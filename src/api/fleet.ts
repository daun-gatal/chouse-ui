/**
 * Fleet API — multi-connection monitoring endpoints.
 *
 * Each card on /fleet calls these with a specific connectionId. The backend
 * route validates the user's access to that connection and runs a fixed,
 * server-controlled SQL for the requested metric. See packages/server/src/routes/fleet.ts.
 */

import { api } from "./client";

export type FleetMetric =
  | "summary"
  | "longest_query"
  | "top_memory_query"
  | "last_exception"
  | "schema_totals";

export interface FleetQueryResult<T = Record<string, unknown>> {
  meta: { name: string; type: string }[];
  data: T[];
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
  rows: number;
}

/**
 * Run a fleet metric against a specific connection. Throws `ApiError` if the
 * upstream cluster is unreachable or if the user does not have access — the
 * caller (a React Query hook) just lets the `isError` state propagate to the
 * card so it can render the "unreachable" / "forbidden" surface.
 */
export async function fleetQuery<T = Record<string, unknown>>(
  connectionId: string,
  metric: FleetMetric,
): Promise<FleetQueryResult<T>> {
  return api.post<FleetQueryResult<T>>("/fleet/query", { connectionId, metric });
}

// ============================================
// Row shapes — match the SQL in FLEET_METRICS server-side.
// ============================================

export interface FleetSummaryRow {
  server_memory_total_bytes: number;
  server_memory_used_bytes: number;
  server_cpu_percent: number;
  active_queries: number;
  long_running_queries: number;
  long_running_merges: number;
  open_mutations: number;
  sick_replicas: number;
  max_replica_lag_seconds: number;
  max_lag_replica: string;
  uptime_seconds: number;
  server_version: string;
}

export interface FleetLongestQueryRow {
  query_id: string;
  user: string;
  query_preview: string;
  elapsed_seconds: number;
  memory_usage: number;
}

export interface FleetLastExceptionRow {
  event_time_str: string;
  exception_code: number;
  exception_preview: string;
  user: string;
  query_id: string;
}

export interface FleetSchemaTotalsRow {
  databases: number;
  tables: number;
  views: number;
  rows: number;
  bytes: number;
}

export interface FleetPartsPressureRow {
  database: string;
  table: string;
  active_parts: number;
  max_parts_in_partition: number;
  rows: number;
  bytes: number;
  merges_running: number;
  insert_parts_per_min: number;
  merge_parts_per_min: number;
  parts_threshold: number;
  net_parts_per_min: number;
  eta_minutes: number;
}

// ============================================
// M2 — Snapshot cache endpoints
// ============================================

/**
 * One per-connection envelope from /api/fleet/snapshots. The per-metric
 * `data` mirrors what fleetQuery returns for that metric, just pre-fetched
 * by the backend poller and persisted in the fleet_snapshots table.
 */
export interface FleetConnectionSnapshot {
  connectionId: string;
  capturedAt: number; // unix seconds; max across this connection's metrics
  metrics: {
    summary?: { data: FleetSummaryRow[]; error: string | null };
    longest_query?: { data: FleetLongestQueryRow[]; error: string | null };
    top_memory_query?: { data: FleetLongestQueryRow[]; error: string | null };
    last_exception?: { data: FleetLastExceptionRow[]; error: string | null };
    schema_totals?: { data: FleetSchemaTotalsRow[]; error: string | null };
    parts_pressure?: { data: FleetPartsPressureRow[]; error: string | null };
  };
}

export interface FleetSnapshotsResponse {
  connections: FleetConnectionSnapshot[];
  workerEnabled: boolean;
  pollIntervalSeconds: number;
}

export async function fetchFleetSnapshots(): Promise<FleetSnapshotsResponse> {
  return api.get<FleetSnapshotsResponse>("/fleet/snapshots");
}

export interface FleetHistoryEntry {
  capturedAt: number;
  metric: FleetMetric;
  data: Record<string, unknown>[];
  error: string | null;
}

export interface FleetHistoryResponse {
  connectionId: string;
  from: number;
  to: number;
  rows: FleetHistoryEntry[];
}

export async function fetchFleetHistory(
  connectionId: string,
  opts?: { from?: number; to?: number; metric?: FleetMetric; limit?: number },
): Promise<FleetHistoryResponse> {
  const params = new URLSearchParams();
  if (opts?.from !== undefined) params.set("from", String(opts.from));
  if (opts?.to !== undefined) params.set("to", String(opts.to));
  if (opts?.metric) params.set("metric", opts.metric);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  const query = params.toString();
  return api.get<FleetHistoryResponse>(
    `/fleet/snapshots/${encodeURIComponent(connectionId)}/history${query ? `?${query}` : ""}`,
  );
}

export interface FleetBulkHistoryNode {
  connectionId: string;
  rows: { capturedAt: number; data: Record<string, unknown>[]; error: string | null }[];
}

export interface FleetBulkHistoryResponse {
  from: number;
  to: number;
  metric: FleetMetric;
  nodes: FleetBulkHistoryNode[];
}

/**
 * Time-series for every node the caller can view, one request. Feeds both the
 * shared trend chart and the per-card sparklines.
 */
export async function fetchFleetHistoryBulk(opts?: {
  from?: number;
  to?: number;
  metric?: FleetMetric;
  limit?: number;
}): Promise<FleetBulkHistoryResponse> {
  const params = new URLSearchParams();
  if (opts?.from !== undefined) params.set("from", String(opts.from));
  if (opts?.to !== undefined) params.set("to", String(opts.to));
  if (opts?.metric) params.set("metric", opts.metric);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  const query = params.toString();
  return api.get<FleetBulkHistoryResponse>(`/fleet/history${query ? `?${query}` : ""}`);
}

