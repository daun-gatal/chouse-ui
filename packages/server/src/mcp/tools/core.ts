/**
 * Core toolset: identity and connection context.
 * All tools are read-only and available by default.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, toolContext, argString, registerChouseTool } from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const useConnectionSchema: Record<string, z.ZodTypeAny> = {
  connection_id: z.string().min(1).describe("Connection id to validate and adopt"),
};

export function registerCoreTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "whoami",
    description:
      "Report the authenticated user's identity, roles, permissions, and active connection context. Use this first to learn what the agent is allowed to do.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "whoami", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/auth/profile")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_connections",
    description: "List the ClickHouse connections visible to this token.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_connections", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/connections")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "use_connection",
    description:
      "Validate a connection id and return its details. To operate on that connection, pass the id as the connection_id argument on other tools (or set the X-Connection-Id request header). Never mutates state.",
    inputSchema: useConnectionSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const connectionId = argString(args, "connection_id");
      return runApiTool(ctx, deps.clientFor(ctx), "use_connection", connectionId, () =>
        deps.clientFor(ctx).request(
          "GET",
          `/api/rbac/connections/${encodeURIComponent(connectionId)}`
        )
      );
    },
  });
}
