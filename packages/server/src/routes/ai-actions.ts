/**
 * AI actions (ADR 0024 §Phase 2, ADR 0025): the approval queue in AI
 * Governance › Approvals, and each user's own activity and inbox (Chobi).
 *
 *   GET  /                 actions: your own, plus every queued action you may decide
 *   GET  /pending-count    how many wait for you (badges)
 *   GET  /inbox            what waits for your decision: your MCP calls held for
 *                          confirmation, and queued actions you may approve
 *   GET  /activity         what the AI did for you, newest first, with undo state
 *   GET  /:id              one action (yours, or one you may decide)
 *   POST /:id/approve      approve a queued action (runs it as you) or a held one
 *                          (the waiting MCP call runs it with its own token)
 *   POST /:id/reject       reject a queued or held action
 *   POST /:id/undo         undo one of your T1 actions
 *
 * Chat actions are answered in their chat, where the paused run continues.
 * A T3 action is never approved by the person it is for: a second person who
 * holds the tool's permission decides.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requireAnyPermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, SYSTEM_ROLES, type Permission } from "../rbac/schema/base";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { getUserConnections } from "../rbac/services/connections";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import { ACTION_DEFINITIONS, actionDefinition, parseEditedArgs } from "../services/ai/actions/definitions";
import { fileForApproval, performAction, undoAction, undoAvailable, UndoError } from "../services/ai/actions/executor";
import { ACTION_STATUSES, decideAction, getAction, listActions, userNames, type AiAction } from "../services/ai/actions/store";
import { resolveTier } from "../services/ai/actions/tiers";
import { getTokenPolicy, handlingFor, toolkitAllowed, type Handling } from "../services/ai/actions/tokenPolicy";
import { nominalTier } from "../services/ai/actions/tools";
import type { Tier, Toolkit } from "../services/ai/actions/types";
import { getMcpSettings } from "../mcp/settings";
import { InProcessApiClient } from "../services/ai/registry/inProcessApi";
import { AppError, requireParam } from "../types";

const aiActions = new Hono();
aiActions.use("*", rbacAuthMiddleware);
aiActions.use("*", requireAnyPermission([PERMISSIONS.AI_CHAT, PERMISSIONS.AI_ACT, PERMISSIONS.AI_OPTIMIZE]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

interface Viewer {
  id: string;
  superAdmin: boolean;
  admin: boolean;
  permissions: string[];
  /** The connections the viewer can reach, loaded once per request. */
  connections: () => Promise<Set<string>>;
}

function viewerOf(c: Context): Viewer {
  const user = getRbacUser(c);
  let connections: Promise<Set<string>> | null = null;
  return {
    id: user.sub,
    superAdmin: user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN),
    admin: user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN) || user.roles.includes(SYSTEM_ROLES.ADMIN),
    permissions: c.get("rbacPermissions") ?? [],
    connections: () => {
      connections ??= getUserConnections(user.sub).then((list) => new Set(list.map((conn) => conn.id)));
      return connections;
    },
  };
}

async function holds(viewer: Viewer, permission: Permission): Promise<boolean> {
  return viewer.permissions.includes(permission) || userHasPermission(viewer.id, permission);
}

/** May the viewer let an agent act at all (the ai:act permission, or admin). */
async function canAct(viewer: Viewer): Promise<boolean> {
  return viewer.admin || holds(viewer, PERMISSIONS.AI_ACT);
}

/**
 * Whether the viewer may decide a pending action here. Held MCP calls are
 * confirmed by their own user. Queued T3 actions need a second person who
 * may act and holds one of the tool's permissions. Other queued proposals
 * need ai:act.
 */
async function mayDecide(action: AiAction, viewer: Viewer, actor: boolean, now: number = Date.now()): Promise<boolean> {
  if (action.status !== "pending" || action.expiresAt <= now) return false;
  if (action.source === "held") return action.userId === viewer.id;
  if (action.source !== "background") return false;
  if (action.tier === "t3") {
    if (action.userId === viewer.id || !actor) return false;
    if (viewer.superAdmin) return true;
    const definition = actionDefinition(action.tool);
    if (!definition) return false;
    // The approval runs as the approver: they must reach the action's connection.
    if (definition.connectionScoped && action.connectionId && !(await viewer.connections()).has(action.connectionId)) return false;
    for (const permission of definition.permissions) if (await holds(viewer, permission)) return true;
    return false;
  }
  return actor;
}

