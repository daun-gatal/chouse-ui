/**
 * `/api/dashboards` — custom dashboards (ADR 0021).
 *
 * Permission map:
 *   list / get / export / pin   dashboards:view + owner, a share of one of your roles, or dashboards:manage
 *   create / import / duplicate dashboards:edit
 *   update                      dashboards:edit + owner, a share with edit, or dashboards:manage
 *   delete                      dashboards:delete + owner or dashboards:manage
 *   shares                      dashboards:share + owner or dashboards:manage
 *   run a panel / options       view access + query:execute; each run is checked against the
 *                               caller's own connection and table access (services/dashboards/runner.ts)
 *   preview / lint              dashboards:edit (+ query:execute to run)
 *   templates                   list: dashboards:view; use one: dashboards:edit
 *   panel alerts                list: alerting:view (+ view access); create / update / check: alerting:edit
 *                               + edit access; delete: alerting:delete + edit access
 *
 * A dashboard the caller may not view answers 404, the same as one that does not exist.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { CONNECTION_ID_COOKIE, CONNECTION_ID_HEADER, getCookie } from "../middleware/connectionContext";
import { rbacAuthMiddleware, getRbacUser, requirePermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext, listRoles } from "../rbac/services/rbac";
import { getChannel } from "../services/alerting/store";
import { AGENT_RECORDED_HEADER, agentContextFor } from "../services/agents/governance";
import * as alertStore from "../services/dashboards/alertStore";
import { evaluate } from "../services/dashboards/alerts";
import { getConnectionById, type ConnectionResponse } from "../rbac/services/connections";
import { dashboardAccess, has, viewerConnections, type DashboardAccess, type Viewer } from "../services/dashboards/access";
import { addNote, deleteNote, getNote, loadAnnotations, MAX_NOTE_LENGTH } from "../services/dashboards/annotations";
import { runBaseline } from "../services/dashboards/baseline";
import { arrange, IMPORTANCES, ROLES, roleProblem, tidy, type ArrangeSection } from "../services/dashboards/layout";
import { parseDashboardDocument, parseDashboardExport } from "../services/dashboards/legacy";
import { chartFit, lintPanel, type LintFinding } from "../services/dashboards/lint";
import { resolveWindow } from "../services/dashboards/macros";
import { assertDataAccess, compilePanel, resolveValues, runFleet, runOptions, runPanel, SHIFT_SECONDS, viewerConnection, type AgentFor, type FleetRun, type PanelQuery, type PanelRun, type ShiftSeconds } from "../services/dashboards/runner";
import {
  CHART_TYPES,
  DASHBOARD_EXPORT_FORMAT,
  GRID_COLUMNS,
  MAX_PANELS,
  MAX_PANEL_ROWS,
  connectionScopeSchema,
  dashboardUpdateSchema,
  inScope,
  MAX_SQL_LENGTH,
  PANEL_KINDS,
  TIME_SERIES_TYPES,
  annotationSourcesSchema,
  timeRangeSchema,
  variableSchema,
  variableValuesSchema,
  vizSpecSchema,
  type ConnectionScope,
  type DashboardExport,
  type DashboardInput,
  type Layout,
} from "../services/dashboards/spec";
import { convertGrafana } from "../services/dashboards/grafana";
import { analyzeRollup, readsRollup, rollupTarget } from "../services/dashboards/rollup";
import { proposeAction, RemediationError } from "../services/remediation/executor";
import { postApprovalRequest } from "../services/remediation/slack";
import { reportRangeSchema, reportScheduleSchema } from "../services/dashboards/reportDigest";
import * as reports from "../services/dashboards/reports";
import * as snapshots from "../services/dashboards/snapshots";
import * as store from "../services/dashboards/store";
import { findTemplate, TEMPLATES } from "../services/dashboards/templates";
import { dashboardProblems, panelProblems } from "../services/dashboards/validate";
import { AppError, requireParam } from "../types";

const dashboards = new Hono();
dashboards.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status: 200 | 201 = 200): any {
  return c.json({ success: true, data }, status);
}

function viewerOf(c: Context): Viewer {
  const user = getRbacUser(c);
  return { id: user.sub, roles: user.roles, permissions: user.permissions };
}

/** Token callers (CLI, MCP) pass agent governance on every panel query. */
function agentFor(c: Context): AgentFor {
  return (connectionId) => agentContextFor(c, connectionId, "dashboards");
}

function markAgentRecorded(c: Context): void {
  if (c.get("authMethod") === "pat") c.header(AGENT_RECORDED_HEADER, "1");
}

interface Visible {
  detail: store.DashboardDetail;
  access: DashboardAccess;
}

async function visible(c: Context, id: string): Promise<Visible> {
  const detail = await store.getDashboard(id);
  if (!detail) throw AppError.notFound("Dashboard not found");
  const access = dashboardAccess(viewerOf(c), detail.dashboard, detail.shares);
  if (!access.view) throw AppError.notFound("Dashboard not found");
  return { detail, access };
}

function assertValid(input: DashboardInput): void {
  const problems = dashboardProblems(input);
  if (problems.length > 0) throw AppError.badRequest(problems[0], { problems });
}

/** A dashboard document in either format (ADR 0023 §3), as format 2 — or a 400 that says what is wrong. */
function documentOf(raw: unknown): DashboardInput {
  const parsed = parseDashboardDocument(raw);
  if (!parsed.ok) throw AppError.badRequest(parsed.problems[0], { problems: parsed.problems });
  return parsed.input;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw AppError.badRequest("The request body must be JSON");
  }
}

/** Where a save came from, for version history: a token (CLI, MCP, scripts) or the browser. */
function saveContext(c: Context, source?: store.VersionSource): store.SaveContext {
  return { userId: viewerOf(c).id, source: source ?? (c.get("authMethod") === "pat" ? "token" : "ui") };
}

/**
 * Drill-down links to other dashboards (ADR 0023 §6) must name a dashboard the
 * saver can view, and only variables it has. One that names an unknown
 * dashboard — say, from another install's export — is refused, never dropped.
 */
