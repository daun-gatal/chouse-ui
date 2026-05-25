/**
 * Fleet monitoring hooks.
 *
 * Parallel to useMonitoringTimeline.ts but each hook takes an explicit
 * `connectionId` so the same hook can run against N different clusters from
 * one browser session. Backed by POST /api/fleet/query — see src/api/fleet.ts.
 *
 * The hooks intentionally do NOT read `useAuthStore.activeConnectionId` —
 * the fleet page renders many cards, each bound to its own connection, and
 * the auth-store singleton would clobber them.
 */

import { useQuery, useQueries, UseQueryOptions } from "@tanstack/react-query";
import {
  fleetApi,
  rbacConnectionsApi,
  type FleetSummaryRow,
  type FleetLongestQueryRow,
  type FleetLastExceptionRow,
  type FleetSnapshotsResponse,
  type FleetConnectionSnapshot,
} from "@/api";
import type { ClickHouseConnection } from "@/api/rbac";

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * List of connections the current user is allowed to see. Drives the grid on
 * /fleet. Refetched infrequently — connection topology doesn't change every
 * 30 seconds.
 */
export function useFleetConnections(
  options?: Partial<UseQueryOptions<ClickHouseConnection[], Error>>,
) {
  return useQuery({
    queryKey: ["fleet", "connections"] as const,
    queryFn: () => rbacConnectionsApi.getMyConnections(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export interface FleetSummary {
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryPercent: number;
  cpuPercent: number;
  activeQueries: number;
  longRunningQueries: number;
  longRunningMerges: number;
  openMutations: number;
  sickReplicas: number;
  maxReplicaLagSeconds: number;
  maxLagReplica: string;
  uptimeSeconds: number;
  serverVersion: string;
}

/**
 * Stable cache key for the per-connection summary. Both `useFleetSummary`
 * (the card-level driver) and `useQueries` aggregations (the page header
 * count strip) point at this key so they share one fetch.
 */
export const fleetSummaryQueryKey = (connectionId: string) =>
  ["fleet", "summary", connectionId] as const;

/**
 * Shared queryFn for the summary metric. Extracted so the page-level
 * `useQueries` call and the per-card `useQuery` call hit identical functions
 * — React Query dedupes by key, but consistent queryFn means whichever call
 * mounts first does the work and the others subscribe.
 */
export async function fetchFleetSummary(connectionId: string): Promise<FleetSummary> {
  const result = await fleetApi.fleetQuery<FleetSummaryRow>(connectionId, "summary");
  const row = result.data[0] ?? ({} as Partial<FleetSummaryRow>);
  const totalBytes = num(row.server_memory_total_bytes);
  const usedBytes = num(row.server_memory_used_bytes);
  return {
    memoryTotalBytes: totalBytes,
    memoryUsedBytes: usedBytes,
    memoryPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    cpuPercent: num(row.server_cpu_percent),
    activeQueries: num(row.active_queries),
    longRunningQueries: num(row.long_running_queries),
    longRunningMerges: num(row.long_running_merges),
    openMutations: num(row.open_mutations),
    sickReplicas: num(row.sick_replicas),
    maxReplicaLagSeconds: num(row.max_replica_lag_seconds),
    maxLagReplica: String(row.max_lag_replica ?? ""),
    uptimeSeconds: num(row.uptime_seconds),
    serverVersion: String(row.server_version ?? ""),
  };
}

/**
 * Per-card summary tile. One SQL call rolls up memory, query, blocked-task,
 * and replica-lag signals. Polled at `refetchIntervalMs` (default 30s,
 * controlled by the page).
 */
export function useFleetSummary(
  connectionId: string,
  refetchIntervalMs: number = 30_000,
  options?: Partial<UseQueryOptions<FleetSummary, Error>>,
) {
  return useQuery({
    queryKey: fleetSummaryQueryKey(connectionId),
    queryFn: () => fetchFleetSummary(connectionId),
    refetchInterval: refetchIntervalMs > 0 ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    // Keep stale data visible during refetch so the card doesn't flash empty
    // every 30 seconds.
    placeholderData: (prev) => prev,
    // Don't auto-retry — the 3-strike rule lives at the card level, and
    // React Query's exponential backoff fights against fixed-interval polling.
    retry: false,
    staleTime: refetchIntervalMs,
    ...options,
  });
}

export interface FleetLongestQuery {
  queryId: string;
  user: string;
  queryPreview: string;
  elapsedSeconds: number;
  memoryUsage: number;
}

/**
 * Top 1 currently-running query by elapsed time. Returns null when nothing is
 * running — the card just shows "—" then.
 */
export function useFleetLongestQuery(
  connectionId: string,
  refetchIntervalMs: number = 30_000,
  options?: Partial<UseQueryOptions<FleetLongestQuery | null, Error>>,
) {
  return useQuery({
    queryKey: ["fleet", "longest_query", connectionId] as const,
    queryFn: async () => {
      const result = await fleetApi.fleetQuery<FleetLongestQueryRow>(
        connectionId,
        "longest_query",
      );
      const row = result.data[0];
      if (!row) return null;
      return {
        queryId: String(row.query_id ?? ""),
        user: String(row.user ?? ""),
        queryPreview: String(row.query_preview ?? ""),
        elapsedSeconds: num(row.elapsed_seconds),
        memoryUsage: num(row.memory_usage),
      };
    },
    refetchInterval: refetchIntervalMs > 0 ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: refetchIntervalMs,
    ...options,
  });
}

export interface FleetLastException {
  eventTime: string;
  exceptionCode: number;
  exceptionPreview: string;
  user: string;
  queryId: string;
}

/**
 * Most recent ClickHouse exception in the past hour. Returns null when the
 * cluster has been clean for an hour. Restores the v2.14 signal that was
 * dropped in v2.15.0 cleanup.
 */
export function useFleetLastException(
  connectionId: string,
  refetchIntervalMs: number = 30_000,
  options?: Partial<UseQueryOptions<FleetLastException | null, Error>>,
) {
  return useQuery({
    queryKey: ["fleet", "last_exception", connectionId] as const,
    queryFn: async () => {
      const result = await fleetApi.fleetQuery<FleetLastExceptionRow>(
        connectionId,
        "last_exception",
      );
      const row = result.data[0];
      if (!row) return null;
      return {
        eventTime: String(row.event_time_str ?? ""),
        exceptionCode: num(row.exception_code),
        exceptionPreview: String(row.exception_preview ?? ""),
        user: String(row.user ?? ""),
        queryId: String(row.query_id ?? ""),
      };
    },
    refetchInterval: refetchIntervalMs > 0 ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: refetchIntervalMs,
    ...options,
  });
}

export type FleetCardStatus = "healthy" | "degraded" | "down" | "loading";

/**
 * Pure function that turns a summary + an error state into the card's
 * status dot color. Kept here (next to the hooks that feed it) so the card
 * stays a dumb renderer.
 *
 * Thresholds chosen to be conservative — better to ship a quiet amber than
 * a noisy red that operators learn to ignore.
 */
export function computeFleetStatus(
  summary: FleetSummary | undefined,
  isError: boolean,
  consecutiveErrors: number,
): FleetCardStatus {
  if (!summary && !isError) return "loading";
  // 3-strike rule before flipping to down — single transient blip should
  // not flap the status indicator.
  if (consecutiveErrors >= 3) return "down";
  if (!summary) return "loading";

  if (
    summary.memoryPercent >= 90 ||
    summary.maxReplicaLagSeconds >= 300 ||
    summary.sickReplicas > 0
  ) {
    return "down";
  }
  if (
    summary.memoryPercent >= 70 ||
    summary.maxReplicaLagSeconds >= 30 ||
    summary.longRunningQueries > 0 ||
    summary.longRunningMerges > 0
  ) {
    return "degraded";
  }
  return "healthy";
}

// useQueries is re-exported for callers that want to batch fleet queries
// across N connections in one hook call instead of N independent hooks. Not
// used by the M1 card (which uses one hook per card) but handy for an
// aggregate "how many clusters are unhealthy" counter on the page header.
export { useQueries };

// ============================================
// M2 — Snapshot-cache hook (one HTTP call for the whole grid)
// ============================================

/**
 * Pulls the latest snapshot for every connection the user can view in one
 * round-trip, so the page doesn't fire N × 3 fetches just to draw the grid.
 *
 * Refetched every `pollIntervalMs` (default 10s — faster than the worker's
 * write cadence so updates feel near-instant). Auto-pauses when the tab is
 * backgrounded.
 *
 * Returns the raw response shape so the caller can also inspect
 * `workerEnabled` and `pollIntervalSeconds` for the stale-banner logic.
 */
export function useFleetSnapshots(
  pollIntervalMs: number = 10_000,
  options?: Partial<UseQueryOptions<FleetSnapshotsResponse, Error>>,
) {
  return useQuery({
    queryKey: ["fleet", "snapshots"] as const,
    queryFn: fleetApi.fetchFleetSnapshots,
    refetchInterval: pollIntervalMs > 0 ? pollIntervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: pollIntervalMs,
    ...options,
  });
}

/**
 * Compute whether a per-connection snapshot is fresh enough to render
 * without falling back to a live fetch.
 *
 * Rule: the snapshot is "fresh" if `capturedAt` is within
 * `2 × pollIntervalSeconds` of now (matches the spec's hint that a
 * snapshot older than twice the poll interval means the worker stalled).
 */
export function isSnapshotFresh(
  snapshot: FleetConnectionSnapshot | undefined,
  pollIntervalSeconds: number,
): boolean {
  if (!snapshot || !snapshot.capturedAt) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - snapshot.capturedAt;
  return ageSeconds <= pollIntervalSeconds * 2;
}

/**
 * Adapt a snapshot envelope into the same shape the live `useFleetSummary`
 * hook returns. Used by FleetCard so the snapshot path and the live path
 * feed the same rendering code.
 */
export function summaryFromSnapshot(
  snapshot: FleetConnectionSnapshot | undefined,
): FleetSummary | undefined {
  if (!snapshot?.metrics.summary) return undefined;
  const { data, error } = snapshot.metrics.summary;
  if (error || !data || data.length === 0) return undefined;
  const row = data[0] ?? ({} as Partial<FleetSummaryRow>);
  const totalBytes = num(row.server_memory_total_bytes);
  const usedBytes = num(row.server_memory_used_bytes);
  return {
    memoryTotalBytes: totalBytes,
    memoryUsedBytes: usedBytes,
    memoryPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    cpuPercent: num(row.server_cpu_percent),
    activeQueries: num(row.active_queries),
    longRunningQueries: num(row.long_running_queries),
    longRunningMerges: num(row.long_running_merges),
    openMutations: num(row.open_mutations),
    sickReplicas: num(row.sick_replicas),
    maxReplicaLagSeconds: num(row.max_replica_lag_seconds),
    maxLagReplica: String(row.max_lag_replica ?? ""),
    uptimeSeconds: num(row.uptime_seconds),
    serverVersion: String(row.server_version ?? ""),
  };
}

export function longestQueryFromSnapshot(
  snapshot: FleetConnectionSnapshot | undefined,
): FleetLongestQuery | null | undefined {
  if (!snapshot?.metrics.longest_query) return undefined;
  const { data, error } = snapshot.metrics.longest_query;
  if (error) return undefined;
  const row = data?.[0];
  if (!row) return null;
  return {
    queryId: String(row.query_id ?? ""),
    user: String(row.user ?? ""),
    queryPreview: String(row.query_preview ?? ""),
    elapsedSeconds: num(row.elapsed_seconds),
    memoryUsage: num(row.memory_usage),
  };
}

/**
 * Top currently-running queries by memory — feeds the high-memory-query alert.
 * Returns every row so the alert engine can raise a separate breach for each
 * query over the threshold (not just the single greediest one).
 */
export function topMemoryQueriesFromSnapshot(
  snapshot: FleetConnectionSnapshot | undefined,
): FleetLongestQuery[] {
  if (!snapshot?.metrics.top_memory_query) return [];
  const { data, error } = snapshot.metrics.top_memory_query;
  if (error || !data) return [];
  return data.map((row) => ({
    queryId: String(row.query_id ?? ""),
    user: String(row.user ?? ""),
    queryPreview: String(row.query_preview ?? ""),
    elapsedSeconds: num(row.elapsed_seconds),
    memoryUsage: num(row.memory_usage),
  }));
}

export function lastExceptionFromSnapshot(
  snapshot: FleetConnectionSnapshot | undefined,
): FleetLastException | null | undefined {
  if (!snapshot?.metrics.last_exception) return undefined;
  const { data, error } = snapshot.metrics.last_exception;
  if (error) return undefined;
  const row = data?.[0];
  if (!row) return null;
  return {
    eventTime: String(row.event_time_str ?? ""),
    exceptionCode: num(row.exception_code),
    exceptionPreview: String(row.exception_preview ?? ""),
    user: String(row.user ?? ""),
    queryId: String(row.query_id ?? ""),
  };
}

/**
 * Page-level status derivation from a snapshot — used by the grid's
 * sort/filter so the page can order nodes worst-first without reaching into
 * each card. A card still computes its own status (which may use live
 * fallback); these agree whenever the snapshot is fresh, which is the case
 * the sort cares about.
 *
 * - no/stale snapshot      → 'loading'
 * - snapshot but poll errored → 'down' (poller reached the DB but the node
 *   was unreachable)
 * - otherwise              → threshold-based status from the summary
 */
export function nodeStatusFromSnapshot(
  snapshot: FleetConnectionSnapshot | undefined,
  pollIntervalSeconds: number,
): FleetCardStatus {
  if (!isSnapshotFresh(snapshot, pollIntervalSeconds)) return "loading";
  if (snapshot?.metrics.summary?.error) return "down";
  const summary = summaryFromSnapshot(snapshot);
  return computeFleetStatus(summary, false, 0);
}

/** Rank for "worst-first" sort: problems float to the top. */
export const FLEET_STATUS_RANK: Record<FleetCardStatus, number> = {
  down: 0,
  degraded: 1,
  healthy: 2,
  loading: 3,
};

// ============================================
// Fleet-wide aggregations for the panels below the grid
// ============================================

export interface FleetExceptionEntry {
  connectionId: string;
  connectionName: string;
  eventTime: string;
  exceptionCode: number;
  exceptionPreview: string;
  user: string;
  queryId: string;
}

/**
 * Flatten the `last_exception` rows from every node's snapshot into one
 * time-sorted feed. Each node's snapshot carries up to 10 recent exceptions
 * (see FLEET_METRICS.last_exception); we merge them across nodes, tag each
 * with the node name, and sort newest-first. Powers the fleet-wide
 * exceptions feed below the grid.
 */
export function flattenFleetExceptions(
  snapshots: FleetConnectionSnapshot[],
  nameById: Map<string, string>,
  limit: number = 30,
): FleetExceptionEntry[] {
  const out: FleetExceptionEntry[] = [];
  for (const snap of snapshots) {
    const ex = snap.metrics.last_exception;
    if (!ex || ex.error || !ex.data) continue;
    for (const row of ex.data) {
      out.push({
        connectionId: snap.connectionId,
        connectionName: nameById.get(snap.connectionId) ?? snap.connectionId,
        eventTime: String(row.event_time_str ?? ""),
        exceptionCode: num(row.exception_code),
        exceptionPreview: String(row.exception_preview ?? ""),
        user: String(row.user ?? ""),
        queryId: String(row.query_id ?? ""),
      });
    }
  }
  // Sort newest-first by the formatted event_time string — it's
  // 'YYYY-MM-DD HH:mm:ss' so lexical sort == chronological sort.
  out.sort((a, b) => b.eventTime.localeCompare(a.eventTime));
  return out.slice(0, limit);
}

export interface FleetSchemaTotals {
  databases: number;
  tables: number;
  views: number;
  rows: number;
  /** Total on-disk size of data (sum of system.tables.total_bytes) across nodes. */
  bytes: number;
  /** How many nodes contributed a schema_totals row (the rest had no/stale snapshot). */
  nodesReporting: number;
}

/**
 * Sum the schema census across every node's latest snapshot — the "what's in
 * my fleet" strip. Each node's schema_totals is polled into the snapshot cache
 * by the worker, so this is a pure client-side fold of data already on the
 * page (no extra fetch, scales with the grid).
 *
 * Note: this is a literal sum across nodes. If two nodes are replicas of the
 * same cluster they share a schema, so their tables/views/rows are counted
 * once per node — which is what "total across N nodes" means here. The strip
 * labels the node count so that's not misread as a unique object count.
 */
export function aggregateFleetSchemaTotals(
  snapshots: FleetConnectionSnapshot[],
): FleetSchemaTotals {
  const acc: FleetSchemaTotals = {
    databases: 0,
    tables: 0,
    views: 0,
    rows: 0,
    bytes: 0,
    nodesReporting: 0,
  };
  for (const snap of snapshots) {
    const st = snap.metrics.schema_totals;
    if (!st || st.error || !st.data || st.data.length === 0) continue;
    const row = st.data[0];
    acc.databases += num(row.databases);
    acc.tables += num(row.tables);
    acc.views += num(row.views);
    acc.rows += num(row.rows);
    acc.bytes += num(row.bytes);
    acc.nodesReporting += 1;
  }
  return acc;
}

// ============================================
// History (trend chart + sparklines), one bulk fetch
// ============================================

export type FleetTrendField = "memory" | "cpu" | "queries" | "replica_lag";

/**
 * Trend metrics the chart can plot — all extracted from the SAME summary
 * snapshot payload, so switching metric needs no extra fetch.
 */
export const FLEET_TREND_FIELDS: Record<
  FleetTrendField,
  { label: string; unit: string; domainMax?: number; extract: (row: Record<string, unknown>) => number | null }
> = {
  memory: {
    label: "Memory %",
    unit: "%",
    domainMax: 100,
    extract: (row) => {
      const total = num(row.server_memory_total_bytes);
      const used = num(row.server_memory_used_bytes);
      return total > 0 ? (used / total) * 100 : null;
    },
  },
  cpu: {
    label: "CPU %",
    unit: "%",
    domainMax: 100,
    extract: (row) =>
      // Pre-1.x snapshots lack server_cpu_percent — treat absence as a gap
      // (null) rather than a misleading 0% so the line just doesn't draw there.
      row.server_cpu_percent == null ? null : num(row.server_cpu_percent),
  },
  queries: {
    label: "Active queries",
    unit: "",
    extract: (row) => num(row.active_queries),
  },
  replica_lag: {
    label: "Replica lag (s)",
    unit: "s",
    extract: (row) => num(row.max_replica_lag_seconds),
  },
};

interface HistoryRow {
  time: number;
  row: Record<string, unknown>;
}

export interface FleetHistory {
  /** Raw summary rows per connectionId, ascending by time. */
  byNode: Map<string, HistoryRow[]>;
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * One bulk fetch of summary history for every node. Feeds the shared trend
 * chart and every per-card sparkline from a single request (vs N per-node
 * requests). Returns raw summary rows per node; callers extract whichever
 * field they want via FLEET_TREND_FIELDS.
 */
export function useFleetHistory(
  hoursBack: number = 1,
  refetchIntervalMs: number = 30_000,
): FleetHistory {
  const now = Math.floor(Date.now() / 1000);
  const from = now - hoursBack * 3600;

  const q = useQuery({
    queryKey: ["fleet", "history", "bulk", hoursBack] as const,
    queryFn: () => fleetApi.fetchFleetHistoryBulk({ metric: "summary", from }),
    refetchInterval: refetchIntervalMs > 0 ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: refetchIntervalMs,
  });

  const byNode = new Map<string, HistoryRow[]>();
  for (const node of q.data?.nodes ?? []) {
    const rows: HistoryRow[] = [];
    for (const r of node.rows) {
      const summaryRow = r.data?.[0] as Record<string, unknown> | undefined;
      if (summaryRow) rows.push({ time: r.capturedAt, row: summaryRow });
    }
    byNode.set(node.connectionId, rows);
  }

  return { byNode, isLoading: q.isLoading, isFetching: q.isFetching };
}

export interface FleetTrendPoint {
  time: number;
  [nodeName: string]: number | null;
}

/**
 * Pivot per-node history into one row per timestamp with a column per node —
 * the shape recharts wants for overlaid lines. `field` selects which summary
 * value to plot.
 */
export function pivotHistory(
  byNode: Map<string, HistoryRow[]>,
  connections: { id: string; name: string }[],
  field: FleetTrendField,
): FleetTrendPoint[] {
  const extract = FLEET_TREND_FIELDS[field].extract;
  const byTime = new Map<number, FleetTrendPoint>();
  for (const conn of connections) {
    const rows = byNode.get(conn.id);
    if (!rows) continue;
    for (const { time, row } of rows) {
      let point = byTime.get(time);
      if (!point) {
        point = { time };
        byTime.set(time, point);
      }
      point[conn.name] = extract(row);
    }
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/** Per-node series for a sparkline: [{time, value}] for one field. */
export function nodeSeries(
  rows: HistoryRow[] | undefined,
  field: FleetTrendField,
): { time: number; value: number | null }[] {
  if (!rows) return [];
  const extract = FLEET_TREND_FIELDS[field].extract;
  return rows.map(({ time, row }) => ({ time, value: extract(row) }));
}

/**
 * Fleet-wide exceptions over a time window (time-travel). Fetches the
 * last_exception metric history in bulk, flattens every node's rows across
 * every poll, and dedups by (connection, query_id, event_time) — each poll
 * re-captures overlapping recent exceptions, so dedup is essential. Sorted
 * newest-first, capped.
 *
 * This supersedes reading exceptions off the latest snapshot: it works for
 * any window (1h / 6h / 24h), not just "the last hour the poller saw".
 */
export function useFleetExceptions(
  connections: { id: string; name: string }[],
  hoursBack: number = 1,
  refetchIntervalMs: number = 30_000,
  limit: number = 50,
) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - hoursBack * 3600;
  const nameById = new Map(connections.map((c) => [c.id, c.name]));

  const q = useQuery({
    queryKey: ["fleet", "exceptions", hoursBack] as const,
    queryFn: () =>
      fleetApi.fetchFleetHistoryBulk({ metric: "last_exception", from, limit: 50000 }),
    refetchInterval: refetchIntervalMs > 0 ? refetchIntervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: refetchIntervalMs,
  });

  const seen = new Set<string>();
  const entries: FleetExceptionEntry[] = [];
  for (const node of q.data?.nodes ?? []) {
    const name = nameById.get(node.connectionId) ?? node.connectionId;
    for (const snap of node.rows) {
      for (const row of snap.data) {
        const r = row as Record<string, unknown>;
        const eventTime = String(r.event_time_str ?? "");
        const queryId = String(r.query_id ?? "");
        const key = `${node.connectionId}|${queryId}|${eventTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          connectionId: node.connectionId,
          connectionName: name,
          eventTime,
          exceptionCode: num(r.exception_code),
          exceptionPreview: String(r.exception_preview ?? ""),
          user: String(r.user ?? ""),
          queryId,
        });
      }
    }
  }
  entries.sort((a, b) => b.eventTime.localeCompare(a.eventTime));

  return {
    entries: entries.slice(0, limit),
    total: entries.length,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
  };
}
