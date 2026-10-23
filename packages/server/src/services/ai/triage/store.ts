/**
 * Auto-triage rules and runs (ADR 0024 §Phase 4).
 *
 * A trigger without a stored rule is off. Turning a rule on moves its
 * watermark to now, so it triages what appears from then on and never the
 * backlog. A run is claimed with a unique (trigger, subject) insert, so two
 * replicas or two ticks never investigate the same subject twice.
 */

import { randomUUID } from "crypto";

import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../observe/db";
import { TRIAGE_TRIGGERS, type TriageTrigger } from "./subjects";

export const TRIAGE_DEFAULTS = { cooldownMinutes: 60, dailyTokenBudget: 200_000 } as const;
export const TRIAGE_RUN_STATUSES = ["running", "completed", "failed", "skipped"] as const;
export type TriageRunStatus = (typeof TRIAGE_RUN_STATUSES)[number];
/** Runs are kept this long. */
export const TRIAGE_RETENTION_MS = 90 * 24 * 3_600_000;

export interface TriageRule {
  trigger: TriageTrigger;
  enabled: boolean;
  /** The agent that investigates; null means the agent bound to triage-incident. */
  agentId: string | null;
  /** Per trigger and connection: no new investigation sooner than this after the last one. */
  cooldownMinutes: number;
  /** Tokens this trigger may spend per UTC day. */
  dailyTokenBudget: number;
  /** Alerting channels that get the short notice. */
  channelIds: string[];
  /** Who proposed actions are recorded for: the person who last saved the rule. */
  proposeAs: string | null;
  watermark: number;
  updatedBy: string | null;
  updatedAt: number;
}

