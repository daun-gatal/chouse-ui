/**
 * Scheduled Queries → Lineage (observed runtime).
 *
 * Every scheduled run executes against ClickHouse with a client-level
 * `log_comment` of `{source:"scheduled_query", job_id, rbac_user_id}` (see
 * runner.ts / clientManager.ts), so `system.query_log` already records the
 * *actual* tables and columns each job touched. We read that back, attribute it
 * to jobs by `job_id`, and build a table/job dependency graph — no extra
 * instrumentation, and it reflects what really ran (not static SQL parsing).
 *
 * Read vs write: the write target is taken from the job's own materialize config
 * (`destDatabase.destTable`) — authoritative — and everything else the run read
 * from `system.query_log.tables` is treated as a source. Jobs chain when one
 * job's destination table is another job's source table.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { logger } from "../../utils/logger";
import { clientForConnection } from "./chClient";
import { describeDestination } from "./materialize";
import type { ScheduledQueryRow, SqOutputMode } from "./types";

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

/**
 * One read of `system.query_log` for the connection: per scheduled-query job,
 * the distinct tables and columns observed in the window, plus run count and the
 * last-seen time. `tables`/`columns` come pre-qualified as `db.table` /
 * `db.table.column` by ClickHouse.
 */
async function observeJobs(client: ClickHouseClient, windowDays: number): Promise<Map<string, JobObservation>> {
  const result = await client.query({
    query: `
      SELECT
        JSONExtractString(log_comment, 'job_id') AS job_id,
        arrayDistinct(arrayFlatten(groupArray(tables))) AS tables,
        arrayDistinct(arrayFlatten(groupArray(columns))) AS columns,
        countDistinct(query_id) AS run_count,
        toUnixTimestamp(max(event_time)) * 1000 AS last_seen_ms
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND event_time >= now() - toIntervalDay({days:UInt32})
        AND JSONExtractString(log_comment, 'source') = 'scheduled_query'
        AND JSONExtractString(log_comment, 'job_id') != ''
      GROUP BY job_id`,
    query_params: { days: windowDays },
    format: "JSON",
    clickhouse_settings: { readonly: "1", max_execution_time: 20, max_result_rows: "5000" },
  });

  const json = (await result.json()) as {
    data?: Array<{
      job_id?: string;
      tables?: string[];
      columns?: string[];
      run_count?: number | string;
      last_seen_ms?: number | string;
    }>;
  };

  const byJob = new Map<string, JobObservation>();
  for (const row of json.data ?? []) {
    const jobId = String(row.job_id ?? "");
    if (!jobId) continue;
    byJob.set(jobId, {
      jobId,
      tables: (row.tables ?? []).map(String).filter((t) => t && !t.startsWith("system.")),
      columns: (row.columns ?? []).map(String).filter((col) => col && !col.startsWith("system.")),
      runCount: Number(row.run_count ?? 0),
      lastSeen: row.last_seen_ms != null ? Number(row.last_seen_ms) : null,
    });
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
 * Fill in the columns for tables a job *writes*. `system.query_log.columns`
 * records the columns a query *reads*, so an `INSERT … SELECT` never reports the
 * destination's written columns — we read the destination's real schema from
 * `system.columns` instead, and mirror it onto the write edges. Best-effort:
 * a table that no longer exists (or can't be introspected) is left as-is.
 */
async function enrichProducedColumns(client: ClickHouseClient, nodes: LineageNode[], edges: LineageEdge[]): Promise<void> {
  const produced = nodes.filter(
    (node): node is LineageTableNode => node.kind === "table" && node.produced && node.columns.length === 0,
  );
  await Promise.all(
    produced.map(async (node) => {
      try {
        const dest = await describeDestination(client, node.database, node.table);
        if (!dest.exists || dest.columns.length === 0) return;
        const cols = dest.columns.map((c) => c.name).sort();
        node.columns = cols;
        for (const edge of edges) {
          if (edge.kind === "write" && edge.to === node.id && edge.columns.length === 0) edge.columns = cols;
        }
      } catch {
        /* best-effort: leave the node without column detail */
      }
    }),
  );
}

/**
 * The RBAC tag for the queries a lineage read issues (the `query_log` scan and
 * the destination-schema reads) — attributes them to the viewing user in
 * ClickHouse `query_log`, not the bare ClickHouse user, mirroring how runs are
 * tagged. The `source` is deliberately NOT `scheduled_query`, so these reads are
 * never mistaken for job runs by a later lineage observation query.
 */
function lineageLogComment(actorUserId: string | null, focusJobId: string): string {
  return JSON.stringify({ rbac_user_id: actorUserId, source: "scheduled_query_lineage", job_id: focusJobId });
}

/**
 * Build the observed-runtime lineage graph for `focusJob`. `visibleJobs` is the
 * set of jobs the caller may see; only those on the focus job's connection are
 * considered, since lineage is meaningful only within a connection. `actorUserId`
 * is the viewing RBAC user, used to attribute the ClickHouse reads in query_log.
 */
export async function buildLineage(
  focusJob: ScheduledQueryRow,
  visibleJobs: ScheduledQueryRow[],
  windowDays: number,
  actorUserId: string | null,
): Promise<LineageGraph> {
  const observedAt = Date.now();
  const sameConnJobs = visibleJobs.filter((job) => job.connectionId === focusJob.connectionId);

  let client: ClickHouseClient;
  let observations: Map<string, JobObservation>;
  try {
    client = await clientForConnection(focusJob.connectionId, lineageLogComment(actorUserId, focusJob.id));
    observations = await observeJobs(client, windowDays);
  } catch (err) {
    logger.warn(
      { module: "ScheduledQueries", jobId: focusJob.id, err: err instanceof Error ? err.message : String(err) },
      "Lineage query_log read failed",
    );
    return {
      focusJobId: focusJob.id,
      connectionId: focusJob.connectionId,
      windowDays,
      observedAt,
      nodes: [],
      edges: [],
      note: "Could not read system.query_log for this connection.",
    };
  }

  const { nodes, edges } = assembleGraph(focusJob, sameConnJobs, observations);
  await enrichProducedColumns(client, nodes, edges);

  const note = observations.has(focusJob.id)
    ? undefined
    : `No runtime observations in the last ${windowDays} day(s). Run this job (or wait for its schedule) to populate lineage.`;

  return { focusJobId: focusJob.id, connectionId: focusJob.connectionId, windowDays, observedAt, nodes, edges, note };
}
