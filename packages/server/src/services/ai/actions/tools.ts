/**
 * Catalog entries for the write tools (ADR 0024 §Phase 2, ADR 0025).
 *
 * In a chat run (`actionMode: "approve"`) the tier decides: a T1 call runs at
 * once and is recorded with its undo; a T2 call (or any call in a plan of two
 * or more writes) pauses for the user through the approval middleware and
 * runs once approved; a T3 call is filed for a second approver and the chat
 * carries on. In every other run (`propose`) a write tool only records a
 * pending action for someone with `ai:act` to approve in AI Governance ›
 * Approvals.
 */

import { PERMISSIONS } from "../../../rbac/schema/base";
import { createAgentTool, type AgentTool } from "../langchainTools";
import type { AgentRunContext } from "../types";
import { InProcessApiClient } from "../registry/inProcessApi";
import type { CatalogTool, ToolRuntime } from "../registry/catalog";
import { ACTION_DEFINITIONS, type ActionDefinition } from "./definitions";
import { fileForApproval, performAction, undoAvailable, type Actor } from "./executor";
import { claimApprovedForRun, createAction } from "./store";
import { resolveTier } from "./tiers";
import type { ActionContext, Tier } from "./types";

/** Whether the user may let an agent act (the `ai:act` permission, or admin). */
export function mayAct(ctx: Pick<AgentRunContext, "isAdmin" | "permissions">): boolean {
  return Boolean(ctx.isAdmin) || (ctx.permissions ?? []).includes(PERMISSIONS.AI_ACT);
}

/** The tier the catalog shows for a tool: its base tier, or "varies" when it depends on the call. */
export function nominalTier(definition: ActionDefinition): Tier | "varies" {
  return typeof definition.tier === "string" ? definition.tier : "varies";
}

/** The action context of a run that has the user's token. */
export function runActionContext(ctx: Pick<AgentRunContext, "bearerToken" | "connectionId" | "userId">): ActionContext {
  return {
    api: new InProcessApiClient(ctx.bearerToken ?? "", ctx.connectionId ?? undefined),
    connectionId: ctx.connectionId ?? null,
    userId: ctx.userId ?? "",
  };
}

const HOW: Record<Tier, string> = {
  t1: "It runs at once and the user can undo it from Activity.",
  t2: "The user confirms it before it runs; say what you are about to do and why.",
  t3: "It needs a second person's approval: calling it files the request and returns at once.",
};

function guidance(definition: ActionDefinition, mode: "approve" | "simulate" | "propose"): string {
  if (definition.proposalOnly) return "It changes nothing by itself; approvers decide in Fixes.";
  if (mode === "simulate") return "This is a test run: the call is not carried out, you are told what would happen.";
  if (mode === "propose") return "Nobody is here to approve it now: the call is saved as a pending action for someone to approve later.";
  const tier = nominalTier(definition);
  return tier === "varies" ? "How it is checked depends on the call (whose query, which connection)." : HOW[tier];
}

function buildActionTool(definition: ActionDefinition, runtime: ToolRuntime): AgentTool | null {
  const { ctx } = runtime;
  const approve = ctx.actionMode === "approve";
  const simulate = ctx.actionMode === "simulate";
  // Executing needs the user's own token; proposing only needs to know who it is for.
  if (approve && !ctx.bearerToken) return null;
  const proposer = ctx.userId ?? ctx.proposeAs;
  if (!approve && !simulate && !proposer) return null;
  const mode = approve ? "approve" : simulate ? "simulate" : "propose";

  return createAgentTool(definition.name, {
    description: `${definition.description} ${guidance(definition, mode)}`,
    inputSchema: definition.schema,
    execute: async (raw: Record<string, unknown>) => {
      const args = definition.schema.parse(raw) as Record<string, unknown>;
      if (simulate) return { simulated: true, wouldDo: definition.describe(args) };
      if (!approve) {
        const action = await createAction({
          source: "background",
          userId: proposer ?? "",
          connectionId: ctx.connectionId ?? null,
          tool: definition.name,
          args,
          description: definition.describe(args),
          tier: typeof definition.tier === "string" ? definition.tier : null,
          origin: "background",
        });
        return { proposed: true, actionId: action.id, status: "Waiting for approval in AI Governance › Approvals" };
      }
      if (!mayAct(ctx)) {
        return { error: "You need the ai:act permission to let the assistant run actions. Ask an admin, or do it yourself in CHouse." };
      }
      const actionCtx = runActionContext(ctx);
      const actor: Actor = { ...actionCtx, origin: "chat", runId: ctx.runId ?? null, threadId: ctx.threadId ?? null };
      try {
        const { tier } = await resolveTier(definition, args, actionCtx);
        if (tier === "t3") {
          const filed = await fileForApproval(definition, args, actor);
          return {
            submitted: true,
            actionId: filed.id,
            tier,
            status: "Sent for a second person's approval. It runs once someone else with this permission approves it in CHouse.",
          };
        }
        // A call the user approved in this chat was recorded when the run paused.
        const approved = ctx.runId ? await claimApprovedForRun(ctx.runId, definition.name) : null;
        const { action, result } = await performAction(definition, args, actor, { tier, actionId: approved?.id ?? null });
        return {
          done: true,
          actionId: action.id,
          tier,
          ...(undoAvailable(action) ? { undo: "The user can undo this from Activity for 24 hours." } : {}),
          result,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "The action failed" };
      }
    },
  });
}

export const ACTION_TOOLS: CatalogTool[] = ACTION_DEFINITIONS.map((definition) => ({
  name: definition.name,
  title: definition.title,
  domain: "chouse",
  category: definition.category,
  access: "write",
  tier: nominalTier(definition),
  toolkit: definition.toolkit,
  requires: null,
  permissions: definition.permissions,
  build: (runtime) => buildActionTool(definition, runtime),
}));
