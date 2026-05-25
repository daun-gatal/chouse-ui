/**
 * ChouseD (Chouse Doctor) — AI SRE for the ClickHouse fleet.
 *
 * An agentic investigator: it's handed a fresh per-node overview (memory/CPU,
 * top queries, longest query, recent errors) and can drill into any node with
 * READ-ONLY `system.*` SELECTs via the `query_node` tool, then returns a
 * STRUCTURED health report (verdict + per-node status/details + prioritised
 * recommendations) so the UI can render it nicely. The agent can only OBSERVE —
 * every tool query is guarded (single SELECT against system.*) and run with
 * ClickHouse `readonly=1`, so it can never kill/mutate/DDL.
 *
 * Reuses the existing AI plumbing: aiConfig (BYO provider incl. local
 * OpenAI-compatible) + the `ai` SDK ToolLoopAgent, mirroring aiOptimizer.ts.
 */

import { randomUUID } from "crypto";
import { ToolLoopAgent, tool, zodSchema, stepCountIs, generateObject, type ModelMessage } from "ai";
import { z } from "zod";

import { getConfiguration, validateConfiguration, initializeAIModel, isAIEnabled } from "./aiConfig";
import { CLICKHOUSE_PLAYBOOK, needsPlaybook } from "./clickhousePlaybook";
import { runFleetMetric, buildFleetConfig } from "./fleetMetrics";
import { ClientManager } from "./clientManager";
import { listConnections } from "../rbac/services/connections";
import { logger } from "../utils/logger";
import { AppError } from "../types";

const StatusEnum = z.enum(["healthy", "warning", "critical"]);

/** Data-grounded analysis of one memory-hungry query. */
const HeavyQuerySchema = z.object({
  node: z.string(),
  query: z.string(),
  peakMemory: z.string(),
  user: z.string().optional(),
  cause: z.string(),
  tables: z.array(
    z.object({
      name: z.string(),
      engine: z.string().optional(),
      rows: z.string().optional(),
      note: z.string(),
    }),
  ),
  suggestions: z.array(z.string()),
  /** The optimized version of the query — same result, business logic unchanged (review before running). */
  optimizedQuery: z.string().optional(),
  /** Real EXPLAIN ESTIMATE figures (rows/parts/marks to read) — computed by the
   * backend for the original vs the rewrite. The model must NOT fill this. */
  estimate: z
    .object({
      before: z.object({ rows: z.number(), parts: z.number(), marks: z.number() }).optional(),
      after: z.object({ rows: z.number(), parts: z.number(), marks: z.number() }).optional(),
    })
    .optional(),
});

const DoctorReportSchema = z.object({
  verdict: z.object({
    status: StatusEnum,
    summary: z.string(),
  }),
  nodes: z.array(
    z.object({
      name: z.string(),
      status: StatusEnum,
      details: z.array(z.string()),
    }),
  ),
  recommendations: z.array(z.string()),
  // Deep-dive on memory-hungry queries — populated only when one breaches the
  // memory standard; omitted/empty on a healthy fleet.
  heavyQueries: z.array(HeavyQuerySchema).optional(),
});

export type DoctorAnalysis = z.infer<typeof DoctorReportSchema>;

/**
 * Real per-node numbers captured at scan time (from the `summary` fleet metric),
 * so the report can render trustworthy metric chips/gauges instead of relying on
 * the AI to echo figures. Matched to analysis.nodes[] by `name`.
 */
export interface NodeVitals {
  id: string;
  name: string;
  reachable: boolean;
  memPct: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  cpuPct: number | null;
  activeQueries: number | null;
  longRunningQueries: number | null;
  longRunningMerges: number | null;
  openMutations: number | null;
  sickReplicas: number | null;
  replicaLagSeconds: number | null;
  uptimeSeconds: number | null;
  version: string | null;
}

