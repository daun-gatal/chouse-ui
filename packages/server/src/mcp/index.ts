/**
 * MCP HTTP application (ADR 0013 §1/§2).
 *
 * A dedicated Hono app for the MCP port: Origin validation (spec MUST),
 * PAT-only auth via verifyBearer(), and the stateless Streamable HTTP
 * transport (2026-07-28 — no protocol sessions, so multi-replica is correct
 * with zero pod-local state).
 *
 * Stateless mode requires a fresh transport + server per request (the SDK's
 * documented pattern); both are cheap — tool registration is plain object
 * wiring, and nothing authoritative lives in process memory (ADR 0010).
 */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { AppError } from "../types";
import { createMcpAuthMiddleware, type McpTokenVerifier } from "./auth";
import { originGuard } from "./origin";
import type { McpConfig } from "./config";
import type { McpDeps, McpIdentity, McpToolContext } from "./types";
import { buildMcpServer } from "./server";

export interface McpAppOptions {
  /** Test seam: overrides the production verifyBearer()-backed verifier. */
  verifyToken?: McpTokenVerifier;
}

/**
 * Build the MCP Hono app. Every request is verified independently, which is
 * exactly the fail-closed property the rest of the server relies on.
 */
export function createMcpApp(
  config: McpConfig,
  deps: McpDeps,
  options?: McpAppOptions
): { app: Hono } {
  const app = new Hono();

  app.use("*", originGuard(config.allowedOrigins));
  app.use("*", createMcpAuthMiddleware(options?.verifyToken));

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { success: false, error: { code: error.code, message: error.message } },
        error.statusCode as ContentfulStatusCode
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: { code: "MCP_ERROR", message } }, 500);
  });

  app.all("/mcp", async (c) => {
    const identity: McpIdentity = c.get("mcpIdentity");
    const token: string = c.get("mcpToken");
    const mcp: McpToolContext = {
      identity,
      token,
      connectionId: c.req.header("X-Connection-Id"),
      clientIp: c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP"),
    };

    const mcpServer = buildMcpServer(config, deps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // A client disconnect is the per-request lifecycle signal: release the
    // server + transport immediately (nothing here is authoritative state).
    const abort = c.req.raw.signal;
    if (abort.aborted) {
      void mcpServer.close();
    } else {
      abort.addEventListener("abort", () => void mcpServer.close(), { once: true });
    }

    await mcpServer.connect(transport);
    return transport.handleRequest(c.req.raw, {
      authInfo: {
        token,
        clientId: identity.patId ?? identity.userId,
        scopes: identity.permissions,
        extra: { mcp },
      },
    });
  });

  return { app };
}
