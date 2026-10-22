/**
 * Dashboards API (ADR 0021, ADR 0023).
 */

import type { AnnotationSource, ChartType, Layout, RefreshSeconds, RelativeRange, TimeRange, Variable, VariableValues, VizSpec } from "@/lib/viz/spec";
import type { ResultColumn } from "@/lib/viz/resolve";

import { invokeAI, type InvokeOptions } from "./ai";
import { api } from "./client";
import type { RemediationAction } from "./remediation";

/** The connections a dashboard is assigned to (ADR 0021 §3). */
export type ConnectionScope = { kind: "any" } | { kind: "only"; connectionIds: string[] };

/** A scope as the viewer sees it: the assigned connections they may use, by name, and how many others. */
export type ScopeView = { kind: "any" } | { kind: "only"; connections: Array<{ id: string; name: string }>; hidden: number };

export interface DashboardRecord {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  timeRange: RelativeRange;
  refreshSeconds: RefreshSeconds;
  connectionScope: ConnectionScope;
  variables: Variable[];
  annotations: AnnotationSource[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface PanelMeta {
  id: string;
  dashboardId: string;
  position: number;
  layout: Layout;
  createdAt: number;
  updatedAt: number;
}

export type ChartPanelRecord = PanelMeta & { kind: "chart"; title: string; sql: string; viz: VizSpec; fleet: boolean };
export type TextPanelRecord = PanelMeta & { kind: "text"; title: string; markdown: string };
export type HeadingPanelRecord = PanelMeta & { kind: "heading"; title: string; description: string };
export type PanelRecord = ChartPanelRecord | TextPanelRecord | HeadingPanelRecord;

export interface ShareRecord {
  roleId: string;
  roleName: string;
  roleDisplayName: string;
  canEdit: boolean;
}

export interface DashboardAccess {
  owner: boolean;
  view: boolean;
  edit: boolean;
  delete: boolean;
  share: boolean;
}

export type LintCode =
  | "cumulative_counter" | "missing_unit" | "avg_of_quantiles" | "unbounded_log_scan" | "pie_without_limit"
  | "too_many_slices" | "time_axis_not_time" | "too_many_series" | "too_many_categories";

export interface LintFinding {
  code: LintCode;
  message: string;
  /** The panel SQL with the fix applied, when the fix is mechanical. */
  fixedSql?: string;
  /** The chart settings with the fix applied, when the fix is mechanical. */
  fixedViz?: VizSpec;
}

export interface DashboardDetail {
  dashboard: DashboardRecord;
  panels: PanelRecord[];
  shares: ShareRecord[];
  access: DashboardAccess;
  pinned: boolean;
  /** Lint findings per chart panel id. */
  lint: Record<string, LintFinding[]>;
  /** Alerts per panel id (counts only, for every viewer). */
  alertCounts: Record<string, number>;
  scope: ScopeView;
}

export interface DashboardSummary extends DashboardRecord {
  panelCount: number;
  ownerName: string | null;
  shares: ShareRecord[];
  access: DashboardAccess;
  pinned: boolean;
  scope: ScopeView;
}

/** A chart panel as saved: its query, chart and place on the canvas. `id` is null for a new panel. */
export interface ChartPanelInput {
  id: string | null;
  kind: "chart";
  title: string;
  sql: string;
  viz: VizSpec;
  fleet: boolean;
  layout: Layout;
}

export interface TextPanelInput {
  id: string | null;
  kind: "text";
  title: string;
  markdown: string;
  layout: Layout;
}

export interface HeadingPanelInput {
  id: string | null;
  kind: "heading";
  title: string;
  description: string;
  layout: Layout;
}

export type PanelInput = ChartPanelInput | TextPanelInput | HeadingPanelInput;

export interface DashboardInput {
  title: string;
  description: string;
  timeRange: RelativeRange;
  refreshSeconds: RefreshSeconds;
  connectionScope: ConnectionScope;
  variables: Variable[];
  annotations: AnnotationSource[];
  panels: PanelInput[];
}

/** An export: format 2. Import also takes a format 1 export (`chouse.dashboard/v1`), converted by the server. */
export interface DashboardExport {
  format: "chouse.dashboard/v2";
  id: string | null;
  dashboard: DashboardInput;
}

export interface PanelData {
  columns: ResultColumn[];
  rows: Array<Record<string, unknown>>;
  elapsedMs: number;
  readRows: number;
  readBytes: number;
  ranAt: number;
  /** ClickHouse's session time zone, or null when it did not say (ADR 0023 §8). */
  timezone: string | null;
}

export interface RunWindow {
  from: number;
  to: number;
  intervalSeconds: number;
}

export type FleetEntry =
  | { connectionId: string; connectionName: string; ok: true; data: PanelData; cached: boolean }
  | { connectionId: string; connectionName: string; ok: false; error: string };

export type PanelRunResult =
  | { kind: "single"; connectionId: string; window: RunWindow; data: PanelData; cached: boolean }
  | { kind: "fleet"; window: RunWindow; connections: FleetEntry[]; omitted: number };

/** A panel runs on the caller's active connection (the X-Connection-Id every request carries); a fleet panel on all of them. */
export interface RunRequest {
  range: TimeRange;
  values: VariableValues;
  /** Compare: run the same window this long ago (ADR 0023 §8). */
  shiftSeconds?: 86_400 | 604_800;
}

export interface DashboardTemplate {
  id: string;
  title: string;
  description: string;
  openFrom: "performance" | "capacity" | null;
  /** A copy is assigned to the connection it is made on. */
  dashboard: Omit<DashboardInput, "connectionScope">;
}

export interface ShareTarget {
  id: string;
  name: string;
  displayName: string;
}

const base = "/dashboards";
const enc = encodeURIComponent;

export function listDashboards(): Promise<DashboardSummary[]> {
  return api.get<DashboardSummary[]>(base);
}

export function getDashboard(id: string): Promise<DashboardDetail> {
  return api.get<DashboardDetail>(`${base}/${enc(id)}`);
}

export function createDashboard(input: DashboardInput): Promise<DashboardDetail> {
  return api.post<DashboardDetail>(base, input);
}

export function updateDashboard(id: string, version: number, dashboard: DashboardInput): Promise<DashboardDetail> {
  return api.put<DashboardDetail>(`${base}/${enc(id)}`, { version, dashboard });
}

export function deleteDashboard(id: string): Promise<{ deleted: string }> {
  return api.delete<{ deleted: string }>(`${base}/${enc(id)}`);
}

export function duplicateDashboard(id: string): Promise<DashboardDetail> {
  return api.post<DashboardDetail>(`${base}/${enc(id)}/duplicate`);
}

export function setShares(id: string, shares: Array<{ roleId: string; canEdit: boolean }>): Promise<DashboardDetail> {
  return api.put<DashboardDetail>(`${base}/${enc(id)}/shares`, { shares });
}

export function listShareTargets(): Promise<ShareTarget[]> {
  return api.get<ShareTarget[]>(`${base}/share-targets`);
}

export function setPinned(id: string, pinned: boolean): Promise<{ pinned: boolean }> {
  return pinned ? api.post<{ pinned: boolean }>(`${base}/${enc(id)}/pin`) : api.delete<{ pinned: boolean }>(`${base}/${enc(id)}/pin`);
}

export function exportDashboard(id: string): Promise<DashboardExport> {
  return api.get<DashboardExport>(`${base}/${enc(id)}/export`);
}

/** Import an export file as it is: the server reads format 1 and 2 and says what is wrong with anything else. */
export function importDashboard(body: unknown): Promise<DashboardDetail> {
  return api.post<DashboardDetail>(`${base}/import`, body);
}

export function runPanel(dashboardId: string, panelId: string, request: RunRequest, signal?: AbortSignal): Promise<PanelRunResult> {
  return api.post<PanelRunResult>(`${base}/${enc(dashboardId)}/panels/${enc(panelId)}/run`, request, { signal });
}

// ============================================
// Annotations, notes and bands (ADR 0023 §5, §8)
// ============================================

export interface AnnotationEvent {
  id: string;
  source: AnnotationSource;
  /** Unix milliseconds (UTC). */
  at: number;
  title: string;
  detail: string | null;
  objectRef: string | null;
  authorId?: string;
  authorName?: string | null;
}

export type AnnotationSourceResult =
  | { source: AnnotationSource; ok: true; events: AnnotationEvent[]; truncated: boolean }
  | { source: AnnotationSource; ok: false; error: string };

export function getAnnotations(dashboardId: string, range: TimeRange, sources: AnnotationSource[], signal?: AbortSignal): Promise<{ sources: AnnotationSourceResult[] }> {
  return api.post<{ sources: AnnotationSourceResult[] }>(`${base}/${enc(dashboardId)}/annotations`, { range, sources }, { signal });
}

export interface NoteRecord {
  id: string;
  dashboardId: string;
  connectionId: string;
  at: number;
  text: string;
  authorId: string;
  createdAt: number;
}

export function addNote(dashboardId: string, at: number, text: string): Promise<NoteRecord> {
  return api.post<NoteRecord>(`${base}/${enc(dashboardId)}/notes`, { at, text });
}

export function deleteNote(dashboardId: string, noteId: string): Promise<{ deleted: string }> {
  return api.delete<{ deleted: string }>(`${base}/${enc(dashboardId)}/notes/${enc(noteId)}`);
}

export interface BandPoint {
  x: string;
  lo: number;
  hi: number;
  median: number;
}

export type Baseline =
  | { state: "ready"; weeks: number; points: BandPoint[] }
  | { state: "learning"; weeks: number; points: BandPoint[]; reason: string };

export function getBaseline(dashboardId: string, panelId: string, request: Omit<RunRequest, "shiftSeconds">, signal?: AbortSignal): Promise<Baseline> {
  return api.post<Baseline>(`${base}/${enc(dashboardId)}/panels/${enc(panelId)}/baseline`, request, { signal });
}

export interface PreviewRequest extends RunRequest {
  sql: string;
  viz: VizSpec;
  fleet: boolean;
  variables: Variable[];
  /** The edit session's connections, saved or not. */
  connectionScope: ConnectionScope;
}

export function previewPanel(request: PreviewRequest, signal?: AbortSignal): Promise<{ result: PanelRunResult; lint: LintFinding[] }> {
  return api.post<{ result: PanelRunResult; lint: LintFinding[] }>(`${base}/preview`, request, { signal });
}

export function lintPanel(sql: string, viz: VizSpec): Promise<{ findings: LintFinding[] }> {
  return api.post<{ findings: LintFinding[] }>(`${base}/lint`, { sql, viz });
}

export function variableOptions(dashboardId: string, name: string): Promise<{ values: string[] }> {
  return api.post<{ values: string[] }>(`${base}/${enc(dashboardId)}/variables/${enc(name)}/options`);
}

export function listTemplates(): Promise<DashboardTemplate[]> {
  return api.get<DashboardTemplate[]>(`${base}/templates`);
}

export function instantiateTemplate(templateId: string, connectionScope: ConnectionScope): Promise<DashboardDetail> {
  return api.post<DashboardDetail>(`${base}/templates/${enc(templateId)}/instantiate`, { connectionScope });
}

/** A stored panel as the panel a save takes. */
export function panelInputOf(p: PanelRecord): PanelInput {
  switch (p.kind) {
    case "chart": return { id: p.id, kind: "chart", title: p.title, sql: p.sql, viz: p.viz, fleet: p.fleet, layout: p.layout };
    case "text": return { id: p.id, kind: "text", title: p.title, markdown: p.markdown, layout: p.layout };
    case "heading": return { id: p.id, kind: "heading", title: p.title, description: p.description, layout: p.layout };
  }
}

/** A detail's stored panels as the input a save takes. */
export function toInput(detail: Pick<DashboardDetail, "dashboard" | "panels">): DashboardInput {
  const { dashboard, panels } = detail;
  return {
    title: dashboard.title,
    description: dashboard.description,
    timeRange: dashboard.timeRange,
    refreshSeconds: dashboard.refreshSeconds,
    connectionScope: dashboard.connectionScope,
    variables: dashboard.variables,
    annotations: dashboard.annotations,
    panels: panels.map(panelInputOf),
  };
}

// ============================================
// Layout engine (ADR 0023 §4)
// ============================================

export const ROLES = ["kpi", "trend", "breakdown", "ranking", "distribution", "detail"] as const;
export type Role = (typeof ROLES)[number];
export type Importance = "primary" | "secondary";

export interface ArrangeSection {
  heading: { title: string; description: string } | null;
  panels: Array<{ key: string; kind: "chart" | "text"; chartType: ChartType | null; role: Role | null; importance: Importance; size: { w: number; h: number } | null }>;
}

export type Placed = { key: string; layout: Layout } | { key: null; heading: { title: string; description: string }; layout: Layout };

export function arrangePanels(sections: ArrangeSection[]): Promise<{ placed: Placed[] }> {
  return api.post<{ placed: Placed[] }>(`${base}/layout`, { mode: "arrange", sections });
}

export function tidyPanels(panels: Array<{ key: string; kind: PanelInput["kind"]; chartType: ChartType | null; size: { w: number; h: number } }>): Promise<{ placed: Placed[] }> {
  return api.post<{ placed: Placed[] }>(`${base}/layout`, { mode: "tidy", panels });
}

// ============================================
// Version history (ADR 0023 §11)
// ============================================

export type VersionSource = "ui" | "token" | "import" | "template" | "duplicate" | "restore" | "migration" | "rollup";

export interface VersionSummary {
  version: number;
  savedBy: string | null;
  savedByName: string | null;
  savedAt: number;
  source: VersionSource;
}

export interface VersionRecord extends VersionSummary {
  dashboardId: string;
  document: DashboardInput;
}

export function listVersions(id: string): Promise<VersionSummary[]> {
  return api.get<VersionSummary[]>(`${base}/${enc(id)}/versions`);
}

export function getVersion(id: string, version: number): Promise<VersionRecord> {
  return api.get<VersionRecord>(`${base}/${enc(id)}/versions/${version}`);
}

export function restorePreview(id: string, version: number): Promise<{ removedPanels: number; removedAlerts: Array<{ id: string; name: string }> }> {
  return api.get<{ removedPanels: number; removedAlerts: Array<{ id: string; name: string }> }>(`${base}/${enc(id)}/versions/${version}/restore-preview`);
}

export function restoreVersion(id: string, version: number, currentVersion: number): Promise<DashboardDetail> {
  return api.post<DashboardDetail>(`${base}/${enc(id)}/versions/${version}/restore`, { currentVersion });
}

// ============================================
// Snapshots (ADR 0023 §12)
// ============================================

export const SNAPSHOT_EXPIRY_DAYS = [1, 7, 30, 90, 365] as const;

export interface SnapshotSummary {
  id: string;
  dashboardId: string;
  name: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: number;
  expiresAt: number;
  connectionId: string;
  /** Unix seconds. */
  range: { from: number; to: number };
  sizeBytes: number;
  roleIds: string[];
  incidentId: string | null;
}

/** A panel's frozen result, or why there is none ("Access denied" when the viewer may not read it). */
export type SnapshotResult = ({ ok: true } & PanelRunResult) | { ok: false; error: string };

export interface Snapshot extends SnapshotSummary {
  document: DashboardInput;
  values: VariableValues;
  results: Record<string, SnapshotResult>;
}

export interface SnapshotRequest {
  name: string;
  from: number;
  to: number;
  values: VariableValues;
  roleIds: string[];
  expiresInDays: number;
  incidentId: string | null;
}

/** Runs every chart panel on the active connection (sent with the request) for the range. */
export function createSnapshot(id: string, request: SnapshotRequest): Promise<SnapshotSummary> {
  return api.post<SnapshotSummary>(`${base}/${enc(id)}/snapshots`, request);
}

export function listSnapshots(id: string): Promise<SnapshotSummary[]> {
  return api.get<SnapshotSummary[]>(`${base}/${enc(id)}/snapshots`);
}

export function getSnapshot(id: string, snapshotId: string): Promise<Snapshot> {
  return api.get<Snapshot>(`${base}/${enc(id)}/snapshots/${enc(snapshotId)}`);
}

export function deleteSnapshot(id: string, snapshotId: string): Promise<{ deleted: string }> {
  return api.delete<{ deleted: string }>(`${base}/${enc(id)}/snapshots/${enc(snapshotId)}`);
}

// ============================================
// Panel cost and rollups (ADR 0023 §10)
// ============================================

export interface PanelCost {
  readBytes: number;
  readRows: number;
  elapsedMs: number;
  cached: boolean;
  refreshSeconds: number;
  /** Runs per hour for each open viewer at the dashboard's refresh (0 without auto-refresh). */
  readsPerHour: number;
  bytesPerHour: number;
  /** Over 1 GiB a run, or 100 GiB an hour. */
  heavy: boolean;
  rollup: { eligible: true; target: string; source: string } | { eligible: false; reason: string };
}

export function getPanelCost(dashboardId: string, panelId: string, body: { range: TimeRange; values: VariableValues }): Promise<PanelCost> {
  return api.post<PanelCost>(`${base}/${enc(dashboardId)}/panels/${enc(panelId)}/cost`, body);
}

/** Propose the panel's rollup as a remediation action; it runs only once approved. */
export function proposeRollup(dashboardId: string, panelId: string, body: { backfillDays: number; cluster: string | null }): Promise<RemediationAction> {
  return api.post<RemediationAction>(`${base}/${enc(dashboardId)}/panels/${enc(panelId)}/rollup`, body);
}

/** Whether a panel reads a rollup this feature made (it then has 1-minute resolution). */
export function readsRollup(sql: string): boolean {
  return /\bchouse_rollup_[0-9a-f]{12}\b/.test(sql);
}

// ============================================
// Grafana import (ADR 0023 §14)
// ============================================

export type GrafanaStatus = "ready" | "changed" | "skipped";

export interface GrafanaPreview {
  /** The convertible panels and variables, ready for importDashboard. */
  dashboard: DashboardInput;
  panels: Array<{ title: string; grafanaType: string; status: GrafanaStatus; changes: string[]; reason: string | null }>;
  variables: Array<{ name: string; status: GrafanaStatus; changes: string[]; reason: string | null }>;
  notes: string[];
}

/** Convert a Grafana dashboard JSON for review; nothing is saved. */
export function previewGrafana(grafana: unknown, connectionScope: ConnectionScope): Promise<GrafanaPreview> {
  return api.post<GrafanaPreview>(`${base}/import/grafana`, { grafana, connectionScope });
}

// ============================================
// Scheduled reports (ADR 0023 §13)
// ============================================

export interface ReportSchedule {
  kind: "daily" | "weekly";
  /** 0 = Sunday … 6 = Saturday; weekly only. */
  dayOfWeek: number | null;
  hour: number;
  minute: number;
  /** IANA zone the hour and minute are in. */
  timezone: string;
}

export interface ReportInput {
  name: string;
  connectionId: string;
  schedule: ReportSchedule;
  range: RelativeRange;
  onlyIfAlert: boolean;
  enabled: boolean;
  channelIds: string[];
}

export type ReportStatus = "sent" | "skipped" | "failed";

export interface Report extends ReportInput {
  id: string;
  dashboardId: string;
  ownerId: string;
  ownerName: string | null;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: ReportStatus | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReportRun {
  status: ReportStatus;
  error: string | null;
  title: string | null;
  text: string | null;
  deliveredTo: string[];
  failed: Array<{ channelId: string; error: string }>;
}

/** The reports, and whether the server can send any (reports need PUBLIC_BASE_URL). */
export function listReports(id: string): Promise<{ reports: Report[]; publicBaseUrl: boolean }> {
  return api.get<{ reports: Report[]; publicBaseUrl: boolean }>(`${base}/${enc(id)}/reports`);
}

export function createReport(id: string, input: ReportInput): Promise<Report> {
  return api.post<Report>(`${base}/${enc(id)}/reports`, input);
}

export function updateReport(id: string, reportId: string, input: ReportInput): Promise<Report> {
  return api.put<Report>(`${base}/${enc(id)}/reports/${enc(reportId)}`, input);
}

export function deleteReport(id: string, reportId: string): Promise<{ deleted: string }> {
  return api.delete<{ deleted: string }>(`${base}/${enc(id)}/reports/${enc(reportId)}`);
}

/** Send a report now to its channels; its schedule is unchanged. */
export function sendReport(id: string, reportId: string): Promise<ReportRun> {
  return api.post<ReportRun>(`${base}/${enc(id)}/reports/${enc(reportId)}/send`);
}

// ============================================
// Draft with AI (ADR 0021 §10, ADR 0023 §4)
// ============================================

export type DraftPanelStatus = "ok" | "attention" | "blocked";

/** A drafted chart: everything but its place, which the layout engine decides. */
export type DraftedChart = Omit<ChartPanelInput, "layout">;

export interface DraftPanel {
  status: DraftPanelStatus;
  /** The panel to add; null when its chart settings, role or importance could not be read. */
  panel: DraftedChart | null;
  title: string;
  sql: string;
  rationale: string;
  role: Role | null;
  importance: Importance | null;
  section: string | null;
  reasons: string[];
  lint: LintFinding[];
}

export interface DashboardDraft {
  title: string;
  description: string;
  variables: Variable[];
  problems: string[];
  panels: DraftPanel[];
}

export interface DraftRequest {
  goal: string;
  /** The active connection: the drafter reads its schemas. */
  connectionId: string;
  existing: { title: string; variables: Variable[]; panels: Array<{ title: string; sql: string }> } | null;
}

export function draftDashboard(request: DraftRequest, opts?: InvokeOptions): Promise<DashboardDraft> {
  return invokeAI<DashboardDraft>("draft-dashboard", { ...request }, opts);
}

// ============================================
// Explain this spike (ADR 0023 §9)
// ============================================

export interface ExplainRequest {
  dashboardId: string;
  panelId: string;
  fromMs: number;
  toMs: number;
  values: VariableValues;
  /** The active connection: evidence is read there. */
  connectionId: string;
}

export interface SpikeExplanation {
  summary: string;
  likelyCause: string;
  confidence: "low" | "medium" | "high";
  evidence: Array<{ kind: "panel" | "change" | "query" | "mutation" | "merge" | "alert" | "incident" | "other"; text: string }>;
  nextSteps: string[];
  /** Evidence that could not be read, and why. */
  unavailable: Array<{ part: string; reason: string }>;
}

export function explainSpike(request: ExplainRequest, opts?: InvokeOptions): Promise<SpikeExplanation> {
  return invokeAI<SpikeExplanation>("explain-spike", { ...request }, opts);
}

// ============================================
// Panel alerts (ADR 0021 §7)
// ============================================

export type AlertOp = ">" | ">=" | "<" | "<=";
export type AlertState = "ok" | "pending" | "firing" | "no_data" | "error";

interface AlertCommon {
  column: string;
  forEvaluations: number;
  everyMinutes: number;
  range: RelativeRange;
  values: VariableValues;
}

export type ThresholdConfig = AlertCommon & {
  kind: "threshold";
  reduce: "last" | "max" | "min" | "avg" | "sum";
  op: AlertOp;
  value: number;
};

/** Outside the panel's expected-range band, in the latest complete bucket (ADR 0023 §8). */
export type BandConfig = AlertCommon & { kind: "outside_band" };

export type AlertConfig = ThresholdConfig | BandConfig;

export interface AlertInput {
  name: string;
  severity: "warning" | "critical";
  connectionId: string;
  channelIds: string[];
  enabled: boolean;
  config: AlertConfig;
}

export interface AlertStatus {
  state: AlertState;
  breaches: number;
  since: number;
  lastEvalAt: number | null;
  lastValue: number | null;
  lastError: string | null;
}

export interface PanelAlert extends AlertInput {
  id: string;
  dashboardId: string;
  panelId: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface PanelAlertWithStatus extends PanelAlert {
  status: AlertStatus | null;
}

export type AlertCheck =
  | { kind: "value"; value: number; breached: boolean; band?: { lo: number; hi: number } }
  | { kind: "no_data"; reason: string }
  | { kind: "error"; reason: string };

export function listAlerts(dashboardId: string): Promise<PanelAlertWithStatus[]> {
  return api.get<PanelAlertWithStatus[]>(`${base}/${enc(dashboardId)}/alerts`);
}

export function listAllAlerts(): Promise<Array<PanelAlertWithStatus & { dashboardTitle: string | null }>> {
  return api.get<Array<PanelAlertWithStatus & { dashboardTitle: string | null }>>(`${base}/alerts`);
}

export function createAlert(dashboardId: string, panelId: string, input: AlertInput): Promise<PanelAlert> {
  return api.post<PanelAlert>(`${base}/${enc(dashboardId)}/panels/${enc(panelId)}/alerts`, input);
}

export function updateAlert(dashboardId: string, alertId: string, input: AlertInput): Promise<PanelAlert> {
  return api.put<PanelAlert>(`${base}/${enc(dashboardId)}/alerts/${enc(alertId)}`, input);
}

export function deleteAlert(dashboardId: string, alertId: string): Promise<{ deleted: string }> {
  return api.delete<{ deleted: string }>(`${base}/${enc(dashboardId)}/alerts/${enc(alertId)}`);
}

export function checkAlert(dashboardId: string, alertId: string): Promise<AlertCheck> {
  return api.post<AlertCheck>(`${base}/${enc(dashboardId)}/alerts/${enc(alertId)}/check`);
}
