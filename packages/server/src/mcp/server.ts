/**
 * MCP server assembly (ADR 0013, ADR 0017): every chouse tool is defined once
 * in the catalog with its category, access level and required permissions.
 * Each request builds an McpServer holding only the tools an administrator
 * enabled (AI Governance › MCP) that the caller's token can use, plus resources and
 * prompts. Tools are a thin projection of the existing API — every call runs
 * through the in-process proxy with the caller's own PAT, so there is exactly
 * one authn/authz implementation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Hono } from "hono";
import { McpApiClient } from "./api";
import { isToolEnabled, toolEnabledByDefault, type McpSettings } from "./settings";
import type { McpDeps, McpIdentity, McpToolContext } from "./types";
import { registerOnServer, type ChouseToolRegistration, type McpToolSink } from "./tools/helpers";
import { registerCoreTools } from "./tools/core";
import { registerExploreTools } from "./tools/explore";
import { registerQueryTools } from "./tools/query";
import { registerObserveTools } from "./tools/observe";
import { registerDataObservabilityTools, registerRemediationProposalTool, registerRemediationReadTools } from "./tools/dataObservability";
import { registerPerformanceTools } from "./tools/performance";
import { registerAiGovernanceTools } from "./tools/aiGovernance";
import { registerDashboardTools } from "./tools/dashboards";
import { registerWriteTools } from "./tools/writes";
import { registerDestructiveTools } from "./tools/destructive";
import { registerAiTools } from "./tools/ai";
import { actionToolListed, registerActionTools, type WriteAccess } from "./tools/actions";
import { registerResources } from "./resources";
import { registerPrompts } from "./prompts";

export const MCP_IMPLEMENTATION = {
  name: "chouse",
  version: "2.0.0",
} as const;

// Kept in its own module so the OAuth endpoints can name it without loading every tool.
export { MCP_PATH } from "./path";

export function buildMcpDeps(proxyApi: Hono): McpDeps {
  return {
    proxyApi,
    clientFor(ctx: McpToolContext): McpApiClient {
      return new McpApiClient(proxyApi, ctx, ctx.timeoutMs);
    },
  };
}

/** Every chouse tool definition, in registration order. */
export function collectTools(deps: McpDeps): ChouseToolRegistration[] {
  const tools: ChouseToolRegistration[] = [];
  const sink: McpToolSink = { add: (tool) => void tools.push(tool) };
  registerCoreTools(sink, deps);
  registerExploreTools(sink, deps);
  registerQueryTools(sink, deps);
  registerObserveTools(sink, deps);
  registerDataObservabilityTools(sink, deps);
  registerRemediationReadTools(sink, deps);
  registerPerformanceTools(sink, deps);
  registerDashboardTools(sink, deps);
  registerWriteTools(sink, deps);
  registerRemediationProposalTool(sink, deps);
  registerDestructiveTools(sink, deps);
  registerAiTools(sink, deps);
  registerAiGovernanceTools(sink, deps);
  // Last, so a generated write tool never replaces an MCP tool of the same name.
  registerActionTools(sink, deps, new Set(tools.map((tool) => tool.name)));
  return tools;
}

/** Deps for reading the catalog only; handlers never run against them. */
const CATALOG_DEPS: McpDeps = {
  proxyApi: new Hono(),
  clientFor(): McpApiClient {
    throw new Error("The MCP tool catalog cannot run tools");
  },
};

/** Every tool definition, for the catalog (AI Governance › MCP) and validation. */
export function listToolDefinitions(): ChouseToolRegistration[] {
  return collectTools(CATALOG_DEPS);
}

/** True when the identity holds at least one of the tool's permissions. */
function canUseTool(tool: Pick<ChouseToolRegistration, "permissions">, identity: Pick<McpIdentity, "permissions">): boolean {
  return tool.permissions.length === 0 || tool.permissions.some((permission) => identity.permissions.includes(permission));
}

