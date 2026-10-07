/**
 * `lineage` collector (ADR 0016 §3): the observed half of the lineage graph.
 *
 * From `system.query_log` (aggregated in ClickHouse, incremental by watermark):
 * - writers → tables (INSERTs, attributed to a scheduled job, an agent, a
 *   person or an external client by `log_comment` / `client_name` / UA);
 * - `INSERT … SELECT` and table-function sources → target tables;
 * - tables → readers (jobs, agents, people, external clients).
 * Plus a static pass over saved queries, which query_log cannot attribute.
 */

import { sql, type SQL } from "drizzle-orm";

import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, runBatch, str } from "../db";
import { NOT_OBSERVE, selectRows } from "../clickhouse";
import { externalNodeId, parseSelectSources, tableNodeId } from "../catalogParse";
import { pruneLineage } from "../orphans";
import { upsertEdge, type LineageEdge } from "./catalog";

const FIRST_WINDOW_MS = 24 * 3600 * 1000;
const MAX_GROUPS = 50_000;

interface QueryGroupRow {
  qkind: string;
  target: string;
  tbls: string[];
  cols: string[];
  tfuncs: string[];
  src: string;
  job_id: string;
  pat_id: string;
  rbac_user_id: string;
  user: string;
  client: string;
  runs: number;
  last_ms: number;
}

export interface QueryGroup {
  query_kind: string;
  target: string;
  tables: string[];
  columns: string[];
  table_functions: string[];
  src: string;
  job_id: string;
  pat_id: string;
  rbac_user_id: string;
  user: string;
  client: string;
  runs: number;
  last_ms: number;
}

export type PrincipalKind = "job" | "agent" | "person" | "client";

export interface Principal {
  kind: PrincipalKind;
  id: string;
  nodeId: string;
  label: string;
}

/** Who issued a query, from its log_comment and client identity. */
export function principalOf(g: Pick<QueryGroup, "src" | "job_id" | "pat_id" | "rbac_user_id" | "user" | "client">): Principal {
  if (g.src === "scheduled_query" && g.job_id) return { kind: "job", id: g.job_id, nodeId: `job:${g.job_id}`, label: `job ${g.job_id}` };
  if ((g.src === "mcp" || g.src === "pat") && g.pat_id) return { kind: "agent", id: g.pat_id, nodeId: `agent:${g.pat_id}`, label: `agent ${g.pat_id}` };
  if (g.rbac_user_id) return { kind: "person", id: g.rbac_user_id, nodeId: `person:${g.rbac_user_id}`, label: `user ${g.rbac_user_id}` };
  const client = g.client || "unknown client";
  const id = `${g.user}|${client}`;
  return { kind: "client", id, nodeId: `client:${id}`, label: `${client} (${g.user})` };
}