async function assertLinks(c: Context, input: DashboardInput): Promise<void> {
  const viewer = viewerOf(c);
  const targets = new Map<string, store.DashboardDetail | null>();
  for (const [i, panel] of input.panels.entries()) {
    if (panel.kind !== "chart") continue;
    for (const link of panel.viz.links) {
      if (link.kind !== "dashboard") continue;
      if (!targets.has(link.dashboardId)) targets.set(link.dashboardId, await store.getDashboard(link.dashboardId));
      const target = targets.get(link.dashboardId) ?? null;
      const where = `Panel ${i + 1} (${panel.title}), link "${link.label}"`;
      if (!target || !dashboardAccess(viewer, target.dashboard, target.shares).view) {
        throw AppError.badRequest(`${where}: there is no dashboard ${link.dashboardId} you can view`);
      }
      const names = new Set(target.dashboard.variables.map((v) => v.name));
      const unknown = Object.keys(link.values).filter((name) => !names.has(name));
      if (unknown.length > 0) throw AppError.badRequest(`${where}: ${target.dashboard.title} has no variable ${unknown.join(", ")}`);
    }
  }
}

/**
 * The connection the caller is on, as every other route reads it (ADR 0010):
 * the browser's active connection, the CLI's -c, or the MCP client's pin. A
 * dashboard has no connection of its own. With none stated we refuse rather
 * than guess the user's default, so a panel never shows another cluster's data.
 */
function currentConnectionId(c: Context): string {
  const id = c.req.header(CONNECTION_ID_HEADER) || getCookie(c, CONNECTION_ID_COOKIE);
  if (!id) throw AppError.badRequest("Pick a connection to run this on");
  return id;
}

/**
 * A dashboard's connections as one viewer sees them: the ones they may use, by
 * name, and how many others there are. Names of connections the viewer cannot
 * use are not theirs to see.
 */
type ScopeView = { kind: "any" } | { kind: "only"; connections: Array<{ id: string; name: string }>; hidden: number };

function scopeView(scope: ConnectionScope, usable: ConnectionResponse[]): ScopeView {
  if (scope.kind === "any") return { kind: "any" };
  const connections = usable.filter((c) => scope.connectionIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name }));
  return { kind: "only", connections, hidden: scope.connectionIds.length - connections.length };
}

/**
 * Connections assigned on a save must exist and be ones the saver may use.
 * Ones already assigned are kept as they are, so an editor who cannot use one
 * of them does not have to drop it to change something else.
 */
async function assertScope(c: Context, scope: ConnectionScope, previous: ConnectionScope | null): Promise<void> {
  if (scope.kind === "any") return;
  const kept = new Set(previous?.kind === "only" ? previous.connectionIds : []);
  const usable = new Set((await viewerConnections(viewerOf(c))).map((conn) => conn.id));
  for (const id of scope.connectionIds) {
    if (kept.has(id) || usable.has(id)) continue;
    const connection = await getConnectionById(id);
    throw AppError.badRequest(connection
      ? `You cannot use the connection ${connection.name}, so you cannot assign the dashboard to it`
      : `There is no connection ${id} to assign the dashboard to`);
  }
}

/**
 * A save may not leave an alert watching a connection the dashboard is no
 * longer assigned to, or a panel that is no longer a chart.
 */
async function assertAlertsInScope(dashboardId: string, input: DashboardInput): Promise<void> {
  const kept = new Map(input.panels.flatMap((p) => (p.id === null ? [] : [[p.id, p] as const])));
  const alerts = (await alertStore.listAlerts({ dashboardId })).filter((a) => kept.has(a.panelId));
  const outside = alerts.filter((a) => !inScope(input.connectionScope, a.connectionId));
  if (outside.length > 0) {
    throw AppError.badRequest(`The alert "${outside[0].name}" watches a connection this would remove from the dashboard. Delete the alert or keep that connection.`);
  }
  const notChart = alerts.find((a) => kept.get(a.panelId)?.kind !== "chart");
  if (notChart) throw AppError.badRequest(`The alert "${notChart.name}" watches a panel this would turn into a ${kept.get(notChart.panelId)?.kind} panel. Delete the alert first.`);
  const bandless = alerts.find((a) => {
    const panel = kept.get(a.panelId);
    return a.config.kind === "outside_band" && panel?.kind === "chart" && panel.viz.baseline === null;
  });
  if (bandless) throw AppError.badRequest(`The alert "${bandless.name}" watches this panel's expected-range band, which this would turn off. Delete the alert first.`);
}

/** Refuse to run on a connection the dashboard is not assigned to, saying which it is assigned to. */
async function assertInScope(c: Context, scope: ConnectionScope, connectionId: string): Promise<void> {
  if (inScope(scope, connectionId)) return;
  const view = scopeView(scope, await viewerConnections(viewerOf(c)));
  const names = view.kind === "only" ? view.connections.map((conn) => conn.name) : [];
  const others = view.kind === "only" && view.hidden > 0 ? `${view.hidden} connection${view.hidden === 1 ? "" : "s"} you cannot use` : null;
  const list = [...names, ...(others ? [others] : [])].join(", ");
  throw AppError.badRequest(`This dashboard is not assigned to the connection you are on. It is assigned to ${list}.`);
}

function lintOf(detail: store.DashboardDetail): Record<string, LintFinding[]> {
  return Object.fromEntries(detail.panels.flatMap((p) => (p.kind === "chart" ? [[p.id, lintPanel(p.sql, p.viz)]] : [])));
}

/** A dashboard's chart panel, or a 404 / 400 that says why it cannot be run. */
function chartPanel(detail: store.DashboardDetail, panelId: string): store.ChartPanelRecord {
  const panel = detail.panels.find((p) => p.id === panelId);
  if (!panel) throw AppError.notFound("Panel not found");
  if (panel.kind !== "chart") throw AppError.badRequest(`This is a ${panel.kind} panel; only chart panels run queries`);
  return panel;
}

async function detailResponse(c: Context, id: string): Promise<unknown> {
  const { detail, access } = await visible(c, id);
  const pinned = await store.pinnedIds(viewerOf(c).id);
  // Counts only, for every viewer: an editor removing a panel is told its alerts go with it.
  const alertCounts: Record<string, number> = {};
  for (const alert of await alertStore.listAlerts({ dashboardId: id })) alertCounts[alert.panelId] = (alertCounts[alert.panelId] ?? 0) + 1;
  const scope = scopeView(detail.dashboard.connectionScope, await viewerConnections(viewerOf(c)));
  return { ...detail, access, pinned: pinned.has(id), lint: lintOf(detail), alertCounts, scope };
}

