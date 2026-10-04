/**
 * Scheduled-query lineage (ADR 0016 §3, §18): the job view of the warehouse
 * lineage graph.
 *
 * `GET /api/scheduled-queries/:id/lineage` keeps its route, permission and
 * response shape, but the observations now come from the lineage collector's
 * stored edges (`reader_job` / `write` edges of `job:<id>` nodes) instead of a
 * per-request `system.query_log` scan. Column detail for produced tables comes
 * from the catalog collector.
 *
 * Read vs write: the write target is the job's own materialize config
 * (`destDatabase.destTable`); everything else the job read is a source. Jobs
 * chain when one job's destination table is another job's source table.
 */

import type { ScheduledQueryRow, SqOutputMode } from "../scheduledQueries/types";
import { all, json, num, sql, str } from "./db";

// --- response shapes (camelCase; mirrored in src/api/scheduledQueries.ts) ----

export interface LineageTableNode {
  id: string; // `table:<db.table>`
  kind: "table";
  label: string; // `db.table`
  database: string;
  table: string;
  /** Distinct columns observed across all runs that touched this table. */
  columns: string[];
  /** True when this table is produced by a job in the graph (has an inbound write). */
  produced: boolean;
}

export interface LineageJobNode {
  id: string; // `job:<jobId>`
  kind: "job";
  label: string; // job name
  jobId: string;
  outputMode: SqOutputMode;
  /** Whether this job is the focus of the request (for highlighting). */
  focus: boolean;
  /** Distinct ClickHouse runs observed in the window. */
  runCount: number;
  /** Last observed run (ms epoch), or null if never observed. */
  lastSeen: number | null;
}

export type LineageNode = LineageTableNode | LineageJobNode;

export interface LineageEdge {
  id: string;
  from: string; // node id
  to: string; // node id
  kind: "read" | "write";
  /** Columns observed flowing across this edge (source columns / written columns). */
  columns: string[];
}

export interface LineageGraph {
  focusJobId: string;
  connectionId: string;
  windowDays: number;
  observedAt: number;
  nodes: LineageNode[];
  edges: LineageEdge[];
  /** Set when the focus job has no runtime observations in the window. */
  note?: string;
}

// --- query_log observation --------------------------------------------------

export interface JobObservation {
  jobId: string;
  tables: string[];
  columns: string[];
  runCount: number;
  lastSeen: number | null;
}

const WINDOW_MIN_DAYS = 1;
const WINDOW_MAX_DAYS = 90;

export function clampWindowDays(days: number): number {
  if (!Number.isFinite(days)) return 14;
  return Math.min(WINDOW_MAX_DAYS, Math.max(WINDOW_MIN_DAYS, Math.trunc(days)));
}

/** Per-job observations from the stored lineage edges within the window. */
async function observeJobs(connectionId: string, windowDays: number): Promise<Map<string, JobObservation>> {
  const since = Date.now() - windowDays * 86_400_000;
  const rows = await all(sql`
    SELECT source_id, target_id, kind, columns, observations, last_seen_at FROM obs_lineage_edges
    WHERE connection_id = ${connectionId} AND last_seen_at >= ${since}
      AND ((kind = 'reader_job' AND target_id LIKE 'job:%') OR (kind = 'write' AND source_id LIKE 'job:%'))`);
  const byJob = new Map<string, JobObservation>();
  for (const row of rows) {
    const isRead = str(row.kind) === "reader_job";
    const jobId = (isRead ? str(row.target_id) : str(row.source_id)).slice("job:".length);
    const table = (isRead ? str(row.source_id) : str(row.target_id)).replace(/^table:/, "");
    const obs = byJob.get(jobId) ?? { jobId, tables: [], columns: [], runCount: 0, lastSeen: null };
    if (!obs.tables.includes(table)) obs.tables.push(table);
    for (const col of json<string[]>(row.columns, [])) obs.columns.push(`${table}.${col}`);
    obs.runCount = Math.max(obs.runCount, num(row.observations));
    obs.lastSeen = Math.max(obs.lastSeen ?? 0, num(row.last_seen_at));
    byJob.set(jobId, obs);
  }
  return byJob;
}

// --- graph assembly ---------------------------------------------------------

function destOf(job: ScheduledQueryRow): string | null {
  if (job.outputMode === "none") return null;
  if (!job.destDatabase || !job.destTable) return null;
  return `${job.destDatabase}.${job.destTable}`;
}

/** Columns observed for a specific `db.table`, with the `db.table.` prefix stripped. */
function columnsForTable(observed: string[], fqtn: string): string[] {
  const prefix = `${fqtn}.`;
  const cols = new Set<string>();
  for (const col of observed) {
    if (col.startsWith(prefix)) cols.add(col.slice(prefix.length));
  }
  return [...cols].sort();
}

/**
 * Build the full job/table graph for one connection from the observations, then
 * return only the connected component containing the focus job. Restricted to
 * `visibleJobs` so a caller without view_all never sees jobs they can't access.
 */
