/**
 * Writes toolset: reversible-ish operational actions.
 * Registered only when MCP_ALLOW_WRITES=true (ADR 0013 §4).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, toolContext, argString, argOptionalString, registerChouseTool } from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const createSavedQuerySchema: Record<string, z.ZodTypeAny> = {
  name: z.string().min(1).describe("Display name"),
  query: z.string().min(1).describe("The SQL to save"),
  description: z.string().optional().describe("Optional description"),
};

const idSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Resource id"),
};

export function registerWriteTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "create_saved_query",
    description: "Save a query definition for reuse.",
    inputSchema: createSavedQuerySchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const name = argString(args, "name");
      return runApiTool(ctx, deps.clientFor(ctx), "create_saved_query", name, () =>
        deps.clientFor(ctx).request("POST", "/api/saved-queries", {
          body: {
            name,
            query: argString(args, "query"),
            description: argOptionalString(args, "description"),
          },
        })
      );
    },
  });

  registerChouseTool(mcp, {
    name: "run_scheduled_job",
    description: "Trigger a scheduled query to run now.",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "run_scheduled_job", id, () =>
        deps.clientFor(ctx).request("POST", `/api/scheduled-queries/${encodeURIComponent(id)}/run`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "run_health_check",
    description: "Evaluate a data-health check now.",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "run_health_check", id, () =>
        deps.clientFor(ctx).request("POST", `/api/data-health/${encodeURIComponent(id)}/run`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "acknowledge_incident",
    description: "Acknowledge an open data-health incident.",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "acknowledge_incident", id, () =>
        deps.clientFor(ctx).request(
          "POST",
          `/api/data-health/incidents/${encodeURIComponent(id)}/acknowledge`
        )
      );
    },
  });

  registerChouseTool(mcp, {
    name: "test_alert_channel",
    description: "Send a test notification through an alert channel (this pages people).",
    inputSchema: idSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "test_alert_channel", id, () =>
        deps.clientFor(ctx).request("POST", `/api/alerting/channels/${encodeURIComponent(id)}/test`)
      );
    },
  });
}
