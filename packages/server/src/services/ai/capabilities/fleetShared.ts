/**
 * Shared helpers for the fleet/connection-based capabilities
 * (diagnose-error, diagnose-parts, diagnose-schema, optimize-log, fleet-scan).
 *
 * These investigate a node's `system.*` tables read-only via the `query_node`
 * tool and prove rewrites with EXPLAIN ESTIMATE — distinct from the
 * session/service-based core tools used by the SQL-editor capabilities.
 *
 * Moved here (the canonical home) from chouseDoctor.ts.
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import { AppError } from "../../../types";
import { logger } from "../../../utils/logger";
import { buildFleetConfig } from "../../fleetMetrics";
import { ClientManager } from "../../clientManager";
import { listConnections } from "../../../rbac/services/connections";
import { readReferenceSync } from "../../agentReferences";

export interface FleetNode {
  id: string;
  name: string;
}

/**
 * Single source of truth for the system.* schema, shared by every fleet prompt
 * so the agent never guesses a column name (e.g. system.errors has
 * last_error_time, NOT event_time).
 *
 * Canonical text lives in `packages/server/src/references/system-table-reference.md`
 * (also loadable on demand by the chat agent via the `load_reference` tool).
 */
export const SYSTEM_TABLE_REFERENCE = readReferenceSync("system-table-reference.md");

/** Resolve one active connection into a node {id,name}. Throws if not found. */
export async function resolveNode(connectionId: string): Promise<FleetNode> {
  const { connections } = await listConnections({ activeOnly: true });
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) throw AppError.badRequest("Connection not found or inactive");
  return { id: conn.id, name: conn.name };
}

/** Resolve the active node set, optionally scoped to a subset of ids. */
export async function resolveNodes(connectionIds?: string[]): Promise<FleetNode[]> {
  const { connections } = await listConnections({ activeOnly: true });
  if (connections.length === 0) throw AppError.badRequest("No active connections to scan");
  let nodes = connections.map((c) => ({ id: c.id, name: c.name }));
  if (connectionIds && connectionIds.length > 0) {
    const want = new Set(connectionIds);
    nodes = nodes.filter((n) => want.has(n.id));
    if (nodes.length === 0) throw AppError.badRequest("None of the selected nodes are active");
  }
  return nodes;
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

/** The read-only `query_node` investigation tool, bound to a node set. */
export function queryNodeTool(connections: FleetNode[]) {
  const nameById = new Map(connections.map((c) => [c.id, c.name]));
  return {
    query_node: tool({
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
    }),
  };
}

/** Clamp a requested window to a sane integer hour range (1h … 31 days). */
export function clampHours(hours: number | undefined): number {
  return Math.max(1, Math.min(744, Math.round(hours ?? 6)));
}

/** Strip SQL comments + trailing semicolon so the AI and EXPLAIN see clean SQL. */
export function cleanQueryForOptimize(q: string): string {
  return q
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/;\s*$/, "")
    .trim();
}

/** Fetch the full query text (+ peak memory, user) for a query_id from system.query_log. */
export async function fetchQueryById(
  connectionId: string,
  queryId: string,
): Promise<{ query: string; peakMemory?: string; user?: string } | null> {
  try {
    const config = await buildFleetConfig(connectionId);
    const client = ClientManager.getInstance().getClient(config);
    const result = await client.query({
      query: `SELECT query, user, round(memory_usage / 1e9, 2) AS peak_gb
              FROM system.query_log
              WHERE query_id = {qid:String}
                AND query != ''
              ORDER BY length(query) DESC, memory_usage DESC
              LIMIT 1`,
      query_params: { qid: queryId },
      format: "JSON",
      clickhouse_settings: { readonly: "1", max_execution_time: 15 },
    });
    const json = (await result.json()) as {
      data?: { query?: string; user?: string; peak_gb?: number }[];
    };
    const row = json.data?.[0];
    if (!row?.query) return null;
    return {
      query: String(row.query),
      user: row.user ? String(row.user) : undefined,
      peakMemory: row.peak_gb != null ? `${row.peak_gb} GB` : undefined,
    };
  } catch {
    return null;
  }
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

/** Heaviest query shapes by memory over the window (sanitized SQL + Redash attribution). */
export async function recentHeavyQueries(
  connectionId: string,
  hours: number,
): Promise<Record<string, unknown>[]> {
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
      if (!out.redash_user) delete out.redash_user;
      if (!out.redash_query_id) delete out.redash_query_id;
      return out;
    });
  } catch {
    return [];
  }
}

export interface EstimateFigures {
  rows: number;
  parts: number;
  marks: number;
}

/**
 * Run EXPLAIN ESTIMATE for a query (read-only — it PLANS, never executes) and
 * sum rows/parts/marks across the tables it would read. Returns null on any
 * failure (truncated/invalid SQL, rewrite with placeholders, unknown table, …).
 */
export async function explainEstimate(
  connectionId: string,
  rawSql: string,
): Promise<EstimateFigures | null> {
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
    logger.info(
      {
        module: "AI:fleetShared",
        err: e instanceof Error ? e.message.slice(0, 240) : String(e),
        sql: sql.slice(0, 140),
      },
      "EXPLAIN ESTIMATE failed",
    );
    return null;
  }
}

/** Standard diagnosis output shape shared by error/parts/schema capabilities. */
export const ErrorDiagnosisSchema = z.object({
  summary: z.string(),
  cause: z.string(),
  impact: z.string(),
  solutions: z.array(z.string()),
});

export type ParsedDiagnosis = z.infer<typeof ErrorDiagnosisSchema>;

export interface ErrorDiagnosis {
  code?: number;
  name: string;
  summary: string;
  cause: string;
  impact: string;
  solutions: string[];
}
