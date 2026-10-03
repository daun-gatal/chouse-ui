/**
 * Cluster-aware materialize destinations (ADR 0015). A cluster destination is
 * either `replicated` (1 shard × N replicas, one Replicated*MergeTree table) or
 * `sharded` (a Replicated*MergeTree local table per shard + a Distributed table
 * that routes rows). Every precondition is a hard check — nothing degrades to
 * single-node behaviour.
 */

import type { ChSession } from "./session";
import type { ClusterConfig, SqClusterTopology, SqOutputMode } from "./types";

/** Every host must ack the cluster DDL; any failure fails the statement. */
export const CLUSTER_DDL_SETTINGS = {
  distributed_ddl_output_mode: "throw",
  distributed_ddl_task_timeout: "180",
} as const;

/** Macros ClickHouse expands itself; everything else must be defined in `<macros>`. */
const BUILTIN_MACROS = new Set(["uuid", "database", "table"]);

const DEFAULT_REPLICA_PATH = "/clickhouse/tables/{uuid}/{shard}";
const DEFAULT_REPLICA_NAME = "{replica}";

/**
 * Functions whose value differs between attempts. A sharding key using them would
 * route a retried slot's rows to different shards, defeating per-shard dedup.
 */
const NONDETERMINISTIC_FN =
  /\b(rand\w*|random\w*|canonicalRand|now\w*|today|yesterday|generateUUID\w*|generateULID|generateSnowflakeID|rowNumberIn\w+|blockNumber|hostName|hostname|serverUUID|uptime|currentDatabase|currentUser)\s*\(/i;

const SQL_WORDS = new Set(["and", "or", "not", "in", "is", "null", "true", "false", "as", "like", "between", "case", "when", "then", "else", "end"]);

export interface ClusterSummary {
  name: string;
  shards: number;
  maxReplicasPerShard: number;
  hosts: number;
  isLocal: boolean;
}

export interface ClusterCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface ClusterInspection {
  ok: boolean;
  topology: SqClusterTopology | null;
  shards: number;
  hosts: number;
  maxReplicasPerShard: number;
  checks: ClusterCheck[];
}

/** Minimal table description the cluster checks need (subset of `DestInfo`). */
export interface TableShape {
  exists: boolean;
  engine: string | null;
  engineFull: string | null;
  sortingKey: string | null;
}

export interface ClusterJobInput {
  cluster: ClusterConfig;
  outputMode: SqOutputMode;
  destDatabase: string;
  destTable: string;
  createIfMissing: boolean;
  engine?: string;
  orderBy?: string;
  /** Stored topology to re-verify (run time). Omit at save time to derive it. */
  expectedTopology?: SqClusterTopology;
}

export function topologyFor(shards: number): SqClusterTopology {
  return shards > 1 ? "sharded" : "replicated";
}

export function localTableName(destTable: string, cluster: ClusterConfig): string {
  return cluster.localTable?.trim() || `${destTable}_local`;
}

export async function listClusters(s: ChSession): Promise<ClusterSummary[]> {
  const rows = await s.rows<{ name: string; shards: string | number; maxReplicas: string | number; hosts: string | number; isLocal: string | number }>(
    `SELECT cluster AS name, uniqExact(shard_num) AS shards, max(replica_num) AS maxReplicas, count() AS hosts, max(is_local) AS isLocal
     FROM system.clusters GROUP BY cluster ORDER BY cluster`,
  );
  return rows.map((r) => ({
    name: r.name,
    shards: Number(r.shards),
    maxReplicasPerShard: Number(r.maxReplicas),
    hosts: Number(r.hosts),
    isLocal: Number(r.isLocal) === 1,
  }));
}

/** Strip string literals so their contents are never mistaken for identifiers/calls. */
function stripLiterals(expr: string): string {
  return expr.replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Column-like identifiers referenced by an expression (function names excluded). */
export function referencedIdentifiers(expr: string): Set<string> {
  const out = new Set<string>();
  const src = stripLiterals(expr);
  for (const m of src.matchAll(/`((?:[^`]|``)+)`|\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g)) {
    const name = m[1] !== undefined ? m[1].replace(/``/g, "`") : m[2];
    if (m[2] !== undefined && SQL_WORDS.has(m[2].toLowerCase())) continue;
    out.add(name);
  }
  return out;
}

