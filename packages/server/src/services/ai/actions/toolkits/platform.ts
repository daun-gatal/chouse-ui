/**
 * Platform & Audit toolkit (ADR 0025 §2): drafting custom AI agents, running
 * their evals, publishing them, and the caller's own preferences.
 *
 * AI never changes its own controls: guardrails, budgets, MCP and agent
 * governance, approvals and tokens are not tools at all (see coverage.ts).
 * A draft agent starts disabled; publishing it is T3, and the registry's
 * eval gate still applies.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import type { ActionDefinition } from "../types";
import { given, idOf, quote, record, seg, str } from "./shared";

const FOCUSED_HARNESS = "builtin-harness-focused";

export const PLATFORM_ACTIONS: ActionDefinition[] = [
  {
    name: "draft_ai_agent",
    title: "Draft an AI agent",
    toolkit: "platform",
    category: "ai",
    tier: "t1",
    connectionScoped: false,
    permissions: [PERMISSIONS.AI_AGENTS_MANAGE],
    description: "Save a new custom chat agent as a disabled draft: a prompt and the catalog tools it may use. Nobody can chat with it until it is published.",
    schema: z.object({
      slug: z.string().regex(/^[a-z][a-z0-9-]*$/).max(63),
      name: z.string().min(1).max(100),
      description: z.string().max(1024),
      systemPrompt: z.string().min(1).max(100_000),
      tools: z.array(z.string()).max(200).describe("Catalog tool names"),
      subagents: z.array(z.string()).max(20).optional().describe("Agent ids"),
    }),
    describe: (args) => `Draft the agent ${quote(str(args.name))} with ${Array.isArray(args.tools) ? args.tools.length : 0} tool(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/ai-agents/agents", {
      ...given(args, ["slug", "name", "description", "systemPrompt", "tools"]),
      subagents: Array.isArray(args.subagents) ? args.subagents : [],
      kind: "agent",
      taskTemplate: null,
      modelConfigId: null,
      harnessId: FOCUSED_HARNESS,
      tuning: { stepBudget: 10 },
      requiredPermissions: [],
      skills: [],
      enabled: false,
    }),
    undo: { mode: "delete-created", resource: "ai_agent", id: (result) => idOf(result) },
  },
  {
    name: "run_ai_eval",
    title: "Run an agent's evals",
    toolkit: "platform",
    category: "ai",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.AI_AGENTS_MANAGE],
    description: "Run an agent's eval cases and score them (it calls the AI model once per case).",
    schema: z.object({ agentId: z.string().min(1) }),
    describe: (args) => `Run the evals of the agent ${quote(str(args.agentId))}`,
    execute: async (args, ctx) => ctx.api.post(`/api/ai-evals/agents/${seg(args.agentId)}/runs`, {}),
  },
  {
    name: "publish_ai_agent",
    title: "Publish an AI agent",
    toolkit: "platform",
    category: "ai",
    tier: "t3",
    connectionScoped: false,
    permissions: [PERMISSIONS.AI_AGENTS_MANAGE],
    description: "Turn a drafted (disabled) custom agent on so people can chat with it. If the agent has an eval threshold, its evals must pass first.",
    schema: z.object({ id: z.string().min(1) }),
    describe: (args) => `Publish the agent ${quote(str(args.id))}`,
    execute: async (args, ctx) => {
      const registry = await ctx.api.get<{ agents?: Array<Record<string, unknown>> }>("/api/ai-agents/registry");
      const agent = (registry.agents ?? []).find((a) => a.id === args.id);
      if (!agent) throw new Error("Agent not found");
      if (agent.isSystem === true) throw new Error("Built-in agents are managed in AI Governance, not by the assistant");
      const body = Object.fromEntries(["slug", "name", "description", "kind", "systemPrompt", "taskTemplate", "modelConfigId", "harnessId", "tuning", "requiredPermissions", "tools", "skills", "subagents"].map((k) => [k, agent[k]]));
      const skills = Array.isArray(body.skills) ? body.skills.map((s) => {
        const link = record(s);
        return { skillId: link.skillId, mode: link.mode, pinnedFile: link.pinnedFile ?? null };
      }) : [];
      return ctx.api.put(`/api/ai-agents/agents/${seg(args.id)}`, { ...body, skills, enabled: true, version: agent.version });
    },
  },
  {
    name: "update_my_preferences",
    title: "Change my preferences",
    toolkit: "platform",
    category: "identity",
    tier: "t1",
    connectionScoped: false,
    permissions: [],
    description: "Change the user's own Explorer preferences (sort order, view mode, favorites only).",
    schema: z.object({
      explorerSortBy: z.enum(["name", "date", "size"]).optional(),
      explorerViewMode: z.enum(["tree", "list", "compact"]).optional(),
      explorerShowFavoritesOnly: z.boolean().optional(),
    }),
    describe: (args) => `Set my preferences (${["explorerSortBy", "explorerViewMode", "explorerShowFavoritesOnly"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => ctx.api.put("/api/rbac/user-preferences/preferences", given(args, ["explorerSortBy", "explorerViewMode", "explorerShowFavoritesOnly"])),
  },
];
