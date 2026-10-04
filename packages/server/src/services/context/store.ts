/**
 * Context engine (ADR 0016 §11): what a table means, for people and agents.
 *
 * Derived facts come from the collectors (sorting key, engine semantics,
 * common joins, known-good query patterns); curated fields are owned by
 * people (description, grain, owner, canonical metrics, "instead of").
 * `getTableContext` is what Chouse AI and MCP `get_table_context` serve.
 */

import { randomUUID } from "crypto";

import { z } from "zod";

import { all, json, num, numOrNull, one, run, sql, str, strOrNull } from "../observe/db";

export const curatedContextSchema = z.object({
  description: z.string().trim().max(4000).nullish(),
  grain: z.string().trim().max(500).nullish(),
  owner: z.string().trim().max(200).nullish(),
  insteadOf: z.string().trim().max(300).nullish(),
  deprecated: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
});
export type CuratedContext = z.infer<typeof curatedContextSchema>;

export const metricSchema = z.object({
  name: z.string().trim().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Metric names are identifiers"),
  expression: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(2000).nullish(),
  owner: z.string().trim().max(200).nullish(),
});
export type MetricInput = z.infer<typeof metricSchema>;

export interface Metric extends MetricInput {
  id: string;
  database: string;
  table: string;
  updatedAt: number;
}

export interface TableContext {
  connectionId: string;
  database: string;
  table: string;
  curated: (CuratedContext & { source: string; verifiedBy: string | null; verifiedAt: number | null; updatedBy: string | null; updatedAt: number | null }) | null;
  derived: {
    engine: string | null;
    sortingKey: string | null;
    partitionKey: string | null;
    totalRows: number | null;
    totalBytes: number | null;
    queryGuidance: string[];
    joins: Array<{ column: string; target: string; share: number }>;
    columns: Array<{ name: string; type: string; comment: string | null }>;
  };
  metrics: Metric[];
  patterns: Array<{ fingerprint: string; sampleQuery: string; runs: number; users: number; p95Ms: number | null; readRatio: number | null }>;
  health: { state: string | null; reason: string | null; criticality: string | null };
}

/** Engine-aware guidance the agent should follow when querying the table. */
export function queryGuidance(engine: string | null, sortingKey: string | null, partitionKey: string | null): string[] {
  const guidance: string[] = [];
  const firstKey = (sortingKey ?? "").split(",")[0]?.trim();
  if (firstKey) guidance.push(`Filter on ${firstKey}; it leads the ORDER BY, so filters on it skip most granules.`);
  if (partitionKey && partitionKey !== "tuple()") guidance.push(`Partitioned by ${partitionKey}; constrain it to avoid scanning every partition.`);
  if (engine?.startsWith("Summing")) guidance.push("SummingMergeTree: aggregate with sum() and GROUP BY the key; raw rows may not be collapsed yet.");
  if (engine?.startsWith("Aggregating")) guidance.push("AggregatingMergeTree: read with the -Merge combinators (e.g. sumMerge, uniqMerge).");
  if (engine?.startsWith("Replacing")) guidance.push("ReplacingMergeTree: duplicates exist until merges run; use FINAL or argMax when exact results matter.");
  if (engine?.startsWith("Collapsing") || engine?.startsWith("VersionedCollapsing")) guidance.push("Collapsing engine: weight rows by the sign column when aggregating.");
  if (engine === "Distributed") guidance.push("Distributed table: queries fan out to every shard.");
  return guidance;
}