export interface DoctorReport {
  /** Stable id — the report's own page is /doctor/:id. */
  id: string;
  /** Structured analysis for the rich UI; null if the model didn't return valid JSON. */
  analysis: DoctorAnalysis | null;
  /** The agent's raw final text — fallback render when `analysis` is null. */
  raw: string;
  /** Audit trail — read-only queries the agent ran (the "evidence chain"). */
  steps: { tool: string; input: unknown }[];
  /** Real per-node metrics captured for this scan (memory/cpu/queries/lag/…). */
  vitals: NodeVitals[];
  model: string;
  scannedAt: number; // unix ms
  durationMs: number; // wall-clock time the scan took
  nodes: number;
  hours: number; // investigation window (lookback) used for this scan
}

/** Derive the per-node vitals chip-data from a built overview entry. */
function vitalsFromOverview(o: Record<string, unknown>): NodeVitals {
  const s = (o.summary ?? null) as Record<string, unknown> | null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const total = num(s?.server_memory_total_bytes);
  const used = num(s?.server_memory_used_bytes);
  return {
    id: String(o.id ?? ""),
    name: String(o.name ?? ""),
    reachable: s != null,
    memUsedBytes: used,
    memTotalBytes: total,
    memPct: total && used != null && total > 0 ? Math.round((used / total) * 100) : null,
    cpuPct: num(s?.server_cpu_percent),
    activeQueries: num(s?.active_queries),
    longRunningQueries: num(s?.long_running_queries),
    longRunningMerges: num(s?.long_running_merges),
    openMutations: num(s?.open_mutations),
    sickReplicas: num(s?.sick_replicas),
    replicaLagSeconds: num(s?.max_replica_lag_seconds),
    uptimeSeconds: num(s?.uptime_seconds),
    version: typeof s?.server_version === "string" ? (s.server_version as string) : null,
  };
}

