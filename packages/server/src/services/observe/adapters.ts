/**
 * Source adapters (ADR 0016 §4). Each adapter discovers its pipelines from the
 * catalog and turns engine-specific evidence into the normalized
 * `PipelineSample`; the classifier in pipelineStatus.ts then judges every kind
 * with one vocabulary. Columns used here were verified against
 * ClickHouse 26.5 system tables; anything missing on a server version makes
 * the adapter report `unsupported_on_version` instead of guessing.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { hasColumn, hasTable, missingMessage, type Capabilities } from "./capabilities";
import { NOT_OBSERVE, selectRows } from "./clickhouse";
import { classifyError } from "./errorClass";
import type { PipelineSample } from "./pipelineStatus";
import { OBJECT_STORAGE_QUEUE_ENGINES, parseMvTarget, QUEUE_ENGINES } from "./catalogParse";

export const PIPELINE_KINDS = [
  "materialized_view",
  "refreshable_view",
  "queue_engine",
  "object_storage_queue",
  "database_replication",
  "external_table",
  "distributed",
  "dictionary",
  "async_insert",
  "buffer",
  "writer",
  "scheduled_job",
] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export interface CatalogTable {
  database: string;
  table: string;
  engine: string;
  createQuery: string;
  totalRows: number | null;
}

export interface PipelineDef {
  id: string;
  kind: PipelineKind;
  engine: string;
  name: string;
  sourceLabel: string | null;
  sourceNode: string | null;
  targetNode: string | null;
  attrs: Record<string, unknown>;
}

export interface AdapterContext {
  client: ClickHouseClient;
  capabilities: Capabilities;
  nowMs: number;
  sinceMs: number;
  /** Previous attrs per pipeline (counters for diffing). */
  previous: Map<string, Record<string, unknown>>;
  /** MV views by their source table node (for queue engines without a status table). */
  viewsBySource: Map<string, string[]>;
}

export interface AdapterResult {
  defs: PipelineDef[];
  samples: Map<string, PipelineSample>;
  /** Pipelines whose evidence is missing on this server version. */
  unsupported: Map<string, string>;
  /** Updated attrs (e.g. counters) to persist per pipeline. */
  attrs: Map<string, Record<string, unknown>>;
}

const tableNode = (database: string, table: string): string => `table:${database}.${table}`;

function emptySample(nowMs: number): PipelineSample {
  return { sampledAt: nowMs, unitsIn: null, bytesIn: null, lastSuccessAt: null, lagSeconds: null, backlog: null, backlogUnit: null, errors: null, errorSample: null, errorClass: null, progressing: null };
}