export interface McpToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface McpToolCatalogEntry {
  name: string;
  title: string;
  description: string;
  category: ChouseToolRegistration["category"];
  access: ChouseToolRegistration["access"];
  spendsLlm: boolean;
  permissions: string[];
  parameters: McpToolParameter[];
  enabled: boolean;
  enabledByDefault: boolean;
}

interface ZodLike {
  description?: string;
  isOptional?: () => boolean;
  _def?: { type?: string; innerType?: ZodLike; entries?: Record<string, unknown> };
}

const WRAPPER_TYPES = new Set(["optional", "default", "prefault", "nullable"]);

function zodTypeName(schema: ZodLike): string {
  const type = schema._def?.type ?? "";
  if (WRAPPER_TYPES.has(type) && schema._def?.innerType) return zodTypeName(schema._def.innerType);
  if (type === "enum" && schema._def?.entries) return Object.values(schema._def.entries).join(" | ");
  return type || "unknown";
}

// Zod 4 keeps .describe() on the schema it was called on, so a description set
// before .optional() or .default() lives on the wrapped schema.
function zodDescription(schema: ZodLike): string | null {
  if (schema.description) return schema.description;
  const inner = WRAPPER_TYPES.has(schema._def?.type ?? "") ? schema._def?.innerType : undefined;
  return inner ? zodDescription(inner) : null;
}

/** Input parameters of a tool as plain data for the catalog. */
export function toolParameters(tool: Pick<ChouseToolRegistration, "inputSchema">): McpToolParameter[] {
  return Object.entries(tool.inputSchema ?? {}).map(([name, schema]) => {
    const zod = schema as unknown as ZodLike;
    return {
      name,
      type: zodTypeName(zod),
      required: !(zod.isOptional?.() ?? false),
      description: zodDescription(zod),
    };
  });
}

/** The catalog shown in AI Governance › MCP: every tool with its state. */
export function toolCatalog(tools: ChouseToolRegistration[], settings: Pick<McpSettings, "toolOverrides">): McpToolCatalogEntry[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    category: tool.category,
    access: tool.access,
    spendsLlm: tool.spendsLlm ?? false,
    permissions: [...tool.permissions],
    parameters: toolParameters(tool),
    enabled: isToolEnabled(settings, tool),
    enabledByDefault: toolEnabledByDefault(tool),
  }));
}

/**
 * Build the per-request MCP server: only tools that are enabled and that the
 * caller's token can use are listed, so an agent's context holds nothing it
 * would be refused.
 */
export function buildMcpServer(settings: Pick<McpSettings, "toolOverrides">, deps: McpDeps, identity: Pick<McpIdentity, "permissions">, writeAccess: WriteAccess | null = null): McpServer {
  const mcp = new McpServer(MCP_IMPLEMENTATION, {
    instructions:
      "CHouse UI operations over MCP. The tools listed are the ones an administrator enabled and this token may use; " +
      "every call runs under the token's own permissions and data-access policies. Tools that change or delete " +
      "things are marked destructive or non-read-only — ask the human to approve them via your client's permission " +
      "prompt before calling. Never send personal access tokens or secrets into tool arguments or prompts.",
  });

  const tools = collectTools(deps);
  // Generated write tools (ADR 0025) also need the write ceiling and the token's policy.
  const writeListed = (tool: ChouseToolRegistration): boolean => {
    if (!tool.action) return true;
    if (!writeAccess) return false;
    if (tool.action.toolkit && tool.action.tier) return actionToolListed({ toolkit: tool.action.toolkit, tier: tool.action.tier }, writeAccess);
    return tools.some((other) => other.action?.toolkit && other.action.tier && canUseTool(other, identity)
      && actionToolListed({ toolkit: other.action.toolkit, tier: other.action.tier }, writeAccess));
  };
  for (const tool of tools) {
    if (isToolEnabled(settings, tool) && canUseTool(tool, identity) && writeListed(tool)) {
      registerOnServer(mcp, tool);
    }
  }

  registerResources(mcp, deps);
  registerPrompts(mcp);

  return mcp;
}
