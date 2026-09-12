/**
 * Writes toolset: reversible-ish operational actions.
 * Registered only when MCP_ALLOW_WRITES=true (ADR 0013 §4).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, toolContext } from "./helpers";

export function registerWriteTools(mcp: McpServer, deps: McpDeps): void {
  mcp.registerTool(
    "create_saved_query",
    {
      description: "Save a query definition for reuse.",
      inputSchema: {
        name: z.string().min(1).describe("Display name"),
        query: z.string().min(1).describe("The SQL to save"),
        description: z.string().optional().describe("Optional description"),
      },
    },
    async (args: { name: string; query: string; description?: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "create_saved_query", args.name, () =>
        deps.clientFor(ctx).request("POST", "/api/saved-queries", {
          body: { name: args.name, query: args.query, description: args.description },
        })
      );
    }
  );

  mcp.registerTool(
    "run_scheduled_job",
    {
      description: "Trigger a scheduled query to run now.",
      inputSchema: { id: z.string().min(1).describe("Scheduled query id") },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "run_scheduled_job", args.id, () =>
        deps.clientFor(ctx).request("POST", `/api/scheduled-queries/${encodeURIComponent(args.id)}/run`)
      );
    }
  );

  mcp.registerTool(
    "run_health_check",
    {
      description: "Evaluate a data-health check now.",
      inputSchema: { id: z.string().min(1).describe("Data-health check id") },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "run_health_check", args.id, () =>
        deps.clientFor(ctx).request("POST", `/api/data-health/${encodeURIComponent(args.id)}/run`)
      );
    }
  );

  mcp.registerTool(
    "acknowledge_incident",
    {
      description: "Acknowledge an open data-health incident.",
      inputSchema: { id: z.string().min(1).describe("Incident id") },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "acknowledge_incident", args.id, () =>
        deps.clientFor(ctx).request(
          "POST",
          `/api/data-health/incidents/${encodeURIComponent(args.id)}/acknowledge`
        )
      );
    }
  );

  mcp.registerTool(
    "test_alert_channel",
    {
      description: "Send a test notification through an alert channel (this pages people).",
      inputSchema: { id: z.string().min(1).describe("Alert channel id") },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "test_alert_channel", args.id, () =>
        deps.clientFor(ctx).request("POST", `/api/alerting/channels/${encodeURIComponent(args.id)}/test`)
      );
    }
  );
}