function splitQualified(fqtn: string): { database: string; table: string } | null {
  const clean = fqtn.replace(/[`"]/g, "");
  const dot = clean.indexOf(".");
  if (dot <= 0) return null;
  return { database: clean.slice(0, dot), table: clean.slice(dot + 1) };
}

export interface ObservedGraph {
  nodes: Map<string, { id: string; kind: string; label: string; database: string | null; table: string | null }>;
  edges: Map<string, LineageEdge & { observations: number }>;
}

/** Pure: turn aggregated query_log groups into nodes and edges. */
export function buildObservedGraph(groups: QueryGroup[], defaultDatabase: string): ObservedGraph {
  const nodes: ObservedGraph["nodes"] = new Map();
  const edges: ObservedGraph["edges"] = new Map();
  const tableNode = (fqtn: string): string | null => {
    const q = splitQualified(fqtn.includes(".") ? fqtn : `${defaultDatabase}.${fqtn}`);
    // `numbers()` and other table functions appear in query_log.tables as
    // `_table_function.<name>`; they are not tables (their reads are external_read).
    if (!q || q.database === "system" || q.database === "_table_function") return null;
    const id = tableNodeId(q.database, q.table);
    if (!nodes.has(id)) nodes.set(id, { id, kind: "table", label: `${q.database}.${q.table}`, database: q.database, table: q.table });
    return id;
  };
  const addEdge = (edge: LineageEdge, runs: number): void => {
    const key = `${edge.kind}:${edge.source}->${edge.target}`;
    const existing = edges.get(key);
    if (existing) {
      existing.observations += runs;
      existing.columns = [...new Set([...(existing.columns ?? []), ...(edge.columns ?? [])])].sort();
    } else {
      edges.set(key, { ...edge, observations: runs });
    }
  };
  const columnsOf = (columns: string[], fqtn: string): string[] => {
    const prefix = `${fqtn}.`;
    return [...new Set(columns.filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length)))].sort();
  };

  for (const g of groups) {
    const principal = principalOf(g);
    if (!nodes.has(principal.nodeId)) nodes.set(principal.nodeId, { id: principal.nodeId, kind: principal.kind, label: principal.label, database: null, table: null });
    if (g.query_kind === "Insert") {
      const target = g.target ? tableNode(g.target) : null;
      if (!target) continue;
      addEdge({ source: principal.nodeId, target, kind: "write", granularity: "table" }, g.runs);
      // A scheduled job's INSERT … SELECT sources are also what the job read.
      if (principal.kind === "job") {
        for (const t of g.tables) {
          const id = tableNode(t);
          if (!id || id === target) continue;
          addEdge({ source: id, target: principal.nodeId, kind: "reader_job", columns: columnsOf(g.columns, t), granularity: "column" }, g.runs);
        }
      }
      for (const t of g.tables) {
        const id = tableNode(t);
        if (!id || id === target) continue;
        addEdge({ source: id, target, kind: "insert_select", columns: columnsOf(g.columns, t), granularity: "column" }, g.runs);
      }
      for (const fn of g.table_functions) {
        const ext = externalNodeId(fn.toLowerCase(), "query");
        if (!nodes.has(ext)) nodes.set(ext, { id: ext, kind: "external", label: `${fn}()`, database: null, table: null });
        addEdge({ source: ext, target, kind: "external_read", granularity: "table" }, g.runs);
      }
      continue;
    }
    for (const t of g.tables) {
      const id = tableNode(t);
      if (!id) continue;
      addEdge({ source: id, target: principal.nodeId, kind: `reader_${principal.kind}`, columns: columnsOf(g.columns, t), granularity: "column" }, g.runs);
    }
  }
  return { nodes, edges };
}

/** Static edges table → saved query, for saved queries bound to this connection (or shared). */
async function savedQueryEdges(connectionId: string, defaultDatabase: string): Promise<{ nodes: ObservedGraph["nodes"]; edges: LineageEdge[] }> {
  const rows = await all(sql`SELECT id, name, query FROM rbac_saved_queries WHERE connection_id = ${connectionId} OR connection_id IS NULL`);
  const nodes: ObservedGraph["nodes"] = new Map();
  const edges: LineageEdge[] = [];
  for (const row of rows) {
    const id = `sq:${str(row.id)}`;
    nodes.set(id, { id, kind: "saved_query", label: str(row.name), database: null, table: null });
    const sources = parseSelectSources(`AS ${str(row.query)}`, defaultDatabase);
    for (const s of sources.tables) {
      if (s.database === "system") continue;
      edges.push({ source: tableNodeId(s.database, s.table), target: id, kind: "reader_saved_query", granularity: "table" });
    }
  }
  return { nodes, edges };
}

export const lineageCollector: ConnectionCollector = {
  name: "lineage",
  scope: "connection",
  intervalMs: 5 * 60 * 1000,
  requires: ["query_log"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const watermark = await ctx.getWatermark();
    const from = Math.max(watermark, ctx.nowMs - FIRST_WINDOW_MS);
    const [db] = await selectRows<{ db: string }>(ctx.client, "SELECT currentDatabase() AS db");
    const defaultDatabase = db?.db ?? "default";
    const rows = await selectRows<QueryGroupRow>(ctx.client, `
      SELECT
        toString(query_kind) AS qkind,
        if(query_kind = 'Insert', replaceRegexpAll(extract(query, '(?i)INSERT\\\\s+INTO\\\\s+(?:TABLE\\\\s+)?([\\\\w.\`"]+)'), '[\`"]', ''), '') AS target,
        arraySort(arrayDistinct(arrayFilter(t -> NOT startsWith(t, 'system.') AND NOT startsWith(t, '_table_function.'), tables))) AS tbls,
        arrayDistinct(arrayFlatten(groupArray(columns))) AS cols,
        arraySort(arrayDistinct(used_table_functions)) AS tfuncs,
        JSONExtractString(log_comment, 'source') AS src,
        JSONExtractString(log_comment, 'job_id') AS job_id,
        JSONExtractString(log_comment, 'pat_id') AS pat_id,
        JSONExtractString(log_comment, 'rbac_user_id') AS rbac_user_id,
        user,
        if(client_name != '', client_name, splitByChar(' ', http_user_agent)[1]) AS client,
        count() AS runs,
        toUnixTimestamp64Milli(max(event_time_microseconds)) AS last_ms
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND event_time > fromUnixTimestamp64Milli({from:Int64})
        AND query_kind IN ('Insert', 'Select')
        AND ${NOT_OBSERVE}
      GROUP BY qkind, target, tbls, tfuncs, src, job_id, pat_id, rbac_user_id, user, client
      LIMIT ${MAX_GROUPS}`, { params: { from }, maxExecutionTime: 60 });

    const groups: QueryGroup[] = rows.map((r) => ({ ...r, query_kind: r.qkind, tables: r.tbls ?? [], columns: r.cols ?? [], table_functions: r.tfuncs ?? [] }));
    const observed = buildObservedGraph(groups, defaultDatabase);
    const saved = await savedQueryEdges(connectionId, defaultDatabase);
    const now = ctx.nowMs;
    const statements: SQL[] = [];
    const nodeSql = (n: { id: string; kind: string; label: string; database: string | null; table: string | null }): SQL => sql`
      INSERT INTO obs_lineage_nodes (connection_id, node_id, kind, label, database_name, table_name, attrs, last_seen_at)
      VALUES (${connectionId}, ${n.id}, ${n.kind}, ${n.label}, ${n.database}, ${n.table}, '{}', ${now})
      ON CONFLICT (connection_id, node_id) DO UPDATE SET last_seen_at = ${now}
    `;
    for (const n of observed.nodes.values()) statements.push(nodeSql(n));
    for (const n of saved.nodes.values()) {
      statements.push(sql`
        INSERT INTO obs_lineage_nodes (connection_id, node_id, kind, label, database_name, table_name, attrs, last_seen_at)
        VALUES (${connectionId}, ${n.id}, ${n.kind}, ${n.label}, NULL, NULL, '{}', ${now})
        ON CONFLICT (connection_id, node_id) DO UPDATE SET label = ${n.label}, last_seen_at = ${now}
      `);
    }
    for (const e of observed.edges.values()) statements.push(upsertEdge(connectionId, e, "observed", now, e.observations));
    statements.push(sql`DELETE FROM obs_lineage_edges WHERE connection_id = ${connectionId} AND kind = 'reader_saved_query'`);
    for (const e of saved.edges) statements.push(upsertEdge(connectionId, e, "structural", now));
    // Observed edges age out after the retention window.
    const retentionMs = Number(process.env.OBSERVE_RETENTION_DAYS ?? 90) * 24 * 3600 * 1000;
    statements.push(sql`DELETE FROM obs_lineage_edges WHERE connection_id = ${connectionId} AND origin = 'observed' AND last_seen_at < ${now - retentionMs}`);
    // Deleted scheduled jobs and saved queries leave the graph with them.
    const jobs = new Set((await all(sql`SELECT id FROM scheduled_queries`)).map((r) => `job:${str(r.id)}`));
    statements.push(...await pruneLineage(connectionId, "job:", (id) => jobs.has(id)));
    statements.push(...await pruneLineage(connectionId, "sq:", (id) => saved.nodes.has(id)));
    await runBatch(statements);
    const newest = groups.reduce((max, g) => Math.max(max, Number(g.last_ms) || 0), from);
    await ctx.setWatermark(newest);
  },
};
