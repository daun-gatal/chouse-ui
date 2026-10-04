/**
 * `/api/remediation` (ADR 0016 §8).
 *
 * Permission map:
 *   catalog, list, detail          remediation:propose | remediation:approve | remediation:approve_high
 *   propose                        remediation:propose (+ connection and table access)
 *   approve / reject / run / rollback  remediation:approve or remediation:approve_high
 *                                  (the executor enforces the action's class and the proposer rule)
 *   credential describe            connections:view
 *   credential set / delete        connections:edit
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requireAnyPermission, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { ACTION_TYPES, REQUIRED_GRANTS, actionParamsSchema, buildAction } from "../services/remediation/catalog";
import { approveAction, executeAction, proposeAction, rejectAction, rollbackAction, RemediationError } from "../services/remediation/executor";
import { postApprovalRequest } from "../services/remediation/slack";
import * as store from "../services/remediation/store";
import { AppError, requireParam } from "../types";
import { actor, assertConnectionAccess, tableAccess } from "./observe/access";

const remediation = new Hono();
remediation.use("*", rbacAuthMiddleware);

const ANY_REMEDIATION = [PERMISSIONS.REMEDIATION_PROPOSE, PERMISSIONS.REMEDIATION_APPROVE, PERMISSIONS.REMEDIATION_APPROVE_HIGH];
const APPROVERS = [PERMISSIONS.REMEDIATION_APPROVE, PERMISSIONS.REMEDIATION_APPROVE_HIGH];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status: 200 | 201 = 200): any {
  return c.json({ success: true, data }, status);
}

function toAppError(error: unknown): never {
  if (error instanceof RemediationError) {
    if (error.code === "forbidden") throw AppError.forbidden(error.message);
    if (error.code === "not_found") throw AppError.notFound(error.message);
    if (error.code === "conflict") throw AppError.conflict(error.message);
    throw AppError.badRequest(error.message);
  }
  throw error;
}

async function guardAction(c: Context, id: string): Promise<store.RemediationAction> {
  const action = await store.getAction(id);
  if (!action) throw AppError.notFound("Action not found");
  await assertConnectionAccess(c, action.connectionId);
  const params = action.params as { database?: string; table?: string };
  if (params.database) {
    const allowed = await tableAccess(c, action.connectionId);
    if (!allowed(params.database, params.table ?? null)) throw AppError.forbidden("You do not have access to this table");
  }
  return action;
}

remediation.get("/catalog", requireAnyPermission(ANY_REMEDIATION), (c) =>
  ok(c, {
    types: ACTION_TYPES.map((type) => ({ type, requiredGrants: REQUIRED_GRANTS[type] })),
    window: process.env.REMEDIATION_MAINTENANCE_WINDOW || "02:00-04:00",
  }),
);

remediation.get("/actions", requireAnyPermission(ANY_REMEDIATION), async (c) => {
  const connectionId = c.req.query("connectionId");
  if (!connectionId) throw AppError.badRequest("connectionId is required");
  await assertConnectionAccess(c, connectionId);
  const allowed = await tableAccess(c, connectionId);
  const status = c.req.query("status")?.split(",").filter((s): s is store.ActionStatus => (store.ACTION_STATUSES as readonly string[]).includes(s));
  const actions = await store.listActions({ connectionId, status, incidentId: c.req.query("incidentId"), notebookId: c.req.query("notebookId") });
  return ok(c, {
    actions: actions.filter((a) => {
      const p = a.params as { database?: string; table?: string };
      return !p.database || allowed(p.database, p.table ?? null);
    }),
  });
});

remediation.get("/actions/:id", requireAnyPermission(ANY_REMEDIATION), async (c) => {
  const action = await guardAction(c, requireParam(c, "id"));
  return ok(c, { action, approvals: await store.listApprovals(action.id), executions: await store.listExecutions(action.id) });
});

const proposeSchema = z.object({
  connectionId: z.string().min(1),
  params: z.record(z.unknown()),
  title: z.string().trim().max(200).optional(),
  rationale: z.string().trim().max(4000).nullish(),
  incidentSource: z.enum(["data_health", "observe"]).nullish(),
  incidentId: z.string().max(64).nullish(),
  notebookId: z.string().max(64).nullish(),
});

remediation.post("/actions/preview", requireAnyPermission(ANY_REMEDIATION), zValidator("json", z.object({ params: z.record(z.unknown()) })), (c) => {
  const parsed = actionParamsSchema.safeParse(c.req.valid("json").params);
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  return ok(c, buildAction(parsed.data));
});

remediation.post("/actions", requirePermission(PERMISSIONS.REMEDIATION_PROPOSE), zValidator("json", proposeSchema), async (c) => {
  const body = c.req.valid("json");
  await assertConnectionAccess(c, body.connectionId);
  const p = body.params as { database?: unknown; table?: unknown };
  if (typeof p.database === "string") {
    const allowed = await tableAccess(c, body.connectionId);
    if (!allowed(p.database, typeof p.table === "string" ? p.table : null)) throw AppError.forbidden("You do not have access to this table");
  }
  const user = getRbacUser(c);
  // MCP / PAT callers are agents: their proposals can never be self-approved.
  const source = c.get("authMethod") === "pat" ? "mcp" : "user";
  let action: store.RemediationAction;
  try {
    action = await proposeAction({ ...body, proposedBy: user.sub, proposedSource: source });
  } catch (error) {
    toAppError(error);
  }
  void postApprovalRequest(action);
  return ok(c, action, 201);
});

const decisionSchema = z.object({ comment: z.string().trim().max(2000).nullish() });

remediation.post("/actions/:id/approve", requireAnyPermission(APPROVERS), zValidator("json", decisionSchema), async (c) => {
  const action = await guardAction(c, requireParam(c, "id"));
  try {
    const channel = c.get("authMethod") === "pat" ? "cli" : "ui";
    return ok(c, await approveAction(action.id, actor(c), channel, c.req.valid("json").comment ?? null));
  } catch (error) {
    toAppError(error);
  }
});

remediation.post("/actions/:id/reject", requireAnyPermission([...APPROVERS, PERMISSIONS.REMEDIATION_PROPOSE]), zValidator("json", decisionSchema), async (c) => {
  const action = await guardAction(c, requireParam(c, "id"));
  try {
    const channel = c.get("authMethod") === "pat" ? "cli" : "ui";
    return ok(c, await rejectAction(action.id, actor(c), channel, c.req.valid("json").comment ?? null));
  } catch (error) {
    toAppError(error);
  }
});

/** Run an approved action now instead of waiting for the worker tick. */
remediation.post("/actions/:id/run", requireAnyPermission(APPROVERS), async (c) => {
  const action = await guardAction(c, requireParam(c, "id"));
  try {
    return ok(c, await executeAction(action.id));
  } catch (error) {
    toAppError(error);
  }
});