const SYSTEM_PROMPT = `You are Chouse AI, acting as ClickHouse's fleet doctor — an expert Site Reliability Engineer reviewing a fleet of ClickHouse servers ("nodes").

You are given a JSON overview with one object per node: server memory %, CPU %, active/long-running query counts, blocked merges/mutations, replica lag + sick replicas, uptime, version, the top memory-consuming queries running NOW, the longest-running query, recent exceptions, and \`recentHeavyQueries\` — the heaviest query SHAPES by memory over the selected investigation window (peak_gb, avg_gb, runs, user, sample, last_seen) from system.query_log, so you catch memory-hungry queries even if they already finished. The window length is stated in the user message.

1. Read the overview and spot anything unhealthy — memory pressure, a single runaway query running now, a query shape that repeatedly peaks high memory over the window (from recentHeavyQueries — call out the worst offenders, their peak_gb, user, and how often they run), replication lag, stuck merges/mutations, repeated exceptions, version skew.
2. When you need detail, use the \`query_node\` tool to run a READ-ONLY SELECT against that node's \`system.*\` tables (system.processes, system.replicas, system.merges, system.mutations, system.query_log, system.parts, system.asynchronous_metrics, …). It is read-only — writes/DDL/KILL are rejected — so investigate freely, but you can only observe.
ClickHouse system.* column reference — use these EXACT column names; a wrong guess wastes a full round-trip and fails:
- system.processes (queries running NOW): query_id, user, query, elapsed (Float64 SECONDS — NOT elapsed_ms / elapsed_seconds), memory_usage, peak_memory_usage, read_rows, read_bytes, total_rows_approx, query_kind, is_cancelled.
- system.query_log (FINISHED queries): event_time, query_start_time, query_duration_ms (UInt64 ms — there is NO "elapsed"), type ('QueryFinish' / 'ExceptionWhileProcessing' / …), query, query_id, user, memory_usage (peak), read_rows, read_bytes, result_rows, exception, exception_code, normalized_query_hash. Filter type = 'QueryFinish' for completed queries.
- system.merges (in-progress merges): database, table, elapsed, progress (0..1), num_parts, result_part_name, total_size_bytes_compressed, is_mutation, merge_type, rows_read, rows_written. There is NO type / reason / status / total_size_memory / bytes_in_source_parts.
- system.mutations: database, table, mutation_id, command, create_time, parts_to_do (remaining), is_done, latest_failed_part, latest_fail_time, latest_fail_reason. There is NO parts_done / fail_count — use is_done + parts_to_do, and latest_fail_reason for failures.
- system.replicas: database, table, is_readonly, is_session_expired, absolute_delay (lag in SECONDS), queue_size, inserts_in_queue, merges_in_queue, total_replicas, active_replicas, zookeeper_path. There is NO partitions_total / parts_active.
- Current metric VALUES: query system.metrics or system.asynchronous_metrics — both LONG format (columns: metric, value, description). system.metric_log is WIDE (one column per metric: CurrentMetric_*, ProfileEvent_*) — do NOT SELECT metric, value FROM system.metric_log.
- system.parts (on-disk parts): database, table, partition, active, rows, bytes_on_disk, data_compressed_bytes, modification_time, level. GROUP BY partition to see partition sizes + part counts (scanning every partition = no pruning; many parts = merge pressure).
- system.tables (one row per table): database, table, engine, total_rows, total_bytes, partition_key, sorting_key, primary_key, engine_full, and \`as_select\` + \`create_table_query\` (the SELECT/DDL for a view). Engine tells the kind: a MergeTree-family engine = real stored data; \`View\` = NO data of its own; \`MaterializedView\` = data in a hidden inner table.
- system.columns (one row per column): database, table, name, type, data_compressed_bytes, data_uncompressed_bytes, marks_bytes. Filter by database+table; ORDER BY data_compressed_bytes DESC to find the heaviest columns + types that should be narrower / LowCardinality.
- system.query_log also has \`tables\` Array(String) + \`columns\` Array(String) (what a query touched) and ProfileEvents Map(String,UInt64). Use \`tables\` to learn which tables a heavy query read instead of parsing SQL.
If a query errors with "Unknown expression identifier", re-read this list — do NOT retry random column-name variants.

HIGH-MEMORY QUERY DEEP-DIVE — do this whenever a query eats memory beyond the norm (several GB, a large share of server memory, or a top entry in topMemoryQueries / recentHeavyQueries). Don't hand-wave "it's heavy" — gather REAL data, but stay FAST and tight:
 - SPEED RULES (important — busy clusters make query_log scans slow): the heavy queries + their peak memory are ALREADY in the overview (recentHeavyQueries: peak_gb/user/sample/runs; topMemoryQueries: memory_usage). REUSE them — do NOT re-query system.query_log for memory or query text. Inspect only the CHEAP metadata tables (system.tables / system.columns / system.parts — they read almost nothing). Deep-dive only the TOP 1–2 heaviest query shapes, ≤2 tables each. Avoid extra system.query_log queries entirely unless absolutely necessary (and then bound them with an event_time range + LIMIT).
 a. Find the tables it reads by parsing the query text already in the overview (recentHeavyQueries.sample / topMemoryQueries.query_preview).
 b. For each table pull the facts (cheap metadata, instant): system.tables (engine, total_rows, total_bytes, partition_key, sorting_key) → how big + how it's keyed; system.columns (type + data_compressed_bytes) → heaviest / mistyped columns; system.parts grouped by partition → is it scanning every partition? too many parts?
 b2. VIEWS — if a "table" has engine \`View\`, \`MaterializedView\`, or \`LiveView\` it has little/no data of its own (total_rows ~0, system.parts empty), so DON'T conclude "empty / not found" — follow it to the real storage:
    • \`View\`: read its \`as_select\` from system.tables and analyze the REAL source tables it selects from (their rows/engine/columns/parts) — that's where the memory comes from.
    • \`MaterializedView\`: its stored data lives in a hidden inner table \`.inner_id.<uuid>\` (or its \`TO\` target — see create_table_query); look THAT up in system.tables/system.parts for size, and \`as_select\` shows the source it reads on insert.
    Note: system.query_log.\`tables\` for a view query usually lists the underlying tables too — prefer those (real MergeTree tables) for the size/rows analysis.
 c. Pin the CAUSE on that data — e.g. no filter on the partition/sorting key so it scans billions of rows; GROUP BY / DISTINCT on a high-cardinality column builds a giant hash table; SELECT * pulls wide columns; a String that should be LowCardinality; a JOIN with a huge right side.
 d. Record it in \`heavyQueries\`: the query, its real peak memory, the user (or Redash attribution), the cause, per-table findings (name, engine, rows, the issue), concrete optimization suggestions grounded in the data, AND \`optimizedQuery\` — the OPTIMIZED version of the query with those fixes applied as concrete, runnable ClickHouse SQL (e.g. date filter pushed into the CTEs, argMax(...) instead of ROW_NUMBER() OVER(...) WHERE rn=1, filter/aggregate each side BEFORE the JOIN, LowCardinality, narrowed SELECT, max_bytes_before_external_group_by), using the REAL table + column names.
    HARD REQUIREMENTS — the optimized query MUST:
      • return the EXACT SAME result as the original — same columns, same rows, same values (optimize only HOW data is read/computed, never WHAT it returns);
      • keep the business logic 100% UNCHANGED — no dropped or added filters, no altered aggregations, joins, grouping, ordering or semantics;
      • aim to run in UNDER 1 MINUTE and peak UNDER 1 GB of memory.
    Write it COMPLETE and VALID — every CTE, SELECT, JOIN, WHERE, GROUP BY, ORDER BY and window reproduced in full so it parses and EXPLAINs cleanly (NO "…" / "-- omitted" placeholders, do not abbreviate static lists). recentHeavyQueries[].sample_query gives up to ~8000 chars of the real query to work from. (Indentation is pretty-printed for display.) It is a suggested optimized query a human reviews + adapts before running.

3. Then output ONLY a JSON object (no prose, no markdown, no code fences) matching EXACTLY this schema:
{
  "verdict": { "status": "healthy" | "warning" | "critical", "summary": "one concise line on overall fleet health" },
  "nodes": [
    { "name": "<node name>", "status": "healthy" | "warning" | "critical", "details": ["short metric/finding line", "..."] }
  ],
  "recommendations": ["concrete, actionable recommendation", "..."],
  "heavyQueries": [
    { "node": "<node>", "query": "<the original query — runnable SQL from recentHeavyQueries.sample_query>", "peakMemory": "<e.g. 12.4 GB>", "user": "<user, or 'Redash #1234 (jane.doe)'>", "cause": "<why it eats that much memory, grounded in the data you gathered>", "tables": [ { "name": "db.table", "engine": "<engine>", "rows": "<e.g. 2.3B>", "note": "<the issue: scans all partitions / huge column / high-cardinality GROUP BY / …>" } ], "suggestions": ["concrete optimization grounded in the data", "..."], "optimizedQuery": "<the optimized version — complete, runnable ClickHouse SQL with the SAME result, business logic unchanged>" }
  ]
}

Rules:
- status = severity: "healthy" (fine), "warning" (needs attention soon), "critical" (acting up now).
- details = the key numbers/observations for that node (memory, CPU, queries, replication, errors) as short lines — cite real values.
- recommendations = prioritised + actionable. For anything destructive (killing a query, changing settings) note a human must run it.
- Base everything on real data from the overview or your tool calls — do NOT invent numbers.
- Redash attribution: many heavy queries come from Redash and run as the shared DB user "r_redash", which is useless for blame. When a query object carries \`redash_user\` and/or \`redash_query_id\`, it originated from a SPECIFIC Redash saved query — name it explicitly in that node's details and recommendations (e.g. "Redash query #1234 (jane.doe) peaks 57 GB over 40 runs/6h") so the operator can open and fix/disable that exact dashboard. Prefer this over the generic "r_redash".
- Be efficient on a healthy fleet — if nothing looks wrong, a handful of query_node calls is plenty. BUT when a query breaches the memory standard, spend the calls needed for the deep-dive above (its tables' rows/engine/columns/parts) — depth there is the whole point. Always leave room to finish by outputting the JSON object; never burn the entire budget on tool calls.
- heavyQueries: add an entry for EVERY query you flag as eating too much memory, grounded in the table data you gathered (never invent rows/engines). Put the runnable original in \`query\` and the optimized version in \`optimizedQuery\` (both complete, valid SQL — the system EXPLAINs them to prove before→after). Do NOT fill \`estimate\` — the system computes it. Omit/empty heavyQueries when no query is problematic.
- Output the JSON object and nothing else.`;