function sec(ms: number): number {
  return Math.floor(ms / 1000);
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function result(): AdapterResult {
  return { defs: [], samples: new Map(), unsupported: new Map(), attrs: new Map() };
}

// --- incremental / refreshable materialized views --------------------------

interface ViewStats {
  view_name: string;
  ok: number;
  /** Successful runs that wrote rows; queue-attached views also log empty polls as successes. */
  wrote: number;
  failed: number;
  written: number;
  bytes: number;
  last_ok_ms: number;
  last_write_ms: number;
  last_exception: string;
}

/**
 * A view run counts as progress when it wrote rows, or when nothing failed
 * at all (an insert-driven view whose SELECT filtered everything out is fine).
 * Empty polls of a queue engine alongside failing batches are not progress.
 */
export function viewProgress(stats: Array<Pick<ViewStats, "ok" | "wrote" | "failed">>): boolean {
  const wrote = stats.reduce((s, v) => s + Number(v.wrote), 0);
  const ok = stats.reduce((s, v) => s + Number(v.ok), 0);
  const failed = stats.reduce((s, v) => s + Number(v.failed), 0);
  return wrote > 0 || (ok > 0 && failed === 0);
}

async function viewStats(ctx: AdapterContext): Promise<Map<string, ViewStats>> {
  if (!hasTable(ctx.capabilities, "query_views_log")) return new Map();
  const rows = await selectRows<ViewStats>(ctx.client, `
    SELECT view_name,
      countIf(status = 'QueryFinish') AS ok,
      countIf(status = 'QueryFinish' AND written_rows > 0) AS wrote,
      countIf(status IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed,
      sumIf(written_rows, status = 'QueryFinish') AS written,
      sumIf(written_bytes, status = 'QueryFinish') AS bytes,
      toUnixTimestamp64Milli(maxIf(event_time_microseconds, status = 'QueryFinish')) AS last_ok_ms,
      toUnixTimestamp64Milli(maxIf(event_time_microseconds, status = 'QueryFinish' AND written_rows > 0)) AS last_write_ms,
      argMaxIf(exception, event_time_microseconds, exception != '') AS last_exception
    FROM system.query_views_log
    WHERE event_time > fromUnixTimestamp({since:UInt32})
    GROUP BY view_name`, { params: { since: sec(ctx.sinceMs) } });
  return new Map(rows.map((r) => [r.view_name, r]));
}

const STICKY_LOOKBACK_SECONDS = 24 * 3600;

/**
 * Views whose latest failure is newer than their latest write, over a day.
 * Queue consumers (RabbitMQ, NATS) hold or drop a failed batch and then only
 * log empty polls, so a per-run window forgets the failure after one sample;
 * this keeps it visible until data flows again.
 */
async function stuckViews(ctx: AdapterContext, names: string[]): Promise<Map<string, string>> {
  if (names.length === 0 || !hasTable(ctx.capabilities, "query_views_log")) return new Map();
  // The alias must not be `exception`: HAVING below would resolve to it.
  const rows = await selectRows<{ view_name: string; last_exception: string }>(ctx.client, `
    SELECT view_name, argMaxIf(exception, event_time_microseconds, exception != '') AS last_exception
    FROM system.query_views_log
    WHERE event_time > now() - {lookback:UInt32} AND view_name IN ({names:Array(String)})
    GROUP BY view_name
    HAVING maxIf(event_time_microseconds, exception != '') > maxIf(event_time_microseconds, status = 'QueryFinish' AND written_rows > 0)`, { params: { lookback: STICKY_LOOKBACK_SECONDS, names } });
  return new Map(rows.map((r) => [r.view_name, r.last_exception]));
}

export async function materializedViews(ctx: AdapterContext, tables: CatalogTable[]): Promise<AdapterResult> {
  const out = result();
  const views = tables.filter((t) => t.engine === "MaterializedView" && !/\bREFRESH\s+(EVERY|AFTER)\b/i.test(t.createQuery));
  const stats = await viewStats(ctx);
  for (const v of views) {
    const id = `materialized_view:${v.database}.${v.table}`;
    out.defs.push({ id, kind: "materialized_view", engine: "MaterializedView", name: `${v.database}.${v.table}`, sourceLabel: null, sourceNode: null, targetNode: tableNode(v.database, v.table), attrs: {} });
    if (!hasTable(ctx.capabilities, "query_views_log")) {
      out.unsupported.set(id, missingMessage(ctx.capabilities, "query_views_log"));
      continue;
    }
    const s = stats.get(`${v.database}.${v.table}`);
    const sample = emptySample(ctx.nowMs);
    if (s) {
      sample.unitsIn = Number(s.written);
      sample.bytesIn = Number(s.bytes);
      sample.errors = Number(s.failed);
      sample.errorSample = s.last_exception || null;
      sample.errorClass = classifyError(s.last_exception);
      sample.lastSuccessAt = Number(s.last_ok_ms) > 0 ? Number(s.last_ok_ms) : null;
      sample.progressing = viewProgress([s]);
    }
    out.samples.set(id, sample);
  }
  return out;
}

const INTERVAL_UNIT_SECONDS: Record<string, number> = {
  SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86_400, WEEK: 604_800, MONTH: 31 * 86_400, QUARTER: 92 * 86_400, YEAR: 366 * 86_400,
};

/** Sum an interval such as "1 HOUR 30 MINUTE" starting at `from`; null when none is there. */
function intervalSecondsAt(query: string, from: number): number | null {
  const part = /^\s*(\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|QUARTER|YEAR)S?\b/i;
  let rest = query.slice(from);
  let total = 0;
  for (let m = part.exec(rest); m; m = part.exec(rest)) {
    total += Number(m[1]) * INTERVAL_UNIT_SECONDS[m[2].toUpperCase()];
    rest = rest.slice(m[0].length);
  }
  return total > 0 ? total : null;
}

/**
 * The longest normal gap between refreshes of a refreshable view, in seconds:
 * its EVERY / AFTER interval plus any RANDOMIZE FOR jitter. Null when the
 * clause cannot be read, so the view is never judged against a guess.
 */
export function refreshPeriodSeconds(createQuery: string): number | null {
  const head = /\bREFRESH\s+(?:EVERY|AFTER)\b/i.exec(createQuery);
  if (!head) return null;
  const period = intervalSecondsAt(createQuery, head.index + head[0].length);
  if (period === null) return null;
  const jitter = /\bRANDOMIZE\s+FOR\b/i.exec(createQuery);
  return period + (jitter ? intervalSecondsAt(createQuery, jitter.index + jitter[0].length) ?? 0 : 0);
}

export async function refreshableViews(ctx: AdapterContext, tables: CatalogTable[]): Promise<AdapterResult> {
  const out = result();
  const views = tables.filter((t) => t.engine === "MaterializedView" && /\bREFRESH\s+(EVERY|AFTER)\b/i.test(t.createQuery));
  if (views.length === 0) return out;
  const supported = hasTable(ctx.capabilities, "view_refreshes") && hasColumn(ctx.capabilities, "view_refreshes", "last_success_time");
  const rows = supported
    ? await selectRows<{ database: string; view: string; status: string; last_success: number; next_refresh: number; exception: string; retry: number; written_rows: number }>(ctx.client, `
      SELECT database, view, toString(status) AS status,
        toUnixTimestamp(last_success_time) * 1000 AS last_success,
        toUnixTimestamp(next_refresh_time) * 1000 AS next_refresh,
        exception, retry, written_rows
      FROM system.view_refreshes`)
    : [];
  const byView = new Map(rows.map((r) => [`${r.database}.${r.view}`, r]));
  for (const v of views) {
    const id = `refreshable_view:${v.database}.${v.table}`;
    const periodSeconds = refreshPeriodSeconds(v.createQuery);
    // A `TO` view refreshes into another table; that table is what goes stale.
    const to = parseMvTarget(v.createQuery, v.database);
    const writesTo = to ? tableNode(to.database, to.table) : tableNode(v.database, v.table);
    out.defs.push({ id, kind: "refreshable_view", engine: "MaterializedView REFRESH", name: `${v.database}.${v.table}`, sourceLabel: null, sourceNode: null, targetNode: tableNode(v.database, v.table), attrs: { periodSeconds, writesTo } });
    if (!supported) {
      out.unsupported.set(id, missingMessage(ctx.capabilities, "view_refreshes"));
      continue;
    }
    const r = byView.get(`${v.database}.${v.table}`);
    const sample = emptySample(ctx.nowMs);
    if (r) {
      sample.lastSuccessAt = Number(r.last_success) > 0 ? Number(r.last_success) : null;
      sample.errors = r.exception ? 1 : 0;
      sample.errorSample = r.exception || null;
      sample.errorClass = classifyError(r.exception);
      sample.unitsIn = Number(r.written_rows ?? 0);
      // A refresh retrying with an exception makes no progress until it succeeds;
      // before the first success, progress is unknown rather than assumed.
      sample.progressing = r.exception ? false : sample.lastSuccessAt !== null ? true : null;
    }
    out.samples.set(id, sample);
    // SYSTEM STOP VIEW is deliberate: the view is paused, not broken.
    const paused = r?.status === "Disabled" ? "Refreshes are stopped (SYSTEM STOP VIEW)" : null;
    out.attrs.set(id, { periodSeconds, writesTo, paused });
  }
  return out;
}

// --- queue engines (Kafka, RabbitMQ, NATS, FileLog) -------------------------

/** A streaming Kafka consumer polls continuously; ten quiet minutes means it stopped. */
const KAFKA_HEARTBEAT_SECONDS = 200;

export async function queueEngines(ctx: AdapterContext, tables: CatalogTable[], views: Map<string, ViewStats>): Promise<AdapterResult> {
  const out = result();
  const queues = tables.filter((t) => QUEUE_ENGINES.has(t.engine) && t.engine !== "Redis");
  if (queues.length === 0) return out;
  const kafkaSupported = hasTable(ctx.capabilities, "kafka_consumers");
  const kafkaRows = kafkaSupported && queues.some((q) => q.engine === "Kafka")
    ? await selectRows<{ database: string; table: string; messages: number; commits: number; last_commit_ms: number; last_poll_ms: number; exception_ms: number; exception: string }>(ctx.client, `
      SELECT database, table,
        sum(num_messages_read) AS messages, sum(num_commits) AS commits,
        toUnixTimestamp(max(last_commit_time)) * 1000 AS last_commit_ms,
        toUnixTimestamp(max(last_poll_time)) * 1000 AS last_poll_ms,
        toUnixTimestamp(max(arrayMax(arrayConcat(exceptions.time, [toDateTime(0)])))) * 1000 AS exception_ms,
        argMax(arrayElement(exceptions.text, -1), arrayMax(arrayConcat(exceptions.time, [toDateTime(0)]))) AS exception
      FROM system.kafka_consumers GROUP BY database, table`)
    : [];
  const kafka = new Map(kafkaRows.map((r) => [`${r.database}.${r.table}`, r]));
  const stuck = await stuckViews(ctx, queues.filter((q) => q.engine !== "Kafka").flatMap((q) => ctx.viewsBySource.get(tableNode(q.database, q.table)) ?? []));
  for (const q of queues) {
    const key = `${q.database}.${q.table}`;
    const id = `queue_engine:${key}`;
    const node = tableNode(q.database, q.table);
    out.defs.push({ id, kind: "queue_engine", engine: q.engine, name: key, sourceLabel: q.engine, sourceNode: null, targetNode: node, attrs: {} });
    const sample = emptySample(ctx.nowMs);
    // Every queue engine: the views reading it carry the outcome of each batch.
    const attached = (ctx.viewsBySource.get(node) ?? []).map((v) => views.get(v)).filter((v): v is ViewStats => v !== undefined);
    const viewFailed = attached.reduce((s, v) => s + Number(v.failed), 0);
    const viewWritten = attached.reduce((s, v) => s + Number(v.written), 0);
    // Queue views log every poll; only a poll that wrote rows is a success.
    const viewLastOk = attached.reduce((m, v) => Math.max(m, Number(v.last_write_ms) || 0), 0);
    const viewException = attached.find((v) => v.last_exception)?.last_exception ?? null;
    sample.unitsIn = viewWritten;
    sample.errors = viewFailed;
    sample.errorSample = viewException;
    sample.errorClass = classifyError(viewException);
    sample.lastSuccessAt = viewLastOk > 0 ? viewLastOk : null;
    sample.progressing = attached.length > 0 ? viewProgress(attached) : null;
    const stuckException = (ctx.viewsBySource.get(node) ?? []).map((v) => stuck.get(v)).find((e) => e);
    if (stuckException && !(viewWritten > 0)) {
      sample.progressing = false;
      sample.errors = Math.max(1, sample.errors ?? 0);
      sample.errorSample = stuckException;
      sample.errorClass = classifyError(stuckException);
    }

    if (q.engine === "Kafka") {
      if (!kafkaSupported) {
        out.unsupported.set(id, missingMessage(ctx.capabilities, "kafka_consumers"));
        continue;
      }
      const k = kafka.get(key);
      if (k) {
        const prev = ctx.previous.get(id) ?? {};
        const prevMessages = Number(prev.messages ?? k.messages);
        const prevCommits = Number(prev.commits ?? k.commits);
        const newMessages = Math.max(0, Number(k.messages) - prevMessages);
        const newCommits = Math.max(0, Number(k.commits) - prevCommits);
        const recentException = Number(k.exception_ms) >= ctx.sinceMs && k.exception;
        sample.unitsIn = newMessages;
        sample.lastSuccessAt = Number(k.last_commit_ms) > 0 ? Number(k.last_commit_ms) : sample.lastSuccessAt;
        // Offsets not committed while batches keep failing = the retry loop.
        sample.progressing = newCommits > 0;
        // A consumer still polling an empty topic is idle, not stopped: Kafka only
        // commits when messages arrive, so the poll is its heartbeat.
        const lastPoll = Number(k.last_poll_ms);
        if (!recentException && newMessages === 0 && lastPoll >= ctx.sinceMs) {
          sample.progressing = null;
          sample.lastSuccessAt = Math.max(sample.lastSuccessAt ?? 0, lastPoll);
        }
        if (recentException) {
          sample.errors = Math.max(1, sample.errors ?? 0);
          sample.errorSample = k.exception;
          sample.errorClass = classifyError(k.exception);
        }
        // Only a consumer with an attached view streams; without one it never polls.
        const streaming = (ctx.viewsBySource.get(node) ?? []).length > 0;
        out.attrs.set(id, {
          messages: Number(k.messages),
          commits: Number(k.commits),
          lastPollMs: lastPoll,
          periodSeconds: streaming ? KAFKA_HEARTBEAT_SECONDS : null,
          expectsRecurring: streaming,
        });
      }
    }
    out.samples.set(id, sample);
  }
  return out;
}

// --- object storage queues (S3Queue, AzureQueue) ---------------------------

export async function objectStorageQueues(ctx: AdapterContext, tables: CatalogTable[]): Promise<AdapterResult> {
  const out = result();
  const queues = tables.filter((t) => OBJECT_STORAGE_QUEUE_ENGINES.has(t.engine));
  if (queues.length === 0) return out;
  for (const engine of ["S3Queue", "AzureQueue"] as const) {
    const ofEngine = queues.filter((q) => q.engine === engine);
    if (ofEngine.length === 0) continue;
    const log = engine === "S3Queue" ? "s3queue_log" : "azure_queue_log";
    const cache = engine === "S3Queue" ? "s3queue_metadata_cache" : "azure_queue_metadata_cache";
    const settings = engine === "S3Queue" ? "s3_queue_settings" : "azure_queue_settings";
    const supported = hasTable(ctx.capabilities, log) && hasColumn(ctx.capabilities, log, "database");
    const logRows = supported
      ? await selectRows<{ database: string; table: string; processed: number; failed: number; rows: number; last_ok_ms: number; exception: string }>(ctx.client, `
        SELECT database, table,
          countIf(toString(status) = 'Processed') AS processed, countIf(toString(status) = 'Failed') AS failed,
          sumIf(rows_processed, toString(status) = 'Processed') AS rows,
          toUnixTimestamp(maxIf(event_time, toString(status) = 'Processed')) * 1000 AS last_ok_ms,
          argMaxIf(exception, event_time, exception != '') AS exception
        FROM system.${log} WHERE event_time > fromUnixTimestamp({since:UInt32}) GROUP BY database, table`, { params: { since: sec(ctx.sinceMs) } })
      : [];
    const byTable = new Map(logRows.map((r) => [`${r.database}.${r.table}`, r]));
    // In-flight files live in keeper; map keeper paths back to tables via the queue settings.
    let backlog = new Map<string, number>();
    // Files that exhausted their retries stay Failed in keeper; the log shows them once.
    let failedFiles = new Map<string, number>();
    if (hasTable(ctx.capabilities, cache) && hasTable(ctx.capabilities, settings)) {
      const rows = await selectRows<{ database: string; table: string; processing: number; failed: number }>(ctx.client, `
        SELECT s.database AS database, s.table AS table,
          countIf(toString(c.status) = 'Processing') AS processing, countIf(toString(c.status) = 'Failed') AS failed
        FROM system.${settings} AS s
        INNER JOIN system.${cache} AS c ON startsWith(c.zookeeper_path, s.value)
        WHERE s.name = 'keeper_path' AND s.value != ''
        GROUP BY s.database, s.table`);
      backlog = new Map(rows.map((r) => [`${r.database}.${r.table}`, Number(r.processing)]));
      failedFiles = new Map(rows.filter((r) => Number(r.failed) > 0).map((r) => [`${r.database}.${r.table}`, Number(r.failed)]));
    }
    // A file that failed for good is logged as Failed once; keeper's metadata
    // cache may already have evicted it. Read the last day of the log too, so
    // the failure stays visible until that file is processed.
    const loggedFailures = supported && hasColumn(ctx.capabilities, log, "file_name")
      ? await selectRows<{ database: string; table: string; files: number; exception: string }>(ctx.client, `
        SELECT database, table, count() AS files, any(last_exception) AS exception
        FROM (
          SELECT database, table, file_name,
            argMax(toString(status), event_time) AS last_status,
            argMax(exception, event_time) AS last_exception
          FROM system.${log} WHERE event_time > now() - {lookback:UInt32}
          GROUP BY database, table, file_name
        )
        WHERE last_status = 'Failed'
        GROUP BY database, table`, { params: { lookback: STICKY_LOOKBACK_SECONDS } })
      : [];
    const lastFailure = new Map(loggedFailures.map((r) => [`${r.database}.${r.table}`, r.exception]));
    for (const r of loggedFailures) {
      const key = `${r.database}.${r.table}`;
      failedFiles.set(key, Math.max(failedFiles.get(key) ?? 0, Number(r.files)));
    }
    for (const q of ofEngine) {
      const key = `${q.database}.${q.table}`;
      const id = `object_storage_queue:${key}`;
      out.defs.push({ id, kind: "object_storage_queue", engine, name: key, sourceLabel: engine, sourceNode: null, targetNode: tableNode(q.database, q.table), attrs: {} });
      if (!supported) {
        out.unsupported.set(id, missingMessage(ctx.capabilities, log));
        continue;
      }
      const r = byTable.get(key);
      const sample = emptySample(ctx.nowMs);
      sample.unitsIn = r ? Number(r.rows) : 0;
      sample.errors = r ? Number(r.failed) : 0;
      sample.errorSample = r?.exception || null;
      sample.errorClass = classifyError(r?.exception);
      sample.lastSuccessAt = r && Number(r.last_ok_ms) > 0 ? Number(r.last_ok_ms) : null;
      const inflight = backlog.get(key);
      if (inflight !== undefined) {
        sample.backlog = inflight;
        sample.backlogUnit = "files";
      }
      sample.progressing = r ? Number(r.processed) > 0 : inflight ? false : null;
      const stuckFiles = failedFiles.get(key) ?? 0;
      if (stuckFiles > 0 && !(sample.errors ?? 0)) {
        sample.errors = stuckFiles;
        sample.errorSample = `${stuckFiles} file(s) failed after all retries: ${lastFailure.get(key) || "see the queue log"}`;
        sample.errorClass = classifyError(lastFailure.get(key));
      }
      out.samples.set(id, sample);
    }
  }
  return out;
}

// --- tables written by replication / external engines ---------------------

/** An exception from reaching an external system, as opposed to a bad query. */
export function isSourceFailure(exception: string | null | undefined): boolean {
  return classifyError(exception) === "external";
}

export async function databaseReplication(ctx: AdapterContext, tables: CatalogTable[], databaseEngines: Map<string, string>): Promise<AdapterResult> {
  const out = result();
  const replicated = tables.filter((t) => {
    const engine = databaseEngines.get(t.database);
    return engine === "MaterializedPostgreSQL" || engine === "MaterializedMySQL";
  });
  if (replicated.length === 0) return out;
  const supported = hasTable(ctx.capabilities, "part_log");
  const rows = supported
    ? await selectRows<{ database: string; table: string; parts: number; rows: number; last_ms: number }>(ctx.client, `
      SELECT database, table, count() AS parts, sum(rows) AS rows, toUnixTimestamp(max(event_time)) * 1000 AS last_ms
      FROM system.part_log WHERE event_type = 'NewPart' AND event_time > fromUnixTimestamp({since:UInt32})
        AND database IN ({dbs:Array(String)}) GROUP BY database, table`, { params: { since: sec(ctx.sinceMs), dbs: [...new Set(replicated.map((t) => t.database))] } })
    : [];
  const byTable = new Map(rows.map((r) => [`${r.database}.${r.table}`, r]));
  // One replication stream serves the whole database, and a quiet source table
  // is normal, so "nothing replicated" is judged per database, not per table.
  const lastByDatabase = new Map<string, number>();
  for (const r of rows) lastByDatabase.set(r.database, Math.max(lastByDatabase.get(r.database) ?? 0, Number(r.last_ms)));
  for (const t of replicated) {
    const key = `${t.database}.${t.table}`;
    const id = `database_replication:${key}`;
    const engine = databaseEngines.get(t.database) ?? "replication";
    out.defs.push({ id, kind: "database_replication", engine, name: key, sourceLabel: engine, sourceNode: `external:${engine.toLowerCase()}:${t.database}`, targetNode: tableNode(t.database, t.table), attrs: {} });
    if (!supported) {
      out.unsupported.set(id, missingMessage(ctx.capabilities, "part_log"));
      continue;
    }
    const r = byTable.get(key);
    const prev = ctx.previous.get(id) ?? {};
    const sample = emptySample(ctx.nowMs);
    const databaseLast = lastByDatabase.get(t.database);
    sample.unitsIn = r ? Number(r.rows) : 0;
    sample.lastSuccessAt = databaseLast ?? (typeof prev.lastWriteMs === "number" ? prev.lastWriteMs : null);
    sample.progressing = databaseLast !== undefined ? true : null;
    out.samples.set(id, sample);
    out.attrs.set(id, { lastWriteMs: sample.lastSuccessAt });
  }
  return out;
}

export async function externalTables(ctx: AdapterContext, tables: CatalogTable[]): Promise<AdapterResult> {
  const out = result();
  const external = tables.filter((t) => ["PostgreSQL", "MySQL", "MongoDB", "S3", "URL", "HDFS", "AzureBlobStorage", "ODBC", "JDBC", "Iceberg", "DeltaLake", "Hudi"].includes(t.engine));
  if (external.length === 0) return out;
  const names = external.map((t) => `${t.database}.${t.table}`);
  const rows = await selectRows<{ tbl: string; code: number; ok: number; failed: number; last_ok_ms: number; exception: string }>(ctx.client, `
    SELECT arrayJoin(arrayIntersect(tables, {names:Array(String)})) AS tbl, exception_code AS code,
      countIf(type = 'QueryFinish') AS ok,
      countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed,
      toUnixTimestamp(maxIf(event_time, type = 'QueryFinish')) * 1000 AS last_ok_ms,
      argMaxIf(exception, event_time, exception != '') AS exception
    FROM system.query_log
    WHERE event_time > fromUnixTimestamp({since:UInt32}) AND type != 'QueryStart' AND hasAny(tables, {names:Array(String)}) AND ${NOT_OBSERVE}
    GROUP BY tbl, code`, { params: { since: sec(ctx.sinceMs), names } });
  const byTable = new Map<string, typeof rows>();
  for (const r of rows) byTable.set(r.tbl, [...(byTable.get(r.tbl) ?? []), r]);
  for (const t of external) {
    const key = `${t.database}.${t.table}`;
    const id = `external_table:${key}`;
    out.defs.push({ id, kind: "external_table", engine: t.engine, name: key, sourceLabel: t.engine, sourceNode: null, targetNode: tableNode(t.database, t.table), attrs: {} });
    const groups = byTable.get(key);
    const sample = emptySample(ctx.nowMs);
    if (groups) {
      // Someone's typo or slow ad-hoc query is not the source failing: only
      // errors that point at the external system count against the pipeline.
      const sourceFailures = groups.filter((g) => Number(g.failed) > 0 && isSourceFailure(g.exception));
      const ok = groups.reduce((sum, g) => sum + Number(g.ok), 0);
      const lastOk = groups.reduce((max, g) => Math.max(max, Number(g.last_ok_ms) || 0), 0);
      const exception = sourceFailures[0]?.exception ?? null;
      sample.errors = sourceFailures.reduce((sum, g) => sum + Number(g.failed), 0);
      sample.errorSample = exception;
      sample.errorClass = classifyError(exception);
      sample.lastSuccessAt = lastOk > 0 ? lastOk : null;
      sample.progressing = ok > 0 ? true : sample.errors > 0 ? false : null;
      sample.unitsIn = ok;
    }
    out.samples.set(id, sample);
  }
  return out;
}

// --- Distributed, dictionaries, async inserts, Buffer ----------------------

export async function distributed(ctx: AdapterContext, tables: CatalogTable[]): Promise<AdapterResult> {
  const out = result();
  const dists = tables.filter((t) => t.engine === "Distributed");
  if (dists.length === 0) return out;
  const supported = hasTable(ctx.capabilities, "distribution_queue");
  const rows = supported
    ? await selectRows<{ database: string; table: string; files: number; bytes: number; errors: number; blocked: number; exception: string; exception_ms: number }>(ctx.client, `
      SELECT database, table, sum(data_files) AS files, sum(data_compressed_bytes) AS bytes, sum(error_count) AS errors,
        max(toUInt8(is_blocked)) AS blocked, argMax(last_exception, last_exception_time) AS exception,
        toUnixTimestamp(max(last_exception_time)) * 1000 AS exception_ms
      FROM system.distribution_queue GROUP BY database, table`)
    : [];
  const byTable = new Map(rows.map((r) => [`${r.database}.${r.table}`, r]));
  for (const t of dists) {
    const key = `${t.database}.${t.table}`;
    const id = `distributed:${key}`;
    out.defs.push({ id, kind: "distributed", engine: "Distributed", name: key, sourceLabel: null, sourceNode: tableNode(t.database, t.table), targetNode: tableNode(t.database, t.table), attrs: {} });
    if (!supported) {
      out.unsupported.set(id, missingMessage(ctx.capabilities, "distribution_queue"));
      continue;
    }
    const r = byTable.get(key);
    const prev = ctx.previous.get(id) ?? {};
    const sample = emptySample(ctx.nowMs);
    const files = r ? Number(r.files) : 0;
    const errorTotal = r ? Number(r.errors) : 0;
    sample.backlog = files;
    sample.backlogUnit = "files";
    sample.errors = Math.max(0, errorTotal - Number(prev.errorTotal ?? errorTotal));
    if (r && Number(r.exception_ms) >= ctx.sinceMs && r.exception) {
      sample.errors = Math.max(1, sample.errors);
      sample.errorSample = r.exception;
      sample.errorClass = classifyError(r.exception);
    }
    const prevFiles = Number(prev.files ?? files);
    sample.progressing = files === 0 ? true : files < prevFiles ? true : r && Number(r.blocked) === 1 ? false : files > prevFiles ? false : null;
    out.samples.set(id, sample);
    out.attrs.set(id, { files, errorTotal });
  }
  return out;
}

export async function dictionaries(ctx: AdapterContext): Promise<AdapterResult> {
  const out = result();
  if (!hasTable(ctx.capabilities, "dictionaries")) return out;
  const rows = await selectRows<{ database: string; name: string; status: string; last_ok_ms: number; exception: string; lifetime_max: number; elements: number }>(ctx.client, `
    SELECT database, name, toString(status) AS status, toUnixTimestamp(last_successful_update_time) * 1000 AS last_ok_ms,
      last_exception AS exception, lifetime_max, element_count AS elements
    FROM system.dictionaries`);
  for (const d of rows) {
    const key = `${d.database}.${d.name}`;
    const id = `dictionary:${key}`;
    // A dictionary only reloads when its source changed (or never, with
    // LIFETIME(0)), so an old load time is normal; failures surface as errors.
    out.defs.push({ id, kind: "dictionary", engine: "Dictionary", name: key, sourceLabel: null, sourceNode: null, targetNode: tableNode(d.database, d.name), attrs: { lifetimeMax: Number(d.lifetime_max), expectsRecurring: false } });
    const sample = emptySample(ctx.nowMs);
    sample.lastSuccessAt = Number(d.last_ok_ms) > 0 ? Number(d.last_ok_ms) : null;
    sample.errors = d.exception ? 1 : 0;
    sample.errorSample = d.exception || null;
    sample.errorClass = classifyError(d.exception);
    sample.unitsIn = Number(d.elements);
    sample.progressing = d.exception ? false : d.status.startsWith("LOADED") ? true : null;
    out.samples.set(id, sample);
    out.attrs.set(id, { lifetimeMax: Number(d.lifetime_max), expectsRecurring: false });
  }
  return out;
}

export async function asyncInserts(ctx: AdapterContext): Promise<AdapterResult> {
  const out = result();
  if (!hasTable(ctx.capabilities, "asynchronous_insert_log")) return out;
  const rows = await selectRows<{ database: string; table: string; ok: number; failed: number; rows: number; bytes: number; last_ok_ms: number; exception: string }>(ctx.client, `
    SELECT database, table, countIf(toString(status) = 'Ok') AS ok, countIf(toString(status) != 'Ok') AS failed,
      sumIf(rows, toString(status) = 'Ok') AS rows, sumIf(bytes, toString(status) = 'Ok') AS bytes,
      toUnixTimestamp(maxIf(event_time, toString(status) = 'Ok')) * 1000 AS last_ok_ms,
      argMaxIf(exception, event_time, exception != '') AS exception
    FROM system.asynchronous_insert_log WHERE event_time > fromUnixTimestamp({since:UInt32}) GROUP BY database, table`, { params: { since: sec(ctx.sinceMs) } });
  const pending = hasTable(ctx.capabilities, "asynchronous_inserts")
    ? new Map((await selectRows<{ database: string; table: string; bytes: number }>(ctx.client, "SELECT database, table, sum(total_bytes) AS bytes FROM system.asynchronous_inserts GROUP BY database, table")).map((r) => [`${r.database}.${r.table}`, Number(r.bytes)]))
    : new Map<string, number>();
  for (const r of rows) {
    const key = `${r.database}.${r.table}`;
    const id = `async_insert:${key}`;
    out.defs.push({ id, kind: "async_insert", engine: "async_insert", name: key, sourceLabel: "async inserts", sourceNode: null, targetNode: tableNode(r.database, r.table), attrs: {} });
    const sample = emptySample(ctx.nowMs);
    sample.unitsIn = Number(r.rows);
    sample.bytesIn = Number(r.bytes);
    sample.errors = Number(r.failed);
    sample.errorSample = r.exception || null;
    sample.errorClass = classifyError(r.exception);
    sample.lastSuccessAt = Number(r.last_ok_ms) > 0 ? Number(r.last_ok_ms) : null;
    sample.progressing = Number(r.ok) > 0;
    const p = pending.get(key);
    if (p !== undefined) {
      sample.backlog = p;
      sample.backlogUnit = "bytes";
    }
    out.samples.set(id, sample);
  }
  return out;
}

export function buffers(ctx: AdapterContext, tables: CatalogTable[]): AdapterResult {
  const out = result();
  for (const t of tables.filter((x) => x.engine === "Buffer")) {
    const key = `${t.database}.${t.table}`;
    const id = `buffer:${key}`;
    out.defs.push({ id, kind: "buffer", engine: "Buffer", name: key, sourceLabel: null, sourceNode: tableNode(t.database, t.table), targetNode: tableNode(t.database, t.table), attrs: {} });
    const sample = emptySample(ctx.nowMs);
    sample.backlog = t.totalRows ?? 0;
    sample.backlogUnit = "rows";
    out.samples.set(id, sample);
  }
  return out;
}

// --- external writers ------------------------------------------------------

/** Below this many rows per insert, at this rate, a writer is "inefficient". */
export const SMALL_INSERT_ROWS = 1000;
export const SMALL_INSERT_RATE_PER_MIN = 60;

export async function writers(ctx: AdapterContext): Promise<AdapterResult> {
  const out = result();
  const windowMinutes = Math.max(1, (ctx.nowMs - ctx.sinceMs) / 60000);
  const rows = await selectRows<{ target: string; usr: string; client: string; inserts: number; failed: number; written: number; median_rows: number; last_ok_ms: number; exception: string }>(ctx.client, `
    SELECT
      replaceRegexpAll(extract(query, '(?i)INSERT\\\\s+INTO\\\\s+(?:TABLE\\\\s+)?([\\\\w.\`"]+)'), '[\`"]', '') AS target,
      user AS usr,
      if(client_name != '', client_name, splitByChar(' ', http_user_agent)[1]) AS client,
      countIf(type = 'QueryFinish') AS inserts,
      countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed,
      sumIf(written_rows, type = 'QueryFinish') AS written,
      quantileIf(0.5)(written_rows, type = 'QueryFinish') AS median_rows,
      toUnixTimestamp(maxIf(event_time, type = 'QueryFinish')) * 1000 AS last_ok_ms,
      argMaxIf(exception, event_time, exception != '') AS exception
    FROM system.query_log
    WHERE event_time > fromUnixTimestamp({since:UInt32}) AND query_kind = 'Insert' AND type != 'QueryStart'
      AND ${NOT_OBSERVE} AND JSONExtractString(log_comment, 'source') != 'scheduled_query'
    GROUP BY target, usr, client
    HAVING target != ''
    LIMIT 2000`, { params: { since: sec(ctx.sinceMs) } });
  for (const r of rows) {
    const target = r.target.includes(".") ? r.target : `default.${r.target}`;
    const writer = `${r.client || "client"}|${r.usr}`;
    const id = `writer:${writer}->${target}`;
    const dot = target.indexOf(".");
    out.defs.push({ id, kind: "writer", engine: r.client || "client", name: `${r.client || "client"} (${r.usr}) → ${target}`, sourceLabel: r.client || null, sourceNode: `client:${r.usr}|${r.client || "unknown client"}`, targetNode: tableNode(target.slice(0, dot), target.slice(dot + 1)), attrs: {} });
    const sample = emptySample(ctx.nowMs);
    sample.unitsIn = Number(r.written);
    sample.errors = Number(r.failed);
    sample.errorSample = r.exception || null;
    sample.errorClass = classifyError(r.exception);
    sample.lastSuccessAt = Number(r.last_ok_ms) > 0 ? Number(r.last_ok_ms) : null;
    sample.progressing = Number(r.inserts) > 0;
    const perMinute = Number(r.inserts) / windowMinutes;
    if (Number(r.inserts) > 0 && Number(r.median_rows) < SMALL_INSERT_ROWS && perMinute > SMALL_INSERT_RATE_PER_MIN) {
      sample.inefficiency = `${Math.round(perMinute)} inserts/min averaging ${Math.round(Number(r.median_rows))} rows; batch or enable async_insert`;
    }
    out.samples.set(id, sample);
    out.attrs.set(id, { insertsPerMinute: Math.round(perMinute), medianRows: Number(r.median_rows) });
  }
  return out;
}

export { toMs };
export type { ViewStats };
export { viewStats };
