/**
 * Upgrade readiness (ADR 0016 §9): match the versioned rules pack against the
 * real workload, add regressions already seen on upgraded replicas, and
 * replay the top read-only query shapes against a canary connection.
 * CHouse UI never performs the upgrade itself.
 */

import { randomUUID } from "crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { z } from "zod";

import { logger } from "../../utils/logger";
import { all, json, num, numOrNull, one, run, sql, str, strOrNull } from "../observe/db";
import { selectRows, NOT_OBSERVE } from "../observe/clickhouse";
import { clientForConnection } from "../scheduledQueries/chClient";
import rulesPack from "./rules/clickhouse.json";

const ruleSchema = z.object({
  id: z.string(),
  since: z.string(),
  category: z.string(),
  severity: z.enum(["blocker", "warning", "info"]),
  title: z.string(),
  detail: z.string(),
  match: z.object({
    columnTypePrefix: z.string().optional(),
    databaseEngine: z.string().optional(),
    settingDisabled: z.array(z.string()).optional(),
    profileSetting: z.string().optional(),
    querySettingPrefix: z.string().optional(),
    functionUsed: z.string().optional(),
  }),
});
export type UpgradeRule = z.infer<typeof ruleSchema>;

export const RULES: UpgradeRule[] = z.object({ rules: z.array(ruleSchema) }).parse(rulesPack).rules;
export const RULES_VERSION: number = (rulesPack as { version: number }).version;

/** Numeric compare of dotted versions ("25.3.1.2" vs "24.11"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface WorkloadFacts {
  columnTypes: Array<{ table: string; column: string; type: string }>;
  databaseEngines: Array<{ database: string; engine: string }>;
  profileSettings: Array<{ target: string; setting: string; value: string }>;
  querySettings: Array<{ setting: string; value: string; shapes: number }>;
  functions: Array<{ name: string; shapes: number }>;
}

export interface Finding {
  category: string;
  severity: "blocker" | "warning" | "info";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
}

/** Pure: which rules hit this workload for an upgrade to `target`. */
export function matchRules(rules: UpgradeRule[], facts: WorkloadFacts, target: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    if (compareVersions(target, rule.since) < 0) continue;
    const m = rule.match;
    let evidence: unknown[] = [];
    if (m.columnTypePrefix) evidence = facts.columnTypes.filter((c) => c.type.startsWith(m.columnTypePrefix!));
    if (m.databaseEngine) {
      const re = new RegExp(`^(${m.databaseEngine})$`);
      evidence = facts.databaseEngines.filter((d) => re.test(d.engine));
    }
    if (m.settingDisabled) {
      const names = new Set(m.settingDisabled);
      evidence = [
        ...facts.profileSettings.filter((s) => names.has(s.setting) && ["0", "false"].includes(s.value.toLowerCase())),
        ...facts.querySettings.filter((s) => names.has(s.setting) && ["0", "false"].includes(s.value.toLowerCase())),
      ];
    }
    if (m.profileSetting) evidence = facts.profileSettings.filter((s) => s.setting === m.profileSetting);
    if (m.querySettingPrefix) evidence = facts.querySettings.filter((s) => s.setting.startsWith(m.querySettingPrefix!));
    if (m.functionUsed) evidence = facts.functions.filter((f) => f.name === m.functionUsed);
    if (evidence.length === 0) continue;
    findings.push({ category: rule.category, severity: rule.severity, title: rule.title, detail: rule.detail, evidence: { ruleId: rule.id, matches: evidence.slice(0, 50), total: evidence.length } });
  }
  return findings;
}

