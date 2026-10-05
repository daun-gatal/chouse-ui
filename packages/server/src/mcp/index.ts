/**
 * MCP HTTP endpoint (ADR 0013, ADR 0017).
 *
 * Served at `/mcp` on the main web port, so it reaches agents through the
 * same Service, Ingress and TLS as the UI — no second listener to expose.
 * Every request: settings check (an administrator turns MCP on in
 * AI Governance › MCP), Origin validation (spec MUST), PAT-only auth via
 * verifyBearer(), then the stateless Streamable HTTP transport (no protocol
 * sessions, so multi-replica is correct with zero pod-local state).
 *
 * Stateless mode requires a fresh transport + server per request (the SDK's
 * documented pattern); both are cheap — tool registration is plain object
 * wiring, and nothing authoritative lives in process memory (ADR 0010).
 */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { AppError } from "../types";
import { describeAgentClient, initializeClientName } from "../services/agents/clients";
import * as agentStore from "../services/agents/store";
import { logger } from "../utils/logger";
import { createMcpAuthMiddleware, type McpTokenVerifier } from "./auth";
import { originGuard } from "./origin";
import { getMcpSettings, type StoredMcpSettings } from "./settings";
import type { McpDeps, McpIdentity, McpToolContext } from "./types";
import { buildMcpServer } from "./server";

declare module "hono" {
  interface ContextVariableMap {
    mcpSettings: StoredMcpSettings;
  }
}

export interface McpAppOptions {
  /** Test seam: overrides the production verifyBearer()-backed verifier. */
  verifyToken?: McpTokenVerifier;
  /** Test seam: overrides the database-backed settings. */
  loadSettings?: () => Promise<StoredMcpSettings>;
}

/**
 * Build the MCP Hono app, to be mounted at `/mcp`. Every request is verified
 * independently, which is exactly the fail-closed property the rest of the
 * server relies on.
 */
export function createMcpApp(deps: McpDeps, options?: McpAppOptions): { app: Hono } {
  const app = new Hono();
  const loadSettings = options?.loadSettings ?? (() => getMcpSettings());

  app.use("*", async (c, next) => {
    const settings = await loadSettings();
    if (!settings.enabled) {
      return c.json(
        {
          success: false,
          error: {
            code: "MCP_DISABLED",
            message: "The MCP endpoint is turned off. An administrator can turn it on in AI Governance › MCP.",
          },
        },
        404
      );
    }
    c.set("mcpSettings", settings);
    await next();
  });
  app.use("*", (c, next) => originGuard(c.get("mcpSettings").allowedOrigins)(c, next));
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

  app.all("/", async (c) => {
    const settings = c.get("mcpSettings");
    const identity: McpIdentity = c.get("mcpIdentity");
    const token: string = c.get("mcpToken");
    const initializeName = c.req.method === "POST" ? initializeClientName(await c.req.raw.clone().json().catch(() => null)) : null;
    const clientName = describeAgentClient(initializeName) ?? describeAgentClient(c.req.header("User-Agent"));
    if (initializeName) {
      // Stateless MCP sees clientInfo only here; put it on the session now so every later call shows it.
      await agentStore.touchSession(identity.patId ?? null, identity.userId, "mcp", clientName).catch((err: unknown) => {
        logger.warn({ module: "Mcp", err: err instanceof Error ? err.message : String(err) }, "Failed to record MCP client");
      });
    }
    const mcp: McpToolContext = {
      identity,
      token,
      connectionId: c.req.header("X-Connection-Id"),
      clientIp: c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP"),
      clientName,
      timeoutMs: settings.timeoutSeconds * 1000,
    };

    const mcpServer = buildMcpServer(settings, deps, identity);
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