/** ChouseD is available only when an AI provider is configured. */
export async function isDoctorEnabled(): Promise<boolean> {
  return isAIEnabled();
}

/** 3-tier JSON extraction (whole text → fenced block → first {...} span). */
function extractJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text.trim();
  try {
    return schema.parse(JSON.parse(cleaned));
  } catch {
    /* fall through */
  }
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return schema.parse(JSON.parse(fence[1].trim()));
    } catch {
      /* fall through */
    }
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return schema.parse(JSON.parse(cleaned.slice(start, end + 1)));
  }
  throw new Error("No JSON object found");
}

const REDASH_USER_RE = /Username:\s*([^,]+)/i;
const REDASH_QID_RE = /query_id:\s*(\d+)/i;

/**
 * Redash submits queries with a leading annotation comment:
 *   \/* Username: jane.doe@acme.com, query_id: 1234, Queue: ..., Job ID: ... *\/
 * They all run as the shared DB user `r_redash`, so the `user` column is
 * useless for blame. Pull the human + saved-query id out of the comment so the
 * report can pin a heavy query on a specific Redash dashboard. Matches the
 * format used by the "By Redash" monitoring view (useQueryByRedashId).
 */
function extractRedash(text: string): { redash_user?: string; redash_query_id?: string } {
  const out: { redash_user?: string; redash_query_id?: string } = {};
  const u = REDASH_USER_RE.exec(text);
  if (u?.[1]?.trim()) out.redash_user = u[1].trim();
  const q = REDASH_QID_RE.exec(text);
  if (q?.[1]) out.redash_query_id = q[1];
  return out;
}

