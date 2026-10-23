/**
 * Catalog entries for the write tools (ADR 0024 §Phase 2).
 *
 * In a chat run (`actionMode: "approve"`) a low-risk tool is wrapped by the
 * per-call approval middleware, so its body only runs once the user approved
 * the call; it then executes as the user and records the outcome. In every
 * other run (`propose`) a write tool only records a pending action for someone
 * with `ai:act` to approve in AI Governance › Approvals.
 */

import { PERMISSIONS } from "../../../rbac/schema/base";
import { createAgentTool, type AgentTool } from "../langchainTools";
import type { AgentRunContext } from "../types";
import { InProcessApiClient } from "../registry/inProcessApi";
import type { CatalogTool, ToolRuntime } from "../registry/catalog";
import { ACTION_DEFINITIONS, type ActionDefinition } from "./definitions";
import { approvedActionForRun, createAction, finishAction } from "./store";

/** Whether the user may let an agent act (the `ai:act` permission, or admin). */
export function mayAct(ctx: Pick<AgentRunContext, "isAdmin" | "permissions">): boolean {
  return Boolean(ctx.isAdmin) || (ctx.permissions ?? []).includes(PERMISSIONS.AI_ACT);
}

/** A short, model-facing summary of what an action returned. */
function outcome(result: unknown): unknown {
  if (!result || typeof result !== "object") return result ?? { ok: true };
  const record = result as Record<string, unknown>;
  const keep = ["id", "name", "title", "status", "message", "killed", "approvalClass", "approvalsNeeded"];
  const picked = Object.fromEntries(Object.entries(record).filter(([key]) => keep.includes(key)));
  return Object.keys(picked).length > 0 ? picked : { ok: true };
}

/** Run an approved action as the user; shared by the chat tool and the Approvals page. */
export async function runAction(definition: ActionDefinition, args: Record<string, unknown>, ctx: { bearerToken: string; connectionId: string | null }): Promise<unknown> {
  const client = new InProcessApiClient(ctx.bearerToken, ctx.connectionId ?? undefined);
  return outcome(await definition.execute(args, { client, connectionId: ctx.connectionId }));
}

function buildActionTool(definition: ActionDefinition, runtime: ToolRuntime): AgentTool | null {
  const { ctx } = runtime;
  const approve = ctx.actionMode === "approve";
  // Executing needs the user's own token; proposing only needs to know who it is for.
  if (approve && !ctx.bearerToken) return null;
  const proposer = ctx.userId ?? ctx.proposeAs;
  if (!approve && !proposer) return null;
  const how = definition.risk === "high"
    ? "It changes nothing by itself; approvers decide in Fixes."
    : approve
      ? "The user approves, edits or rejects each call before it runs; say what you are about to do and why."
      : "Nobody is here to approve it now: the call is saved as a pending action for someone to approve later.";

  return createAgentTool(definition.name, {
    description: `${definition.description} ${how}`,
    inputSchema: definition.schema,
    execute: async (raw: Record<string, unknown>) => {
      const args = definition.schema.parse(raw) as Record<string, unknown>;
      if (!approve) {
        const action = await createAction({
          source: "background",
          userId: proposer ?? "",
          connectionId: ctx.connectionId ?? null,
          tool: definition.name,
          args,
          description: definition.describe(args),
        });
        return { proposed: true, actionId: action.id, status: "Waiting for approval in AI Governance › Approvals" };
      }
      if (!mayAct(ctx)) {
        return { error: "You need the ai:act permission to let the assistant run actions. Ask an admin, or do it yourself in CHouse." };
      }
      const record = ctx.runId ? await approvedActionForRun(ctx.runId, definition.name) : null;
      try {
        const result = await runAction(definition, args, { bearerToken: ctx.bearerToken ?? "", connectionId: ctx.connectionId ?? null });
        if (record) await finishAction(record.id, { result });
        return { done: true, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The action failed";
        if (record) await finishAction(record.id, { error: message });
        return { error: message };
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
  risk: definition.risk,
  requires: null,
  permissions: definition.permissions,
  build: (runtime) => buildActionTool(definition, runtime),
}));