function saveConflict(error: unknown): never {
  if (error instanceof store.SaveConflictError) {
    throw AppError.conflict("This dashboard changed since you opened it. Reload it to see the latest version, then make your change again.");
  }
  throw error;
}

// ============================================
// Reads
// ============================================

dashboards.get("/", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const viewer = viewerOf(c);
  const pinned = await store.pinnedIds(viewer.id);
  const usable = await viewerConnections(viewer);
  const rows = (await store.listDashboards())
    .map((d) => ({ ...d, access: dashboardAccess(viewer, d, d.shares), pinned: pinned.has(d.id), scope: scopeView(d.connectionScope, usable) }))
    .filter((d) => d.access.view);
  return ok(c, rows);
});

/** Roles a dashboard can be shared with (the share dialog needs them without roles:view). */
dashboards.get("/share-targets", requirePermission(PERMISSIONS.DASHBOARDS_SHARE), async (c) => {
  const roles = await listRoles();
  return ok(c, roles.map((r) => ({ id: r.id, name: r.name, displayName: r.displayName })));
});

/** Every panel alert with its state, for Admin › Alerting. */
dashboards.get("/alerts", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const alerts = await alertStore.listAlerts();
  const statuses = await alertStore.getStatuses(alerts.map((a) => a.id));
  const titles = new Map((await store.listDashboards()).map((d) => [d.id, d.title]));
  return ok(c, alerts.map((a) => ({ ...a, status: statuses.get(a.id) ?? null, dashboardTitle: titles.get(a.dashboardId) ?? null })));
});

dashboards.get("/templates", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  return ok(c, TEMPLATES);
});

dashboards.get("/:id", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  return ok(c, await detailResponse(c, requireParam(c, "id")));
});

dashboards.get("/:id/export", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const { detail } = await visible(c, requireParam(c, "id"));
  const body: DashboardExport = { format: DASHBOARD_EXPORT_FORMAT, id: detail.dashboard.id, dashboard: store.toInput(detail) };
  return ok(c, body);
});

// ============================================
// Writes
// ============================================

dashboards.post("/", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const input = documentOf(await jsonBody(c));
  assertValid(input);
  await assertScope(c, input.connectionScope, null);
  await assertLinks(c, input);
  const id = await store.createDashboard(input, viewerOf(c).id, saveContext(c));
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, panels: input.panels.length } });
  return ok(c, await detailResponse(c, id), 201);
});

dashboards.post("/import", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const parsed = parseDashboardExport(await jsonBody(c));
  if (!parsed.ok) throw AppError.badRequest(parsed.problems[0], { problems: parsed.problems });
  const input = parsed.input;
  assertValid(input);
  // An export from another install names connections and dashboards this one may not have: refused, never dropped.
  await assertScope(c, input.connectionScope, null);
  await assertLinks(c, input);
  const id = await store.createDashboard(input, viewerOf(c).id, saveContext(c, "import"));
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_IMPORT, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, panels: input.panels.length, format: parsed.format } });
  return ok(c, await detailResponse(c, id), 201);
});

const grafanaImportSchema = z.object({ grafana: z.unknown(), connectionScope: connectionScopeSchema }).strict();

/**
 * A Grafana dashboard converted for review (ADR 0023 §14). Nothing is saved:
 * the user imports the returned document through POST /import.
 */
dashboards.post("/import/grafana", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const body = grafanaImportSchema.safeParse(await jsonBody(c));
  if (!body.success) throw AppError.badRequest(`${body.error.issues[0]?.path.join(".") || "body"}: ${body.error.issues[0]?.message ?? "invalid"}`);
  await assertScope(c, body.data.connectionScope, null);
  const result = convertGrafana(body.data.grafana, body.data.connectionScope);
  if (!result.ok) throw AppError.badRequest(result.error);
  return ok(c, result.preview);
});

/** A template copy is assigned to the connections its maker picks. */
const instantiateSchema = z.object({ connectionScope: connectionScopeSchema }).strict();

dashboards.post("/templates/:templateId/instantiate", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", instantiateSchema), async (c) => {
  const template = findTemplate(requireParam(c, "templateId"));
  if (!template) throw AppError.notFound("Template not found");
  const input: DashboardInput = { ...template.dashboard, connectionScope: c.req.valid("json").connectionScope };
  assertValid(input);
  await assertScope(c, input.connectionScope, null);
  const id = await store.createDashboard(input, viewerOf(c).id, saveContext(c, "template"));
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, template: template.id } });
  return ok(c, await detailResponse(c, id), 201);
});

dashboards.put("/:id", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", dashboardUpdateSchema), async (c) => {
  const id = requireParam(c, "id");
  const { detail, access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("You can view this dashboard but not edit it");
  const { version, dashboard } = c.req.valid("json");
  const input = documentOf(dashboard);
  assertValid(input);
  await assertScope(c, input.connectionScope, detail.dashboard.connectionScope);
  await assertAlertsInScope(id, input);
  await assertLinks(c, input);
  const result = await store.updateDashboard(id, version, input, saveContext(c)).catch(saveConflict);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_UPDATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { version: result.version, panels: input.panels.length, removedPanels: result.removedPanelIds.length, removedAlerts: result.removedAlertIds.length } });
  return ok(c, await detailResponse(c, id));
});

dashboards.post("/:id/duplicate", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const { detail } = await visible(c, requireParam(c, "id"));
  const input = { ...store.toInput(detail), title: `Copy of ${detail.dashboard.title}`.slice(0, 200) };
  await assertScope(c, input.connectionScope, detail.dashboard.connectionScope);
  await assertLinks(c, input);
  const id = await store.createDashboard(input, viewerOf(c).id, saveContext(c, "duplicate"));
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, duplicateOf: detail.dashboard.id } });
  return ok(c, await detailResponse(c, id), 201);
});

dashboards.delete("/:id", requirePermission(PERMISSIONS.DASHBOARDS_DELETE), async (c) => {
  const id = requireParam(c, "id");
  const { detail, access } = await visible(c, id);
  if (!access.delete) throw AppError.forbidden("Only the owner or a dashboard manager can delete this dashboard");
  const removedAlerts = await store.deleteDashboard(id).catch((error: unknown) => {
    if (error instanceof store.SaveConflictError) throw AppError.notFound("Dashboard not found");
    throw error;
  });
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_DELETE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: detail.dashboard.title, removedAlerts: removedAlerts.length } });
  return ok(c, { deleted: id });
});

