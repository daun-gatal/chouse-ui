import { api } from "./client";

export type DataHealthState = "healthy" | "degraded" | "unhealthy" | "unknown" | "paused";
export type DataHealthOutcome = "pass" | "breach" | "learning" | "not_evaluated";
export type DataHealthSeverity = "warning" | "critical";
export type DataHealthCriticality = "standard" | "important" | "critical";
export type DataHealthFrequency = "daily" | "weekly" | "monthly" | "cron" | "manual" | "event";
export type DataHealthEventTimeEncoding = "auto" | "native" | "unix_seconds" | "unix_milliseconds" | "unix_microseconds" | "unix_nanoseconds" | "string";
export type DataHealthEventTimeFormat = "best_effort";

interface CheckBase {
  checkKey: string;
  name: string;
  severity: DataHealthSeverity;
  enabled: boolean;
}

export type DataHealthCheck =
  | (CheckBase & { type: "freshness"; config: { eventTimeColumn: string; maxAgeSeconds: number } })
  | (CheckBase & { type: "row_count"; config: { min?: number; max?: number } })
  | (CheckBase & { type: "volume_anomaly"; config: { minSamples: number; sensitivity: number; minRelativeBand: number; hardMin?: number; hardMax?: number } })
  | (CheckBase & { type: "completeness"; config: { column: string; minRatio: number } })
  | (CheckBase & { type: "uniqueness"; config: { columns: string[]; maxDuplicateRatio: number } })
  | (CheckBase & { type: "validity"; config: { predicate: string; minRatio: number } })
  | (CheckBase & { type: "schema_contract"; config: { expectedColumns: Array<{ name: string; type: string }>; allowAdditionalColumns: boolean } })
  | (CheckBase & { type: "custom_metric"; config: { expression: string; operator: "gt" | "gte" | "lt" | "lte" | "eq" | "between"; threshold: number; upperThreshold?: number } });

export interface DataHealthSchedule {
  frequency: DataHealthFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string | null;
  timeoutSecs: number;
}

/** Compact upstream job summary for event-triggered promises (ADR 0006). */
export interface DataHealthUpstream {
  id: string;
  name: string;
  frequency: string;
  enabled: boolean;
  lastRunAt: number | null;
  destDatabase: string | null;
  destTable: string | null;
}

export interface DataHealthPromise {
  id: string;
  scheduledQueryId: string;
  upstreamJobId: string | null;
  name: string;
  description: string | null;
  connectionId: string;
  sourceType: "table" | "query";
  databaseName: string | null;
  tableName: string | null;
  sourceQuery: string | null;
  eventTimeColumn: string | null;
  eventTimeType: string | null;
  eventTimeEncoding: DataHealthEventTimeEncoding;
  eventTimeTimezone: string | null;
  eventTimeFormat: DataHealthEventTimeFormat;
  rowFilter: string | null;
  ownerId: string | null;
  ownerDisplayName: string | null;
  criticality: DataHealthCriticality;
  timezone: string;
  runbookUrl: string | null;
  enabled: boolean;
  status: DataHealthState;
  graceSecs: number;
  breachAfter: number;
  recoverAfter: number;
  retentionDays: number;
  schemaSnapshot: Array<{ name: string; type: string }> | null;
  lastEvaluatedAt: number | null;
  lastHealthyAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  checks: DataHealthCheck[];
  schedule: DataHealthSchedule;
  channelIds: string[];
  upstream: DataHealthUpstream | null;
}

export interface DataHealthPromiseInput {
  name: string;
  description?: string | null;
  connectionId: string;
  source:
    | { sourceType: "table"; databaseName: string; tableName: string; eventTimeColumn?: string; eventTimeType?: string; eventTimeEncoding?: DataHealthEventTimeEncoding; eventTimeTimezone?: string; rowFilter?: string | null }
    | { sourceType: "query"; sourceQuery: string; eventTimeColumn?: string; eventTimeType?: string; eventTimeEncoding?: DataHealthEventTimeEncoding; eventTimeTimezone?: string; rowFilter?: string | null };
  ownerId?: string | null;
  criticality: DataHealthPromise["criticality"];
  runbookUrl?: string | null;
  enabled: boolean;
  frequency: DataHealthFrequency;
  /** Required when frequency is "event": the materializing job to run after. */
  upstreamJobId?: string | null;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr?: string | null;
  graceSecs: number;
  breachAfter: number;
  recoverAfter: number;
  retentionDays: number;
  timeoutSecs: number;
  channelIds: string[];
  checks: DataHealthCheck[];
  runNow: boolean;
}

