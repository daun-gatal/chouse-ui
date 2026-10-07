/**
 * Data Observability Platform API (ADR 0016): collector status, datasets,
 * lineage, pipelines, coverage, incidents with RCA, performance, capacity
 * and schema preflight. Every call is scoped to one connection; it defaults
 * to the active connection header when `connectionId` is omitted.
 */

import { invokeAI, type InvokeOptions } from "./ai";
import { api } from "./client";

export type TrustState = "trusted" | "degraded" | "stale" | "learning" | "unknown";
export type Criticality = "critical" | "important" | "standard";
export type PipelineStatus =
  | "healthy"
  | "lagging"
  | "stalled"
  | "retrying"
  | "failing"
  | "stopped"
  | "inefficient"
  | "paused"
  | "unsupported_on_version";
export type PipelineKind =
  | "materialized_view"
  | "refreshable_view"
  | "queue_engine"
  | "object_storage_queue"
  | "database_replication"
  | "distributed"
  | "dictionary"
  | "async_insert"
  | "writer"
  | "external_table"
  | "scheduled_job";
export type IncidentSource = "data_health" | "observe";
export type RcaLayer = "data" | "transform" | "ingestion" | "external" | "engine";

export interface CollectorState {
  collector: string;
  state: string;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  missingPrivileges: string[] | null;
  durationMs: number | null;
}

export interface CollectorStatus {
  collectors: CollectorState[];
  serverVersion: string | null;
  probedAt: number | null;
}

export interface DatasetSummary {
  database: string;
  table: string;
  state: TrustState;
  stateReason: string | null;
  criticality: Criticality;
  criticalityPinned: boolean;
  lastWriteAt: number | null;
  cadenceSeconds: number | null;
  readers7d: number;
  reads7d: number;
  totalRows: number | null;
  totalBytes: number | null;
  engine: string | null;
  hasPromise: boolean;
  openIncident: boolean;
}

export interface ColumnProfilePoint {
  at: number;
  nullRatio: number | null;
  distinct: number | null;
  p50: number | null;
  p95: number | null;
  top: unknown[];
}

export interface DatasetDetail {
  database: string;
  table: string;
  catalog: {
    engine: string;
    sortingKey: string;
    partitionKey: string;
    primaryKey: string;
    totalRows: number | null;
    totalBytes: number | null;
    comment: string | null;
    createQuery: string | null;
  } | null;
  baseline: {
    state: TrustState;
    stateReason: string | null;
    criticality: Criticality;
    criticalityPinned: boolean;
    cadenceP50: number | null;
    cadenceP99: number | null;
    lastWriteAt: number | null;
    readers7d: number;
    reads7d: number;
  } | null;
  volume: Array<{ hour: number; rows: number; bytes: number; expected: number | null; lower: number | null; upper: number | null }>;
  drift: Record<string, ColumnProfilePoint[]>;
  schemaHistory: Array<{ at: number; summary: string; details: Record<string, unknown> }>;
  usage: Array<{ kind: string; principals: number; reads: number; bytes: number }>;
  filters: Array<{ column: string; share: number; inSortingKey: boolean }>;
  columns: string[];
  promises: Array<{ id: string; name: string; status: string; criticality: string }>;
}

export interface LineageNode {
  id: string;
  kind: string;
  label: string;
  database: string | null;
  table: string | null;
  status: string | null;
  statusReason: string | null;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  origin: string;
  columns: string[];
  observations: number;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  truncated: boolean;
  totalNodes: number;
}

export interface Pipeline {
  id: string;
  kind: PipelineKind;
  engine: string;
  name: string;
  sourceLabel: string | null;
  sourceNode: string | null;
  targetNode: string | null;
  status: PipelineStatus;
  statusReason: string | null;
  statusSince: number;
  unsupported: string | null;
  attrs: Record<string, unknown>;
  units24h: number;
  errors24h: number;
  sparkline: number[];
  lagSeconds: number | null;
  backlog: number | null;
  lastSuccessAt: number | null;
}

export interface PipelineSample {
  at: number;
  unitsIn: number | null;
  bytesIn: number | null;
  lastSuccessAt: number | null;
  lagSeconds: number | null;
  backlog: number | null;
  backlogUnit: string | null;
  errors: number | null;
  errorSample: string | null;
  errorClass: string | null;
  progressing: boolean | null;
}