export interface TriageRun {
  id: string;
  trigger: TriageTrigger;
  subjectId: string;
  subjectTitle: string;
  connectionId: string | null;
  status: TriageRunStatus;
  /** Why a run was skipped. */
  reason: string | null;
  summary: string | null;
  result: Record<string, unknown> | null;
  notebookId: string | null;
  actionIds: string[];
  tokens: number;
  costUsd: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function isTrigger(value: string): value is TriageTrigger {
  return (TRIAGE_TRIGGERS as readonly string[]).includes(value);
}

function defaultRule(trigger: TriageTrigger): TriageRule {
  return { trigger, enabled: false, agentId: null, ...TRIAGE_DEFAULTS, channelIds: [], proposeAs: null, watermark: 0, updatedBy: null, updatedAt: 0 };
}

function rowToRule(r: Row): TriageRule | null {
  const trigger = str(r.trigger);
  if (!isTrigger(trigger)) return null;
  return {
    trigger,
    enabled: num(r.enabled) === 1,
    agentId: strOrNull(r.agent_id),
    cooldownMinutes: num(r.cooldown_minutes),
    dailyTokenBudget: num(r.daily_token_budget),
    channelIds: json<string[]>(r.channel_ids, []).filter((id) => typeof id === "string"),
    proposeAs: strOrNull(r.propose_as),
    watermark: num(r.watermark),
    updatedBy: strOrNull(r.updated_by),
    updatedAt: num(r.updated_at),
  };
}

function rowToRun(r: Row): TriageRun {
  const status = str(r.status);
  const trigger = str(r.trigger);
  return {
    id: str(r.id),
    trigger: isTrigger(trigger) ? trigger : "observe_incident",
    subjectId: str(r.subject_id),
    subjectTitle: str(r.subject_title),
    connectionId: strOrNull(r.connection_id),
    status: (TRIAGE_RUN_STATUSES as readonly string[]).includes(status) ? (status as TriageRunStatus) : "failed",
    reason: strOrNull(r.reason),
    summary: strOrNull(r.summary),
    result: json<Record<string, unknown> | null>(r.result, null),
    notebookId: strOrNull(r.notebook_id),
    actionIds: json<string[]>(r.action_ids, []),
    tokens: num(r.tokens),
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
    error: strOrNull(r.error),
    startedAt: num(r.started_at),
    finishedAt: numOrNull(r.finished_at),
  };
}

/** Every trigger's rule, stored or default (off). */
export async function listRules(): Promise<TriageRule[]> {
  const stored = new Map<TriageTrigger, TriageRule>();
  for (const row of await all(sql`SELECT * FROM ai_triage_rules`)) {
    const rule = rowToRule(row);
    if (rule) stored.set(rule.trigger, rule);
  }
  return TRIAGE_TRIGGERS.map((t) => stored.get(t) ?? defaultRule(t));
}

export async function getRule(trigger: TriageTrigger): Promise<TriageRule> {
  const row = await one(sql`SELECT * FROM ai_triage_rules WHERE trigger = ${trigger}`);
  return (row && rowToRule(row)) || defaultRule(trigger);
}

export interface TriageRuleInput {
  enabled: boolean;
  agentId: string | null;
  cooldownMinutes: number;
  dailyTokenBudget: number;
  channelIds: string[];
}

export async function saveRule(trigger: TriageTrigger, input: TriageRuleInput, actor: string): Promise<TriageRule> {
  const current = await getRule(trigger);
  const now = Date.now();
  // Turning a rule on starts from now: the backlog is never triaged.
  const watermark = input.enabled && !current.enabled ? now : current.watermark;
  const channels = JSON.stringify([...new Set(input.channelIds)]);
  const enabled = input.enabled ? 1 : 0;
  await run(sql`
    INSERT INTO ai_triage_rules (trigger, enabled, agent_id, cooldown_minutes, daily_token_budget, channel_ids, propose_as, watermark, updated_by, updated_at)
    VALUES (${trigger}, ${enabled}, ${input.agentId}, ${input.cooldownMinutes}, ${input.dailyTokenBudget}, ${channels}, ${actor}, ${watermark}, ${actor}, ${now})
    ON CONFLICT (trigger) DO UPDATE SET enabled = ${enabled}, agent_id = ${input.agentId}, cooldown_minutes = ${input.cooldownMinutes},
      daily_token_budget = ${input.dailyTokenBudget}, channel_ids = ${channels}, propose_as = ${actor}, watermark = ${watermark},
      updated_by = ${actor}, updated_at = ${now}`);
  return getRule(trigger);
}

export async function setWatermark(trigger: TriageTrigger, at: number): Promise<void> {
  await run(sql`UPDATE ai_triage_rules SET watermark = ${at} WHERE trigger = ${trigger} AND watermark < ${at}`);
}

/** Claim a subject; null when another tick or replica already took it. */
export async function claimRun(subject: { trigger: TriageTrigger; id: string; title: string; connectionId: string | null }): Promise<TriageRun | null> {
  const id = randomUUID();
  const claimed = await one(sql`
    INSERT INTO ai_triage_runs (id, trigger, subject_id, subject_title, connection_id, status, started_at)
    VALUES (${id}, ${subject.trigger}, ${subject.id}, ${subject.title.slice(0, 500)}, ${subject.connectionId}, 'running', ${Date.now()})
    ON CONFLICT (trigger, subject_id) DO NOTHING RETURNING id`);
  return claimed ? getRun(id) : null;
}

export async function getRun(id: string): Promise<TriageRun | null> {
  const row = await one(sql`SELECT * FROM ai_triage_runs WHERE id = ${id}`);
  return row ? rowToRun(row) : null;
}

export async function runForSubject(trigger: TriageTrigger, subjectId: string): Promise<TriageRun | null> {
  const row = await one(sql`SELECT * FROM ai_triage_runs WHERE trigger = ${trigger} AND subject_id = ${subjectId}`);
  return row ? rowToRun(row) : null;
}

export interface TriageRunUpdate {
  status: Exclude<TriageRunStatus, "running">;
  reason?: string | null;
  summary?: string | null;
  result?: Record<string, unknown> | null;
  notebookId?: string | null;
  actionIds?: string[];
  tokens?: number;
  costUsd?: number | null;
  error?: string | null;
}

export async function finishRun(id: string, update: TriageRunUpdate): Promise<TriageRun | null> {
  await run(sql`
    UPDATE ai_triage_runs SET status = ${update.status}, reason = ${update.reason ?? null}, summary = ${update.summary ?? null},
      result = ${update.result ? JSON.stringify(update.result) : null}, notebook_id = ${update.notebookId ?? null},
      action_ids = ${JSON.stringify(update.actionIds ?? [])}, tokens = ${update.tokens ?? 0}, cost_usd = ${update.costUsd ?? null},
      error = ${update.error ?? null}, finished_at = ${Date.now()}
    WHERE id = ${id}`);
  return getRun(id);
}

/** When this trigger last investigated this connection (skipped runs don't count). */
export async function lastInvestigatedAt(trigger: TriageTrigger, connectionId: string | null, exceptRunId: string): Promise<number | null> {
  const row = await one(sql`
    SELECT MAX(started_at) AS at FROM ai_triage_runs
    WHERE trigger = ${trigger} AND status IN ('running', 'completed', 'failed') AND id <> ${exceptRunId}
      AND ${connectionId === null ? sql`connection_id IS NULL` : sql`connection_id = ${connectionId}`}`);
  return row ? numOrNull(row.at) : null;
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Tokens a trigger spent since 00:00 UTC. */
export async function tokensToday(trigger: TriageTrigger, now = Date.now()): Promise<number> {
  const row = await one(sql`SELECT COALESCE(SUM(tokens), 0) AS n FROM ai_triage_runs WHERE trigger = ${trigger} AND started_at >= ${startOfUtcDay(now)}`);
  return row ? num(row.n) : 0;
}

export async function listRuns(filter: { trigger?: TriageTrigger; status?: TriageRunStatus; limit?: number; offset?: number }): Promise<{ runs: TriageRun[]; total: number }> {
  const conditions = [sql`1 = 1`];
  if (filter.trigger) conditions.push(sql`trigger = ${filter.trigger}`);
  if (filter.status) conditions.push(sql`status = ${filter.status}`);
  const where = sql.join(conditions, sql` AND `);
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  const rows = await all(sql`SELECT * FROM ai_triage_runs WHERE ${where} ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`);
  const count = await one(sql`SELECT COUNT(*) AS n FROM ai_triage_runs WHERE ${where}`);
  return { runs: rows.map(rowToRun), total: count ? num(count.n) : 0 };
}

/** Runs a replica left `running` when it died: marked failed so the subject shows what happened. */
export async function failStaleRuns(olderThanMs: number): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const rows = await all(sql`UPDATE ai_triage_runs SET status = 'failed', error = 'The investigation stopped (the server restarted).', finished_at = ${Date.now()}
    WHERE status = 'running' AND started_at < ${cutoff} RETURNING id`);
  return rows.length;
}

export async function pruneRuns(now = Date.now()): Promise<void> {
  await run(sql`DELETE FROM ai_triage_runs WHERE started_at < ${now - TRIAGE_RETENTION_MS}`);
}