export interface DataHealthIncident {
  id: string;
  promiseId: string;
  status: "open" | "acknowledged" | "snoozed" | "recovered";
  severity: DataHealthSeverity;
  kind: "data" | "execution";
  summary: string;
  openedAt: number;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  snoozedUntil: number | null;
  recoveredAt: number | null;
  lastEventAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface DataHealthSample {
  id: string;
  promiseId: string;
  checkId: string;
  checkKey: string;
  runId: string | null;
  origin: "live" | "backtest";
  outcome: DataHealthOutcome;
  observedValue: number | null;
  expectedLower: number | null;
  expectedUpper: number | null;
  evidence: Record<string, unknown> | null;
  slotAt: number;
  createdAt: number;
}

export interface DataHealthRun {
  id: string;
  queryId: string;
  trigger: "scheduled" | "manual" | "event";
  status: "running" | "success" | "failed" | "error";
  slotAt: number;
  conditionValue: string | null;
  conditionMet: boolean | null;
  durationMs: number | null;
  message: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface DataHealthIncidentEvent {
  id: string;
  incidentId: string;
  type: string;
  actorId: string | null;
  runId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: number;
}

export interface DataHealthOverview {
  totalPromises: number;
  byStatus: Record<DataHealthState, number>;
  openIncidents: number;
  unownedCritical: number;
  needsAttention: DataHealthPromise[];
  coverageGaps: Array<{ jobId: string; jobName: string; databaseName: string; tableName: string; outputMode: "append" | "replace" | "upsert" }>;
}

export interface DataHealthPreview {
  compiledSql: string;
  metricCheckKeys: string[];
  schemaCheckKeys: string[];
  nextFireTimes: number[];
  upstream: DataHealthUpstream | null;
}

export interface DataHealthColumn {
  name: string;
  type: string;
}

export async function listDataHealthPromises(connectionId?: string): Promise<DataHealthPromise[]> {
  const response = await api.get<{ promises: DataHealthPromise[] }>("/data-health", {
    params: { connectionId: connectionId || undefined },
  });
  return response.promises;
}

export function getDataHealthPromise(id: string): Promise<DataHealthPromise> {
  return api.get<DataHealthPromise>(`/data-health/${id}`);
}

export function getDataHealthOverview(connectionId?: string): Promise<DataHealthOverview> {
  return api.get<DataHealthOverview>("/data-health/overview", {
    params: { connectionId: connectionId || undefined },
  });
}

export function previewDataHealthPromise(input: DataHealthPromiseInput): Promise<DataHealthPreview> {
  return api.post<DataHealthPreview>("/data-health/preview", input);
}

export function describeDataHealthColumns(input: { connectionId: string; sourceQuery: string }): Promise<{ columns: DataHealthColumn[] }> {
  return api.post<{ columns: DataHealthColumn[] }>("/data-health/describe-columns", input);
}

export async function createDataHealthPromise(input: DataHealthPromiseInput): Promise<DataHealthPromise> {
  const response = await api.post<{ promise: DataHealthPromise; initialRun: DataHealthRun | null }>("/data-health", input);
  return response.promise;
}

export function updateDataHealthPromise(id: string, input: DataHealthPromiseInput): Promise<DataHealthPromise> {
  return api.patch<DataHealthPromise>(`/data-health/${id}`, input);
}

export async function deleteDataHealthPromise(id: string): Promise<void> {
  await api.delete<{ success: boolean }>(`/data-health/${id}`);
}

export async function runDataHealthPromise(id: string): Promise<DataHealthRun | null> {
  const response = await api.post<{ run: DataHealthRun | null }>(`/data-health/${id}/run`);
  return response.run;
}

export function getDataHealthTimeline(id: string): Promise<{ samples: DataHealthSample[]; incidents: DataHealthIncident[]; events: DataHealthIncidentEvent[]; runs: DataHealthRun[] }> {
  return api.get(`/data-health/${id}/timeline`);
}

export async function listDataHealthIncidents(connectionId?: string): Promise<DataHealthIncident[]> {
  const response = await api.get<{ incidents: DataHealthIncident[] }>("/data-health/incidents", {
    params: { connectionId: connectionId || undefined },
  });
  return response.incidents;
}

export async function acknowledgeDataHealthIncident(id: string): Promise<DataHealthIncident | null> {
  const response = await api.post<{ incident: DataHealthIncident | null }>(`/data-health/incidents/${id}/acknowledge`);
  return response.incident;
}

export async function snoozeDataHealthIncident(id: string, until: number): Promise<DataHealthIncident | null> {
  const response = await api.post<{ incident: DataHealthIncident | null }>(`/data-health/incidents/${id}/snooze`, { until });
  return response.incident;
}

export interface DataHealthBacktestResult {
  slots: Array<{
    slotAt: number;
    state: "healthy" | "degraded" | "unhealthy" | "unknown";
    checks: Array<{ checkKey: string; outcome: DataHealthOutcome; observedValue: number | null; expectedLower: number | null; expectedUpper: number | null }>;
    error?: string;
  }>;
  summary: { evaluated: number; healthy: number; breached: number; unknown: number; errors: number };
}

export function backtestDataHealthPromise(id: string, slots = 14): Promise<DataHealthBacktestResult> {
  return api.post<DataHealthBacktestResult>(`/data-health/${id}/backtest`, { slots });
}

export interface DataHealthDiagnosticResult {
  supported: boolean;
  rows: Array<Record<string, unknown>>;
  columns: Array<{ name: string; type: string }>;
  slotStart: number;
  slotEnd: number;
}

export function diagnoseDataHealthCheck(id: string, checkKey: string, slotAt?: number, limit = 50): Promise<DataHealthDiagnosticResult> {
  return api.post<DataHealthDiagnosticResult>(`/data-health/${id}/diagnostics`, { checkKey, slotAt, limit });
}