/** Pure sharding-key rules: present, deterministic, references a column. */
export function shardingKeyErrors(key: string | undefined): string[] {
  const k = key?.trim() ?? "";
  if (!k) return ["A sharding key is required for a sharded cluster"];
  const errors: string[] = [];
  if (NONDETERMINISTIC_FN.test(stripLiterals(k))) {
    errors.push("Sharding key must be deterministic (no rand/now/generateUUID…): a retried slot must route rows to the same shard");
  }
  if (referencedIdentifiers(k).size === 0) errors.push("Sharding key must reference at least one output column");
  return errors;
}

/**
 * Upsert on a sharded cluster: ReplacingMergeTree only collapses rows within one
 * shard, so every column the sharding key uses must be part of the ORDER BY key.
 */
export function colocationError(shardingKey: string, orderBy: string | null | undefined): string | null {
  const orderCols = referencedIdentifiers(orderBy ?? "");
  const missing = [...referencedIdentifiers(shardingKey)].filter((c) => !orderCols.has(c));
  if (missing.length === 0) return null;
  return `Upsert requires the sharding key columns to be part of ORDER BY (missing: ${missing.join(", ")}) so duplicate keys land on the same shard`;
}

export interface ReplicatedEngineSpec {
  family: string;
  /** Explicit Keeper path/replica name when given as the first two string args. */
  path: string | null;
  replica: string | null;
}

/** Parse a `Replicated*MergeTree[(…)]` engine clause; null when not a replicated MergeTree. */
export function parseReplicatedEngine(engine: string | undefined): ReplicatedEngineSpec | null {
  const m = /^\s*(Replicated\w*MergeTree)\s*(?:\(([\s\S]*)\))?\s*$/.exec(engine ?? "");
  if (!m) return null;
  const args = m[2] ?? "";
  const explicit = /^\s*'((?:[^'\\]|\\.)*)'\s*(?:,\s*'((?:[^'\\]|\\.)*)')?/.exec(args);
  if (!explicit) return { family: m[1], path: null, replica: null };
  return { family: m[1], path: explicit[1], replica: explicit[2] ?? null };
}

function macrosIn(...values: string[]): string[] {
  const names = new Set<string>();
  for (const v of values) for (const m of v.matchAll(/\{(\w+)\}/g)) names.add(m[1]);
  return [...names].filter((n) => !BUILTIN_MACROS.has(n));
}

/** Parsed `Distributed(cluster, db, table[, key…])` from `system.tables.engine_full`. */
export interface DistributedSpec {
  cluster: string;
  database: string;
  table: string;
}

function unquoteArg(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/\\(.)/g, "$1");
  if (t.startsWith("`") && t.endsWith("`")) return t.slice(1, -1).replace(/``/g, "`");
  return t;
}

export function parseDistributedEngine(engineFull: string | null): DistributedSpec | null {
  const m = /^\s*Distributed\s*\(([\s\S]*)\)/.exec(engineFull ?? "");
  if (!m) return null;
  const [cluster, database, table] = m[1].match(/'(?:[^'\\]|\\.)*'|`(?:[^`]|``)*`|[^,]+/g) ?? [];
  if (cluster === undefined || database === undefined || table === undefined) return null;
  return { cluster: unquoteArg(cluster), database: unquoteArg(database), table: unquoteArg(table) };
}

const isReplicatedMergeTree = (engine: string | null): boolean => /^Replicated\w*MergeTree$/.test(engine ?? "");

/**
 * Verify an EXISTING destination matches the configured topology. Missing tables
 * are not reported here — the caller decides whether that is fatal.
 */
