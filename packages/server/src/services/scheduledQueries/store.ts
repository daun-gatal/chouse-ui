/**
 * Scheduled Queries store — dialect-aware CRUD + the atomic scheduler lease,
 * run lifecycle, reaper, and outbox claim primitives. Mirrors the low-level
 * `all`/`run` helper shape of `alerting/store.ts`. See ADR 0002 (D1, D5–D7).
 *
 * The job row IS the lease (`last_run_at`); `claimSlot` is the atomic
 * conditional UPDATE whose affected-row count (1 = won) decides ownership under
 * concurrent pods, with no leader election. Booleans persist as 0/1, timestamps
 * as millisecond integers.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import { getDatabase, getDatabaseType, type SqliteDb, type PostgresDb } from "../../rbac/db";
import { logger } from "../../utils/logger";
import {
  isFrequency,
  isOutputMode,
  type OutputConfig,
  type ScheduledQueryOutboxRow,
  type ScheduledQueryRow,
  type ScheduledQueryRunRow,
  type SqOutboxKind,
  type SqStatus,
  type SqTrigger,
} from "./types";

// --- low-level dialect-aware helpers ----------------------------------------

async function all(stmt: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(stmt) as Array<Record<string, unknown>>;
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  return (Array.isArray(anyRes) ? anyRes : anyRes.rows ?? []) as Array<Record<string, unknown>>;
}

async function run(stmt: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(stmt);
    return;
  }
  await (db as PostgresDb).execute(stmt);
}

/** Run a write statement and return the affected-row count (the lease primitive). */
async function execChanges(stmt: ReturnType<typeof sql>): Promise<number> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    const res = (db as SqliteDb).run(stmt) as unknown as { changes?: number };
    return Number(res?.changes ?? 0);
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  return Number(anyRes?.count ?? anyRes?.rowCount ?? 0);
}

const bool = (v: unknown): boolean => Number(v) === 1;
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- row mappers ------------------------------------------------------------

function toJobRow(r: Record<string, unknown>): ScheduledQueryRow {
  const frequency = String(r.frequency);
  const outputMode = String(r.output_mode);
  return {
    id: String(r.id),
    name: String(r.name),
    description: strOrNull(r.description),
    kind: (String(r.kind) as ScheduledQueryRow["kind"]) || "sql_query",
    connectionId: String(r.connection_id),
    query: String(r.query),
    enabled: bool(r.enabled),
    frequency: isFrequency(frequency) ? frequency : "daily",
    hour: Number(r.hour ?? 8),
    dayOfWeek: Number(r.day_of_week ?? 1),
    dayOfMonth: Number(r.day_of_month ?? 1),
    cronExpr: strOrNull(r.cron_expr),
    outputMode: isOutputMode(outputMode) ? outputMode : "none",
    destDatabase: strOrNull(r.dest_database),
    destTable: strOrNull(r.dest_table),
    outputConfig: parseJson<OutputConfig>(r.output_config),
    maxRows: Number(r.max_rows ?? 100),
    timeoutSecs: Number(r.timeout_secs ?? 60),
    useFinal: bool(r.use_final),
    seqConsistency: bool(r.seq_consistency),
    lastRunAt: Number(r.last_run_at ?? 0),
    lastRunBy: strOrNull(r.last_run_by),
    maxAttempts: Number(r.max_attempts ?? 2),
    retentionDays: Number(r.retention_days ?? 90),
    createdBy: strOrNull(r.created_by),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

function toRunRow(r: Record<string, unknown>): ScheduledQueryRunRow {
  return {
    id: String(r.id),
    queryId: String(r.query_id),
    trigger: String(r.trigger) as SqTrigger,
    status: String(r.status) as SqStatus,
    slotAt: Number(r.slot_at ?? 0),
    attempt: Number(r.attempt ?? 1),
    runnerId: strOrNull(r.runner_id),
    deadline: numOrNull(r.deadline),
    rowCount: numOrNull(r.row_count),
    truncated: bool(r.truncated),
    writtenRows: numOrNull(r.written_rows),
    resultJson: strOrNull(r.result_json),
    conditionValue: strOrNull(r.condition_value),
    conditionMet: r.condition_met == null ? null : bool(r.condition_met),
    durationMs: numOrNull(r.duration_ms),
    message: strOrNull(r.message),
    notified: bool(r.notified),
    startedAt: Number(r.started_at ?? 0),
    finishedAt: numOrNull(r.finished_at),
  };
}

function toOutboxRow(r: Record<string, unknown>): ScheduledQueryOutboxRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    queryId: String(r.query_id),
    kind: String(r.kind) as SqOutboxKind,
    dedupKey: String(r.dedup_key),
    payload: String(r.payload),
    status: String(r.status) as ScheduledQueryOutboxRow["status"],
    lockedBy: strOrNull(r.locked_by),
    lockedAt: numOrNull(r.locked_at),
    attempts: Number(r.attempts ?? 0),
    createdAt: Number(r.created_at ?? 0),
    sentAt: numOrNull(r.sent_at),
  };
}