const sharesSchema = z.object({
  shares: z.array(z.object({ roleId: z.string().min(1), canEdit: z.boolean() }).strict()).max(50),
}).strict();

dashboards.put("/:id/shares", requirePermission(PERMISSIONS.DASHBOARDS_SHARE), zValidator("json", sharesSchema), async (c) => {
  const id = requireParam(c, "id");
  const { access } = await visible(c, id);
  if (!access.share) throw AppError.forbidden("Only the owner or a dashboard manager can share this dashboard");
  const { shares } = c.req.valid("json");
  const roleIds = shares.map((s) => s.roleId);
  if (new Set(roleIds).size !== roleIds.length) throw AppError.badRequest("A role is listed twice");
  const known = await store.existingRoleIds(roleIds);
  const unknown = roleIds.filter((r) => !known.has(r));
  if (unknown.length > 0) throw AppError.badRequest(`Unknown role: ${unknown.join(", ")}`);
  await store.setShares(id, shares).catch(saveConflict);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_SHARE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { shares } });
  return ok(c, await detailResponse(c, id));
});

dashboards.post("/:id/pin", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const id = requireParam(c, "id");
  await visible(c, id);
  await store.pin(viewerOf(c).id, id);
  return ok(c, { pinned: true });
});

dashboards.delete("/:id/pin", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const id = requireParam(c, "id");
  await visible(c, id);
  await store.unpin(viewerOf(c).id, id);
  return ok(c, { pinned: false });
});

// ============================================
// Running panels
// ============================================

const runSchema = z.object({
  range: timeRangeSchema,
  values: variableValuesSchema,
  /** Compare: run the same window this many seconds ago (ADR 0023 §8). */
  shiftSeconds: z.union([z.literal(SHIFT_SECONDS[0]), z.literal(SHIFT_SECONDS[1])]).optional(),
}).strict();

/** Why a panel cannot be compared with an earlier window (null when it can). */
function compareProblem(panel: store.ChartPanelRecord): string | null {
  if (panel.fleet) return "Compare runs on one connection; this panel runs across the fleet";
  if (!TIME_SERIES_TYPES.has(panel.viz.type)) return "Compare needs a line or area chart";
  if (panel.viz.series !== null) return "Compare needs a chart without a split by series";
  return null;
}

function requireQueryExecute(c: Context): void {
  if (!has(viewerOf(c), PERMISSIONS.QUERY_EXECUTE)) throw AppError.forbidden("Running panels needs query:execute");
}

/**
 * A fleet panel runs on every connection the dashboard is assigned to that the
 * viewer may use; any other panel on the current one, if it is assigned.
 */
type RunResult = ({ kind: "fleet" } & FleetRun) | ({ kind: "single" } & PanelRun);

async function runQuery(c: Context, query: PanelQuery, fleet: boolean, scope: ConnectionScope, shiftSeconds: ShiftSeconds | 0 = 0): Promise<RunResult> {
  markAgentRecorded(c);
  if (fleet) return { kind: "fleet", ...(await runFleet(viewerOf(c), query, agentFor(c), scope)) };
  const connectionId = currentConnectionId(c);
  await assertInScope(c, scope, connectionId);
  return { kind: "single", ...(await runPanel(viewerOf(c), connectionId, query, agentFor(c), Date.now(), shiftSeconds)) };
}

dashboards.post("/:id/panels/:panelId/run", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), zValidator("json", runSchema), async (c) => {
  requireQueryExecute(c);
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const panel = chartPanel(detail, requireParam(c, "panelId"));
  const { range, values, shiftSeconds } = c.req.valid("json");
  if (shiftSeconds !== undefined) {
    const problem = compareProblem(panel);
    if (problem) throw AppError.badRequest(problem);
  }
  const query: PanelQuery = { sql: panel.sql, variables: detail.dashboard.variables, values, range, dashboardId: id, panelId: panel.id };
  return ok(c, await runQuery(c, query, panel.fleet, detail.dashboard.connectionScope, shiftSeconds ?? 0));
});

// ============================================
// Panel cost and rollups (ADR 0023 §10)
// ============================================

const GIB = 1024 ** 3;
const costSchema = z.object({ range: timeRangeSchema, values: variableValuesSchema }).strict();

/** What one run of the panel reads, what that comes to per hour at the dashboard's refresh, and whether a rollup could serve it. */
dashboards.post("/:id/panels/:panelId/cost", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), zValidator("json", costSchema), async (c) => {
  requireQueryExecute(c);
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const panel = chartPanel(detail, requireParam(c, "panelId"));
  const { range, values } = c.req.valid("json");
  const query: PanelQuery = { sql: panel.sql, variables: detail.dashboard.variables, values, range, dashboardId: id, panelId: panel.id };
  const result = await runQuery(c, query, panel.fleet, detail.dashboard.connectionScope);
  const runs = result.kind === "single" ? [result.data] : result.connections.flatMap((e) => (e.ok ? [e.data] : []));
  const readBytes = runs.reduce((sum, d) => sum + d.readBytes, 0);
  const readRows = runs.reduce((sum, d) => sum + d.readRows, 0);
  const elapsedMs = Math.max(0, ...runs.map((d) => d.elapsedMs));
  const refreshSeconds = detail.dashboard.refreshSeconds;
  const readsPerHour = refreshSeconds > 0 ? 3600 / refreshSeconds : 0;
  const bytesPerHour = readBytes * readsPerHour;
  const analysis = readsRollup(panel.sql) ? { ok: false as const, reason: "it already reads a rollup" } : panel.fleet ? { ok: false as const, reason: "it runs across the fleet; a rollup is made on one connection" } : analyzeRollup(panel.sql);
  return ok(c, {
    readBytes, readRows, elapsedMs, cached: result.kind === "single" ? result.cached : false, refreshSeconds, readsPerHour, bytesPerHour,
    heavy: readBytes > GIB || bytesPerHour > 100 * GIB,
    rollup: analysis.ok ? { eligible: true, target: `${analysis.plan.database}.${rollupTarget(analysis.plan)}`, source: `${analysis.plan.database}.${analysis.plan.table}` } : { eligible: false, reason: analysis.reason },
  });
});

