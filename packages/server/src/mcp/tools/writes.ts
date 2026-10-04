/**
 * Write tools: reversible-ish operational actions.
 * Off until an administrator turns each one on in Agents › MCP (ADR 0017).
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import { runApiTool, toolContext, argString, argOptionalString, registerChouseTool, type McpToolSink } from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const createSavedQuerySchema: Record<string, z.ZodTypeAny> = {
  name: z.string().min(1).describe("Display name"),
  query: z.string().min(1).describe("The SQL to save"),
  description: z.string().optional().describe("Optional description"),
};

const idSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Resource id"),
};

export function registerWriteTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "create_saved_query",
    title: "Save a query",
    category: "query",
    access: "write",
    permissions: [PERMISSIONS.SAVED_QUERIES_CREATE],
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

  registerChouseTool(sink, {
    name: "run_scheduled_job",
    title: "Run a scheduled job now",
    category: "scheduling",
    access: "write",
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_RUN],
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

  registerChouseTool(sink, {
    name: "run_health_check",
    title: "Run a data health check",
    category: "data_health",
    access: "write",
    permissions: [PERMISSIONS.DATA_HEALTH_RUN],
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

  registerChouseTool(sink, {
    name: "acknowledge_incident",
    title: "Acknowledge an incident",
    category: "data_health",
    access: "write",
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
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

  registerChouseTool(sink, {
    name: "test_alert_channel",
    title: "Test an alert channel",
    category: "monitoring",
    access: "write",
    permissions: [PERMISSIONS.ALERTING_EDIT],
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