// --- job CRUD ---------------------------------------------------------------

export interface JobInput {
  name: string;
  description: string | null;
  connectionId: string;
  query: string;
  enabled: boolean;
  frequency: ScheduledQueryRow["frequency"];
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string | null;
  outputMode: ScheduledQueryRow["outputMode"];
  destDatabase: string | null;
  destTable: string | null;
  outputConfig: OutputConfig | null;
  maxRows: number;
  timeoutSecs: number;
  useFinal: boolean;
  seqConsistency: boolean;
  maxAttempts: number;
  retentionDays: number;
}

/** List jobs, optionally scoped to a single owner (`created_by`). */
export async function listJobs(ownerId?: string | null): Promise<ScheduledQueryRow[]> {
  const rows = ownerId
    ? await all(sql`SELECT * FROM scheduled_queries WHERE created_by = ${ownerId} ORDER BY name`)
    : await all(sql`SELECT * FROM scheduled_queries ORDER BY name`);
  return rows.map(toJobRow);
}

export async function listEnabledJobs(): Promise<ScheduledQueryRow[]> {
  const rows = await all(sql`SELECT * FROM scheduled_queries WHERE enabled = 1`);
  return rows.map(toJobRow);
}

export async function getJob(id: string): Promise<ScheduledQueryRow | null> {
  const rows = await all(sql`SELECT * FROM scheduled_queries WHERE id = ${id} LIMIT 1`);
  return rows[0] ? toJobRow(rows[0]) : null;
}

export async function createJob(input: JobInput, createdBy: string | null): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const outputConfig = input.outputConfig ? JSON.stringify(input.outputConfig) : null;
  // alert_config/export_enabled/severity are legacy columns kept for schema
  // stability; alerting is now purely failure-based, so they are written as
  // inert defaults and never read.
  await run(sql`
    INSERT INTO scheduled_queries (
      id, name, description, kind, connection_id, query, enabled,
      frequency, hour, day_of_week, day_of_month, cron_expr,
      alert_config, export_enabled, severity,
      output_mode, dest_database, dest_table, output_config,
      max_rows, timeout_secs, use_final, seq_consistency,
      last_run_at, last_run_by, max_attempts, retention_days,
      created_by, created_at, updated_at
    ) VALUES (
      ${id}, ${input.name}, ${input.description}, 'sql_query', ${input.connectionId}, ${input.query}, ${input.enabled ? 1 : 0},
      ${input.frequency}, ${input.hour}, ${input.dayOfWeek}, ${input.dayOfMonth}, ${input.cronExpr},
      NULL, 0, 'warning',
      ${input.outputMode}, ${input.destDatabase}, ${input.destTable}, ${outputConfig},
      ${input.maxRows}, ${input.timeoutSecs}, ${input.useFinal ? 1 : 0}, ${input.seqConsistency ? 1 : 0},
      0, NULL, ${input.maxAttempts}, ${input.retentionDays},
      ${createdBy}, ${now}, ${now}
    )
  `);
  return id;
}

export async function updateJob(id: string, input: JobInput): Promise<boolean> {
  const existing = await getJob(id);
  if (!existing) return false;
  const now = Date.now();
  const outputConfig = input.outputConfig ? JSON.stringify(input.outputConfig) : null;
  await run(sql`
    UPDATE scheduled_queries SET
      name = ${input.name}, description = ${input.description}, connection_id = ${input.connectionId},
      query = ${input.query}, enabled = ${input.enabled ? 1 : 0},
      frequency = ${input.frequency}, hour = ${input.hour}, day_of_week = ${input.dayOfWeek},
      day_of_month = ${input.dayOfMonth}, cron_expr = ${input.cronExpr},
      output_mode = ${input.outputMode}, dest_database = ${input.destDatabase}, dest_table = ${input.destTable},
      output_config = ${outputConfig},
      max_rows = ${input.maxRows}, timeout_secs = ${input.timeoutSecs}, use_final = ${input.useFinal ? 1 : 0},
      seq_consistency = ${input.seqConsistency ? 1 : 0}, max_attempts = ${input.maxAttempts},
      retention_days = ${input.retentionDays}, updated_at = ${now}
    WHERE id = ${id}
  `);
  return true;
}