/** What the pages show for an action. */
type ActionView = AiAction & {
  title: string;
  toolkit: Toolkit | null;
  tier: Tier | null;
  canDecide: boolean;
  undoAvailable: boolean;
  userName: string | null;
  decidedByName: string | null;
};

/** A queued proposal of your own (not T3) can be answered by you: at least rejected. */
function ownQueued(action: AiAction, viewer: Viewer, now: number = Date.now()): boolean {
  return action.userId === viewer.id && action.source === "background" && action.tier !== "t3" && action.status === "pending" && action.expiresAt > now;
}

async function views(actions: AiAction[], viewer: Viewer, actor: boolean): Promise<ActionView[]> {
  const names = await userNames(actions.flatMap((a) => [a.userId, a.decidedBy]));
  const out: ActionView[] = [];
  for (const action of actions) {
    const definition = actionDefinition(action.tool);
    out.push({
      ...action,
      title: definition?.title ?? action.tool,
      toolkit: definition?.toolkit ?? null,
      tier: action.tier,
      canDecide: ownQueued(action, viewer) || (await mayDecide(action, viewer, actor)),
      undoAvailable: action.userId === viewer.id && undoAvailable(action),
      userName: names.get(action.userId) ?? null,
      decidedByName: action.decidedBy ? names.get(action.decidedBy) ?? null : null,
    });
  }
  return out;
}

