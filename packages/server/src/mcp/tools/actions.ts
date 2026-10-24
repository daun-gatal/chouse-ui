/**
 * MCP write tools generated from the action registry (ADR 0025 §3, §4).
 *
 * Every tool runs through the same executor as the chat, with the caller's
 * PAT, and is checked by its tier:
 * - T1 runs (or asks, when the token's policy says confirm) and can be undone;
 * - T2 is held for its user's confirmation in CHouse (Chobi's inbox or AI
 *   Governance › Approvals). The call waits, sending progress, and runs as
 *   soon as it is approved; after the wait it returns a pending action id the
 *   agent checks with get_action_status, which runs it once approved;
 * - T3 is filed for a second person who holds the permission.
 * The endpoint is stateless, so it cannot ask the client back (elicitation);
 * the confirmation happens in CHouse, where it is audited.
 *
 * MCP tools that existed before keep their names and behaviour; a generated
 * tool never replaces one.
 */

import { z } from "zod";

import { ACTION_DEFINITIONS, actionDefinition, type ActionDefinition } from "../../services/ai/actions/definitions";
import { performAction, undoAction, undoAvailable, UndoError, type Actor } from "../../services/ai/actions/executor";
import { claimApprovedAction, createAction, getAction, type AiAction } from "../../services/ai/actions/store";
import { resolveTier } from "../../services/ai/actions/tiers";
import { getTokenPolicy, handlingFor, toolkitAllowed, type TokenPolicy, type WriteCeiling } from "../../services/ai/actions/tokenPolicy";
import type { ActionApi, ActionContext, Tier, Toolkit } from "../../services/ai/actions/types";
import { getMcpSettings } from "../settings";
import type { McpApiClient } from "../api";
import type { McpDeps, McpToolContext } from "../types";
import { argString, registerChouseTool, runApiTool, toolContext, type McpToolCategory, type McpToolSink, type ToolExtra } from "./helpers";

/** Actions that only make sense in the CHouse UI. */
const NOT_OVER_MCP = new Set(["update_my_preferences"]);

const CATEGORY: Record<Toolkit, McpToolCategory> = {
  data: "query",
  scheduling: "scheduling",
  health: "data_health",
  observe: "monitoring",
  dashboards: "dashboards",
  access: "access",
  platform: "ai_governance",
};

/** The executor's API over the MCP subrequest client (the caller's PAT). */
export function mcpActionApi(client: McpApiClient): ActionApi {
  return {
    get: (path, query) => client.request("GET", path, query ? { query: Object.fromEntries(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string")) } : undefined),
    post: (path, body) => client.request("POST", path, { body: body ?? {} }),
    put: (path, body) => client.request("PUT", path, { body }),
    patch: (path, body) => client.request("PATCH", path, { body }),
    delete: (path, body) => client.request("DELETE", path, body === undefined ? undefined : { body }),
  };
}

/** The ceiling and the token's policy, for listing and for each call. */
export interface WriteAccess {
  policy: TokenPolicy;
  ceiling: WriteCeiling;
}

export async function writeAccessFor(patId: string | null | undefined): Promise<WriteAccess> {
  const settings = await getMcpSettings();
  return {
    policy: await getTokenPolicy(patId),
    ceiling: { toolkits: settings.actionToolkits, maxTier: settings.actionMaxTier },
  };
}

/** Whether a generated tool is listed for the token: its toolkit is allowed and some tier it can take is not off. */
export function actionToolListed(definition: Pick<ActionDefinition, "toolkit" | "tier">, access: WriteAccess): boolean {
  if (!toolkitAllowed(definition.toolkit, access.policy, access.ceiling)) return false;
  const tiers: Tier[] = typeof definition.tier === "string" ? [definition.tier] : ["t2", "t3"];
  return tiers.some((tier) => handlingFor(tier, access.policy, access.ceiling) !== "off");
}

const HOW = "Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.";

function actorFor(ctx: McpToolContext, api: ActionApi): Actor & ActionContext {
  return { api, userId: ctx.identity.userId, connectionId: ctx.connectionId ?? null, origin: "mcp", tokenId: ctx.identity.patId ?? null };
}

function done(action: AiAction, result: unknown): Record<string, unknown> {
  return {
    done: true,
    actionId: action.id,
    tier: action.tier,
    ...(undoAvailable(action) ? { undo: "Undo it with undo_action (24 hours)." } : {}),
    result,
  };
}

async function sendProgress(extra: ToolExtra, progress: number, total: number, message: string): Promise<void> {
  const token = extra._meta?.progressToken;
  if (token === undefined) return;
  await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total, message } }).catch(() => undefined);
}

