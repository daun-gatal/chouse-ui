/**
 * MCP server assembly (ADR 0013): builds the McpServer with the toolsets the
 * operator enabled, plus resources and prompts. Tools are a thin projection
 * of the existing API — every call runs through the in-process proxy with the
 * caller's own PAT, so there is exactly one authn/authz implementation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { Hono } from "hono";
import { McpApiClient } from "./api";
import type { McpConfig } from "./config";
import type { McpDeps, McpToolContext } from "./types";
import { registerCoreTools } from "./tools/core";
import { registerExploreTools } from "./tools/explore";
import { registerQueryTools } from "./tools/query";
import { registerObserveTools } from "./tools/observe";
import { registerWriteTools } from "./tools/writes";
import { registerDestructiveTools } from "./tools/destructive";
import { registerAiTools } from "./tools/ai";
import { registerResources } from "./resources";
import { registerPrompts } from "./prompts";

export const MCP_IMPLEMENTATION = {
  name: "chouse",
  version: "1.0.0",
} as const;

export function buildMcpDeps(proxyApi: Hono, timeoutMs: number): McpDeps {
  return {
    proxyApi,
    timeoutMs,
    clientFor(ctx: McpToolContext): McpApiClient {
      return new McpApiClient(proxyApi, ctx, timeoutMs);
    },
  };
}

export function buildMcpServer(config: McpConfig, deps: McpDeps): McpServer {
  const mcp = new McpServer(MCP_IMPLEMENTATION, {
    instructions:
      "CHouse UI operations over MCP (ADR 0013). Tools are read-only unless the operator enabled writes; " +
      "destructive tools require human approval (elicitation) in this host. Never send personal access " +
      "tokens or secrets into tool arguments or prompts.",
  });

  const toolsets = new Set(config.toolsets);
  if (toolsets.has("core")) registerCoreTools(mcp, deps);
  if (toolsets.has("explore")) registerExploreTools(mcp, deps);
  if (toolsets.has("query")) registerQueryTools(mcp, deps);
  if (toolsets.has("observe")) registerObserveTools(mcp, deps);
  if (toolsets.has("writes") && config.allowWrites) registerWriteTools(mcp, deps);
  if (toolsets.has("destructive") && config.allowDestructive) registerDestructiveTools(mcp, deps);
  if (toolsets.has("ai")) registerAiTools(mcp, deps);

  registerResources(mcp, deps);
  registerPrompts(mcp);

  return mcp;
}