async function gatherFacts(client: ClickHouseClient): Promise<WorkloadFacts> {
  const columnTypes = (await selectRows<{ db: string; tbl: string; name: string; type: string }>(client, `
    SELECT database AS db, table AS tbl, name, type FROM system.columns
    WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND (type LIKE 'Object(%' OR type LIKE '%JSON%') LIMIT 1000`))
    .map((c) => ({ table: `${c.db}.${c.tbl}`, column: c.name, type: c.type }));
  const databaseEngines = (await selectRows<{ name: string; engine: string }>(client, "SELECT name, engine FROM system.databases WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')"))
    .map((d) => ({ database: d.name, engine: d.engine }));
  const profileSettings = (await selectRows<{ target: string; setting_name: string; value: string }>(client, `
    SELECT coalesce(profile_name, user_name, role_name, '') AS target, setting_name, coalesce(value, '') AS value
    FROM system.settings_profile_elements WHERE setting_name IS NOT NULL`)).map((s) => ({ target: s.target, setting: s.setting_name, value: s.value }));
  const querySettings = (await selectRows<{ setting: string; value: string; shapes: number }>(client, `
    SELECT k AS setting, v AS value, uniqExact(normalized_query_hash) AS shapes
    FROM system.query_log ARRAY JOIN mapKeys(Settings) AS k, mapValues(Settings) AS v
    WHERE event_time > now() - INTERVAL 30 DAY AND type = 'QueryFinish' AND ${NOT_OBSERVE}
      AND (k LIKE 'allow_experimental%' OR k IN ('enable_analyzer', 'allow_experimental_analyzer', 'compatibility'))
    GROUP BY setting, value LIMIT 500`, { maxExecutionTime: 60 }));
  const functions = (await selectRows<{ name: string; shapes: number }>(client, `
    SELECT f AS name, uniqExact(normalized_query_hash) AS shapes FROM system.query_log ARRAY JOIN used_functions AS f
    WHERE event_time > now() - INTERVAL 30 DAY AND type = 'QueryFinish' AND ${NOT_OBSERVE} GROUP BY name LIMIT 5000`, { maxExecutionTime: 60 }));
  return { columnTypes, databaseEngines, profileSettings, querySettings, functions };
}

export interface Assessment {
  id: string;
  connectionId: string;
  currentVersion: string | null;
  targetVersion: string;
  status: string;
  verdict: string | null;
  summary: Record<string, unknown>;
  createdAt: number;
  finishedAt: number | null;
  findings: Array<Finding & { id: string }>;
}