/** Strip comment blocks + collapse whitespace so query text is real SQL, bounded. */
function sanitizeQueryRow(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (typeof out.query_preview === "string") {
    // Pull Redash attribution from the leading comment BEFORE stripping comments.
    Object.assign(out, extractRedash(out.query_preview));
    out.query_preview = out.query_preview
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }
  return out;
}

/** Validate a tool SQL is a single read-only SELECT against system.* tables. */
function assertReadOnlySql(raw: string): string {
  const s = raw.trim().replace(/;\s*$/, "");
  if (s.includes(";")) throw new Error("Only a single statement is allowed");
  if (!/^(select|with)\b/i.test(s)) throw new Error("Only SELECT / WITH queries are allowed");
  if (/\b(insert|update|delete|drop|alter|truncate|attach|detach|optimize|create|rename|grant|revoke|kill)\b/i.test(s)) {
    throw new Error("Query contains a forbidden (write/DDL/KILL) keyword");
  }
  if (!/\bsystem\./i.test(s)) throw new Error("Chouse AI may only read system.* tables");
  return s;
}

function queryNodeTool(connections: { id: string; name: string }[]) {
  const nameById = new Map(connections.map((c) => [c.id, c.name]));
  return tool({
    description:
      "Run ONE read-only SQL SELECT against a node's system.* tables to investigate (processes, replicas, merges, mutations, query_log, parts, asynchronous_metrics, …). Read-only: writes/DDL/KILL are rejected. Returns up to 100 rows.",
    inputSchema: zodSchema(
      z.object({
        connectionId: z.string().describe("the node id from the overview"),
        sql: z.string().describe("a single read-only SELECT querying system.* tables"),
      }),
    ),
    execute: async ({ connectionId, sql }: { connectionId: string; sql: string }) => {
      if (!nameById.has(connectionId)) return { error: "Unknown connectionId" };
      let safe: string;
      try {
        safe = assertReadOnlySql(sql);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Rejected query" };
      }
      try {
        const config = await buildFleetConfig(connectionId);
        const client = ClientManager.getInstance().getClient(config);
        const result = await client.query({
          query: safe,
          format: "JSON",
          clickhouse_settings: {
            readonly: "1",
            // Fail a slow/heavy diagnostic query fast (8s) instead of grinding —
            // on a busy prod cluster a system.query_log scan can otherwise eat
            // 15s+ per step and make the whole scan take minutes.
            max_execution_time: 8,
            max_result_rows: "200",
            result_overflow_mode: "break",
          },
        });
        const json = (await result.json()) as { data?: Record<string, unknown>[] };
        return { node: nameById.get(connectionId), rows: (json.data ?? []).slice(0, 100) };
      } catch (e) {
        return { error: e instanceof Error ? e.message.slice(0, 300) : "Query failed" };
      }
    },
  });
}