export async function setJobEnabled(id: string, enabled: boolean): Promise<void> {
  await run(sql`UPDATE scheduled_queries SET enabled = ${enabled ? 1 : 0}, updated_at = ${Date.now()} WHERE id = ${id}`);
}

/** Delete a job and all dependent rows (explicit cascade; dialect-safe). */
export async function deleteJob(id: string): Promise<boolean> {
  const existing = await getJob(id);
  if (!existing) return false;
  await run(sql`DELETE FROM scheduled_query_outbox WHERE query_id = ${id}`);
  await run(sql`DELETE FROM scheduled_query_runs WHERE query_id = ${id}`);
  await run(sql`DELETE FROM scheduled_query_channels WHERE query_id = ${id}`);
  await run(sql`DELETE FROM scheduled_queries WHERE id = ${id}`);
  return true;
}

// --- channels (M:N to notification_channels) --------------------------------

export async function getJobChannelIds(queryId: string): Promise<string[]> {
  const rows = await all(sql`SELECT channel_id FROM scheduled_query_channels WHERE query_id = ${queryId}`);
  return rows.map((r) => String(r.channel_id));
}

export async function setJobChannels(queryId: string, channelIds: string[]): Promise<void> {
  await run(sql`DELETE FROM scheduled_query_channels WHERE query_id = ${queryId}`);
  for (const channelId of channelIds) {
    await run(sql`INSERT INTO scheduled_query_channels (query_id, channel_id) VALUES (${queryId}, ${channelId})`);
  }
}

// --- scheduler lease --------------------------------------------------------

/**
 * Atomic per-job slot claim. Returns true iff THIS caller won the slot — the
 * affected-row count is the lease, correct under concurrent pods (SQLite single
 * writer; PostgreSQL row lock + MVCC re-evaluation under READ COMMITTED).
 */
export async function claimSlot(jobId: string, fireAt: number, now: number, runnerId: string): Promise<boolean> {
  const changes = await execChanges(sql`
    UPDATE scheduled_queries SET last_run_at = ${now}, last_run_by = ${runnerId}
    WHERE id = ${jobId} AND last_run_at < ${fireAt}
  `);
  return changes === 1;
}

/** Re-open a scheduled slot for retry (only if still held by that slot value). */
export async function reopenSlot(jobId: string, slot: number): Promise<boolean> {
  const changes = await execChanges(sql`
    UPDATE scheduled_queries SET last_run_at = 0 WHERE id = ${jobId} AND last_run_at = ${slot}
  `);
  return changes === 1;
}

// --- run lifecycle ----------------------------------------------------------

export interface InsertRunInput {
  id: string;
  queryId: string;
  trigger: SqTrigger;
  slotAt: number;
  attempt: number;
  runnerId: string;
  deadline: number;
  startedAt: number;
}

export async function insertRun(input: InsertRunInput): Promise<void> {
  await run(sql`
    INSERT INTO scheduled_query_runs (id, query_id, trigger, status, slot_at, attempt, runner_id, deadline, truncated, notified, started_at)
    VALUES (${input.id}, ${input.queryId}, ${input.trigger}, 'running', ${input.slotAt}, ${input.attempt}, ${input.runnerId}, ${input.deadline}, 0, 0, ${input.startedAt})
  `);
}

export interface FinalizeRunInput {
  status: SqStatus;
  rowCount: number | null;
  truncated: boolean;
  writtenRows: number | null;
  resultJson: string | null;
  conditionValue: string | null;
  conditionMet: boolean | null;
  durationMs: number;
  message: string | null;
  notified: boolean;
  finishedAt: number;
}

export async function finalizeRun(runId: string, f: FinalizeRunInput): Promise<void> {
  await run(sql`
    UPDATE scheduled_query_runs SET
      status = ${f.status}, row_count = ${f.rowCount}, truncated = ${f.truncated ? 1 : 0},
      written_rows = ${f.writtenRows}, result_json = ${f.resultJson}, condition_value = ${f.conditionValue},
      condition_met = ${f.conditionMet == null ? null : f.conditionMet ? 1 : 0}, duration_ms = ${f.durationMs},
      message = ${f.message}, notified = ${f.notified ? 1 : 0}, finished_at = ${f.finishedAt}
    WHERE id = ${runId}
  `);
}

