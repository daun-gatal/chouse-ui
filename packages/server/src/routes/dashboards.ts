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
import { dashboardAccess, has, type DashboardAccess, type Viewer } from "../services/dashboards/access";
import { lintPanel, type LintFinding } from "../services/dashboards/lint";
import { resolveValues, runFleet, runOptions, runPanel, viewerConnection, type AgentFor, type PanelQuery } from "../services/dashboards/runner";
import {
  DASHBOARD_EXPORT_FORMAT,
  dashboardExportSchema,
  dashboardInputSchema,
  dashboardUpdateSchema,
  MAX_SQL_LENGTH,
  timeRangeSchema,
  variableSchema,
  vizSpecSchema,
  type DashboardExport,
  type DashboardInput,
} from "../services/dashboards/spec";
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

function toInput(detail: store.DashboardDetail): DashboardInput {
  const { dashboard, panels } = detail;
  return {
    title: dashboard.title,
    description: dashboard.description,
    timeRange: dashboard.timeRange,
    refreshSeconds: dashboard.refreshSeconds as DashboardInput["refreshSeconds"],
    variables: dashboard.variables,
    panels: panels.map((p) => ({ id: p.id, title: p.title, sql: p.sql, viz: p.viz, width: p.width, height: p.height, fleet: p.fleet })),
  };
}

function lintOf(detail: store.DashboardDetail): Record<string, LintFinding[]> {
  return Object.fromEntries(detail.panels.map((p) => [p.id, lintPanel(p.sql, p.viz)]));
}

async function detailResponse(c: Context, id: string): Promise<unknown> {
  const { detail, access } = await visible(c, id);
  const pinned = await store.pinnedIds(viewerOf(c).id);
  // Counts only, for every viewer: an editor removing a panel is told its alerts go with it.
  const alertCounts: Record<string, number> = {};
  for (const alert of await alertStore.listAlerts({ dashboardId: id })) alertCounts[alert.panelId] = (alertCounts[alert.panelId] ?? 0) + 1;
  return { ...detail, access, pinned: pinned.has(id), lint: lintOf(detail), alertCounts };
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
  const rows = (await store.listDashboards())
    .map((d) => ({ ...d, access: dashboardAccess(viewer, d, d.shares), pinned: pinned.has(d.id) }))
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
  const body: DashboardExport = { format: DASHBOARD_EXPORT_FORMAT, id: detail.dashboard.id, dashboard: toInput(detail) };
  return ok(c, body);
});

// ============================================
// Writes
// ============================================

dashboards.post("/", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", dashboardInputSchema), async (c) => {
  const input = c.req.valid("json");
  assertValid(input);
  const id = await store.createDashboard(input, viewerOf(c).id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, panels: input.panels.length } });
  return ok(c, await detailResponse(c, id), 201);
});

dashboards.post("/import", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", dashboardExportSchema), async (c) => {
  const { dashboard: input } = c.req.valid("json");
  assertValid(input);
  const id = await store.createDashboard(input, viewerOf(c).id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_IMPORT, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, panels: input.panels.length } });
  return ok(c, await detailResponse(c, id), 201);
});

dashboards.post("/templates/:templateId/instantiate", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const template = findTemplate(requireParam(c, "templateId"));
  if (!template) throw AppError.notFound("Template not found");
  const input: DashboardInput = template.dashboard;
  assertValid(input);
  const id = await store.createDashboard(input, viewerOf(c).id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_CREATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { title: input.title, template: template.id } });
  return ok(c, await detailResponse(c, id), 201);
});

dashboards.put("/:id", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", dashboardUpdateSchema), async (c) => {
  const id = requireParam(c, "id");
  const { access } = await visible(c, id);
  if (!access.edit) throw AppError.forbidden("You can view this dashboard but not edit it");
  const { version, dashboard: input } = c.req.valid("json");
  assertValid(input);
  const result = await store.updateDashboard(id, version, input).catch(saveConflict);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.DASHBOARD_UPDATE, viewerOf(c).id, { resourceType: "dashboard", resourceId: id, details: { version: result.version, panels: input.panels.length, removedPanels: result.removedPanelIds.length, removedAlerts: result.removedAlertIds.length } });
  return ok(c, await detailResponse(c, id));
});

dashboards.post("/:id/duplicate", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), async (c) => {
  const { detail } = await visible(c, requireParam(c, "id"));
  const input = { ...toInput(detail), title: `Copy of ${detail.dashboard.title}`.slice(0, 200) };
  const id = await store.createDashboard(input, viewerOf(c).id);
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

const valuesSchema = z.record(z.string().max(500));

const runSchema = z.object({
  range: timeRangeSchema,
  values: valuesSchema,
}).strict();

function requireQueryExecute(c: Context): void {
  if (!has(viewerOf(c), PERMISSIONS.QUERY_EXECUTE)) throw AppError.forbidden("Running panels needs query:execute");
}

/** A fleet panel runs on every connection the viewer may use; any other on the current one. */
async function runQuery(c: Context, query: PanelQuery, fleet: boolean): Promise<unknown> {
  markAgentRecorded(c);
  if (fleet) return { kind: "fleet", ...(await runFleet(viewerOf(c), query, agentFor(c))) };
  return { kind: "single", ...(await runPanel(viewerOf(c), currentConnectionId(c), query, agentFor(c))) };
}

dashboards.post("/:id/panels/:panelId/run", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), zValidator("json", runSchema), async (c) => {
  requireQueryExecute(c);
  const id = requireParam(c, "id");
  const { detail } = await visible(c, id);
  const panel = detail.panels.find((p) => p.id === requireParam(c, "panelId"));
  if (!panel) throw AppError.notFound("Panel not found");
  const { range, values } = c.req.valid("json");
  const query: PanelQuery = { sql: panel.sql, variables: detail.dashboard.variables, values, range, dashboardId: id, panelId: panel.id };
  return ok(c, await runQuery(c, query, panel.fleet));
});

dashboards.post("/:id/variables/:name/options", requirePermission(PERMISSIONS.DASHBOARDS_VIEW), async (c) => {
  requireQueryExecute(c);
  const { detail } = await visible(c, requireParam(c, "id"));
  const variable = detail.dashboard.variables.find((v) => v.name === requireParam(c, "name"));
  if (!variable) throw AppError.notFound("Variable not found");
  if (variable.options.source === "static") return ok(c, { values: variable.options.values });
  const connectionId = currentConnectionId(c);
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
  values: valuesSchema,
  range: timeRangeSchema,
}).strict();

dashboards.post("/preview", requirePermission(PERMISSIONS.DASHBOARDS_EDIT), zValidator("json", previewSchema), async (c) => {
  requireQueryExecute(c);
  const body = c.req.valid("json");
  const problems = panelProblems(body, body.variables);
  if (problems.length > 0) throw AppError.badRequest(problems[0], { problems });
  const query: PanelQuery = { sql: body.sql, variables: body.variables, values: body.values, range: body.range, dashboardId: null, panelId: "preview" };
  const result = await runQuery(c, query, body.fleet);
  return ok(c, { result, lint: lintPanel(body.sql, body.viz) });
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
  const panel = detail.panels.find((p) => p.id === panelId);
  if (!panel) throw AppError.notFound("Panel not found");
  if (panel.fleet) throw AppError.badRequest("Alerts need a panel for one connection; this one runs across the fleet");
  if (!panel.viz.y.includes(input.config.column)) {
    throw AppError.badRequest(panel.viz.y.length === 0
      ? "Alerts need a chart panel with a y column"
      : `Alert on one of the panel's y columns: ${panel.viz.y.join(", ")}`);
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

export default dashboards;