const rollupSchema = z.object({ backfillDays: z.number().int().min(1).max(30), cluster: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).nullable() }).strict();

/** Propose the panel's rollup as a remediation action (approval class 2); nothing runs until it is approved. */
dashboards.post("/:id/panels/:panelId/rollup", requirePermission(PERMISSIONS.REMEDIATION_PROPOSE), zValidator("json", rollupSchema), async (c) => {
  requireQueryExecute(c);
  const id = requireParam(c, "id");
  const { detail, access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("Rolling up a panel changes its query, which needs edit access to the dashboard");
  const panel = chartPanel(detail, requireParam(c, "panelId"));
  if (panel.fleet) throw AppError.badRequest("A fleet panel runs on many connections; a rollup is made on one");
  const analysis = analyzeRollup(panel.sql);
  if (!analysis.ok) throw AppError.badRequest(`This panel cannot be rolled up: ${analysis.reason}`);
  const connectionId = currentConnectionId(c);
  await assertInScope(c, detail.dashboard.connectionScope, connectionId);
  const connection = await viewerConnection(viewerOf(c), connectionId);
  // The proposer must be able to read the table the rollup copies.
  await assertDataAccess(viewerOf(c), compilePanel({ sql: panel.sql, variables: detail.dashboard.variables, values: {}, range: { kind: "relative", value: "1h" }, dashboardId: id, panelId: panel.id }, resolveWindow({ kind: "relative", value: "1h" }, Date.now())), connection);
  const { backfillDays, cluster } = c.req.valid("json");
  const params = { type: "create_panel_rollup" as const, dashboardId: id, panelId: panel.id, ...analysis.plan, target: rollupTarget(analysis.plan), backfillDays, cluster };
  let action: Awaited<ReturnType<typeof proposeAction>>;
  try {
    action = await proposeAction({
      connectionId,
      params,
      title: `Roll up "${panel.title}" on ${detail.dashboard.title}`,
      rationale: `Serve the panel from 1-minute pre-aggregates of ${analysis.plan.database}.${analysis.plan.table} instead of scanning it on every refresh.`,
      proposedBy: viewerOf(c).id,
      proposedSource: c.get("authMethod") === "pat" ? "mcp" : "user",
    });
  } catch (error) {
    if (error instanceof RemediationError) throw error.code === "forbidden" ? AppError.forbidden(error.message) : AppError.badRequest(error.message);
    throw error;
  }
  void postApprovalRequest(action);
  return ok(c, action, 201);
});

// ============================================
// Expected-range bands (ADR 0023 §8)
// ============================================

const baselineSchema = z.object({ range: timeRangeSchema, values: variableValuesSchema }).strict();

/** The panel's band over the current window: ready with points, or learning with the reason. */
dashboards.post("/:id/panels/:panelId/baseline", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), zValidator("json", baselineSchema), async (c) => {
  requireQueryExecute(c);
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const panel = chartPanel(detail, requireParam(c, "panelId"));
  if (panel.viz.baseline === null || panel.viz.x === null) throw AppError.badRequest("This panel does not draw an expected-range band");
  if (panel.fleet) throw AppError.badRequest("A fleet panel cannot draw an expected-range band");
  const connectionId = currentConnectionId(c);
  await assertInScope(c, detail.dashboard.connectionScope, connectionId);
  markAgentRecorded(c);
  const { range, values } = c.req.valid("json");
  const query: PanelQuery = { sql: panel.sql, variables: detail.dashboard.variables, values, range, dashboardId: id, panelId: panel.id };
  const { baseline } = await runBaseline({ viewer: viewerOf(c), connectionId, query, xColumn: panel.viz.x, yColumn: panel.viz.y[0], weeks: panel.viz.baseline.weeks, agentFor: agentFor(c), nowMs: Date.now() });
  return ok(c, baseline);
});

// ============================================
// Annotations and notes (ADR 0023 §5)
// ============================================

const annotationsSchema = z.object({
  range: timeRangeSchema,
  sources: annotationSourcesSchema,
}).strict();

/** What changed in the range, per source, on the connection the caller is on. */
dashboards.post("/:id/annotations", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), zValidator("json", annotationsSchema), async (c) => {
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const connectionId = currentConnectionId(c);
  await assertInScope(c, detail.dashboard.connectionScope, connectionId);
  await viewerConnection(viewerOf(c), connectionId);
  const { range, sources } = c.req.valid("json");
  const window = resolveWindow(range, Date.now());
  return ok(c, { sources: await loadAnnotations({ viewer: viewerOf(c), connectionId, dashboardId: id, fromMs: window.from * 1000, toMs: window.to * 1000 }, sources) });
});

const noteSchema = z.object({
  /** Unix milliseconds. */
  at: z.number().int().positive(),
  text: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
}).strict();

dashboards.post("/:id/notes", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", noteSchema), async (c) => {
  const id = requireParam(c, "id");
  const { detail, access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("Notes on a dashboard need edit access to it");
  const connectionId = currentConnectionId(c);
  await assertInScope(c, detail.dashboard.connectionScope, connectionId);
  await viewerConnection(viewerOf(c), connectionId);
  const { at, text } = c.req.valid("json");
  const note = await addNote(id, connectionId, at, text, viewerOf(c).id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_NOTE_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { noteId: note.id, connectionId } });
  return ok(c, note, 201);
});

/** A note's author may delete it, as may anyone who can edit the dashboard. */
dashboards.delete("/:id/notes/:noteId", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const id = requireParam(c, "id");
  const { access } = await visible(c, id);
  const note = await getNote(id, requireParam(c, "noteId"));
  if (!note) throw AppError.notFound("Note not found");
  if (!access.edit && note.authorId !== viewerOf(c).id) throw AppError.forbidden("Only the note's author or an editor of the dashboard can delete it");
  await deleteNote(note.id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_NOTE_DELETE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { noteId: note.id } });
  return ok(c, { deleted: note.id });
});

// ============================================
// Snapshots (ADR 0023 §12)
// ============================================

const snapshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Unix seconds. */
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  values: variableValuesSchema,
  roleIds: z.array(z.string().min(1)).max(50),
  expiresInDays: z.number().int().min(snapshots.MIN_EXPIRY_DAYS).max(snapshots.MAX_EXPIRY_DAYS),
  incidentId: z.string().min(1).nullable(),
}).strict();

/** Freeze every chart panel's result for an absolute range, on the connection you are on. */
dashboards.post("/:id/snapshots", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), zValidator("json", snapshotSchema), async (c) => {
  requireQueryExecute(c);
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const connectionId = currentConnectionId(c);
  await assertInScope(c, detail.dashboard.connectionScope, connectionId);
  markAgentRecorded(c);
  const body = c.req.valid("json");
  const snapshot = await snapshots.createSnapshot({ viewer: viewerOf(c), detail, connectionId, ...body, agentFor: agentFor(c) });
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_SNAPSHOT_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { snapshotId: snapshot.id, connectionId, sizeBytes: snapshot.sizeBytes, roles: snapshot.roleIds.length, expiresAt: snapshot.expiresAt } });
  return ok(c, snapshot, 201);
});

dashboards.get("/:id/snapshots", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const { detail } = await visible(c, requireParam(c, "id"));
  return ok(c, await snapshots.listSnapshots(viewerOf(c), detail));
});

dashboards.get("/:id/snapshots/:snapshotId", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const { detail } = await visible(c, requireParam(c, "id"));
  return ok(c, await snapshots.openSnapshot(viewerOf(c), detail, requireParam(c, "snapshotId")));
});

dashboards.delete("/:id/snapshots/:snapshotId", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const deleted = await snapshots.deleteSnapshot(viewerOf(c), detail, requireParam(c, "snapshotId"));
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_SNAPSHOT_DELETE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { snapshotId: deleted.id } });
  return ok(c, { deleted: deleted.id });
});

dashboards.post("/:id/variables/:name/options", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  requireQueryExecute(c);
  const { detail } = await visible(c, requireParam(c, "id"));
  const variable = detail.dashboard.variables.find((v) => v.name === requireParam(c, "name"));
  if (!variable) throw AppError.notFound("Variable not found");
  if (variable.options.source === "static") return ok(c, { values: variable.options.values });
  const connectionId = currentConnectionId(c);
  await assertInScope(c, detail.dashboard.connectionScope, connectionId);
  markAgentRecorded(c);
  return ok(c, { values: await runOptions(viewerOf(c), connectionId, variable.options.sql, agentFor(c)) });
});

// ============================================
// Editor: lint and preview for unsaved panels
// ============================================

const lintSchema = z.object({ sql: z.string().trim().min(1).max(MAX_SQL_LENGTH), viz: vizSpecSchema }).strict();

dashboards.post("/lint", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", lintSchema), async (c) => {
  const { sql, viz } = c.req.valid("json");
  return ok(c, { findings: lintPanel(sql, viz) });
});

const previewSchema = z.object({
  sql: z.string().trim().min(1).max(MAX_SQL_LENGTH),
  viz: vizSpecSchema,
  fleet: z.boolean(),
  variables: z.array(variableSchema).max(10),
  values: variableValuesSchema,
  range: timeRangeSchema,
  /** The edit session's connections, saved or not. */
  connectionScope: connectionScopeSchema,
}).strict();

dashboards.post("/preview", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", previewSchema), async (c) => {
  requireQueryExecute(c);
  const body = c.req.valid("json");
  const problems = panelProblems(body, body.variables);
  if (problems.length > 0) throw AppError.badRequest(problems[0], { problems });
  const query: PanelQuery = { sql: body.sql, variables: body.variables, values: body.values, range: body.range, dashboardId: null, panelId: "preview" };
  const result = await runQuery(c, query, body.fleet, body.connectionScope);
  // Chart fit reads a real result; a fleet preview has one per connection, so it is checked on a single run only.
  const fit = result.kind === "single" ? chartFit(body.viz, result.data) : [];
  return ok(c, { result, lint: [...lintPanel(body.sql, body.viz), ...fit] });
});

// ============================================
// Layout engine (ADR 0023 §4): AI drafts, Tidy up, Pin to dashboard
// ============================================

const sizeSchema = z.object({ w: z.number().int().min(1).max(GRID_COLUMNS), h: z.number().int().min(1).max(MAX_PANEL_ROWS) }).strict();
const itemKey = z.string().min(1).max(100);

const arrangeRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("arrange"),
    sections: z.array(z.object({
      heading: z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(500) }).strict().nullable(),
      panels: z.array(z.object({
        key: itemKey,
        kind: z.enum(["chart", "text"]),
        chartType: z.enum(CHART_TYPES).nullable(),
        role: z.enum(ROLES).nullable(),
        importance: z.enum(IMPORTANCES),
        size: sizeSchema.nullable(),
      }).strict()).max(MAX_PANELS),
    }).strict()).max(MAX_PANELS),
  }).strict(),
  z.object({
    mode: z.literal("tidy"),
    panels: z.array(z.object({ key: itemKey, kind: z.enum(PANEL_KINDS), chartType: z.enum(CHART_TYPES).nullable(), size: sizeSchema }).strict()).max(MAX_PANELS),
  }).strict(),
]);

type PlacedOut = { key: string; layout: Layout } | { key: null; heading: { title: string; description: string }; layout: Layout };

/**
 * Places panels with the layout engine. `arrange` takes sections of new panels
 * with their roles (an AI draft); `tidy` lays out an existing dashboard's
 * panels again. Pure: nothing is saved — the caller saves the result.
 */
