/**
 * Shared MCP types: the verified identity attached by mcpAuthMiddleware and
 * the context handed to every tool handler via the transport's AuthInfo.
 */

import type { Hono } from "hono";
import type { McpApiClient } from "./api";

export interface McpIdentity {
  userId: string;
  email: string;
  username: string;
  roles: string[];
  permissions: string[];
  patId?: string;
  patName?: string;
}

export interface McpToolContext {
  identity: McpIdentity;
  /** The raw PAT supplied by the client — forwarded to API subrequests and never logged. */
  token: string;
  /** X-Connection-Id from the MCP request, if the client pinned one. */
  connectionId?: string;
  clientIp?: string;
}

/**
 * Static dependencies shared by every tool registration: the in-process
 * proxy app and the timeout policy. A per-request client is built from the
 * tool context (each request carries its own PAT and connection).
 */
export interface McpDeps {
  proxyApi: Hono;
  timeoutMs: number;
  clientFor(ctx: McpToolContext): McpApiClient;
}
