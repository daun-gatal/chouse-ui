/**
 * Materialize writer (D4a/D4b/D4c) — engine-generated, idempotent write-back of
 * a job's read-only SELECT into a destination ClickHouse table. Users never
 * author write SQL; the runner generates `INSERT … SELECT` / `REPLACE PARTITION`
 * from `output_mode` + destination, so read-only validation, deterministic
 * windows, and at-least-once idempotency all hold.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { logger } from "../../utils/logger";
import {
  CLUSTER_DDL_SETTINGS,
  destinationChecks,
  inspectClusterJob,
  inspectionError,
  localTableName,
  parseDistributedEngine,
} from "./cluster";
import { pinnedSession, type ChSession } from "./session";
import type { ExpectedColumn, OutputConfig, ScheduledQueryRow, SqOutputMode } from "./types";

/** Backtick-quote a ClickHouse identifier. */
function ident(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

/** Single-quoted ClickHouse string literal. */
function lit(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function qualified(database: string, table: string): string {
  return `${ident(database)}.${ident(table)}`;
}

function stagingName(job: ScheduledQueryRow): string {
  return job.outputConfig?.staging?.trim() || `${job.destTable}__sq_staging`;
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
  engineFull: string | null;
  partitionKey: string | null;
  sortingKey: string | null;
  primaryKey: string | null;
  columns: DestColumn[];
}

const MISSING: DestInfo = { exists: false, engine: null, engineFull: null, partitionKey: null, sortingKey: null, primaryKey: null, columns: [] };

/** Introspect a table via system.tables / system.columns on the session's node. */
export async function describeDestination(s: ChSession, database: string, table: string): Promise<DestInfo> {
  const [tbl] = await s.rows<{ engine: string; engine_full: string; partition_key: string; sorting_key: string; primary_key: string }>(
    `SELECT engine, engine_full, partition_key, sorting_key, primary_key FROM system.tables WHERE database = {db:String} AND name = {tbl:String} LIMIT 1`,
    { db: database, tbl: table },
  );
  if (!tbl) return MISSING;
  const columns = await s.rows<DestColumn>(
    `SELECT name, type FROM system.columns WHERE database = {db:String} AND table = {tbl:String} ORDER BY position`,
    { db: database, tbl: table },
  );
  return {
    exists: true,
    engine: tbl.engine,
    engineFull: tbl.engine_full || null,
    partitionKey: tbl.partition_key || null,
    sortingKey: tbl.sorting_key || null,
    primaryKey: tbl.primary_key || null,
    columns: columns.map((c) => ({ name: c.name, type: c.type })),
  };
}

/**
 * The table rows physically land in: a `Distributed` destination resolves to its
 * underlying local table (engine-fit rules apply to that engine, ADR 0015).
 */
export async function resolveWriteTarget(s: ChSession, database: string, dest: DestInfo): Promise<DestInfo> {
  if (dest.engine !== "Distributed") return dest;
  const spec = parseDistributedEngine(dest.engineFull);
  if (!spec) return dest;
  return describeDestination(s, spec.database, spec.table);
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

/**
 * Generated CREATE statements for create-if-missing / copy-paste preview (D4b,
 * ADR 0015 §3): one table without a cluster; one `ON CLUSTER` table for a
 * replicated cluster; a per-shard local table plus a Distributed table when sharded.
 */
export function buildCreateStatements(job: ScheduledQueryRow, columns: ExpectedColumn[]): string[] {
  const cfg = job.outputConfig ?? {};
  const database = job.destDatabase!;
  const table = job.destTable!;
  const cols = columns.map((c) => `  ${ident(c.name)} ${c.type}`).join(",\n");
  const engine = cfg.engine?.trim() || "MergeTree";
  // `replace` collects the partition key as `partitionExpr`; `createIfMissing`
  // exposes a dedicated `partitionBy`. Prefer the explicit one, falling back to
  // the replace expression so the user's partition input is reflected in the DDL.
  const partition = cfg.partitionBy?.trim() || cfg.partitionExpr?.trim();
  const partitionBy = partition ? `\nPARTITION BY ${partition}` : "";
  const orderBy = cfg.orderBy?.trim() || "tuple()";
  const cluster = cfg.cluster;
  const onCluster = cluster ? ` ON CLUSTER ${ident(cluster.name)}` : "";
  const body = (target: string): string =>
    `CREATE TABLE IF NOT EXISTS ${qualified(database, target)}${onCluster} (\n${cols}\n) ENGINE = ${engine}${partitionBy}\nORDER BY ${orderBy}`;
  if (!cluster || cluster.topology !== "sharded") return [body(table)];
  const local = localTableName(table, cluster);
  return [
    body(local),
    `CREATE TABLE IF NOT EXISTS ${qualified(database, table)}${onCluster} AS ${qualified(database, local)}\n` +
      `ENGINE = Distributed(${lit(cluster.name)}, ${lit(database)}, ${lit(local)}, ${cluster.shardingKey!.trim()})`,
  ];
}

/**
 * Staging for `replace`. A Replicated* destination must NOT be cloned with
 * `AS dest` — that copies its Keeper path and collides (REPLICA_ALREADY_EXISTS).
 * Staging is then a local plain MergeTree with dest's exact keys, which
 * REPLACE PARTITION accepts into the replicated destination (ADR 0015 §5).
 */
export function buildStagingDDL(stagingQ: string, destQ: string, dest: DestInfo): string {
  if (!dest.engine?.startsWith("Replicated")) return `CREATE TABLE IF NOT EXISTS ${stagingQ} AS ${destQ}`;
  const partitionBy = dest.partitionKey ? ` PARTITION BY ${dest.partitionKey}` : "";
  const orderBy = ` ORDER BY ${dest.sortingKey || "tuple()"}`;
  const primaryKey = dest.primaryKey && dest.primaryKey !== dest.sortingKey ? ` PRIMARY KEY ${dest.primaryKey}` : "";
  return `CREATE TABLE IF NOT EXISTS ${stagingQ} AS ${destQ} ENGINE = MergeTree${partitionBy}${orderBy}${primaryKey}`;
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
  const cluster = cfg.cluster;
  const colList = columns.map((c) => ident(c.name)).join(", ");
  const destQ = qualified(database, table);
  const dedupToken = `${job.id}:${slotAt}`;
  // Every statement of this run on ONE node (staging, swap, system.parts reads).
  const s = pinnedSession(client, `sq_${queryId}`, signal);
  const describe = (db: string, tbl: string): Promise<DestInfo> => describeDestination(s, db, tbl);

  if (cluster) {
    // Re-verify membership, topology, database and the destination's shape every run.
    const inspection = await inspectClusterJob(s, {
      cluster,
      outputMode: job.outputMode,
      destDatabase: database,
      destTable: table,
      createIfMissing: Boolean(cfg.createIfMissing),
      engine: cfg.engine,
      orderBy: cfg.orderBy,
      expectedTopology: cluster.topology,
    }, describe);
    if (!inspection.ok) throw new Error(`cluster destination check failed: ${inspectionError(inspection)}`);
  }

  let dest = await describe(database, table);
  const localTable = cluster?.topology === "sharded" ? localTableName(table, cluster) : null;
  const localMissing = localTable !== null && !(await describe(database, localTable)).exists;

  // Create-if-missing — issued ONLY when something is absent, so a healthy cluster
  // job enqueues no distributed-DDL task per run. `IF NOT EXISTS` keeps racing pods safe.
  if (cfg.createIfMissing && (!dest.exists || localMissing)) {
    const statements = buildCreateStatements(job, columns);
    for (const [i, query] of statements.entries()) {
      await s.command(query, { queryId: `${queryId}_ddl${i}`, settings: cluster ? { ...CLUSTER_DDL_SETTINGS } : undefined });
    }
    dest = await describe(database, table);
    if (cluster) {
      const local = localTable ? await describe(database, localTable) : null;
      const bad = destinationChecks(cluster.name, cluster.topology ?? "replicated", database, localTable ?? "", dest, local).filter((c) => !c.ok);
      if (!dest.exists || (local !== null && !local.exists) || bad.length > 0) {
        throw new Error(`cluster destination not ready after DDL: ${bad.map((c) => c.message).join("; ") || "table missing"}`);
      }
    }
  }

  if (job.outputMode === "append" || job.outputMode === "upsert") {
    const result = await s.command(`INSERT INTO ${destQ} (${colList}) ${selectSql}`, {
      params,
      queryId,
      settings: {
        insert_deduplication_token: dedupToken,
        // Synchronous fan-out through Distributed: every shard's write (and its
        // error) is part of this statement, and the slot token reaches each shard.
        ...(localTable ? { distributed_foreground_insert: 1 } : {}),
      },
    });
    return readWrittenRows(result);
  }

  if (job.outputMode === "replace") {
    const staging = stagingName(job);
    const stagingQ = qualified(database, staging);
    await s.command(buildStagingDDL(stagingQ, destQ, dest), { queryId: `${queryId}_stg_create` });
    await s.command(`TRUNCATE TABLE ${stagingQ}`, { queryId: `${queryId}_stg_trunc` });
    const result = await s.command(`INSERT INTO ${stagingQ} (${colList}) ${selectSql}`, { params, queryId });
    const written = readWrittenRows(result);
    // Discover the partitions staging produced and atomically swap each into dest.
    const parts = await s.rows<{ partition_id: string }>(
      `SELECT DISTINCT partition_id FROM system.parts WHERE database = {db:String} AND table = {tbl:String} AND active`,
      { db: database, tbl: staging },
    );
    for (const p of parts) {
      await s.command(`ALTER TABLE ${destQ} REPLACE PARTITION ID {pid:String} FROM ${stagingQ}`, {
        queryId: `${queryId}_replace_${p.partition_id}`,
        params: { pid: p.partition_id },
      });
    }
    // Swap done — staging now holds a redundant full copy of the run's output.
    // The table itself is kept and reused (CREATE IF NOT EXISTS + TRUNCATE next
    // run), but free its storage now so we don't retain a run's worth of data
    // between runs. Best-effort: the next run truncates again, so this is safe.
    try {
      await s.command(`TRUNCATE TABLE ${stagingQ}`, { queryId: `${queryId}_stg_cleanup` });
    } catch (err) {
      logger.warn({ module: "ScheduledQueries", jobId: job.id, err }, "post-replace staging truncate failed (non-fatal)");
    }
    return written;
  }

  logger.warn({ module: "ScheduledQueries", mode: job.outputMode }, "executeMaterialize called for non-materialize mode");
  return null;
}
