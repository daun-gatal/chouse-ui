/**
 * Which registry agents a chat user may talk to (ADR 0019 §9).
 *
 * A chat agent is an enabled agent without a task template (structured-feature
 * agents have one). The picker offers the top-level ones: routers, agents
 * placed directly under a router, the chat feature's bound agent, and agents
 * nobody uses as a subagent. Specialists wired under another agent stay behind
 * it. An agent's `requiredPermissions` gate it per user.
 */

import type { AgentRunContext } from "../types";
import type { AgentDef, RegistrySnapshot } from "./types";

export function userMayUseAgent(agent: AgentDef, ctx: Pick<AgentRunContext, "isAdmin" | "permissions">): boolean {
  if (agent.requiredPermissions.length === 0 || ctx.isAdmin) return true;
  const held = new Set(ctx.permissions ?? []);
  return agent.requiredPermissions.some((p) => held.has(p));
}

export function isChatAgent(agent: AgentDef): boolean {
  return agent.enabled && agent.taskTemplate === null;
}

/** Top-level chat agents the user may pick, routers first. */
export function chatAgentCandidates(snapshot: RegistrySnapshot, ctx: Pick<AgentRunContext, "isAdmin" | "permissions">): AgentDef[] {
  const underNonRouter = new Set<string>();
  for (const agent of snapshot.agents.values()) {
    if (agent.kind === "router") continue;
    for (const child of agent.subagents) underNonRouter.add(child);
  }
  const boundId = snapshot.bindings.get("chat")?.agentId;
  return [...snapshot.agents.values()]
    .filter((agent) => isChatAgent(agent) && userMayUseAgent(agent, ctx))
    .filter((agent) => agent.kind === "router" || agent.id === boundId || !underNonRouter.has(agent.id))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "router" ? -1 : 1));
}
