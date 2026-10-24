/**
 * Approved actions (ADR 0024 §Phase 2), shown in AI Governance › Approvals.
 *
 *   GET  /                 actions: your own, plus every background proposal with ai:act
 *   GET  /pending-count    how many wait for you (the chat header badge)
 *   POST /:id/approve      approve a background proposal and run it as you (ai:act)
 *   POST /:id/reject       reject a background proposal (ai:act, or your own)
 *
 * Chat actions are answered in their chat, where the paused run continues.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requireAnyPermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import { actionDefinition, parseEditedArgs } from "../services/ai/actions/definitions";
import { ACTION_STATUSES, decideAction, finishAction, getAction, listActions, pendingCount, userNames, type AiAction } from "../services/ai/actions/store";
import { runAction } from "../services/ai/actions/tools";
import { AppError, requireParam } from "../types";

const aiActions = new Hono();
aiActions.use("*", rbacAuthMiddleware);
aiActions.use("*", requireAnyPermission([PERMISSIONS.AI_CHAT, PERMISSIONS.AI_ACT, PERMISSIONS.AI_OPTIMIZE]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

async function canAct(c: Context): Promise<boolean> {
  const user = getRbacUser(c);
  if (user.roles.includes("super_admin") || user.roles.includes("admin")) return true;
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  return permissions.includes(PERMISSIONS.AI_ACT) || userHasPermission(user.sub, PERMISSIONS.AI_ACT);
}

/** What the page shows for an action, with whether this viewer may decide it here. */
type ActionView = AiAction & { title: string; risk: "low" | "high"; canDecide: boolean; userName: string | null; decidedByName: string | null };

async function views(actions: AiAction[], viewerId: string, actor: boolean): Promise<ActionView[]> {
  const names = await userNames(actions.flatMap((a) => [a.userId, a.decidedBy]));
  const now = Date.now();
  return actions.map((action) => {
    const definition = actionDefinition(action.tool);
    const pending = action.status === "pending" && action.expiresAt > now;
    return {
      ...action,
      title: definition?.title ?? action.tool,
      risk: definition?.risk ?? "low",
      canDecide: pending && action.source === "background" && (actor || action.userId === viewerId),
      userName: names.get(action.userId) ?? null,
      decidedByName: action.decidedBy ? names.get(action.decidedBy) ?? null : null,
    };
  });
}

const listQuery = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

aiActions.get("/", zValidator("query", listQuery), async (c) => {
  const { status, limit } = c.req.valid("query");
  const user = getRbacUser(c);
  const actor = await canAct(c);
  const own = await listActions({ status, userId: user.sub, limit });
  const background = actor ? await listActions({ status, userId: null, source: "background", limit }) : [];
  const merged = new Map([...own, ...background].map((a) => [a.id, a]));
  const actions = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit ?? 100);
  return ok(c, { canAct: actor, actions: await views(actions, user.sub, actor) });
});

aiActions.get("/pending-count", async (c) => {
  const user = getRbacUser(c);
  return ok(c, { count: await pendingCount(user.sub, await canAct(c)) });
});

async function backgroundAction(c: Context): Promise<AiAction> {
  const action = await getAction(requireParam(c, "id"));
  if (!action) throw AppError.notFound("Action not found");
  if (action.source !== "background") throw AppError.conflict("Answer this action in its chat, where the reply is waiting for it.");
  if (action.status !== "pending") throw AppError.conflict(`This action was already ${action.status}.`);
  if (action.expiresAt <= Date.now()) throw new AppError("This action expired.", "APPROVAL_EXPIRED", "validation", 410);
  return action;
}

const approveBody = z.object({ args: z.record(z.string(), z.unknown()).optional() });

aiActions.post("/:id/approve", zValidator("json", approveBody), async (c) => {
  const user = getRbacUser(c);
  if (!(await canAct(c))) throw AppError.forbidden("You need the ai:act permission to approve AI actions.");
  const action = await backgroundAction(c);
  const definition = actionDefinition(action.tool);
  if (!definition) throw AppError.badRequest(`'${action.tool}' is no longer an action CHouse can run.`);
  const body = c.req.valid("json");
  let args = action.args;
  if (body.args) {
    const parsed = parseEditedArgs(definition, body.args);
    if (!parsed.ok) throw AppError.badRequest(parsed.message);
    args = parsed.args;
  }
  const decided = await decideAction(action.id, "approved", user.sub, body.args ? args : undefined);
  if (!decided) throw AppError.conflict("Someone already answered this action, or it expired.");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_ACTION_APPROVE, user.sub, {
    resourceType: "ai_action", resourceId: action.id, details: { origin: "ai", tool: action.tool, description: definition.describe(args), edited: Boolean(body.args) },
  });
  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (!token) throw AppError.unauthorized("Sign in again to run this action.");
  try {
    const result = await runAction(definition, args, { bearerToken: token, connectionId: action.connectionId });
    await finishAction(action.id, { result });
  } catch (error) {
    await finishAction(action.id, { error: error instanceof Error ? error.message : "The action failed" });
  }
  const finished = await getAction(action.id);
  return ok(c, finished ? (await views([finished], user.sub, true))[0] : null);
});

const rejectBody = z.object({ message: z.string().trim().max(1000).optional() });

aiActions.post("/:id/reject", zValidator("json", rejectBody), async (c) => {
  const user = getRbacUser(c);
  const action = await backgroundAction(c);
  if (action.userId !== user.sub && !(await canAct(c))) throw AppError.forbidden("You need the ai:act permission to answer other people's AI actions.");
  const decided = await decideAction(action.id, "rejected", user.sub);
  if (!decided) throw AppError.conflict("Someone already answered this action, or it expired.");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_ACTION_REJECT, user.sub, {
    resourceType: "ai_action", resourceId: action.id, details: { origin: "ai", tool: action.tool, description: action.description, reason: c.req.valid("json").message ?? null },
  });
  return ok(c, (await views([decided], user.sub, true))[0]);
});

export default aiActions;