export function destinationChecks(
  clusterName: string,
  topology: SqClusterTopology,
  database: string,
  localTable: string,
  dest: TableShape,
  local: TableShape | null,
): ClusterCheck[] {
  const checks: ClusterCheck[] = [];
  if (topology === "replicated") {
    if (dest.exists) {
      const ok = isReplicatedMergeTree(dest.engine);
      checks.push({ id: "destination.engine", ok, message: ok ? `Destination is ${dest.engine}` : `A replicated-cluster destination must be Replicated*MergeTree (got ${dest.engine})` });
    }
    return checks;
  }
  if (dest.exists) {
    const spec = dest.engine === "Distributed" ? parseDistributedEngine(dest.engineFull) : null;
    const ok = spec !== null && spec.cluster === clusterName && spec.database === database && spec.table === localTable;
    checks.push({
      id: "destination.engine",
      ok,
      message: ok
        ? `Destination is Distributed over ${database}.${localTable} on ${clusterName}`
        : `A sharded-cluster destination must be Distributed('${clusterName}', '${database}', '${localTable}', …) (got ${dest.engineFull ?? dest.engine})`,
    });
  }
  if (local?.exists) {
    const ok = isReplicatedMergeTree(local.engine);
    checks.push({ id: "destination.local", ok, message: ok ? `Local table is ${local.engine}` : `The per-shard local table must be Replicated*MergeTree (got ${local.engine})` });
  }
  return checks;
}

/**
 * Full precondition check for a cluster job against the connected node. Pure rules
 * (mode, sharding key, engine) and live ones (cluster membership, database, macros,
 * existing destination shape) are reported together so the builder can show all.
 */