/** Clamp a requested window to a sane integer hour range (1h … 31 days). */
function clampHours(hours: number | undefined): number {
  return Math.max(1, Math.min(744, Math.round(hours ?? 6)));
}

/** Top query SHAPES by memory over the last N hours (system.query_log) — read-only. */
function recentHeavyQueriesSql(hours: number): string {
  const h = clampHours(hours); // integer-clamped → safe to interpolate
  return `
  SELECT
    any(substring(query, 1, 8000)) AS sample_query,
    any(user) AS user,
    count() AS runs,
    round(max(memory_usage) / 1e9, 2) AS peak_gb,
    round(avg(memory_usage) / 1e9, 2) AS avg_gb,
    formatDateTime(max(event_time), '%Y-%m-%d %H:%i:%S') AS last_seen,
    max(trim(extract(query, 'Username:\\\\s*([^,]+)'))) AS redash_user,
    max(extract(query, 'query_id:\\\\s*(\\\\d+)')) AS redash_query_id
  FROM system.query_log
  WHERE event_time >= now() - INTERVAL ${h} HOUR
    AND type = 'QueryFinish'
    AND memory_usage > 0
    AND query NOT LIKE '%FLEET_POLLER_MARKER%'
  GROUP BY normalized_query_hash
  ORDER BY peak_gb DESC
  LIMIT 5`;
}

async function recentHeavyQueries(connectionId: string, hours: number): Promise<Record<string, unknown>[]> {
  try {
    const config = await buildFleetConfig(connectionId);
    const client = ClientManager.getInstance().getClient(config);
    const result = await client.query({
      query: recentHeavyQueriesSql(hours),
      format: "JSON",
      clickhouse_settings: { readonly: "1", max_execution_time: 20, max_result_rows: "50" },
    });
    const json = (await result.json()) as { data?: Record<string, unknown>[] };
    return (json.data ?? []).map((r) => {
      const out = { ...r };
      if (typeof out.sample_query === "string") {
        out.sample_query = out.sample_query
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/--[^\n]*/g, " ")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{2,}/g, "\n")
          .trim()
          .slice(0, 8000);
      }
      // Keep Redash attribution only when present, so non-Redash rows stay clean.
      if (!out.redash_user) delete out.redash_user;
      if (!out.redash_query_id) delete out.redash_query_id;
      return out;
    });
  } catch {
    return [];
  }
}

/**
 * Run EXPLAIN ESTIMATE for a query (read-only — it PLANS, never executes) and
 * sum rows/parts/marks across the tables it would read. Returns null on any
 * failure (truncated/invalid SQL, rewrite with placeholders, unknown table, …).
 */