/**
 * Hold a call for its user's confirmation: wait (sending progress) until it is
 * approved, rejected, expired or the wait ends. Runs it here once approved.
 */
async function holdForConfirmation(definition: ActionDefinition, args: Record<string, unknown>, actor: Actor, tier: Tier, waitSeconds: number, extra: ToolExtra): Promise<Record<string, unknown>> {
  const held = await createAction({
    source: "held",
    userId: actor.userId,
    connectionId: actor.connectionId,
    tool: definition.name,
    args,
    description: definition.describe(args),
    tier,
    origin: "mcp",
    tokenId: actor.tokenId ?? null,
  });
  const deadline = Date.now() + waitSeconds * 1000;
  let tick = 0;
  while (Date.now() < deadline && !extra.signal.aborted) {
    const current = await getAction(held.id);
    if (current?.status === "approved") return runApproved(held.id, actor);
    if (current && current.status !== "pending") return { status: current.status, actionId: held.id, message: current.status === "rejected" ? "The user rejected this action." : `The action is ${current.status}.` };
    if (tick % 15 === 0) await sendProgress(extra, tick, waitSeconds, `Waiting for confirmation in CHouse: ${definition.describe(args)}`);
    tick += 1;
    await Bun.sleep(1000);
  }
  return {
    pending: true,
    actionId: held.id,
    status: "Waiting for the user's confirmation in CHouse (Chobi or AI Governance › Approvals). Check it with get_action_status; it runs once confirmed.",
  };
}

/** Run an approved held action with the caller's own token, exactly once. */
async function runApproved(actionId: string, actor: Actor): Promise<Record<string, unknown>> {
  const claimed = await claimApprovedAction(actionId);
  if (!claimed) {
    const current = await getAction(actionId);
    return { status: current?.status ?? "unknown", actionId, ...(current?.result !== undefined ? { result: current.result } : {}), ...(current?.error ? { error: current.error } : {}) };
  }
  const definition = actionDefinition(claimed.tool);
  if (!definition) throw new Error(`'${claimed.tool}' is no longer an action CHouse can run.`);
  const { action, result } = await performAction(definition, claimed.args, { ...actor, connectionId: claimed.connectionId }, { tier: claimed.tier ?? "t2", actionId: claimed.id });
  return done(action, result);
}

async function callAction(definition: ActionDefinition, rawArgs: Record<string, unknown>, ctx: McpToolContext, client: McpApiClient, extra: ToolExtra): Promise<Record<string, unknown>> {
  const parsed = definition.schema.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const args = parsed.data as Record<string, unknown>;
  const access = await writeAccessFor(ctx.identity.patId);
  if (!toolkitAllowed(definition.toolkit, access.policy, access.ceiling)) throw new Error(`This token's write policy does not include ${definition.toolkit} tools.`);
  const actor = actorFor(ctx, mcpActionApi(client));
  const { tier } = await resolveTier(definition, args, actor);
  const handling = handlingFor(tier, access.policy, access.ceiling);
  if (handling === "off") {
    throw new Error(`This call is ${tier.toUpperCase()} here, which ${tier === "t3" ? "an administrator has not allowed over MCP" : "this token's write policy turns off"}. Ask the user to do it in CHouse.`);
  }
  if (tier === "t3") {
    const filed = await createAction({
      source: "background", userId: actor.userId, connectionId: actor.connectionId, tool: definition.name, args,
      description: definition.describe(args), tier, origin: "mcp", tokenId: actor.tokenId ?? null,
    });
    return { submitted: true, actionId: filed.id, tier, status: "Sent for a second person's approval in CHouse. It runs once someone else with this permission approves it." };
  }
  if (handling === "auto") {
    const { action, result } = await performAction(definition, args, actor, { tier });
    return done(action, result);
  }
  const settings = await getMcpSettings();
  return holdForConfirmation(definition, args, actor, tier, settings.approvalWaitSeconds, extra);
}