export function assembleGraph(
  focusJob: ScheduledQueryRow,
  visibleJobs: ScheduledQueryRow[],
  observations: Map<string, JobObservation>,
): { nodes: LineageNode[]; edges: LineageEdge[] } {
  const tableNodes = new Map<string, LineageTableNode>();
  const jobNodes = new Map<string, LineageJobNode>();
  const edges = new Map<string, LineageEdge>();

  const tableNode = (fqtn: string): LineageTableNode => {
    const id = `table:${fqtn}`;
    let node = tableNodes.get(id);
    if (!node) {
      const dot = fqtn.indexOf(".");
      node = {
        id,
        kind: "table",
        label: fqtn,
        database: dot >= 0 ? fqtn.slice(0, dot) : "",
        table: dot >= 0 ? fqtn.slice(dot + 1) : fqtn,
        columns: [],
        produced: false,
      };
      tableNodes.set(id, node);
    }
    return node;
  };

  const mergeColumns = (node: LineageTableNode, cols: string[]): void => {
    if (cols.length === 0) return;
    node.columns = [...new Set([...node.columns, ...cols])].sort();
  };

  for (const job of visibleJobs) {
    const obs = observations.get(job.id);
    if (!obs) continue; // observed-runtime: skip jobs that never ran in the window

    const jobNodeId = `job:${job.id}`;
    jobNodes.set(jobNodeId, {
      id: jobNodeId,
      kind: "job",
      label: job.name,
      jobId: job.id,
      outputMode: job.outputMode,
      focus: job.id === focusJob.id,
      runCount: obs.runCount,
      lastSeen: obs.lastSeen,
    });

    const dest = destOf(job);

    // Reads: everything the run touched except its own write target.
    for (const fqtn of obs.tables) {
      if (fqtn === dest || fqtn.startsWith("system.")) continue;
      const node = tableNode(fqtn);
      const cols = columnsForTable(obs.columns, fqtn);
      mergeColumns(node, cols);
      const edgeId = `read:${fqtn}->${job.id}`;
      edges.set(edgeId, { id: edgeId, from: node.id, to: jobNodeId, kind: "read", columns: cols });
    }

    // Write: the job's configured materialize destination.
    if (dest) {
      const node = tableNode(dest);
      node.produced = true;
      const destCols = job.outputConfig?.expectedSchema?.map((column) => column.name) ?? columnsForTable(obs.columns, dest);
      mergeColumns(node, destCols);
      const edgeId = `write:${job.id}->${dest}`;
      edges.set(edgeId, { id: edgeId, from: jobNodeId, to: node.id, kind: "write", columns: [...destCols].sort() });
    }
  }

  // Keep only the connected component containing the focus job (undirected BFS).
  const focusNodeId = `job:${focusJob.id}`;
  if (!jobNodes.has(focusNodeId)) return { nodes: [], edges: [] };

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const edge of edges.values()) link(edge.from, edge.to);

  const reachable = new Set<string>([focusNodeId]);
  const queue = [focusNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const nodes: LineageNode[] = [
    ...[...jobNodes.values()].filter((node) => reachable.has(node.id)),
    ...[...tableNodes.values()].filter((node) => reachable.has(node.id)),
  ];
  const keptEdges = [...edges.values()].filter((edge) => reachable.has(edge.from) && reachable.has(edge.to));
  return { nodes, edges: keptEdges };
}

/**
 * Fill in the columns for tables a job *writes*: query_log records the columns a
 * query reads, so destinations get their schema from the catalog collector.
 */
async function enrichProducedColumns(connectionId: string, nodes: LineageNode[], edges: LineageEdge[]): Promise<void> {
  for (const node of nodes) {
    if (node.kind !== "table" || !node.produced || node.columns.length > 0) continue;
    const cols = (await all(sql`
      SELECT column_name FROM obs_catalog_columns WHERE connection_id = ${connectionId} AND database_name = ${node.database} AND table_name = ${node.table} ORDER BY column_name`)).map((r) => str(r.column_name));
    if (cols.length === 0) continue;
    node.columns = cols;
    for (const edge of edges) {
      if (edge.kind === "write" && edge.to === node.id && edge.columns.length === 0) edge.columns = cols;
    }
  }
}

/**
 * Build the lineage graph for `focusJob`. `visibleJobs` is the set of jobs the
 * caller may see; only those on the focus job's connection are considered.
 */
export async function buildLineage(focusJob: ScheduledQueryRow, visibleJobs: ScheduledQueryRow[], windowDays: number): Promise<LineageGraph> {
  const observedAt = Date.now();
  const sameConnJobs = visibleJobs.filter((job) => job.connectionId === focusJob.connectionId);
  const observations = await observeJobs(focusJob.connectionId, windowDays);
  const { nodes, edges } = assembleGraph(focusJob, sameConnJobs, observations);
  await enrichProducedColumns(focusJob.connectionId, nodes, edges);
  const note = observations.has(focusJob.id)
    ? undefined
    : `No runtime observations in the last ${windowDays} day(s). Run this job (or wait for its schedule and the next lineage collection) to populate lineage.`;
  return { focusJobId: focusJob.id, connectionId: focusJob.connectionId, windowDays, observedAt, nodes, edges, note };
}
