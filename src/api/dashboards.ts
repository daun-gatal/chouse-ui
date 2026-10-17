/**
 * Custom dashboards API (ADR 0021).
 */

import type { RelativeRange, TimeRange, Variable, VizSpec, PanelWidth, PanelHeight, RefreshSeconds } from "@/lib/viz/spec";
import type { ResultColumn } from "@/lib/viz/resolve";

import { invokeAI, type InvokeOptions } from "./ai";
import { api } from "./client";

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
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PanelRecord {
  id: string;
  dashboardId: string;
  position: number;
  title: string;
  sql: string;
  viz: VizSpec;
  width: PanelWidth;
  height: PanelHeight;
  fleet: boolean;
  createdAt: number;
  updatedAt: number;
}

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

export type LintCode = "cumulative_counter" | "missing_unit" | "avg_of_quantiles" | "unbounded_log_scan" | "pie_without_limit";

export interface LintFinding {
  code: LintCode;
  message: string;
  fixedSql?: string;
}

export interface DashboardDetail {
  dashboard: DashboardRecord;
  panels: PanelRecord[];
  shares: ShareRecord[];
  access: DashboardAccess;
  pinned: boolean;
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

export interface PanelInput {
  /** The stored panel's id, or null for a new panel. */
  id: string | null;
  title: string;
  sql: string;
  viz: VizSpec;
  width: PanelWidth;
  height: PanelHeight;
  fleet: boolean;
}

export interface DashboardInput {
  title: string;
  description: string;
  timeRange: RelativeRange;
  refreshSeconds: RefreshSeconds;
  connectionScope: ConnectionScope;
  variables: Variable[];
  panels: PanelInput[];
}

export interface DashboardExport {
  format: "chouse.dashboard/v1";
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
  values: Record<string, string>;
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

export function importDashboard(body: DashboardExport): Promise<DashboardDetail> {
  return api.post<DashboardDetail>(`${base}/import`, body);
}

export function runPanel(dashboardId: string, panelId: string, request: RunRequest, signal?: AbortSignal): Promise<PanelRunResult> {
  return api.post<PanelRunResult>(`${base}/${enc(dashboardId)}/panels/${enc(panelId)}/run`, request, { signal });
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
    panels: panels.map((p) => ({ id: p.id, title: p.title, sql: p.sql, viz: p.viz, width: p.width, height: p.height, fleet: p.fleet })),
  };
}

// ============================================
// Draft with AI (ADR 0021 §10)
// ============================================

export type DraftPanelStatus = "ok" | "attention" | "blocked";

export interface DraftPanel {
  status: DraftPanelStatus;
  /** The panel to save; null when its chart settings or size could not be read. */
  panel: PanelInput | null;
  title: string;
  sql: string;
  rationale: string;
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
// Panel alerts (ADR 0021 §7)
// ============================================

export type AlertOp = ">" | ">=" | "<" | "<=";
export type AlertState = "ok" | "pending" | "firing" | "no_data" | "error";

export interface AlertConfig {
  column: string;
  reduce: "last" | "max" | "min" | "avg" | "sum";
  op: AlertOp;
  value: number;
  forEvaluations: number;
  everyMinutes: number;
  range: RelativeRange;
  values: Record<string, string>;
}

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

export type AlertCheck = { kind: "value"; value: number } | { kind: "no_data"; reason: string } | { kind: "error"; reason: string };

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