async function explainEstimate(
  connectionId: string,
  rawSql: string,
): Promise<{ rows: number; parts: number; marks: number } | null> {
  // EXPLAIN runs read-only — drop a trailing FORMAT and SETTINGS clause. The
  // SETTINGS clause (e.g. max_bytes_before_external_group_by) is REJECTED under
  // readonly mode and doesn't change the rows/parts estimate anyway; the stored
  // optimized query keeps it for the real run.
  const sql = rawSql
    .replace(/;\s*$/, "")
    .replace(/\bformat\s+\w+\s*$/i, "")
    .replace(/\bsettings\s+\w+\s*=[\s\S]*$/i, "")
    .trim();
  if (!sql || !/^(select|with)\b/i.test(sql)) return null;
  try {
    const config = await buildFleetConfig(connectionId);
    const client = ClientManager.getInstance().getClient(config);
    const result = await client.query({
      query: `EXPLAIN ESTIMATE ${sql}`,
      format: "JSON",
      clickhouse_settings: { readonly: "1", max_execution_time: 10 },
    });
    const json = (await result.json()) as {
      data?: { rows?: unknown; parts?: unknown; marks?: unknown }[];
    };
    const data = json.data ?? [];
    if (data.length === 0) return null;
    let rows = 0;
    let parts = 0;
    let marks = 0;
    for (const r of data) {
      rows += Number(r.rows) || 0;
      parts += Number(r.parts) || 0;
      marks += Number(r.marks) || 0;
    }
    return { rows, parts, marks };
  } catch (e) {
    // Log WHY (truncated original / invalid rewrite / unknown column …) so we can
    // see why a "before→after" half is missing.
    logger.info(
      {
        module: "ChouseDoctor",
        err: e instanceof Error ? e.message.slice(0, 240) : String(e),
        sql: sql.slice(0, 140),
      },
      "EXPLAIN ESTIMATE failed",
    );
    return null;
  }
}

/** Build a compact, sanitized per-node overview from the live fleet metrics. */
async function buildOverview(
  connections: { id: string; name: string }[],
  hours: number,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    connections.map(async (c) => {
      try {
        const [summary, topMem, longest, errors, heavy] = await Promise.all([
          runFleetMetric(c.id, "summary").then((r) => r.data?.[0] ?? null).catch(() => null),
          runFleetMetric(c.id, "top_memory_query")
            .then((r) => (r.data ?? []).slice(0, 3).map(sanitizeQueryRow))
            .catch(() => []),
          runFleetMetric(c.id, "longest_query")
            .then((r) => (r.data?.[0] ? sanitizeQueryRow(r.data[0]) : null))
            .catch(() => null),
          runFleetMetric(c.id, "last_exception").then((r) => (r.data ?? []).slice(0, 3)).catch(() => []),
          recentHeavyQueries(c.id, hours),
        ]);
        return {
          id: c.id,
          name: c.name,
          summary,
          topMemoryQueries: topMem,
          longestQuery: longest,
          recentErrors: errors,
          recentHeavyQueries: heavy,
        };
      } catch (e) {
        return { id: c.id, name: c.name, error: e instanceof Error ? e.message.slice(0, 160) : "unreachable" };
      }
    }),
  );
}

/**
 * Run a full fleet health scan. Throws AppError.badRequest if AI isn't
 * configured or there are no active connections.
 */