export interface UnifiedIncident {
  source: IncidentSource;
  id: string;
  connectionId: string;
  kind: string;
  title: string;
  status: string;
  severity: "warning" | "critical";
  openedAt: number;
  lastEventAt: number;
  subject: string | null;
  rootCause: { layer: RcaLayer; summary: string } | null;
  connectionName?: string | null;
}

export interface ChainStep {
  layer: RcaLayer;
  nodeId: string | null;
  label: string;
  kind: string;
  summary: string;
  evidence: { source: string; detail: string };
  onsetAt: number;
  isRoot: boolean;
}

export interface BlastRadiusEntry {
  nodeId: string;
  label: string;
  kind: string;
  depth: number;
}

export interface StoredRca {
  computedAt: number;
  signature: string | null;
  chain: ChainStep[];
  rootCause: ChainStep | null;
  related: Array<{ source: IncidentSource; id: string; title?: string; relation?: string }>;
  blastRadius: BlastRadiusEntry[];
}

export interface IncidentDetail {
  source: IncidentSource;
  id: string;
  connectionId: string;
  connectionName?: string | null;
  kind: string;
  title: string;
  status: string;
  severity: "warning" | "critical";
  openedAt: number;
  lastEventAt: number;
  promiseId?: string;
  database?: string | null;
  table?: string | null;
  subjectRef?: string;
  acknowledgedBy?: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt?: number | null;
  events?: Array<{ type: string; at: number; payload: Record<string, unknown> }>;
  rca: StoredRca | null;
}

export interface ChangeEvent {
  at: number;
  kind: string;
  summary: string;
  objectRef: string | null;
}

export interface Overview {
  tables: { total: number; trusted: number; stale: number; degraded: number; learning: number };
  coverage: { critical: number; criticalPromised: number; promised: number };
  incidents: { open: number; critical: number; top: UnifiedIncident[] };
  pipelines: { total: number; byStatus: Partial<Record<PipelineStatus, number>>; attention: Pipeline[] };
  topTables: DatasetSummary[];
  recentChanges: ChangeEvent[];
}

export interface Suggestion {
  key: string;
  connectionId: string;
  database: string;
  table: string;
  kind: "freshness" | "volume" | "schema_contract" | "distribution";
  why: string;
  check: string;
  learnedFrom: string;
  score: number;
  draft: {
    name: string;
    connectionId: string;
    source: { sourceType: "table"; databaseName: string; tableName: string; eventTimeColumn?: string; eventTimeType?: string; eventTimeEncoding?: "native" };
    criticality: Criticality;
    frequency: "hourly" | "daily";
    checks: Array<Record<string, unknown>>;
  };
}

export interface ColdTable {
  database: string;
  table: string;
  totalBytes: number;
  lastWriteAt: number | null;
}

export interface Coverage {
  tables: number;
  learned: number;
  promised: number;
  byCriticality: Array<{ criticality: Criticality; tables: number; promised: number }>;
  unprotectedHot: number;
  suggestions: Suggestion[];
  cold: ColdTable[];
  readers: number;
}

export interface Regression {
  id: string;
  fingerprint: string;
  replica: string;
  metric: string;
  baseline: number;
  current: number;
  ratio: number;
  runs: number;
  onsetAt: number;
  linkedChanges: Array<{ id?: string; kind?: string; summary?: string; at?: number }>;
  sampleQuery: string | null;
}

export interface Performance {
  fingerprints: number;
  resolved7d: number;
  regressions: Regression[];
  changes: Array<{ id: string; kind: string; at: number; node: string | null; objectRef: string | null; summary: string }>;
}

export interface FingerprintPoint {
  hour: number;
  replica: string;
  runs: number;
  errors: number;
  p50: number | null;
  p95: number | null;
  readBytes: number | null;
  serverVersion: string | null;
}

export interface CodecTrial {
  id: string;
  database: string;
  table: string;
  column: string;
  current: string | null;
  candidate: string;
  status: string;
  ratioBefore: number | null;
  ratioAfter: number | null;
  savedBytes: number | null;
  error: string | null;
  createdAt: number;
}