export async function runAssessment(connectionId: string, targetVersion: string, actorId: string | null): Promise<Assessment> {
  const id = randomUUID();
  const now = Date.now();
  await run(sql`INSERT INTO upgrade_assessments (id, connection_id, target_version, status, created_by, created_at) VALUES (${id}, ${connectionId}, ${targetVersion}, 'running', ${actorId}, ${now})`);
  try {
    const client = await clientForConnection(connectionId, JSON.stringify({ source: "observe", collector: "upgrades" }));
    const [v] = await selectRows<{ v: string }>(client, "SELECT version() AS v");
    const facts = await gatherFacts(client);
    const findings = matchRules(RULES, facts, targetVersion);
    // Regressions already open on replicas running a version at or above the target are blockers.
    const regressions = await all(sql`SELECT r.*, f.server_version FROM obs_regressions r
      LEFT JOIN (SELECT fingerprint, replica, MAX(server_version) AS server_version FROM obs_fingerprint_rollups WHERE connection_id = ${connectionId} GROUP BY fingerprint, replica) f
        ON f.fingerprint = r.fingerprint AND f.replica = r.replica
      WHERE r.connection_id = ${connectionId} AND r.status = 'open'`);
    for (const r of regressions) {
      const linked = json<Array<{ kind: string; summary: string }>>(r.linked_changes, []);
      if (!linked.some((c) => c.kind === "version")) continue;
      findings.push({ category: "regression", severity: "blocker", title: `Query shape ${str(r.fingerprint)} is ${num(r.ratio)}× slower after an upgrade`, detail: `${str(r.metric)} rose from ${num(r.baseline_value)} to ${num(r.current_value)} on ${str(r.replica)}. Fix it before upgrading more replicas.`, evidence: { fingerprint: str(r.fingerprint), replica: str(r.replica), linkedChanges: linked } });
    }
    for (const f of findings) {
      await run(sql`INSERT INTO upgrade_findings (id, assessment_id, category, severity, title, detail, evidence) VALUES (${randomUUID()}, ${id}, ${f.category}, ${f.severity}, ${f.title}, ${f.detail}, ${JSON.stringify(f.evidence)})`);
    }
    const blockers = findings.filter((f) => f.severity === "blocker").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;
    const verdict = blockers > 0 ? "not_ready" : warnings > 0 ? "ready_with_warnings" : "ready";
    const summary = { blockers, warnings, info: findings.length - blockers - warnings, rulesVersion: RULES_VERSION, rulesChecked: RULES.length };
    await run(sql`UPDATE upgrade_assessments SET status = 'done', verdict = ${verdict}, current_version = ${v?.v ?? null}, summary = ${JSON.stringify(summary)}, finished_at = ${Date.now()} WHERE id = ${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ module: "Upgrades", assessmentId: id, err: message }, "Upgrade assessment failed");
    await run(sql`UPDATE upgrade_assessments SET status = 'failed', summary = ${JSON.stringify({ error: message.slice(0, 500) })}, finished_at = ${Date.now()} WHERE id = ${id}`);
  }
  return (await getAssessment(id))!;
}

export async function getAssessment(id: string): Promise<Assessment | null> {
  const a = await one(sql`SELECT * FROM upgrade_assessments WHERE id = ${id}`);
  if (!a) return null;
  const findings = (await all(sql`SELECT * FROM upgrade_findings WHERE assessment_id = ${id}`)).map((f) => ({
    id: str(f.id), category: str(f.category), severity: str(f.severity) as Finding["severity"], title: str(f.title), detail: str(f.detail), evidence: json<Record<string, unknown>>(f.evidence, {}),
  }));
  const order = { blocker: 0, warning: 1, info: 2 };
  findings.sort((x, y) => order[x.severity] - order[y.severity]);
  return {
    id, connectionId: str(a.connection_id), currentVersion: strOrNull(a.current_version), targetVersion: str(a.target_version), status: str(a.status),
    verdict: strOrNull(a.verdict), summary: json(a.summary, {}), createdAt: num(a.created_at), finishedAt: numOrNull(a.finished_at), findings,
  };
}

export async function listAssessments(connectionId: string): Promise<Array<Omit<Assessment, "findings">>> {
  return (await all(sql`SELECT * FROM upgrade_assessments WHERE connection_id = ${connectionId} ORDER BY created_at DESC LIMIT 50`)).map((a) => ({
    id: str(a.id), connectionId, currentVersion: strOrNull(a.current_version), targetVersion: str(a.target_version), status: str(a.status), verdict: strOrNull(a.verdict),
    summary: json(a.summary, {}), createdAt: num(a.created_at), finishedAt: numOrNull(a.finished_at),
  }));
}

// --- workload replay -----------------------------------------------------------

/** Queries whose results legitimately differ between runs are not replayed. */
export function replayable(query: string): boolean {
  const q = query.toLowerCase();
  if (!/^\s*(with|select)\b/.test(q)) return false;
  if (/\bsystem\./.test(q)) return false;
  if (/\b(now|now64|today|yesterday|rand|rand64|randcanonical|generateuuidv4|currentuser|hostname|uptime|version)\s*\(/.test(q)) return false;
  return true;
}

/** HTTP clients append `FORMAT …`; the comparison wraps the query, so the clause goes. */
export function stripFormat(query: string): string {
  return query.replace(/;\s*$/, "").replace(/\s+FORMAT\s+\w+\s*;?\s*$/i, "");
}

export function replayQuery(query: string): string {
  return `SELECT count() AS c, sum(cityHash64(*)) AS h FROM (${stripFormat(query)})`;
}

async function timed(client: ClickHouseClient, query: string): Promise<{ hash: string; ms: number }> {
  const started = Date.now();
  const rows = await selectRows<{ c: number; h: string | number }>(client, query, { maxExecutionTime: 60 });
  return { hash: `${rows[0]?.c ?? 0}:${rows[0]?.h ?? 0}`, ms: Date.now() - started };
}

export async function runReplay(connectionId: string, canaryConnectionId: string, assessmentId: string | null, actorId: string | null, limit = 500): Promise<string> {
  const id = randomUUID();
  await run(sql`INSERT INTO replay_runs (id, assessment_id, connection_id, canary_connection_id, status, requested_by, started_at) VALUES (${id}, ${assessmentId}, ${connectionId}, ${canaryConnectionId}, 'running', ${actorId}, ${Date.now()})`);
  void (async () => {
    const counts = { total: 0, same: 0, differs: 0, slower: 0, errors: 0 };
    try {
      const comment = JSON.stringify({ source: "observe", collector: "replay", run_id: id });
      const base = await clientForConnection(connectionId, comment);
      const canary = await clientForConnection(canaryConnectionId, comment);
      const shapes = await all(sql`
        SELECT fingerprint, MAX(sample_query) AS sample_query, SUM(total_ms) AS total FROM obs_query_fingerprints
        WHERE connection_id = ${connectionId} AND query_kind = 'Select' GROUP BY fingerprint ORDER BY total DESC LIMIT ${limit * 2}`);
      for (const s of shapes) {
        if (counts.total >= limit) break;
        const query = str(s.sample_query);
        if (!replayable(query)) continue;
        counts.total++;
        let outcome = "same";
        let b: { hash: string; ms: number } | null = null;
        let k: { hash: string; ms: number } | null = null;
        let error: string | null = null;
        try {
          b = await timed(base, replayQuery(query));
          k = await timed(canary, replayQuery(query));
          if (b.hash !== k.hash) outcome = "differs";
          else if (k.ms >= Math.max(50, b.ms * 1.5)) outcome = "slower";
        } catch (e) {
          outcome = "error";
          error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        }
        if (outcome === "same") counts.same++;
        if (outcome === "differs") counts.differs++;
        if (outcome === "slower") counts.slower++;
        if (outcome === "error") counts.errors++;
        await run(sql`
          INSERT INTO replay_results (run_id, fingerprint, outcome, baseline_ms, canary_ms, baseline_hash, canary_hash, error)
          VALUES (${id}, ${str(s.fingerprint)}, ${outcome}, ${b?.ms ?? null}, ${k?.ms ?? null}, ${b?.hash ?? null}, ${k?.hash ?? null}, ${error})
          ON CONFLICT (run_id, fingerprint) DO NOTHING`);
      }
      await run(sql`UPDATE replay_runs SET status = 'done', total = ${counts.total}, same = ${counts.same}, differs = ${counts.differs}, slower = ${counts.slower}, errors = ${counts.errors}, finished_at = ${Date.now()} WHERE id = ${id}`);
    } catch (error) {
      logger.warn({ module: "Upgrades", replayId: id, err: error instanceof Error ? error.message : String(error) }, "Workload replay failed");
      await run(sql`UPDATE replay_runs SET status = 'failed', total = ${counts.total}, same = ${counts.same}, differs = ${counts.differs}, slower = ${counts.slower}, errors = ${counts.errors}, finished_at = ${Date.now()} WHERE id = ${id}`);
    }
  })();
  return id;
}

export async function getReplay(id: string, canSeeQueryText: boolean): Promise<Record<string, unknown> | null> {
  const r = await one(sql`SELECT * FROM replay_runs WHERE id = ${id}`);
  if (!r) return null;
  const results = await all(sql`
    SELECT rr.*, f.sample_query FROM replay_results rr
    LEFT JOIN (SELECT fingerprint, MAX(sample_query) AS sample_query FROM obs_query_fingerprints GROUP BY fingerprint) f ON f.fingerprint = rr.fingerprint
    WHERE rr.run_id = ${id} AND rr.outcome <> 'same' LIMIT 200`);
  return {
    id, connectionId: str(r.connection_id), canaryConnectionId: str(r.canary_connection_id), status: str(r.status),
    total: num(r.total), same: num(r.same), differs: num(r.differs), slower: num(r.slower), errors: num(r.errors), startedAt: num(r.started_at), finishedAt: numOrNull(r.finished_at),
    results: results.map((x) => ({ fingerprint: str(x.fingerprint), outcome: str(x.outcome), baselineMs: numOrNull(x.baseline_ms), canaryMs: numOrNull(x.canary_ms), error: strOrNull(x.error), sampleQuery: canSeeQueryText ? strOrNull(x.sample_query) : null })),
  };
}

export async function listReplays(connectionId: string): Promise<Array<Record<string, unknown>>> {
  return (await all(sql`SELECT * FROM replay_runs WHERE connection_id = ${connectionId} ORDER BY started_at DESC LIMIT 20`)).map((r) => ({
    id: str(r.id), canaryConnectionId: str(r.canary_connection_id), status: str(r.status), total: num(r.total), same: num(r.same), differs: num(r.differs), slower: num(r.slower), errors: num(r.errors), startedAt: num(r.started_at),
  }));
}