export async function runFleetScan(opts?: {
  modelId?: string;
  connectionIds?: string[];
  hours?: number;
}): Promise<DoctorReport> {
  const startedAt = Date.now();
  const hours = clampHours(opts?.hours);
  const config = await getConfiguration(opts?.modelId);
  const validation = validateConfiguration(config);
  if (!validation.valid) {
    throw AppError.badRequest(validation.error || "AI is not configured for Chouse AI");
  }

  const { connections } = await listConnections({ activeOnly: true });
  if (connections.length === 0) {
    throw AppError.badRequest("No active connections to scan");
  }
  let nodes = connections.map((c) => ({ id: c.id, name: c.name }));
  // Optional node subset — scope the scan to the picked nodes.
  if (opts?.connectionIds && opts.connectionIds.length > 0) {
    const want = new Set(opts.connectionIds);
    nodes = nodes.filter((n) => want.has(n.id));
    if (nodes.length === 0) {
      throw AppError.badRequest("None of the selected nodes are active");
    }
  }

  const model = initializeAIModel(config!);
  const overview = await buildOverview(nodes, hours);

  // The optimization playbook is heavy — only attach it when the scan actually
  // surfaced a heavy query to optimize, so a healthy-fleet scan stays light.
  const instructions = needsPlaybook(overview)
    ? `${SYSTEM_PROMPT}\n\n${CLICKHOUSE_PLAYBOOK}`
    : SYSTEM_PROMPT;

  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools: { query_node: queryNodeTool(nodes) },
    stopWhen: stepCountIs(12),
    temperature: 0.1,
    // Reports can be large (a full optimizedQuery rewrite) — give the model room
    // so the JSON isn't truncated mid-string → "response did not match schema".
    maxOutputTokens: 16000,
  });

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `Current ClickHouse fleet overview (one object per node). Investigation window: last ${hours} hours (the \`recentHeavyQueries\` field covers this window; scope your system.query_log tool queries to it too). Investigate and produce the structured health report.\n\n\`\`\`json\n${JSON.stringify(overview, null, 2)}\n\`\`\``,
    },
  ];

  const streamResult = await agent.stream({ messages });
  const raw = await streamResult.text;

  let analysis: DoctorAnalysis | null = null;
  try {
    analysis = extractJson(raw, DoctorReportSchema);
  } catch {
    analysis = null;
  }
  // If the agent didn't emit parseable JSON (often: it spent its step budget on
  // tool calls before writing the report), force a structured report from the
  // overview + whatever it gathered, so the UI is never empty.
  if (!analysis) {
    try {
      const { object } = await generateObject({
        model,
        schema: DoctorReportSchema,
        maxOutputTokens: 16000,
        messages: [
          { role: "system", content: instructions },
          {
            role: "user",
            content: `Fleet overview:\n\`\`\`json\n${JSON.stringify(overview)}\n\`\`\`\n\nInvestigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the structured health report now.`,
          },
        ],
      });
      analysis = object;
    } catch (e) {
      logger.warn(
        { module: "ChouseDoctor", err: e instanceof Error ? e.message : String(e) },
        "Structured fallback failed",
      );
    }
  }

  // "Before → after" proof: real EXPLAIN ESTIMATE (rows/parts/marks to read) for
  // each heavy query's original vs its rewrite. Backend-computed (never trust AI
  // figures); parallel + best-effort; EXPLAIN plans only, so it's safe + cheap.
  if (analysis?.heavyQueries?.length) {
    const idByName = new Map(nodes.map((n) => [n.name, n.id]));
    await Promise.all(
      analysis.heavyQueries.map(async (hq) => {
        const connId = idByName.get(hq.node);
        if (!connId) {
          delete hq.estimate;
          return;
        }
        const [before, after] = await Promise.all([
          explainEstimate(connId, hq.query),
          hq.optimizedQuery ? explainEstimate(connId, hq.optimizedQuery) : Promise.resolve(null),
        ]);
        if (before || after) {
          hq.estimate = { before: before ?? undefined, after: after ?? undefined };
        } else {
          delete hq.estimate;
        }
      }),
    );
  }

  // Best-effort audit trail of the read-only queries the agent ran.
  let steps: { tool: string; input: unknown }[] = [];
  try {
    const stepArr = (await streamResult.steps) as { toolCalls?: { toolName: string; input?: unknown; args?: unknown }[] }[];
    steps = stepArr.flatMap((s) =>
      (s.toolCalls ?? []).map((tc) => ({ tool: tc.toolName, input: tc.input ?? tc.args })),
    );
  } catch {
    steps = [];
  }

  const vitals = overview.map(vitalsFromOverview);

  logger.info(
    { module: "ChouseDoctor", nodes: nodes.length, steps: steps.length, structured: analysis != null },
    "Fleet scan complete",
  );

  return {
    id: randomUUID(),
    analysis,
    raw,
    steps,
    vitals,
    model: config!.model?.modelId ?? config!.model?.name ?? "configured model",
    scannedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    nodes: nodes.length,
    hours,
  };
}
