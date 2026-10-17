/**
 * AI governance tools (ADR 0019, ADR 0020): what CHouse's own AI agents cost
 * and which data they sent to LLM providers, and how the agents are set up.
 * Read-only projections of AI Governance › AI activity and › Assistant; a
 * token without ai_usage:view sees only its owner's own requests, exactly as
 * in the UI.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import { summarizeRegistry, type RegistryPayload } from "../../services/ai/registry/summary";
import { REQUEST_ORIGINS } from "../../services/ai/usage/queries";
import type { McpDeps } from "../types";
import { argOptionalNumber, argOptionalString, argString, registerChouseTool, runApiTool, toolContext, type McpToolSink } from "./helpers";

const USAGE_PERMISSIONS = [PERMISSIONS.AI_USAGE_VIEW, PERMISSIONS.AI_CHAT, PERMISSIONS.AI_OPTIMIZE];

const daysArg = z.number().int().min(1).max(365).optional().describe("Window in days (default 7; capped at the server's retention)");

const usageSchema: Record<string, z.ZodTypeAny> = { days: daysArg };

const egressSchema: Record<string, z.ZodTypeAny> = {
  days: daysArg,
  q: z.string().min(1).max(200).optional().describe("Only sources whose name contains this text (a table or CHouse record type)"),
};

const requestsSchema: Record<string, z.ZodTypeAny> = {
  days: daysArg,
  q: z.string().min(1).max(200).optional().describe("Match on user, agent, feature, client, token name or a table sent to the model"),
  origin: z.enum(REQUEST_ORIGINS).optional().describe("Only requests started from the UI, by MCP agents, by token callers (CLI, scripts) or in the background"),
  limit: z.number().int().min(1).max(200).optional().describe("Rows to return (default 50)"),
  offset: z.number().int().min(0).optional().describe("Rows to skip, for paging"),
};

const requestSchema: Record<string, z.ZodTypeAny> = { id: z.string().min(1).describe("AI request id from list_ai_requests") };

/** Query parameters with the optional ones left out. */
function params(entries: Record<string, string | number | undefined>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) query[key] = String(value);
  return query;
}

export function registerAiGovernanceTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "get_ai_usage",
    title: "AI usage",
    category: "ai_governance",
    access: "read",
    permissions: USAGE_PERMISSIONS,
    description:
      "What CHouse's AI chat and features used in a window: requests, tokens, estimated cost (priced models only), ClickHouse read by AI tools, " +
      "rows sent to providers, the split by origin (UI, MCP agents, tokens, background) and usage by model. " +
      "`scope` says whether it covers everyone (ai_usage:view) or only the token owner's own requests.",
    inputSchema: usageSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const query = params({ days: argOptionalNumber(args, "days") });
      return runApiTool(ctx, api, "get_ai_usage", query.days, async () => {
        const summary = await api.request("GET", "/api/ai-usage/summary", { query });
        const models = await api.request<{ models: unknown[] }>("GET", "/api/ai-usage/models", { query });
        return { summary, models: models.models };
      });
    },
  });

  registerChouseTool(sink, {
    name: "get_ai_data_egress",
    title: "Data sent to AI providers",
    category: "ai_governance",
    access: "read",
    permissions: USAGE_PERMISSIONS,
    description:
      "Tables, columns and CHouse record types that AI tools returned to an LLM provider, most rows first: rows, bytes, users, requests and providers per source.",
    inputSchema: egressSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const query = params({ days: argOptionalNumber(args, "days"), q: argOptionalString(args, "q") });
      return runApiTool(ctx, api, "get_ai_data_egress", query.q, () => api.request("GET", "/api/ai-usage/egress", { query }));
    },
  });

  registerChouseTool(sink, {
    name: "list_ai_requests",
    title: "AI requests",
    category: "ai_governance",
    access: "read",
    permissions: USAGE_PERMISSIONS,
    description:
      "Recent AI requests, newest first: who and what started each (origin, token, client), the agent, tokens, cost, ClickHouse read, rows sent and status. " +
      "Prompt and response text are never stored.",
    inputSchema: requestsSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const query = params({
        days: argOptionalNumber(args, "days"),
        q: argOptionalString(args, "q"),
        origin: argOptionalString(args, "origin"),
        limit: argOptionalNumber(args, "limit"),
        offset: argOptionalNumber(args, "offset"),
      });
      return runApiTool(ctx, api, "list_ai_requests", query.origin ?? query.q, () => api.request("GET", "/api/ai-usage/requests", { query }));
    },
  });

  registerChouseTool(sink, {
    name: "get_ai_request",
    title: "AI request",
    category: "ai_governance",
    access: "read",
    permissions: USAGE_PERMISSIONS,
    description: "One AI request step by step: each LLM call with tokens and cost, each tool call with the ClickHouse queries it ran and the data it sent to the model.",
    inputSchema: requestSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const id = argString(args, "id");
      return runApiTool(ctx, api, "get_ai_request", id, () => api.request("GET", `/api/ai-usage/requests/${encodeURIComponent(id)}`));
    },
  });

  registerChouseTool(sink, {
    name: "list_ai_agents",
    title: "AI agents",
    category: "ai_governance",
    access: "read",
    permissions: [PERMISSIONS.AI_AGENTS_VIEW],
    description:
      "How CHouse's AI is set up: which agent each AI feature runs, and each agent's model, harness, tools, skills, subagents and tuning, " +
      "whether it is built in or customized and has an update. Prompt templates and skill files are left out.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      return runApiTool(ctx, api, "list_ai_agents", undefined, async () =>
        summarizeRegistry(await api.request<RegistryPayload>("GET", "/api/ai-agents/registry"))
      );
    },
  });

  registerChouseTool(sink, {
    name: "list_ai_guardrails",
    title: "AI guardrails",
    category: "ai_governance",
    access: "read",
    permissions: [PERMISSIONS.AI_GUARDRAILS_VIEW],
    description:
      "The guardrails every CHouse AI run (and, where enabled, every MCP tool result) passes through: kind, stages, action, " +
      "shadow or enforce mode, scope, order, whether it is on, and its triggers in the last 24 hours.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      return runApiTool(ctx, api, "list_ai_guardrails", undefined, async () => {
        const data = await api.request<{ guardrails: unknown[] }>("GET", "/api/ai-guardrails");
        return { guardrails: data.guardrails };
      });
    },
  });

  registerChouseTool(sink, {
    name: "list_ai_guardrail_triggers",
    title: "AI guardrail triggers",
    category: "ai_governance",
    access: "read",
    permissions: [PERMISSIONS.AI_GUARDRAILS_VIEW],
    description:
      "Recent guardrail triggers, newest first: guardrail, stage, action, mode, how many values matched, agent and tool, and the AI request. " +
      "Returns the total too; page with limit and offset. Matched values are never stored.",
    inputSchema: {
      days: daysArg,
      guardrailId: z.string().min(1).optional().describe("Only this guardrail's triggers (id from list_ai_guardrails)"),
      limit: z.number().int().min(1).max(500).optional().describe("Rows to return (default 100)"),
      offset: z.number().int().min(0).optional().describe("Rows to skip, for paging"),
    },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const query = params({ days: argOptionalNumber(args, "days"), guardrailId: argOptionalString(args, "guardrailId"), limit: argOptionalNumber(args, "limit"), offset: argOptionalNumber(args, "offset") });
      return runApiTool(ctx, api, "list_ai_guardrail_triggers", query.guardrailId, () => api.request("GET", "/api/ai-guardrails/events", { query }));
    },
  });
}
