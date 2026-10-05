/**
 * `/api/context` — the context engine (ADR 0016 §11).
 *
 * Permission map:
 *   read table context, metrics      observe:view (+ connection and table access)
 *   edit / verify context, metrics   context:edit
 *   dbt manifest import              context:edit
 *   Chouse AI context draft          context:edit + ai:optimize (+ table access)
 *   plain-language watcher compile   data_health:edit + ai:optimize
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import * as context from "../services/context/store";
import { draftTableContext } from "../services/context/draft";
import { compileWatcher } from "../services/context/watchers";
import { listDatasets } from "../services/observe/views";
import { AppError, requireParam } from "../types";
import { scopedConnection } from "./observe/access";

const contextRoute = new Hono();
contextRoute.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

async function scopedTable(c: Context): Promise<{ connectionId: string; database: string; table: string }> {
  const { connectionId, allowed } = await scopedConnection(c);
  const database = requireParam(c, "database");
  const table = requireParam(c, "table");
  if (!allowed(database, table)) throw AppError.forbidden("You do not have access to this table");
  return { connectionId, database, table };
}

contextRoute.get("/tables", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const datasets = await listDatasets(connectionId, allowed, { q: c.req.query("q") });
  return ok(c, { tables: datasets.map((d) => ({ database: d.database, table: d.table, criticality: d.criticality, state: d.state })) });
});

contextRoute.get("/tables/:database/:table", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, database, table } = await scopedTable(c);
  const result = await context.getTableContext(connectionId, database, table);
  if (!result) throw AppError.notFound("Table not found");
  return ok(c, result);
});

contextRoute.put("/tables/:database/:table", requirePermission(PERMISSIONS.CONTEXT_EDIT), zValidator("json", context.curatedContextSchema), async (c) => {
  const { connectionId, database, table } = await scopedTable(c);
  await context.upsertCurated(connectionId, database, table, c.req.valid("json"), getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONTEXT_UPDATE, getRbacUser(c).sub, { resourceType: "table", resourceId: `${database}.${table}`, details: { connectionId } });
  return ok(c, await context.getTableContext(connectionId, database, table));
});

contextRoute.post("/tables/:database/:table/verify", requirePermission(PERMISSIONS.CONTEXT_EDIT), async (c) => {
  const { connectionId, database, table } = await scopedTable(c);
  await context.verifyContext(connectionId, database, table, getRbacUser(c).sub);
  return ok(c, await context.getTableContext(connectionId, database, table));
});

contextRoute.get("/metrics", requirePermission(PERMISSIONS.OBSERVE_VIEW), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  return ok(c, { metrics: (await context.listMetrics(connectionId)).filter((m) => allowed(m.database, m.table)) });
});

contextRoute.put("/tables/:database/:table/metrics", requirePermission(PERMISSIONS.CONTEXT_EDIT), zValidator("json", context.metricSchema), async (c) => {
  const { connectionId, database, table } = await scopedTable(c);
  const metric = await context.upsertMetric(connectionId, database, table, c.req.valid("json"), getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONTEXT_METRIC_UPSERT, getRbacUser(c).sub, { resourceType: "metric", resourceId: metric.id, details: { connectionId, name: metric.name } });
  return ok(c, metric);
});

contextRoute.delete("/metrics/:id", requirePermission(PERMISSIONS.CONTEXT_EDIT), async (c) => {
  const { connectionId, allowed } = await scopedConnection(c);
  const id = requireParam(c, "id");
  const metric = (await context.listMetrics(connectionId)).find((m) => m.id === id);
  if (!metric || !allowed(metric.database, metric.table)) throw AppError.notFound("Metric not found");
  await context.deleteMetric(id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONTEXT_METRIC_DELETE, getRbacUser(c).sub, { resourceType: "metric", resourceId: id });
  return ok(c, { deleted: id });
});

contextRoute.post("/dbt-import", requirePermission(PERMISSIONS.CONTEXT_EDIT), async (c) => {
  const { connectionId } = await scopedConnection(c);
  let manifest: unknown;
  try {
    manifest = await c.req.json();
  } catch {
    throw AppError.badRequest("Upload a dbt manifest.json");
  }
  let result: context.DbtImportResult;
  try {
    result = await context.importDbtManifest(connectionId, manifest, getRbacUser(c).sub);
  } catch (error) {
    throw AppError.badRequest(`Not a dbt manifest: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
  }
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CONTEXT_DBT_IMPORT, getRbacUser(c).sub, { details: { connectionId, imported: result.imported, skipped: result.skipped } });
  return ok(c, result);
});

contextRoute.post(
  "/tables/:database/:table/draft",
  requirePermission(PERMISSIONS.CONTEXT_EDIT),
  requirePermission(PERMISSIONS.AI_OPTIMIZE),
  zValidator("json", z.object({ modelId: z.string().optional() })),
  async (c) => {
    const { connectionId, database, table } = await scopedTable(c);
    const user = getRbacUser(c);
    const draft = await draftTableContext({ connectionId, database, table, modelId: c.req.valid("json").modelId, userId: user.sub, roles: user.roles, permissions: user.permissions });
    await createAuditLogWithContext(c, AUDIT_ACTIONS.CONTEXT_AI_DRAFT, user.sub, { resourceType: "table", resourceId: `${database}.${table}`, details: { connectionId, model: draft.model, dropped: draft.dropped } });
    return ok(c, draft);
  },
);

contextRoute.post(
  "/watchers/compile",
  requirePermission(PERMISSIONS.DATA_HEALTH_EDIT),
  requirePermission(PERMISSIONS.AI_OPTIMIZE),
  zValidator("json", z.object({ text: z.string().trim().min(5).max(1000), modelId: z.string().optional() })),
  async (c) => {
    const { connectionId, allowed } = await scopedConnection(c);
    const body = c.req.valid("json");
    const user = getRbacUser(c);
    return ok(c, await compileWatcher({ connectionId, text: body.text, modelId: body.modelId, userId: user.sub, roles: user.roles, permissions: user.permissions, allowed }));
  },
);

export default contextRoute;