// ============================================
// M4 — Alert delivery config (Slack / email). Super-admin only; secrets are
// never returned (only whether a channel is configured).
// ============================================

// Fleet alert delivery is now managed through the normalized alerting model
// (see src/api/alerting.ts and the Fleet "Alert delivery" dialog). The legacy
// /fleet/alert-config client helpers were removed; the backend route still
// exists as a compatibility shim over the same normalized tables.

// ============================================
// ChouseD — AI fleet doctor (agentic health scan)
// ============================================

export type DoctorStatus = "healthy" | "warning" | "critical";

/** How a scan was kicked off: a manual run, an auto RCA from a breach, or a scheduled scan. */
export type DoctorTrigger = "manual" | "auto" | "scheduled";

/** Data-grounded analysis of one memory-hungry query. */
export interface FleetDoctorHeavyQuery {
  node: string;
  query: string;
  peakMemory: string;
  user?: string;
  cause: string;
  tables: { name: string; engine?: string; rows?: string; note: string }[];
  suggestions: string[];
  /** The query rewritten with the fixes applied (runnable SQL; review before running). */
  optimizedQuery?: string;
  /** Real EXPLAIN ESTIMATE (rows/parts/marks to read) for the original vs the optimized query. */
  estimate?: {
    before?: { rows: number; parts: number; marks: number };
    after?: { rows: number; parts: number; marks: number };
  };
}

export interface FleetDoctorAnalysis {
  verdict: { status: DoctorStatus; summary: string };
  nodes: { name: string; status: DoctorStatus; details: string[] }[];
  recommendations: string[];
  /** Deep-dives on memory-hungry queries — present only when one was flagged. */
  heavyQueries?: FleetDoctorHeavyQuery[];
}

/** Real per-node numbers captured at scan time — feeds the metric chips. */
export interface FleetDoctorNodeVitals {
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

export interface FleetDoctorReport {
  /** Stable id — the report's own page is /doctor/:id. */
  id: string;
  /** Structured analysis for the rich UI; null if the model didn't return JSON. */
  analysis: FleetDoctorAnalysis | null;
  /** The agent's raw final text — fallback render when `analysis` is null. */
  raw: string;
  /** Audit trail — read-only queries the agent ran. */
  steps: { tool: string; input: unknown }[];
  /** Real per-node metrics captured for this scan. */
  vitals: FleetDoctorNodeVitals[];
  model: string;
  scannedAt: number;
  durationMs: number;
  nodes: number;
  createdBy?: string | null;
  trigger?: DoctorTrigger;
  /** Investigation window (lookback hours) used for this scan. */
  hours?: number;
}

/** Compact row for the history rail (no heavy JSON). */
export interface FleetDoctorReportSummary {
  id: string;
  createdAt: number;
  createdBy: string | null;
  model: string | null;
  status: DoctorStatus | null;
  summary: string | null;
  nodeCount: number;
  durationMs: number;
  trigger: DoctorTrigger;
}

export interface FleetDoctorModel {
  id: string;
  label: string;
  model: string;
  provider: string;
  isDefault: boolean;
}

export async function fetchDoctorEnabled(): Promise<{ enabled: boolean }> {
  return api.get<{ enabled: boolean }>("/fleet/doctor/enabled");
}

export async function fetchDoctorModels(): Promise<FleetDoctorModel[]> {
  return api.get<FleetDoctorModel[]>("/fleet/doctor/models");
}

export async function runDoctorScan(opts?: {
  modelId?: string;
  connectionIds?: string[];
  hours?: number;
}): Promise<FleetDoctorReport> {
  return api.post<FleetDoctorReport>("/fleet/doctor/scan", opts ?? {});
}

/** Newest-first history of past scans (compact rows for the rail). */
export async function fetchDoctorReports(): Promise<FleetDoctorReportSummary[]> {
  return api.get<FleetDoctorReportSummary[]>("/fleet/doctor/reports");
}

/** One stored report by id — backs /doctor/:id. */
export async function fetchDoctorReport(id: string): Promise<FleetDoctorReport> {
  return api.get<FleetDoctorReport>(`/fleet/doctor/reports/${encodeURIComponent(id)}`);
}

/** Recurring scan schedule (daily / weekly / monthly). Times are UTC. */
export interface FleetDoctorSchedule {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  hour: number; // 0-23 UTC
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  dayOfMonth: number; // 1-28
  modelId?: string;
  hours: number; // scan window
  connectionIds?: string[];
  deliver: boolean;
  lastRunAt: number;
}

export type FleetDoctorScheduleUpdate = Omit<FleetDoctorSchedule, "lastRunAt">;

export async function fetchDoctorSchedule(): Promise<FleetDoctorSchedule> {
  return api.get<FleetDoctorSchedule>("/fleet/doctor/schedule");
}

export async function updateDoctorSchedule(body: FleetDoctorScheduleUpdate): Promise<{ ok: boolean }> {
  return api.put<{ ok: boolean }>("/fleet/doctor/schedule", body);
}

/** Delete specific reports from the history. */
export async function deleteDoctorReports(ids: string[]): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/fleet/doctor/reports/delete", { ids });
}

/** Wipe the entire report history. */
export async function deleteAllDoctorReports(): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/fleet/doctor/reports/delete", { all: true });
}