/** Pending actions waiting on this viewer, newest first. */
async function inboxFor(viewer: Viewer, actor: boolean, limit = 100): Promise<AiAction[]> {
  const held = await listActions({ status: "pending", userId: viewer.id, source: "held", limit });
  const queued = await listActions({ status: "pending", userId: null, source: "background", limit: 500 });
  const decidable: AiAction[] = [];
  for (const action of queued) if (await mayDecide(action, viewer, actor)) decidable.push(action);
  const now = Date.now();
  return [...held, ...decidable].filter((a) => a.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

const listQuery = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

aiActions.get("/", zValidator("query", listQuery), async (c) => {
  const { status, limit } = c.req.valid("query");
  const viewer = viewerOf(c);
  const actor = await canAct(viewer);
  const own = await listActions({ status, userId: viewer.id, limit });
  const background = actor ? await listActions({ status, userId: null, source: "background", limit }) : [];
  const merged = new Map([...own, ...background].map((a) => [a.id, a]));
  const actions = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit ?? 100);
  return ok(c, { canAct: actor, actions: await views(actions, viewer, actor) });
});

aiActions.get("/pending-count", async (c) => {
  const viewer = viewerOf(c);
  return ok(c, { count: (await inboxFor(viewer, await canAct(viewer), 500)).length });
});

aiActions.get("/inbox", async (c) => {
  const viewer = viewerOf(c);
  const actor = await canAct(viewer);
  return ok(c, { actions: await views(await inboxFor(viewer, actor), viewer, actor) });
});

const activityQuery = z.object({
  runId: z.string().min(1).optional(),
  /** Comma-separated action ids (a reply's receipts); only the viewer's own come back. */
  ids: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

aiActions.get("/activity", zValidator("query", activityQuery), async (c) => {
  const { runId, ids, limit } = c.req.valid("query");
  const viewer = viewerOf(c);
  const wanted = ids ? [...new Set(ids.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 50) : null;
  const actions = wanted
    ? (await Promise.all(wanted.map((id) => getAction(id)))).filter((a): a is AiAction => a !== null && a.userId === viewer.id)
    : await listActions({ userId: viewer.id, runId, limit: limit ?? 50 });
  return ok(c, { actions: await views(actions, viewer, await canAct(viewer)) });
});

/**
 * How a call of this tier is handled for this caller: a personal access token
 * follows its write policy under the administrator's ceiling (ADR 0025 §4); a
 * browser session runs T1, confirms T2 and files T3, as the chat does.
 */
async function handlingForCaller(c: Context, tier: Tier): Promise<Handling> {
  const patId: string | undefined = c.get("patId");
  if (c.get("authMethod") !== "pat" || !patId) return tier === "t1" ? "auto" : tier === "t2" ? "confirm" : "approver";
  const settings = await getMcpSettings();
  return handlingFor(tier, await getTokenPolicy(patId), { toolkits: settings.actionToolkits, maxTier: settings.actionMaxTier });
}

async function toolkitForCaller(c: Context, toolkit: Toolkit): Promise<boolean> {
  const patId: string | undefined = c.get("patId");
  if (c.get("authMethod") !== "pat" || !patId) return true;
  const settings = await getMcpSettings();
  return toolkitAllowed(toolkit, await getTokenPolicy(patId), { toolkits: settings.actionToolkits, maxTier: settings.actionMaxTier });
}

/** GET /tools — the write tools this caller may run (the CLI's `chouse action tools`). */
aiActions.get("/tools", async (c) => {
  const viewer = viewerOf(c);
  const tools = [];
  for (const definition of ACTION_DEFINITIONS) {
    if (!(await toolkitForCaller(c, definition.toolkit))) continue;
    if (!viewer.superAdmin && definition.permissions.length > 0 && !definition.permissions.some((p) => viewer.permissions.includes(p))) continue;
    tools.push({
      name: definition.name,
      title: definition.title,
      toolkit: definition.toolkit,
      tier: nominalTier(definition),
      description: definition.description,
      arguments: Object.keys(definition.schema.shape),
    });
  }
  return ok(c, { tools });
});

const runBody = z.object({
  tool: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()).default({}),
  /** The caller confirmed it (an interactive "yes" or --yes); never enough for T3. */
  confirmed: z.boolean().default(false),
});

/**
 * POST /run — run one write tool as the caller (the CLI's `chouse action run`).
 * T1 runs; T2 answers 409 CONFIRMATION_REQUIRED until confirmed; T3 is always
 * filed for a second approver; a tier the token's policy turns off is refused.
 */
aiActions.post("/run", zValidator("json", runBody), async (c) => {
  const viewer = viewerOf(c);
  const body = c.req.valid("json");
  if (!(await canAct(viewer))) throw AppError.forbidden("You need the ai:act permission to let an agent change things.");
  const definition = actionDefinition(body.tool);
  if (!definition) throw AppError.notFound(`'${body.tool}' is not a write tool (chouse action tools lists them).`);
  if (!(await toolkitForCaller(c, definition.toolkit))) throw new AppError(`This token's write policy does not include ${definition.toolkit} tools.`, "ACTION_OFF", "permission", 403);
  const parsed = parseEditedArgs(definition, body.args);
  if (!parsed.ok) throw AppError.badRequest(parsed.message);
  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (!token) throw AppError.unauthorized("Sign in again to run this action.");
  const connectionId: string | null = c.req.header("X-Connection-Id") || null;
  const actor = {
    api: new InProcessApiClient(token, connectionId ?? undefined),
    userId: viewer.id,
    connectionId,
    origin: "cli" as const,
    tokenId: c.get("patId") ?? null,
  };
  const { tier, production } = await resolveTier(definition, parsed.args, actor);
  const handling = await handlingForCaller(c, tier);
  const description = definition.describe(parsed.args);
  if (handling === "off") throw new AppError(`This call is ${tier.toUpperCase()}${production ? " on a production connection" : ""}, which this token's write policy turns off. Do it in CHouse.`, "ACTION_OFF", "permission", 403);
  if (tier === "t3") {
    const filed = await fileForApproval(definition, parsed.args, actor);
    return c.json({ success: true, data: { submitted: true, actionId: filed.id, tier, description, status: "Sent for a second person's approval in CHouse." } }, 202);
  }
  if (handling === "confirm" && !body.confirmed) {
    throw new AppError(`Confirm: ${description}`, "CONFIRMATION_REQUIRED", "validation", 409, { tier, production, description });
  }
  try {
    const { action, result } = await performAction(definition, parsed.args, actor, { tier });
    return ok(c, { done: true, actionId: action.id, tier, description, undoAvailable: undoAvailable(action), result });
  } catch (error) {
    throw AppError.badRequest(error instanceof Error ? error.message : "The action failed");
  }
});

aiActions.get("/:id", async (c) => {
  const viewer = viewerOf(c);
  const actor = await canAct(viewer);
  const action = await getAction(requireParam(c, "id"));
  if (!action || (action.userId !== viewer.id && !(await mayDecide(action, viewer, actor)))) throw AppError.notFound("Action not found");
  return ok(c, (await views([action], viewer, actor))[0]);
});

async function decidable(c: Context): Promise<AiAction> {
  const action = await getAction(requireParam(c, "id"));
  if (!action) throw AppError.notFound("Action not found");
  if (action.source === "chat") throw AppError.conflict("Answer this action in its chat, where the reply is waiting for it.");
  if (action.status !== "pending") throw AppError.conflict(`This action was already ${action.status}.`);
  if (action.expiresAt <= Date.now()) throw new AppError("This action expired.", "APPROVAL_EXPIRED", "validation", 410);
  return action;
}

const approveBody = z.object({ args: z.record(z.string(), z.unknown()).optional() });

aiActions.post("/:id/approve", zValidator("json", approveBody), async (c) => {
  const viewer = viewerOf(c);
  const actor = await canAct(viewer);
  const action = await decidable(c);
  if (!(await mayDecide(action, viewer, actor))) {
    if (action.tier === "t3" && action.userId === viewer.id) throw AppError.forbidden("A second person has to approve this: you cannot approve your own high-risk action.");
    throw AppError.forbidden(action.tier === "t3"
      ? "You need the ai:act permission and this tool's own permission to approve it."
      : "You need the ai:act permission to approve AI actions.");
  }
  const definition = actionDefinition(action.tool);
  if (!definition) throw AppError.badRequest(`'${action.tool}' is no longer an action CHouse can run.`);
  const body = c.req.valid("json");
  let args = action.args;
  if (body.args) {
    const parsed = parseEditedArgs(definition, body.args);
    if (!parsed.ok) throw AppError.badRequest(parsed.message);
    args = parsed.args;
  }
  const decided = await decideAction(action.id, "approved", viewer.id, body.args ? args : undefined);
  if (!decided) throw AppError.conflict("Someone already answered this action, or it expired.");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_ACTION_APPROVE, viewer.id, {
    resourceType: "ai_action", resourceId: action.id, details: { origin: "ai", from: action.origin, tier: action.tier, tool: action.tool, description: definition.describe(args), edited: Boolean(body.args), requestedBy: action.userId },
  });
  // A held MCP call runs with the caller's own token, in the MCP request that waits for it.
  if (action.source === "held") return ok(c, (await views([decided], viewer, actor))[0]);
  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (!token) throw AppError.unauthorized("Sign in again to run this action.");
  const api = new InProcessApiClient(token, action.connectionId ?? undefined);
  await performAction(definition, args, { api, userId: viewer.id, connectionId: action.connectionId, origin: action.origin }, { tier: action.tier ?? "t2", actionId: action.id })
    .catch(() => undefined);
  const finished = await getAction(action.id);
  return ok(c, finished ? (await views([finished], viewer, actor))[0] : null);
});

const rejectBody = z.object({ message: z.string().trim().max(1000).optional() });

aiActions.post("/:id/reject", zValidator("json", rejectBody), async (c) => {
  const viewer = viewerOf(c);
  const actor = await canAct(viewer);
  const action = await decidable(c);
  // Anyone may withdraw their own request; deciding someone else's needs the right to decide it.
  if (action.userId !== viewer.id && !(await mayDecide(action, viewer, actor))) {
    throw AppError.forbidden("You need the ai:act permission to answer other people's AI actions.");
  }
  const decided = await decideAction(action.id, "rejected", viewer.id);
  if (!decided) throw AppError.conflict("Someone already answered this action, or it expired.");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_ACTION_REJECT, viewer.id, {
    resourceType: "ai_action", resourceId: action.id, details: { origin: "ai", from: action.origin, tier: action.tier, tool: action.tool, description: action.description, reason: c.req.valid("json").message ?? null },
  });
  return ok(c, (await views([decided], viewer, actor))[0]);
});

aiActions.post("/:id/undo", async (c) => {
  const viewer = viewerOf(c);
  const action = await getAction(requireParam(c, "id"));
  if (!action || action.userId !== viewer.id) throw AppError.notFound("Action not found");
  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (!token) throw AppError.unauthorized("Sign in again to undo this action.");
  try {
    const { restoredId } = await undoAction(action, viewer.id, new InProcessApiClient(token, action.connectionId ?? undefined));
    await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_ACTION_UNDO, viewer.id, {
      resourceType: "ai_action", resourceId: action.id, details: { origin: "ai", tool: action.tool, description: action.description, restoredId },
    });
  } catch (error) {
    if (error instanceof UndoError) throw new AppError(error.message, `UNDO_${error.code}`, "validation", error.code === "EXPIRED" ? 410 : 409);
    throw error;
  }
  const updated = await getAction(action.id);
  return ok(c, updated ? (await views([updated], viewer, await canAct(viewer)))[0] : null);
});

export default aiActions;