dashboards.post("/layout", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", arrangeRequestSchema), async (c) => {
  const body = c.req.valid("json");
  const keys = body.mode === "tidy" ? body.panels.map((p) => p.key) : body.sections.flatMap((s) => s.panels.map((p) => p.key));
  if (new Set(keys).size !== keys.length) throw AppError.badRequest("A panel key is listed twice");
  if (body.mode === "tidy") {
    for (const p of body.panels) {
      if ((p.kind === "chart") !== (p.chartType !== null)) throw AppError.badRequest(`Panel ${p.key}: a chart panel needs its chart type, and only a chart panel has one`);
    }
    const placed = tidy(body.panels.map((p) => ({ ref: p.key, kind: p.kind, chartType: p.chartType, size: p.size })));
    return ok(c, { placed: placed.map((p): PlacedOut => ({ key: p.ref, layout: p.layout })) });
  }
  type Ref = { key: string } | { heading: { title: string; description: string } };
  const sections: ArrangeSection<Ref>[] = body.sections.map((section) => ({
    heading: section.heading ? { heading: section.heading } : null,
    items: section.panels.map((p) => {
      if (p.kind === "chart") {
        if (p.chartType === null || p.role === null) throw AppError.badRequest(`Panel ${p.key}: a chart panel needs its chart type and role`);
        const misfit = roleProblem(p.role, p.chartType);
        if (misfit) throw AppError.badRequest(`Panel ${p.key}: ${misfit}`);
      } else if (p.role !== null || p.chartType !== null) {
        throw AppError.badRequest(`Panel ${p.key}: a text panel has no chart type or role`);
      }
      return { ref: { key: p.key }, kind: p.kind, role: p.role, importance: p.importance, size: p.size };
    }),
  }));
  const placed = arrange(sections);
  if (placed.length > MAX_PANELS) throw AppError.badRequest(`With their headings these come to ${placed.length} panels; a dashboard can have at most ${MAX_PANELS}`);
  return ok(c, { placed: placed.map((p): PlacedOut => ("key" in p.ref ? { key: p.ref.key, layout: p.layout } : { key: null, heading: p.ref.heading, layout: p.layout })) });
});

// ============================================
// Version history (ADR 0023 §11)
// ============================================

function versionParam(c: Context): number {
  const version = Number(requireParam(c, "version"));
  if (!Number.isInteger(version) || version < 1) throw AppError.badRequest("A version is a positive whole number");
  return version;
}

dashboards.get("/:id/versions", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const id = requireParam(c, "id");
  await visible(c, id);
  return ok(c, await store.listVersions(id));
});

dashboards.get("/:id/versions/:version", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  const id = requireParam(c, "id");
  await visible(c, id);
  const version = await store.getVersion(id, versionParam(c));
  if (!version) throw AppError.notFound("That version is not kept (a dashboard keeps its last 50)");
  return ok(c, version);
});

/** What restoring a version would remove: panels the old version does not have, and their alerts. */
dashboards.get("/:id/versions/:version/restore-preview", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const id = requireParam(c, "id");
  const { access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("You can view this dashboard but not edit it");
  const version = await store.getVersion(id, versionParam(c));
  if (!version) throw AppError.notFound("That version is not kept (a dashboard keeps its last 50)");
  const { removedPanelIds, removedAlertIds } = await store.removals(id, version.document);
  const alerts = (await alertStore.listAlerts({ dashboardId: id })).filter((a) => removedAlertIds.includes(a.id));
  return ok(c, { removedPanels: removedPanelIds.length, removedAlerts: alerts.map((a) => ({ id: a.id, name: a.name })) });
});

const restoreSchema = z.object({ currentVersion: z.number().int().positive() }).strict();

/** Save an old version's document as the newest version. Every save check applies again. */
dashboards.post("/:id/versions/:version/restore", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", restoreSchema), async (c) => {
  const id = requireParam(c, "id");
  const { detail, access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("You can view this dashboard but not edit it");
  const old = await store.getVersion(id, versionParam(c));
  if (!old) throw AppError.notFound("That version is not kept (a dashboard keeps its last 50)");
  const input = old.document;
  assertValid(input);
  await assertScope(c, input.connectionScope, detail.dashboard.connectionScope);
  await assertAlertsInScope(id, input);
  await assertLinks(c, input);
  const result = await store.updateDashboard(id, c.req.valid("json").currentVersion, input, saveContext(c, "restore")).catch(saveConflict);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_RESTORE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { version: result.version, restoredFrom: old.version, removedPanels: result.removedPanelIds.length, removedAlerts: result.removedAlertIds.length } });
  return ok(c, await detailResponse(c, id));
});

// ============================================
// Panel alerts (ADR 0021 §7)
// ============================================

async function editableForAlerts(c: Context, id: string): Promise<store.DashboardDetail> {
  const { detail, access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("Alerts on a dashboard need edit access to it");
  return detail;
}

/** Refuse an alert that could never evaluate, before it is saved. */
async function assertAlertValid(c: Context, detail: store.DashboardDetail, panelId: string, input: alertStore.AlertInput): Promise<void> {
  const panel = chartPanel(detail, panelId);
  if (panel.fleet) throw AppError.badRequest("Alerts need a panel for one connection; this one runs across the fleet");
  await assertInScope(c, detail.dashboard.connectionScope, input.connectionId);
  if (!panel.viz.y.includes(input.config.column)) {
    throw AppError.badRequest(panel.viz.y.length === 0
      ? "Alerts need a chart panel with a y column"
      : `Alert on one of the panel's y columns: ${panel.viz.y.join(", ")}`);
  }
  if (input.config.kind === "outside_band" && panel.viz.baseline === null) {
    throw AppError.badRequest("An expected-range alert needs a panel that draws an expected-range band; turn the band on in the panel's chart settings first");
  }
  resolveValues(detail.dashboard.variables, input.config.values);
  await viewerConnection(viewerOf(c), input.connectionId);
  for (const channelId of input.channelIds) {
    if (!(await getChannel(channelId))) throw AppError.badRequest(`Unknown notification channel: ${channelId}`);
  }
  if (new Set(input.channelIds).size !== input.channelIds.length) throw AppError.badRequest("A channel is listed twice");
}

dashboards.get("/:id/alerts", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const id = requireParam(c, "id");
  await visible(c, id);
  const alerts = await alertStore.listAlerts({ dashboardId: id });
  const statuses = await alertStore.getStatuses(alerts.map((a) => a.id));
  return ok(c, alerts.map((a) => ({ ...a, status: statuses.get(a.id) ?? null })));
});

dashboards.post("/:id/panels/:panelId/alerts", requirePermission(PERMISSIONS.ALERTING_EDIT), zValidator("json", alertStore.alertInputSchema), async (c) => {
  const id = requireParam(c, "id");
  const panelId = requireParam(c, "panelId");
  const detail = await editableForAlerts(c, id);
  const input = c.req.valid("json");
  await assertAlertValid(c, detail, panelId, input);
  const alertId = await alertStore.createAlert(id, panelId, viewerOf(c).id, input);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.PANEL_ALERT_CREATE, viewerOf(c).id, { resourceType: "dashboard_alert", resourceId: alertId, details: { dashboardId: id, panelId, name: input.name } });
  return ok(c, await alertStore.getAlert(alertId), 201);
});

