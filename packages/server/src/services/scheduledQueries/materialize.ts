/**
 * Materialize writer (D4a/D4b/D4c) — engine-generated, idempotent write-back of
 * a job's read-only SELECT into a destination ClickHouse table. Users never
 * author write SQL; the runner generates `INSERT … SELECT` / `REPLACE PARTITION`
 * from `output_mode` + destination, so read-only validation, deterministic
 * windows, and at-least-once idempotency all hold.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { logger } from "../../utils/logger";
import type { ExpectedColumn, OutputConfig, ScheduledQueryRow, SqOutputMode } from "./types";

/** Backtick-quote a ClickHouse identifier. */
function ident(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

function qualified(database: string, table: string): string {
  return `${ident(database)}.${ident(table)}`;
}

function stagingName(job: ScheduledQueryRow): string {
  return job.outputConfig?.staging?.trim() || `${job.destTable}__sq_staging`;
}

interface ExecArgs {
  query: string;
  params: Record<string, unknown>;
  queryId: string;
  signal: AbortSignal;
  settings?: Record<string, string | number>;
}

/** Best-effort `written_rows` from a command's `x-clickhouse-summary` header. */
function readWrittenRows(result: unknown): number | null {
  const headers = (result as { response_headers?: Record<string, unknown> })?.response_headers;
  const raw = headers?.["x-clickhouse-summary"];
  if (typeof raw !== "string") return null;
  try {
    const summary = JSON.parse(raw) as { written_rows?: string | number };
    return summary.written_rows != null ? Number(summary.written_rows) : null;
  } catch {
    return null;
  }
}

/**
 * Discover the SELECT's output schema WITHOUT running it, via
 * `DESCRIBE (SELECT …)`, binding the window params with the current slot values.
 */
export async function describeSelectSchema(
  client: ClickHouseClient,
  selectSql: string,
  params: Record<string, unknown>,
): Promise<ExpectedColumn[]> {
  const rs = await client.query({
    query: `DESCRIBE (${selectSql})`,
    format: "JSON",
    query_params: params,
  });
  const json = (await rs.json()) as { data?: Array<{ name: string; type: string }> };
  return (json.data ?? []).map((r) => ({ name: r.name, type: r.type }));
}

export interface DestColumn {
  name: string;
  type: string;
}

export interface DestInfo {
  exists: boolean;
  engine: string | null;
  partitionKey: string | null;
  columns: DestColumn[];
}

/** Introspect the destination table via system.tables / system.columns. */
export async function describeDestination(
  client: ClickHouseClient,
  database: string,
  table: string,
): Promise<DestInfo> {
  const tblRs = await client.query({
    query: `SELECT engine, partition_key FROM system.tables WHERE database = {db:String} AND name = {tbl:String} LIMIT 1`,
    format: "JSON",
    query_params: { db: database, tbl: table },
  });
  const tblJson = (await tblRs.json()) as { data?: Array<{ engine: string; partition_key: string }> };
  if (!tblJson.data || tblJson.data.length === 0) {
    return { exists: false, engine: null, partitionKey: null, columns: [] };
  }
  const colRs = await client.query({
    query: `SELECT name, type FROM system.columns WHERE database = {db:String} AND table = {tbl:String} ORDER BY position`,
    format: "JSON",
    query_params: { db: database, tbl: table },
  });
  const colJson = (await colRs.json()) as { data?: Array<{ name: string; type: string }> };
  return {
    exists: true,
    engine: tblJson.data[0].engine,
    partitionKey: tblJson.data[0].partition_key || null,
    columns: (colJson.data ?? []).map((c) => ({ name: c.name, type: c.type })),
  };
}

export interface SchemaDiff {
  compatible: boolean;
  additive: ExpectedColumn[];
  missing: ExpectedColumn[];
  retyped: Array<{ name: string; from: string; to: string }>;
}

/** Diff the SELECT output against a pinned schema (D4c). */
export function diffSchema(pinned: ExpectedColumn[], current: ExpectedColumn[]): SchemaDiff {
  const pinnedByName = new Map(pinned.map((c) => [c.name, c.type]));
  const currentByName = new Map(current.map((c) => [c.name, c.type]));
  const additive: ExpectedColumn[] = [];
  const missing: ExpectedColumn[] = [];
  const retyped: Array<{ name: string; from: string; to: string }> = [];
  for (const c of current) {
    if (!pinnedByName.has(c.name)) additive.push(c);
    else if (pinnedByName.get(c.name) !== c.type) retyped.push({ name: c.name, from: pinnedByName.get(c.name)!, to: c.type });
  }
  for (const c of pinned) {
    if (!currentByName.has(c.name)) missing.push(c);
  }
  return { compatible: additive.length === 0 && missing.length === 0 && retyped.length === 0, additive, missing, retyped };
}

/** Engine-fit check for a mode against an existing destination (D4b). */
export function checkEngineFit(mode: SqOutputMode, dest: DestInfo): string | null {
  const engine = dest.engine ?? "";
  switch (mode) {
    case "upsert":
      if (!/Replacing|Aggregating|Collapsing/.test(engine)) {
        return `upsert requires a ReplacingMergeTree/Aggregating/Collapsing destination (got ${engine || "unknown"})`;
      }
      return null;
    case "replace":
      if (!/MergeTree/.test(engine)) return `replace requires a MergeTree-family destination (got ${engine || "unknown"})`;
      if (!dest.partitionKey) return "replace requires the destination to have a PARTITION BY key";
      return null;
    case "append":
      if (!/MergeTree/.test(engine)) return `append requires a MergeTree-family destination (got ${engine || "unknown"})`;
      return null;
    default:
      return null;
  }
}

/** Generated CREATE TABLE DDL for create-if-missing / copy-paste preview (D4b). */
export function buildCreateTableDDL(job: ScheduledQueryRow, columns: ExpectedColumn[]): string {
  const cfg = job.outputConfig ?? {};
  const cols = columns.map((c) => `  ${ident(c.name)} ${c.type}`).join(",\n");
  const engine = cfg.engine?.trim() || "MergeTree";
  const partitionBy = cfg.partitionBy?.trim() ? `\nPARTITION BY ${cfg.partitionBy.trim()}` : "";
  const orderBy = cfg.orderBy?.trim() || "tuple()";
  return `CREATE TABLE IF NOT EXISTS ${qualified(job.destDatabase!, job.destTable!)} (\n${cols}\n) ENGINE = ${engine}${partitionBy}\nORDER BY ${orderBy}`;
}

async function exec(client: ClickHouseClient, args: ExecArgs): Promise<unknown> {
  return client.command({
    query: args.query,
    query_id: args.queryId,
    abort_signal: args.signal,
    query_params: args.params,
    clickhouse_settings: args.settings as never,
  });
}

export interface MaterializeArgs {
  client: ClickHouseClient;
  job: ScheduledQueryRow;
  /** Executable SELECT with `{{…}}` already rewritten to native params. */
  selectSql: string;
  params: Record<string, unknown>;
  queryId: string;
  slotAt: number;
  signal: AbortSignal;
  columns: ExpectedColumn[];
}

/**
 * Execute the engine-generated write for a materialize job. Idempotent under
 * at-least-once retry: append/upsert use a slot-scoped dedup token; replace uses
 * staging + atomic REPLACE PARTITION. Returns best-effort `written_rows`.
 */
export async function executeMaterialize(args: MaterializeArgs): Promise<number | null> {
  const { client, job, selectSql, params, queryId, slotAt, signal, columns } = args;
  const database = job.destDatabase!;
  const table = job.destTable!;
  const cfg: OutputConfig = job.outputConfig ?? {};
  const colList = columns.map((c) => ident(c.name)).join(", ");
  const dest = qualified(database, table);
  const dedupToken = `${job.id}:${slotAt}`;

  // Create-if-missing (idempotent; no-op once the table exists).
  if (cfg.createIfMissing) {
    await client.command({ query: buildCreateTableDDL(job, columns), query_id: `${queryId}_ddl`, abort_signal: signal });
  }

  if (job.outputMode === "append" || job.outputMode === "upsert") {
    const result = await exec(client, {
      query: `INSERT INTO ${dest} (${colList}) ${selectSql}`,
      params,
      queryId,
      signal,
      settings: { insert_deduplication_token: dedupToken },
    });
    return readWrittenRows(result);
  }

  if (job.outputMode === "replace") {
    const staging = stagingName(job);
    const stagingQ = qualified(database, staging);
    // Staging clones dest's exact structure (incl. partition key) → can't diverge.
    await client.command({ query: `CREATE TABLE IF NOT EXISTS ${stagingQ} AS ${dest}`, query_id: `${queryId}_stg_create`, abort_signal: signal });
    await client.command({ query: `TRUNCATE TABLE ${stagingQ}`, query_id: `${queryId}_stg_trunc`, abort_signal: signal });
    const result = await exec(client, {
      query: `INSERT INTO ${stagingQ} (${colList}) ${selectSql}`,
      params,
      queryId,
      signal,
    });
    const written = readWrittenRows(result);
    // Discover the partitions staging produced and atomically swap each into dest.
    const partsRs = await client.query({
      query: `SELECT DISTINCT partition_id FROM system.parts WHERE database = {db:String} AND table = {tbl:String} AND active`,
      format: "JSON",
      query_params: { db: database, tbl: staging },
    });
    const partsJson = (await partsRs.json()) as { data?: Array<{ partition_id: string }> };
    for (const p of partsJson.data ?? []) {
      await client.command({
        query: `ALTER TABLE ${dest} REPLACE PARTITION ID {pid:String} FROM ${stagingQ}`,
        query_id: `${queryId}_replace_${p.partition_id}`,
        abort_signal: signal,
        query_params: { pid: p.partition_id },
      });
    }
    return written;
  }

  logger.warn({ module: "ScheduledQueries", mode: job.outputMode }, "executeMaterialize called for non-materialize mode");
  return null;
}
