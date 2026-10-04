/**
 * Identity tools: who the token is and which connections it can use.
 * All tools are read-only and on by default.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import { runApiTool, toolContext, argString, registerChouseTool, type McpToolSink } from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const useConnectionSchema: Record<string, z.ZodTypeAny> = {
  connection_id: z.string().min(1).describe("Connection id to validate and adopt"),
};

export function registerCoreTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "whoami",
    title: "Who am I",
    category: "identity",
    access: "read",
    permissions: [],
    description:
      "Report the authenticated user's identity, roles, permissions, and active connection context. Use this first to learn what the agent is allowed to do.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "whoami", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/auth/profile")
      );
    },
  });

  registerChouseTool(sink, {
    name: "list_connections",
    title: "List connections",
    category: "identity",
    access: "read",
    permissions: [PERMISSIONS.CONNECTIONS_VIEW],
    description: "List the ClickHouse connections visible to this token.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_connections", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/connections")
      );
    },
  });

  registerChouseTool(sink, {
    name: "use_connection",
    title: "Check a connection",
    category: "identity",
    access: "read",
    permissions: [PERMISSIONS.CONNECTIONS_VIEW],
    description:
      "Validate a connection id and return its details. To operate on that connection, pass the id as the connection_id argument on other tools (or set the X-Connection-Id request header). Never mutates state.",
    inputSchema: useConnectionSchema,
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
