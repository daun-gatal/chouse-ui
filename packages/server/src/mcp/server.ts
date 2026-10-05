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
import { registerDataObservabilityTools, registerRemediationProposalTool } from "./tools/dataObservability";
import { registerWriteTools } from "./tools/writes";
import { registerDestructiveTools } from "./tools/destructive";
import { registerAiTools } from "./tools/ai";
import { registerResources } from "./resources";
import { registerPrompts } from "./prompts";

export const MCP_IMPLEMENTATION = {
  name: "chouse",
  version: "2.0.0",
} as const;

/** Path the endpoint is served on, on the main web port. */
export const MCP_PATH = "/mcp";

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
  registerWriteTools(sink, deps);
  registerRemediationProposalTool(sink, deps);
  registerDestructiveTools(sink, deps);
  registerAiTools(sink, deps);
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
  _def?: { typeName?: string; innerType?: ZodLike; values?: unknown };
}

function zodTypeName(schema: ZodLike): string {
  const typeName = schema._def?.typeName ?? "";
  if ((typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodNullable") && schema._def?.innerType) {
    return zodTypeName(schema._def.innerType);
  }
  if (typeName === "ZodEnum" && Array.isArray(schema._def?.values)) return schema._def.values.join(" | ");
  return typeName.replace(/^Zod/, "").toLowerCase() || "unknown";
}

/** Input parameters of a tool as plain data for the catalog. */
export function toolParameters(tool: Pick<ChouseToolRegistration, "inputSchema">): McpToolParameter[] {
  return Object.entries(tool.inputSchema ?? {}).map(([name, schema]) => {
    const zod = schema as unknown as ZodLike;
    return {
      name,
      type: zodTypeName(zod),
      required: !(zod.isOptional?.() ?? false),
      description: zod.description ?? null,
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
export function buildMcpServer(settings: Pick<McpSettings, "toolOverrides">, deps: McpDeps, identity: Pick<McpIdentity, "permissions">): McpServer {
  const mcp = new McpServer(MCP_IMPLEMENTATION, {
    instructions:
      "CHouse UI operations over MCP. The tools listed are the ones an administrator enabled and this token may use; " +
      "every call runs under the token's own permissions and data-access policies. Tools that change or delete " +
      "things are marked destructive or non-read-only — ask the human to approve them via your client's permission " +
      "prompt before calling. Never send personal access tokens or secrets into tool arguments or prompts.",
  });

  for (const tool of collectTools(deps)) {
    if (isToolEnabled(settings, tool) && canUseTool(tool, identity)) {
      registerOnServer(mcp, tool);
    }
  }

  registerResources(mcp, deps);
  registerPrompts(mcp);

  return mcp;
}