async function alertOf(c: Context, dashboardId: string): Promise<alertStore.PanelAlert> {
  const alert = await alertStore.getAlert(requireParam(c, "alertId"));
  if (!alert || alert.dashboardId !== dashboardId) throw AppError.notFound("Alert not found");
  return alert;
}

dashboards.put("/:id/alerts/:alertId", requirePermission(PERMISSIONS.ALERTING_EDIT), zValidator("json", alertStore.alertInputSchema), async (c) => {
  const id = requireParam(c, "id");
  const detail = await editableForAlerts(c, id);
  const alert = await alertOf(c, id);
  const input = c.req.valid("json");
  await assertAlertValid(c, detail, alert.panelId, input);
  await alertStore.updateAlert(alert.id, viewerOf(c).id, input);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.PANEL_ALERT_UPDATE, viewerOf(c).id, { resourceType: "dashboard_alert", resourceId: alert.id, details: { dashboardId: id, name: input.name, enabled: input.enabled } });
  return ok(c, await alertStore.getAlert(alert.id));
});

dashboards.delete("/:id/alerts/:alertId", requirePermission(PERMISSIONS.ALERTING_DELETE), async (c) => {
  const id = requireParam(c, "id");
  await editableForAlerts(c, id);
  const alert = await alertOf(c, id);
  await alertStore.deleteAlert(alert.id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.PANEL_ALERT_DELETE, viewerOf(c).id, { resourceType: "dashboard_alert", resourceId: alert.id, details: { dashboardId: id, name: alert.name } });
  return ok(c, { deleted: alert.id });
});

/** Evaluate an alert now without changing its state or notifying anyone. */
dashboards.post("/:id/alerts/:alertId/check", requirePermission(PERMISSIONS.ALERTING_EDIT), async (c) => {
  const id = requireParam(c, "id");
  await editableForAlerts(c, id);
  const alert = await alertOf(c, id);
  const { outcome } = await evaluate(alert, Date.now());
  return ok(c, outcome);
});

// ============================================
// Scheduled reports (ADR 0023 §13)
// ============================================

const reportInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  connectionId: z.string().min(1),
  schedule: reportScheduleSchema,
  range: reportRangeSchema,
  onlyIfAlert: z.boolean(),
  enabled: z.boolean(),
  channelIds: z.array(z.string().min(1)).min(1).max(20),
}).strict();

/** Refuse a report that could never send, before it is saved. */
async function assertReportValid(c: Context, detail: store.DashboardDetail, input: reports.ReportInput): Promise<void> {
  if (!reports.publicBaseUrl()) throw AppError.badRequest("Reports link back to the dashboard, which needs PUBLIC_BASE_URL set on the server");
  await assertInScope(c, detail.dashboard.connectionScope, input.connectionId);
  await viewerConnection(viewerOf(c), input.connectionId);
  if (!has(viewerOf(c), PERMISSIONS.QUERY_EXECUTE)) throw AppError.forbidden("A report runs the dashboard's panels as you, which needs query:execute");
  if (new Set(input.channelIds).size !== input.channelIds.length) throw AppError.badRequest("A channel is listed twice");
  for (const channelId of input.channelIds) {
    if (!(await getChannel(channelId))) throw AppError.badRequest(`Unknown notification channel: ${channelId}`);
  }
}

async function reportOf(c: Context, dashboardId: string): Promise<reports.Report> {
  const report = await reports.getReport(dashboardId, requireParam(c, "reportId"));
  if (!report) throw AppError.notFound("Report not found");
  return report;
}

dashboards.get("/:id/reports", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const id = requireParam(c, "id");
  await visible(c, id);
  return ok(c, { reports: await reports.listReports(id), publicBaseUrl: reports.publicBaseUrl() !== null });
});

dashboards.post("/:id/reports", requirePermission(PERMISSIONS.ALERTING_EDIT), zValidator("json", reportInputSchema), async (c) => {
  const id = requireParam(c, "id");
  const detail = await editableForAlerts(c, id);
  const input = c.req.valid("json");
  await assertReportValid(c, detail, input);
  const report = await reports.createReport(id, viewerOf(c).id, input);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_REPORT_CREATE, viewerOf(c).id, { resourceType: "dashboard_report", resourceId: report.id, details: { dashboardId: id, name: input.name, channels: input.channelIds.length } });
  return ok(c, report, 201);
});

dashboards.put("/:id/reports/:reportId", requirePermission(PERMISSIONS.ALERTING_EDIT), zValidator("json", reportInputSchema), async (c) => {
  const id = requireParam(c, "id");
  const detail = await editableForAlerts(c, id);
  const report = await reportOf(c, id);
  const input = c.req.valid("json");
  await assertReportValid(c, detail, input);
  const updated = await reports.updateReport(id, report.id, viewerOf(c).id, input);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_REPORT_UPDATE, viewerOf(c).id, { resourceType: "dashboard_report", resourceId: report.id, details: { dashboardId: id, name: input.name, enabled: input.enabled } });
  return ok(c, updated);
});

dashboards.delete("/:id/reports/:reportId", requirePermission(PERMISSIONS.ALERTING_DELETE), async (c) => {
  const id = requireParam(c, "id");
  await editableForAlerts(c, id);
  const report = await reportOf(c, id);
  await reports.deleteReport(report.id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_REPORT_DELETE, viewerOf(c).id, { resourceType: "dashboard_report", resourceId: report.id, details: { dashboardId: id, name: report.name } });
  return ok(c, { deleted: report.id });
});

/** Send a report now, as its owner, to its channels. The schedule is left as it is. */
dashboards.post("/:id/reports/:reportId/send", requirePermission(PERMISSIONS.ALERTING_EDIT), async (c) => {
  const id = requireParam(c, "id");
  await editableForAlerts(c, id);
  const report = await reportOf(c, id);
  const outcome = await reports.runReport(report, Date.now(), false);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_REPORT_SEND, viewerOf(c).id, { resourceType: "dashboard_report", resourceId: report.id, details: { dashboardId: id, status: outcome.status } });
  return ok(c, outcome);
});

export default dashboards;