/** The action's input as the MCP registration takes it: one zod schema per argument. */
function inputShape(definition: ActionDefinition): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(Object.entries(definition.schema.shape).filter((entry): entry is [string, z.ZodTypeAny] => entry[1] instanceof z.ZodType));
}

const actionIdSchema: Record<string, z.ZodTypeAny> = {
  action_id: z.string().min(1).describe("The actionId a write tool returned"),
};

export function registerActionTools(sink: McpToolSink, deps: McpDeps, existing: ReadonlySet<string>): void {
  for (const definition of ACTION_DEFINITIONS) {
    if (existing.has(definition.name) || NOT_OVER_MCP.has(definition.name)) continue;
    registerChouseTool(sink, {
      name: definition.name,
      title: definition.title,
      category: CATEGORY[definition.toolkit],
      access: definition.tier === "t3" ? "destructive" : "write",
      permissions: definition.permissions,
      description: `${definition.description} ${HOW}`,
      inputSchema: inputShape(definition),
      action: { toolkit: definition.toolkit, tier: definition.tier },
      handler: async (args, extra) => {
        const ctx = toolContext(extra);
        const client = deps.clientFor(ctx);
        return runApiTool(ctx, client, definition.name, definition.describe(args).slice(0, 200), () => callAction(definition, args, ctx, client, extra));
      },
    });
  }

  registerChouseTool(sink, {
    name: "get_action_status",
    title: "Check a write action",
    category: "ai",
    access: "write",
    permissions: [],
    description: "Check a write action this token started (by the actionId a write tool returned). If the user has confirmed it since, it runs now and the result comes back.",
    inputSchema: actionIdSchema,
    action: { toolkit: null, tier: null },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const client = deps.clientFor(ctx);
      return runApiTool(ctx, client, "get_action_status", argString(args, "action_id"), async () => {
        const action = await getAction(argString(args, "action_id"));
        if (!action || action.userId !== ctx.identity.userId) throw new Error("Action not found");
        if (action.source === "held" && action.status === "approved") return runApproved(action.id, actorFor(ctx, mcpActionApi(client)));
        return {
          actionId: action.id, tool: action.tool, tier: action.tier, status: action.status, description: action.description,
          ...(action.result !== null ? { result: action.result } : {}), ...(action.error ? { error: action.error } : {}),
          undoAvailable: undoAvailable(action),
        };
      });
    },
  });

  registerChouseTool(sink, {
    name: "undo_action",
    title: "Undo a write action",
    category: "ai",
    access: "write",
    permissions: [],
    description: "Undo an undoable action this user made (within 24 hours). Refused when the object changed since, so nobody's later change is overwritten.",
    inputSchema: actionIdSchema,
    action: { toolkit: null, tier: null },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const client = deps.clientFor(ctx);
      return runApiTool(ctx, client, "undo_action", argString(args, "action_id"), async () => {
        const action = await getAction(argString(args, "action_id"));
        if (!action || action.userId !== ctx.identity.userId) throw new Error("Action not found");
        try {
          const { restoredId } = await undoAction(action, ctx.identity.userId, mcpActionApi(client));
          return { undone: true, actionId: action.id, ...(restoredId ? { restoredId } : {}) };
        } catch (error) {
          if (error instanceof UndoError) throw new Error(`${error.code}: ${error.message}`);
          throw error;
        }
      });
    },
  });
}