remediation.post("/actions/:id/rollback", requireAnyPermission(APPROVERS), async (c) => {
  const action = await guardAction(c, requireParam(c, "id"));
  try {
    return ok(c, await rollbackAction(action.id, actor(c)));
  } catch (error) {
    toAppError(error);
  }
});

remediation.get("/credentials/:connectionId", requirePermission(PERMISSIONS.CONNECTIONS_VIEW), async (c) => {
  const connectionId = requireParam(c, "connectionId");
  await assertConnectionAccess(c, connectionId);
  return ok(c, await store.describeCredential(connectionId));
});

remediation.put(
  "/credentials/:connectionId",
  requirePermission(PERMISSIONS.CONNECTIONS_EDIT),
  zValidator("json", z.object({ username: z.string().trim().min(1).max(255), password: z.string().max(1000) })),
  async (c) => {
    const connectionId = requireParam(c, "connectionId");
    await assertConnectionAccess(c, connectionId);
    const body = c.req.valid("json");
    await store.setCredential(connectionId, body.username, body.password, getRbacUser(c).sub);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.REMEDIATION_CREDENTIAL_UPDATE, getRbacUser(c).sub, { resourceType: "connection", resourceId: connectionId, details: { username: body.username } });
    return ok(c, await store.describeCredential(connectionId));
  },
);

remediation.delete("/credentials/:connectionId", requirePermission(PERMISSIONS.CONNECTIONS_EDIT), async (c) => {
  const connectionId = requireParam(c, "connectionId");
  await assertConnectionAccess(c, connectionId);
  await store.deleteCredential(connectionId);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.REMEDIATION_CREDENTIAL_UPDATE, getRbacUser(c).sub, { resourceType: "connection", resourceId: connectionId, details: { removed: true } });
  return ok(c, { configured: false });
});

export default remediation;