export interface Capacity {
  forecasts: Array<{ node: string; disk: string; usedRatio: number; growthPerDay: number | null; daysToThreshold: number | null; threshold: number }>;
  history: Array<{ node: string; disk: string; at: number; used: number; total: number }>;
  growth: Array<{ database: string; table: string; bytesPerDay: number }>;
  cold: ColdTable[];
  trials: CodecTrial[];
  cost: {
    currency: string;
    perTibRead: number;
    perCpuHour: number;
    byConsumer: Array<{ kind: string; id: string; label?: string; readBytes: number; cost: number }>;
  } | null;
}

export type ImpactSeverity = "breaks" | "affects" | "info";

export interface ImpactItem {
  severity: ImpactSeverity;
  kind: string;
  ref: string;
  label: string;
  reason: string;
}

export interface PreflightResult {
  parsed: { kind: string; database?: string | null; table?: string | null };
  analyzed: boolean;
  breaking: boolean;
  items: ImpactItem[];
  notes: string[];
  saferPlan: string | null;
  hiddenDependents: number;
  canOverride?: boolean;
}

type Scope = { connectionId?: string };

function scope(connectionId?: string): { params: Record<string, string | undefined> } {
  return { params: { connectionId } };
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

export function getCollectorStatus(connectionId?: string): Promise<CollectorStatus> {
  return api.get<CollectorStatus>("/observe/status", scope(connectionId));
}

export function getPrivileges(connectionId?: string): Promise<{ missingGrants: string[]; collectors: CollectorState[] }> {
  return api.get("/observe/privileges", scope(connectionId));
}

export function checkPrivileges(connectionId?: string): Promise<{ serverVersion: string | null; missing: string[]; grants: string[] }> {
  return api.post("/observe/privileges/check", undefined, scope(connectionId));
}

export function getOverview(connectionId?: string): Promise<Overview> {
  return api.get<Overview>("/observe/overview", scope(connectionId));
}

export async function listDatasets(filter: Scope & { q?: string; state?: string; criticality?: string } = {}): Promise<DatasetSummary[]> {
  const res = await api.get<{ datasets: DatasetSummary[] }>("/observe/datasets", {
    params: { connectionId: filter.connectionId, q: filter.q || undefined, state: filter.state || undefined, criticality: filter.criticality || undefined },
  });
  return res.datasets;
}

export function getDataset(database: string, table: string, connectionId?: string): Promise<DatasetDetail> {
  return api.get<DatasetDetail>(`/observe/datasets/${seg(database)}/${seg(table)}`, scope(connectionId));
}

export function pinCriticality(database: string, table: string, criticality: Criticality | null, connectionId?: string): Promise<{ pinned: Criticality | null }> {
  return api.put(`/observe/datasets/${seg(database)}/${seg(table)}/criticality`, { criticality }, scope(connectionId));
}

export function getLineage(options: Scope & { node?: string | null; depth?: number; direction?: "up" | "down" | "both" } = {}): Promise<LineageGraph> {
  return api.get<LineageGraph>("/observe/lineage", {
    params: { connectionId: options.connectionId, node: options.node ?? undefined, depth: options.depth, direction: options.direction },
  });
}

export function getImpact(node: string, connectionId?: string): Promise<{ node: string; impacted: LineageNode[]; edges: LineageEdge[] }> {
  return api.get("/observe/lineage/impact", { params: { connectionId, node } });
}

export async function listPipelines(filter: Scope & { kind?: string; status?: string } = {}): Promise<Pipeline[]> {
  const res = await api.get<{ pipelines: Pipeline[] }>("/observe/pipelines", {
    params: { connectionId: filter.connectionId, kind: filter.kind || undefined, status: filter.status || undefined },
  });
  return res.pipelines;
}

export async function getPipelineSamples(id: string, connectionId?: string): Promise<PipelineSample[]> {
  const res = await api.get<{ samples: PipelineSample[] }>(`/observe/pipelines/${seg(id)}/samples`, scope(connectionId));
  return res.samples;
}

export function getCoverage(connectionId?: string): Promise<Coverage> {
  return api.get<Coverage>("/observe/coverage", scope(connectionId));
}

export function dismissSuggestion(key: string, connectionId?: string): Promise<{ dismissed: string }> {
  return api.post("/observe/suggestions/dismiss", { key }, scope(connectionId));
}

/** Active incidents across every accessible connection, or one when given. */
export async function listIncidents(options: Scope & { status?: "active" | "all" } = {}): Promise<UnifiedIncident[]> {
  const res = await api.get<{ incidents: UnifiedIncident[] }>("/observe/incidents", {
    params: { connectionId: options.connectionId, status: options.status === "all" ? "all" : undefined },
  });
  return res.incidents;
}

export function getIncident(source: IncidentSource, id: string): Promise<IncidentDetail> {
  return api.get<IncidentDetail>(`/observe/incidents/${source}/${seg(id)}`);
}

export function recomputeRca(source: IncidentSource, id: string): Promise<StoredRca | null> {
  return api.post<StoredRca | null>(`/observe/incidents/${source}/${seg(id)}/rca`);
}

export function acknowledgeObserveIncident(id: string): Promise<unknown> {
  return api.post(`/observe/incidents/observe/${seg(id)}/acknowledge`);
}

export function getPerformance(connectionId?: string): Promise<Performance> {
  return api.get<Performance>("/observe/performance", scope(connectionId));
}

export async function getFingerprintSeries(fingerprint: string, connectionId?: string): Promise<FingerprintPoint[]> {
  const res = await api.get<{ series: FingerprintPoint[] }>(`/observe/performance/fingerprints/${seg(fingerprint)}`, scope(connectionId));
  return res.series;
}

export function explainFingerprint(fingerprint: string, compareConnectionId?: string, connectionId?: string): Promise<{ plans: Record<string, string[]> }> {
  return api.post("/observe/performance/explain", { fingerprint, compareConnectionId }, scope(connectionId));
}

export function getCapacity(connectionId?: string): Promise<Capacity> {
  return api.get<Capacity>("/observe/capacity", scope(connectionId));
}

export function setCostRates(rates: { currency: string; perTibRead: number; perCpuHour: number }): Promise<typeof rates> {
  return api.put("/observe/cost-rates", rates);
}

export function startCodecTrial(input: { database: string; table: string; column: string; candidateCodec: string }, connectionId?: string): Promise<{ id: string }> {
  return api.post("/observe/codec-trials", input, scope(connectionId));
}

export function preflightDdl(sql: string, connectionId?: string): Promise<PreflightResult> {
  return api.post<PreflightResult>("/observe/preflight", { sql }, scope(connectionId));
}

export interface IncidentExplanation {
  summary: string;
  facts: string[];
  interpretation: string[];
  confidence: "low" | "medium" | "high";
  actionDrafts: Array<{ type: string; params: Record<string, unknown>; rationale: string; preview: string; approvalClass: 1 | 2 }>;
  droppedDrafts: number;
  model: string;
  generatedAt: number;
}

/** Chouse AI narrates the stored, deterministic RCA chain and drafts catalog fixes (never picks the root cause). */
export function explainIncident(source: IncidentSource, id: string, opts?: InvokeOptions): Promise<IncidentExplanation> {
  return invokeAI<IncidentExplanation>("explain-incident", { source, incidentId: id }, opts);
}

/** `table:db.name` lineage node id for a table. */
export function tableNode(database: string, table: string): string {
  return `table:${database}.${table}`;
}

/** Splits a `table:db.name` node id; null for non-table nodes. */
/** ClickHouse's own databases: never in the catalog, so they have no dataset page. */
const SYSTEM_DATABASES = new Set(["system", "information_schema"]);

export function isSystemDatabase(database: string | null | undefined): boolean {
  return Boolean(database) && SYSTEM_DATABASES.has(String(database).toLowerCase());
}

export function parseTableNode(nodeId: string | null | undefined): { database: string; table: string } | null {
  if (!nodeId || !nodeId.startsWith("table:")) return null;
  const fq = nodeId.slice("table:".length);
  const dot = fq.indexOf(".");
  if (dot <= 0) return null;
  return { database: fq.slice(0, dot), table: fq.slice(dot + 1) };
}