export async function getTableContext(connectionId: string, database: string, table: string): Promise<TableContext | null> {
  const catalog = await one(sql`SELECT * FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  const curatedRow = await one(sql`SELECT * FROM ctx_table_context WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  if (!catalog && !curatedRow) return null;
  const columns = (await all(sql`SELECT column_name, column_type, comment FROM obs_catalog_columns WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} ORDER BY position`))
    .map((c) => ({ name: str(c.column_name), type: str(c.column_type), comment: strOrNull(c.comment) || null }));
  const metrics = await listMetrics(connectionId, database, table);
  const patterns = (await all(sql`SELECT * FROM ctx_patterns WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} ORDER BY runs DESC`))
    .map((p) => ({ fingerprint: str(p.fingerprint), sampleQuery: str(p.sample_query), runs: num(p.runs), users: num(p.users), p95Ms: numOrNull(p.p95_ms), readRatio: numOrNull(p.read_ratio) }));
  const baseline = await one(sql`SELECT state, state_reason, criticality FROM obs_table_baselines WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  const joins = await commonJoins(connectionId, database, table);
  const engine = catalog ? str(catalog.engine) || null : null;
  const sortingKey = catalog ? str(catalog.sorting_key) || null : null;
  const partitionKey = catalog ? str(catalog.partition_key) || null : null;
  return {
    connectionId,
    database,
    table,
    curated: curatedRow ? {
      description: strOrNull(curatedRow.description),
      grain: strOrNull(curatedRow.grain),
      owner: strOrNull(curatedRow.owner),
      insteadOf: strOrNull(curatedRow.instead_of),
      deprecated: num(curatedRow.deprecated) === 1,
      tags: json<string[]>(curatedRow.tags, []),
      source: str(curatedRow.source),
      verifiedBy: strOrNull(curatedRow.verified_by),
      verifiedAt: numOrNull(curatedRow.verified_at),
      updatedBy: strOrNull(curatedRow.updated_by),
      updatedAt: numOrNull(curatedRow.updated_at),
    } : null,
    derived: {
      engine,
      sortingKey,
      partitionKey,
      totalRows: catalog ? numOrNull(catalog.total_rows) : null,
      totalBytes: catalog ? numOrNull(catalog.total_bytes) : null,
      queryGuidance: queryGuidance(engine, sortingKey, partitionKey),
      joins,
      columns,
    },
    metrics,
    patterns,
    health: { state: baseline ? str(baseline.state) : null, reason: baseline ? strOrNull(baseline.state_reason) : null, criticality: baseline ? str(baseline.criticality) : null },
  };
}

/** Join columns observed in known-good patterns: `<col> = other.table.<col>` style references. */
async function commonJoins(connectionId: string, database: string, table: string): Promise<TableContext["derived"]["joins"]> {
  const patterns = await all(sql`SELECT sample_query, runs FROM ctx_patterns WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
  const counts = new Map<string, number>();
  let total = 0;
  for (const p of patterns) {
    const query = str(p.sample_query);
    for (const m of query.matchAll(/JOIN\s+([\w.`]+)[\s\S]*?\bON\b\s+[\w.`]*?\.?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[\w.`]*?\.?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      const key = `${m[2]}→${m[1].replace(/`/g, "")}.${m[3]}`;
      counts.set(key, (counts.get(key) ?? 0) + num(p.runs));
    }
    total += num(p.runs);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, n]) => {
    const [column, target] = key.split("→");
    return { column, target, share: total > 0 ? Math.round((n / total) * 100) / 100 : 0 };
  });
}

export async function upsertCurated(connectionId: string, database: string, table: string, input: CuratedContext, actorId: string | null, source: "manual" | "dbt" = "manual"): Promise<void> {
  const parsed = curatedContextSchema.parse(input);
  const now = Date.now();
  await run(sql`
    INSERT INTO ctx_table_context (connection_id, database_name, table_name, description, grain, owner, instead_of, deprecated, tags, source, updated_by, updated_at)
    VALUES (${connectionId}, ${database}, ${table}, ${parsed.description ?? null}, ${parsed.grain ?? null}, ${parsed.owner ?? null}, ${parsed.insteadOf ?? null}, ${parsed.deprecated ? 1 : 0}, ${JSON.stringify(parsed.tags)}, ${source}, ${actorId}, ${now})
    ON CONFLICT (connection_id, database_name, table_name) DO UPDATE SET description = ${parsed.description ?? null}, grain = ${parsed.grain ?? null},
      owner = ${parsed.owner ?? null}, instead_of = ${parsed.insteadOf ?? null}, deprecated = ${parsed.deprecated ? 1 : 0}, tags = ${JSON.stringify(parsed.tags)},
      source = ${source}, updated_by = ${actorId}, updated_at = ${now}
  `);
}

export async function verifyContext(connectionId: string, database: string, table: string, actorId: string): Promise<void> {
  await run(sql`UPDATE ctx_table_context SET verified_by = ${actorId}, verified_at = ${Date.now()} WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
}

export async function listMetrics(connectionId: string, database?: string, table?: string): Promise<Metric[]> {
  const rows = database && table
    ? await all(sql`SELECT * FROM ctx_metrics WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} ORDER BY name`)
    : await all(sql`SELECT * FROM ctx_metrics WHERE connection_id = ${connectionId} ORDER BY database_name, table_name, name`);
  return rows.map((r) => ({ id: str(r.id), database: str(r.database_name), table: str(r.table_name), name: str(r.name), expression: str(r.expression), description: strOrNull(r.description), owner: strOrNull(r.owner), updatedAt: num(r.updated_at) }));
}

export async function upsertMetric(connectionId: string, database: string, table: string, input: MetricInput, actorId: string | null): Promise<Metric> {
  const parsed = metricSchema.parse(input);
  const now = Date.now();
  const existing = await one(sql`SELECT id FROM ctx_metrics WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table} AND name = ${parsed.name}`);
  const id = existing ? str(existing.id) : randomUUID();
  if (existing) {
    await run(sql`UPDATE ctx_metrics SET expression = ${parsed.expression}, description = ${parsed.description ?? null}, owner = ${parsed.owner ?? null}, updated_at = ${now} WHERE id = ${id}`);
  } else {
    await run(sql`
      INSERT INTO ctx_metrics (id, connection_id, database_name, table_name, name, expression, description, owner, created_by, updated_at)
      VALUES (${id}, ${connectionId}, ${database}, ${table}, ${parsed.name}, ${parsed.expression}, ${parsed.description ?? null}, ${parsed.owner ?? null}, ${actorId}, ${now})
    `);
  }
  return (await listMetrics(connectionId, database, table)).find((m) => m.id === id)!;
}

export async function deleteMetric(id: string): Promise<boolean> {
  const existing = await one(sql`SELECT id FROM ctx_metrics WHERE id = ${id}`);
  if (!existing) return false;
  await run(sql`DELETE FROM ctx_metrics WHERE id = ${id}`);
  return true;
}

export async function getMetricByName(connectionId: string, name: string): Promise<Metric[]> {
  return (await listMetrics(connectionId)).filter((m) => m.name === name);
}

// --- dbt manifest import -----------------------------------------------------

const manifestSchema = z.object({
  nodes: z.record(z.object({
    resource_type: z.string(),
    schema: z.string().optional(),
    database: z.string().nullish(),
    alias: z.string().nullish(),
    name: z.string(),
    description: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
    config: z.object({ meta: z.record(z.unknown()).optional() }).passthrough().optional(),
    tags: z.array(z.string()).optional(),
  }).passthrough()),
}).passthrough();

export interface DbtImportResult {
  imported: number;
  skipped: number;
  tables: string[];
}

/**
 * Import model descriptions, owners and tags from a dbt `manifest.json`.
 * dbt-clickhouse maps the dbt schema to the ClickHouse database.
 */
export async function importDbtManifest(connectionId: string, manifest: unknown, actorId: string | null): Promise<DbtImportResult> {
  const parsed = manifestSchema.parse(manifest);
  const known = new Set((await all(sql`SELECT database_name, table_name FROM obs_catalog_tables WHERE connection_id = ${connectionId}`)).map((r) => `${str(r.database_name)}.${str(r.table_name)}`));
  const result: DbtImportResult = { imported: 0, skipped: 0, tables: [] };
  for (const node of Object.values(parsed.nodes)) {
    if (node.resource_type !== "model" && node.resource_type !== "seed" && node.resource_type !== "snapshot") continue;
    const database = node.schema ?? "";
    const table = node.alias || node.name;
    if (!known.has(`${database}.${table}`)) {
      result.skipped++;
      continue;
    }
    const meta = { ...(node.config?.meta ?? {}), ...(node.meta ?? {}) };
    const owner = typeof meta.owner === "string" ? meta.owner : null;
    const existing = await one(sql`SELECT source FROM ctx_table_context WHERE connection_id = ${connectionId} AND database_name = ${database} AND table_name = ${table}`);
    // Never overwrite context a person curated by hand.
    if (existing && str(existing.source) === "manual") {
      result.skipped++;
      continue;
    }
    await upsertCurated(connectionId, database, table, { description: node.description || null, grain: null, owner, insteadOf: null, deprecated: false, tags: node.tags ?? [] }, actorId, "dbt");
    result.imported++;
    result.tables.push(`${database}.${table}`);
  }
  return result;
}