export async function inspectClusterJob(
  s: ChSession,
  input: ClusterJobInput,
  describe: (database: string, table: string) => Promise<TableShape>,
): Promise<ClusterInspection> {
  const { cluster, destDatabase } = input;
  const checks: ClusterCheck[] = [];
  const fail = (id: string, message: string): void => void checks.push({ id, ok: false, message });
  const pass = (id: string, message: string): void => void checks.push({ id, ok: true, message });

  const [info] = await s.rows<{ shards: string | number; hosts: string | number; maxReplicas: string | number; isLocal: string | number }>(
    `SELECT uniqExact(shard_num) AS shards, count() AS hosts, max(replica_num) AS maxReplicas, max(is_local) AS isLocal
     FROM system.clusters WHERE cluster = {c:String}`,
    { c: cluster.name },
  );
  const hosts = Number(info?.hosts ?? 0);
  const shards = Number(info?.shards ?? 0);
  const maxReplicasPerShard = Number(info?.maxReplicas ?? 0);
  if (hosts === 0) {
    fail("cluster.exists", `Cluster '${cluster.name}' is not defined on the connected node (system.clusters)`);
    return { ok: false, topology: null, shards: 0, hosts: 0, maxReplicasPerShard: 0, checks };
  }
  const topology = topologyFor(shards);
  pass("cluster.exists", `Cluster '${cluster.name}': ${shards} shard(s), ${hosts} host(s)`);

  if (Number(info?.isLocal) === 1) pass("cluster.local", "Connected node is a member of the cluster");
  else fail("cluster.local", `The connection's node is not a member of '${cluster.name}' — point the connection at a cluster node`);

  if (input.expectedTopology && input.expectedTopology !== topology) {
    fail("cluster.topology", `Cluster '${cluster.name}' is now ${topology} (${shards} shards) but the job was configured as ${input.expectedTopology} — re-save the job to confirm`);
  }

  const [db] = await s.rows<{ engine: string }>(`SELECT engine FROM system.databases WHERE name = {db:String}`, { db: destDatabase });
  if (!db) fail("database.exists", `Database '${destDatabase}' does not exist on the connected node — create it on every host of '${cluster.name}' first`);
  else if (db.engine === "Replicated") {
    fail("database.engine", `Database '${destDatabase}' uses the Replicated database engine, which replicates DDL itself and rejects ON CLUSTER — save the job without a cluster`);
  } else pass("database.exists", `Database '${destDatabase}' (${db.engine})`);

  if (input.outputMode === "replace" && topology === "sharded") {
    fail("mode.replace", "Replace partition is not available on a sharded cluster: REPLACE PARTITION is shard-local and cannot swap atomically across shards");
  }

  if (topology === "sharded") {
    const keyErrors = shardingKeyErrors(cluster.shardingKey);
    for (const e of keyErrors) fail("sharding.key", e);
    if (keyErrors.length === 0) pass("sharding.key", `Sharding key: ${cluster.shardingKey}`);
    if (localTableName(input.destTable, cluster) === input.destTable) {
      fail("sharding.localTable", "The local table name must differ from the destination (Distributed) table name");
    }
  }

  const localTable = localTableName(input.destTable, cluster);
  const dest = await describe(destDatabase, input.destTable);
  const local = topology === "sharded" ? await describe(destDatabase, localTable) : null;
  checks.push(...destinationChecks(cluster.name, topology, destDatabase, localTable, dest, local));

  const needsCreate = !dest.exists || (local !== null && !local.exists);
  if (needsCreate && !input.createIfMissing) {
    fail("destination.exists", "The cluster destination does not exist — enable “Create destination table if missing” or create it first");
  }

  if (needsCreate && input.createIfMissing) {
    const spec = parseReplicatedEngine(input.engine);
    if (!spec) {
      fail("engine.replicated", `Cluster destinations require a Replicated*MergeTree engine (got ${input.engine?.trim() || "MergeTree"})`);
    } else {
      let path = spec.path;
      let replica = spec.replica;
      if (path === null) {
        const settings = await s.rows<{ name: string; value: string }>(
          `SELECT name, value FROM system.server_settings WHERE name IN ('default_replica_path', 'default_replica_name')`,
        );
        path = settings.find((r) => r.name === "default_replica_path")?.value || DEFAULT_REPLICA_PATH;
        replica = settings.find((r) => r.name === "default_replica_name")?.value || DEFAULT_REPLICA_NAME;
      }
      if (replica === null) fail("engine.replicaPath", "An explicit Keeper path needs an explicit replica name argument containing {replica}");
      else if (!replica.includes("{replica}")) fail("engine.replicaPath", `Replica name '${replica}' must contain {replica} so each host registers a distinct replica`);
      if (topology === "sharded" && !path.includes("{shard}")) {
        fail("engine.replicaPath", `Keeper path '${path}' must contain {shard} so each shard replicates independently`);
      }
      const needed = macrosIn(path, replica ?? "");
      if (needed.length > 0) {
        const defined = new Set((await s.rows<{ macro: string }>(`SELECT macro FROM system.macros`)).map((r) => r.macro));
        const missing = needed.filter((m) => !defined.has(m));
        if (missing.length > 0) fail("engine.macros", `Macro(s) ${missing.map((m) => `{${m}}`).join(", ")} are not defined on the connected node (<macros> in server config)`);
        else pass("engine.macros", `Macros defined: ${needed.map((m) => `{${m}}`).join(", ")}`);
      }
      if (!checks.some((c) => !c.ok && c.id.startsWith("engine."))) pass("engine.replicated", `${spec.family} at ${path}`);
    }
  }

  if (input.outputMode === "upsert" && topology === "sharded" && cluster.shardingKey?.trim()) {
    const orderBy = needsCreate ? input.orderBy : local?.sortingKey;
    const err = colocationError(cluster.shardingKey, orderBy);
    if (err) fail("sharding.colocated", err);
  }

  return { ok: checks.every((c) => c.ok), topology, shards, hosts, maxReplicasPerShard, checks };
}

/** Human summary of the failing checks, for AppError / run messages. */
export function inspectionError(inspection: ClusterInspection): string {
  return inspection.checks.filter((c) => !c.ok).map((c) => c.message).join("; ");
}