export async function getRun(runId: string): Promise<ScheduledQueryRunRow | null> {
  const rows = await all(sql`SELECT * FROM scheduled_query_runs WHERE id = ${runId} LIMIT 1`);
  return rows[0] ? toRunRow(rows[0]) : null;
}

export async function listRuns(opts: {
  queryId?: string;
  status?: SqStatus;
  limit: number;
  offset: number;
}): Promise<ScheduledQueryRunRow[]> {
  const conds = [sql`1 = 1`];
  if (opts.queryId) conds.push(sql`query_id = ${opts.queryId}`);
  if (opts.status) conds.push(sql`status = ${opts.status}`);
  const where = sql.join(conds, sql` AND `);
  const rows = await all(sql`
    SELECT * FROM scheduled_query_runs WHERE ${where}
    ORDER BY started_at DESC LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);
  return rows.map(toRunRow);
}

export async function countRunsForSlot(queryId: string, slotAt: number): Promise<number> {
  const rows = await all(sql`SELECT COUNT(*) AS c FROM scheduled_query_runs WHERE query_id = ${queryId} AND slot_at = ${slotAt}`);
  return Number(rows[0]?.c ?? 0);
}

/** The most recent successful run's slot before `beforeSlot` (`{{prev_run_at}}`). */
export async function getLastSuccessSlot(queryId: string, beforeSlot: number): Promise<number | null> {
  const rows = await all(sql`
    SELECT slot_at FROM scheduled_query_runs
    WHERE query_id = ${queryId} AND status = 'success' AND slot_at < ${beforeSlot}
    ORDER BY slot_at DESC LIMIT 1
  `);
  return rows[0] ? Number(rows[0].slot_at) : null;
}

/** The most recent terminal run before `beforeStartedAt` (transition alerting). */
export async function getPreviousTerminalRun(queryId: string, beforeStartedAt: number): Promise<ScheduledQueryRunRow | null> {
  const rows = await all(sql`
    SELECT * FROM scheduled_query_runs
    WHERE query_id = ${queryId} AND status IN ('success','failed','error') AND started_at < ${beforeStartedAt}
    ORDER BY started_at DESC LIMIT 1
  `);
  return rows[0] ? toRunRow(rows[0]) : null;
}

/** Prune runs older than each job's retention window (cascades to outbox). */
export async function pruneOldRuns(): Promise<void> {
  const jobs = await all(sql`SELECT id, retention_days FROM scheduled_queries`);
  const now = Date.now();
  for (const j of jobs) {
    const retentionDays = Number(j.retention_days ?? 90);
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const queryId = String(j.id);
    await run(sql`DELETE FROM scheduled_query_outbox WHERE query_id = ${queryId} AND run_id IN (
      SELECT id FROM scheduled_query_runs WHERE query_id = ${queryId} AND started_at < ${cutoff}
    )`);
    await run(sql`DELETE FROM scheduled_query_runs WHERE query_id = ${queryId} AND started_at < ${cutoff}`);
  }
}

// --- reaper -----------------------------------------------------------------

export interface ReapedRun {
  id: string;
  queryId: string;
  slotAt: number;
  trigger: SqTrigger;
  runnerId: string | null;
}

/**
 * Mark every orphaned `running` run past its deadline as `error`, returning the
 * reaped rows so the caller can KILL QUERY + re-open slots. Idempotent and
 * double-reap-safe (the WHERE excludes already-finalized rows).
 */
export async function reapOrphanedRuns(now: number): Promise<ReapedRun[]> {
  const orphaned = await all(sql`
    SELECT id, query_id, slot_at, trigger, runner_id FROM scheduled_query_runs
    WHERE status = 'running' AND deadline IS NOT NULL AND deadline < ${now}
  `);
  if (orphaned.length === 0) return [];
  await run(sql`
    UPDATE scheduled_query_runs
    SET status = 'error', message = 'reaped: runner lost (deadline exceeded)', finished_at = ${now}
    WHERE status = 'running' AND deadline IS NOT NULL AND deadline < ${now}
  `);
  return orphaned.map((r) => ({
    id: String(r.id),
    queryId: String(r.query_id),
    slotAt: Number(r.slot_at),
    trigger: String(r.trigger) as SqTrigger,
    runnerId: strOrNull(r.runner_id),
  }));
}

// --- outbox -----------------------------------------------------------------

export async function enqueueOutbox(input: {
  runId: string;
  queryId: string;
  kind: SqOutboxKind;
  dedupKey: string;
  payload: string;
}): Promise<void> {
  const id = randomUUID();
  const now = Date.now();
  if (getDatabaseType() === "sqlite") {
    await run(sql`
      INSERT OR IGNORE INTO scheduled_query_outbox (id, run_id, query_id, kind, dedup_key, payload, status, attempts, created_at)
      VALUES (${id}, ${input.runId}, ${input.queryId}, ${input.kind}, ${input.dedupKey}, ${input.payload}, 'pending', 0, ${now})
    `);
  } else {
    await run(sql`
      INSERT INTO scheduled_query_outbox (id, run_id, query_id, kind, dedup_key, payload, status, attempts, created_at)
      VALUES (${id}, ${input.runId}, ${input.queryId}, ${input.kind}, ${input.dedupKey}, ${input.payload}, 'pending', 0, ${now})
      ON CONFLICT (dedup_key) DO NOTHING
    `);
  }
}

export async function listClaimableOutbox(limit: number): Promise<ScheduledQueryOutboxRow[]> {
  const rows = await all(sql`
    SELECT * FROM scheduled_query_outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ${limit}
  `);
  return rows.map(toOutboxRow);
}

/** Atomic per-row outbox claim (pending → sending). True iff this pod won it. */
export async function claimOutboxRow(id: string, podId: string, now: number): Promise<boolean> {
  const changes = await execChanges(sql`
    UPDATE scheduled_query_outbox SET status = 'sending', locked_by = ${podId}, locked_at = ${now}
    WHERE id = ${id} AND status = 'pending'
  `);
  return changes === 1;
}

export async function markOutboxSent(id: string, now: number): Promise<void> {
  await run(sql`UPDATE scheduled_query_outbox SET status = 'sent', sent_at = ${now} WHERE id = ${id}`);
}

export async function markOutboxFailed(id: string): Promise<void> {
  await run(sql`
    UPDATE scheduled_query_outbox SET status = 'pending', locked_by = NULL, locked_at = NULL, attempts = attempts + 1
    WHERE id = ${id}
  `);
}

/** Reset rows stuck in `sending` past the lease TTL (a pod died mid-send). */
export async function reapStuckSending(olderThan: number): Promise<void> {
  await run(sql`
    UPDATE scheduled_query_outbox SET status = 'pending', locked_by = NULL, locked_at = NULL
    WHERE status = 'sending' AND locked_at IS NOT NULL AND locked_at < ${olderThan}
  `);
}

// --- overview aggregation ---------------------------------------------------

export interface OverviewKpis {
  totalJobs: number;
  enabledJobs: number;
  disabledJobs: number;
  failing: number;
  healthy: number;
  neverRun: number;
  runsLast24h: number;
  runsWindow: number;
  successRateWindow: number; // 0..100
  avgDurationMs: number;
  materializeJobs: number;
  alertingJobs: number;
}

export interface FailingJob {
  id: string;
  name: string;
  failureStreak: number;
  lastMessage: string | null;
}

export interface UpcomingRun {
  id: string;
  name: string;
  nextRunAt: number;
}

export interface OverviewSummary {
  kpis: OverviewKpis;
  byCadence: Record<string, number>;
  byOutputMode: Record<string, number>;
  byLastStatus: { success: number; failing: number; running: number; never: number };
  upcoming: UpcomingRun[];
  topFailing: FailingJob[];
}

/**
 * A real summary of the feature — counts, health, breakdowns, and what's next.
 * Scoped to `ownerId` when provided (a user without cross-owner visibility only
 * sees their own jobs/runs).
 */
export async function getOverview(windowDays: number, ownerId?: string | null): Promise<OverviewSummary> {
  const now = Date.now();
  const since = now - windowDays * 24 * 60 * 60 * 1000;
  const since24h = now - 24 * 60 * 60 * 1000;

  const jobs = await listJobs(ownerId ?? undefined);
  const totalJobs = jobs.length;
  const enabledJobs = jobs.filter((j) => j.enabled).length;
  const materializeJobs = jobs.filter((j) => j.outputMode !== "none").length;
  const jobIdSet = new Set(jobs.map((j) => j.id));

  // Limit run aggregates to the visible jobs. With an owner scope and no jobs,
  // `1 = 0` short-circuits the run queries to empty.
  const inScope = ownerId
    ? jobs.length > 0
      ? sql`query_id IN (${sql.join(jobs.map((j) => sql`${j.id}`), sql`, `)})`
      : sql`1 = 0`
    : sql`1 = 1`;

  // Channel links per job → alertingJobs (counted over the visible jobs only).
  const linkRows = await all(sql`SELECT DISTINCT query_id FROM scheduled_query_channels`);
  const alertingJobs = ownerId
    ? linkRows.filter((r) => jobIdSet.has(String(r.query_id))).length
    : linkRows.length;

  const byCadence: Record<string, number> = { daily: 0, weekly: 0, monthly: 0, cron: 0, manual: 0 };
  const byOutputMode: Record<string, number> = { none: 0, append: 0, replace: 0, upsert: 0 };
  for (const j of jobs) {
    byCadence[j.frequency] = (byCadence[j.frequency] ?? 0) + 1;
    byOutputMode[j.outputMode] = (byOutputMode[j.outputMode] ?? 0) + 1;
  }

  // Window run aggregates (success rate + avg duration + counts).
  const runs24hRow = await all(sql`SELECT COUNT(*) AS c FROM scheduled_query_runs WHERE started_at >= ${since24h} AND ${inScope}`);
  const windowRows = await all(sql`
    SELECT status, duration_ms FROM scheduled_query_runs
    WHERE started_at >= ${since} AND status IN ('success','failed','error') AND ${inScope}
  `);
  const runsWindow = windowRows.length;
  let windowSuccess = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const r of windowRows) {
    if (String(r.status) === "success") windowSuccess++;
    if (r.duration_ms != null) {
      durationSum += Number(r.duration_ms);
      durationCount++;
    }
  }

  // Latest-run health per job + failure streaks.
  let failing = 0;
  let healthy = 0;
  let neverRun = 0;
  let running = 0;
  const failingJobs: FailingJob[] = [];
  for (const j of jobs) {
    const recent = await all(sql`
      SELECT status, message FROM scheduled_query_runs
      WHERE query_id = ${j.id} ORDER BY started_at DESC LIMIT 50
    `);
    if (recent.length === 0) {
      neverRun++;
      continue;
    }
    const latest = String(recent[0].status);
    if (latest === "running") running++;
    else if (latest === "failed" || latest === "error") failing++;
    else healthy++;
    let streak = 0;
    let lastMessage: string | null = null;
    for (const r of recent) {
      const s = String(r.status);
      if (s === "failed" || s === "error") {
        streak++;
        if (lastMessage == null) lastMessage = strOrNull(r.message);
      } else break;
    }
    if (streak > 0) failingJobs.push({ id: j.id, name: j.name, failureStreak: streak, lastMessage });
  }
  failingJobs.sort((a, b) => b.failureStreak - a.failureStreak);

  // Upcoming runs — soonest next fire across enabled, non-manual jobs.
  const { nextFireTimes } = await import("./cadence");
  const upcoming: UpcomingRun[] = jobs
    .filter((j) => j.enabled && j.frequency !== "manual")
    .map((j) => {
      const next = nextFireTimes(
        { frequency: j.frequency, hour: j.hour, dayOfWeek: j.dayOfWeek, dayOfMonth: j.dayOfMonth, cronExpr: j.cronExpr },
        1,
        now,
      );
      return next.length > 0 ? { id: j.id, name: j.name, nextRunAt: next[0] } : null;
    })
    .filter((u): u is UpcomingRun => u !== null)
    .sort((a, b) => a.nextRunAt - b.nextRunAt)
    .slice(0, 6);

  return {
    kpis: {
      totalJobs,
      enabledJobs,
      disabledJobs: totalJobs - enabledJobs,
      failing,
      healthy,
      neverRun,
      runsLast24h: Number(runs24hRow[0]?.c ?? 0),
      runsWindow,
      successRateWindow: runsWindow > 0 ? Math.round((windowSuccess / runsWindow) * 100) : 100,
      avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
      materializeJobs,
      alertingJobs,
    },
    byCadence,
    byOutputMode,
    byLastStatus: { success: healthy, failing, running, never: neverRun },
    upcoming,
    topFailing: failingJobs.slice(0, 8),
  };
}
