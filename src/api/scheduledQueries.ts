/**
 * Scheduled Queries API (DataOps) — CRUD, manual run, run history, overview, and
 * the builder preview helper. Mirrors packages/server/src/routes/scheduled-queries.ts.
 */

import { api } from "./client";

export type SqFrequency = "daily" | "weekly" | "monthly" | "cron" | "manual";
export type SqOutputMode = "none" | "append" | "replace" | "upsert";
export type SqStatus = "running" | "success" | "failed" | "error";
export type SqTrigger = "scheduled" | "manual";

export interface OutputConfig {
  partitionExpr?: string;
  createIfMissing?: boolean;
  engine?: string;
  orderBy?: string;
  partitionBy?: string;
  staging?: string;
  expectedSchema?: Array<{ name: string; type: string }>;
}

export interface ScheduledQueryRun {
  id: string;
  queryId: string;
  trigger: SqTrigger;
  status: SqStatus;
  slotAt: number;
  attempt: number;
  rowCount: number | null;
  truncated: boolean;
  writtenRows: number | null;
  resultJson: string | null;
  durationMs: number | null;
  message: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface ScheduledQuery {
  id: string;
  name: string;
  description: string | null;
  connectionId: string;
  query: string;
  enabled: boolean;
  frequency: SqFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string | null;
  outputMode: SqOutputMode;
  destDatabase: string | null;
  destTable: string | null;
  outputConfig: OutputConfig | null;
  maxRows: number;
  timeoutSecs: number;
  useFinal: boolean;
  seqConsistency: boolean;
  lastRunAt: number;
  maxAttempts: number;
  retentionDays: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  channelIds: string[];
  lastRun?: ScheduledQueryRun | null;
}

export interface ScheduledQueryInput {
  name: string;
  description?: string | null;
  connectionId: string;
  query: string;
  enabled: boolean;
  frequency: SqFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr?: string | null;
  outputMode: SqOutputMode;
  destDatabase?: string | null;
  destTable?: string | null;
  outputConfig?: OutputConfig | null;
  maxRows: number;
  timeoutSecs: number;
  useFinal: boolean;
  seqConsistency: boolean;
  maxAttempts: number;
  retentionDays: number;
  channelIds: string[];
}

export interface OverviewKpis {
  totalJobs: number;
  enabledJobs: number;
  disabledJobs: number;
  failing: number;
  healthy: number;
  neverRun: number;
  runsLast24h: number;
  runsWindow: number;
  successRateWindow: number;
  avgDurationMs: number;
  materializeJobs: number;
  alertingJobs: number;
}

export interface Overview {
  kpis: OverviewKpis;
  byCadence: Record<string, number>;
  byOutputMode: Record<string, number>;
  byLastStatus: { success: number; failing: number; running: number; never: number };
  upcoming: Array<{ id: string; name: string; nextRunAt: number }>;
  topFailing: Array<{ id: string; name: string; failureStreak: number; lastMessage: string | null }>;
}

export interface PreviewResult {
  readOnly: { ok: boolean; error?: string; tokens: string[] };
  dataAccess?: { allowed: boolean; reason?: string };
  cron?: { valid: boolean; error?: string; normalized?: string };
  nextFireTimes?: number[];
  outputColumns?: Array<{ name: string; type: string }>;
  destination?: {
    exists?: boolean;
    engine?: string | null;
    engineError?: string | null;
    compatible?: boolean;
    missingInDest?: Array<{ name: string; type: string }>;
    createDDL?: string;
    willCreate?: boolean;
    error?: string;
  };
}

export async function listScheduledQueries(): Promise<ScheduledQuery[]> {
  const res = await api.get<{ jobs: ScheduledQuery[] }>("/scheduled-queries");
  return res.jobs;
}

export async function getScheduledQuery(id: string): Promise<ScheduledQuery> {
  return api.get<ScheduledQuery>(`/scheduled-queries/${id}`);
}

export async function createScheduledQuery(input: ScheduledQueryInput): Promise<ScheduledQuery> {
  return api.post<ScheduledQuery>("/scheduled-queries", input);
}

export async function updateScheduledQuery(id: string, input: ScheduledQueryInput): Promise<ScheduledQuery> {
  return api.patch<ScheduledQuery>(`/scheduled-queries/${id}`, input);
}

export async function deleteScheduledQuery(id: string): Promise<void> {
  await api.delete<{ success: boolean }>(`/scheduled-queries/${id}`);
}

export async function runScheduledQuery(id: string): Promise<{ run: ScheduledQueryRun | null }> {
  return api.post<{ run: ScheduledQueryRun | null }>(`/scheduled-queries/${id}/run`);
}

export interface RunQuery {
  limit?: number;
  offset?: number;
  status?: SqStatus;
  /** Inclusive lower bound on started_at (ms). */
  from?: number;
  /** Exclusive upper bound on started_at (ms). */
  to?: number;
  /** Delete/keep window: older than N days (overrides `to`). */
  olderThanDays?: number;
}

function runQueryString(opts: RunQuery): string {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.status) params.set("status", opts.status);
  if (opts.from != null) params.set("from", String(opts.from));
  if (opts.to != null) params.set("to", String(opts.to));
  if (opts.olderThanDays != null) params.set("olderThanDays", String(opts.olderThanDays));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listRuns(id: string, opts: RunQuery = {}): Promise<ScheduledQueryRun[]> {
  const res = await api.get<{ runs: ScheduledQueryRun[] }>(`/scheduled-queries/${id}/runs${runQueryString(opts)}`);
  return res.runs;
}

export async function deleteRuns(id: string, opts: RunQuery): Promise<number> {
  const res = await api.delete<{ deleted: number }>(`/scheduled-queries/${id}/runs${runQueryString(opts)}`);
  return res.deleted;
}

export async function getRun(runId: string): Promise<ScheduledQueryRun> {
  const res = await api.get<{ run: ScheduledQueryRun }>(`/scheduled-queries/runs/${runId}`);
  return res.run;
}

export async function getOverview(windowDays = 14): Promise<Overview> {
  return api.get<Overview>(`/scheduled-queries/overview?window=${windowDays}d`);
}

export async function previewScheduledQuery(input: Partial<ScheduledQueryInput>): Promise<PreviewResult> {
  return api.post<PreviewResult>("/scheduled-queries/preview", input);
}

// --- lineage (observed runtime) ---------------------------------------------

export interface LineageTableNode {
  id: string;
  kind: "table";
  label: string;
  database: string;
  table: string;
  columns: string[];
  produced: boolean;
}

export interface LineageJobNode {
  id: string;
  kind: "job";
  label: string;
  jobId: string;
  outputMode: SqOutputMode;
  focus: boolean;
  runCount: number;
  lastSeen: number | null;
}

export type LineageNode = LineageTableNode | LineageJobNode;

export interface LineageEdge {
  id: string;
  from: string;
  to: string;
  kind: "read" | "write";
  columns: string[];
}

export interface LineageGraph {
  focusJobId: string;
  connectionId: string;
  windowDays: number;
  observedAt: number;
  nodes: LineageNode[];
  edges: LineageEdge[];
  note?: string;
}

export async function getLineage(id: string, windowDays = 14): Promise<LineageGraph> {
  return api.get<LineageGraph>(`/scheduled-queries/${id}/lineage?window=${windowDays}d`);
}
