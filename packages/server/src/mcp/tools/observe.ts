/**
 * Observe toolset: fleet health, live queries, scheduled jobs, data health,
 * alerting, and the audit trail. Read-only.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, toolContext, argString, argNumber, argEnum, registerChouseTool } from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const getJobSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Scheduled query id"),
};

const getHealthSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Data-health check id"),
};

const listAlertsSchema: Record<string, z.ZodTypeAny> = {
  kind: z.enum(["channels", "rules", "events"]).describe("Which alerting object to list"),
};

const auditListSchema: Record<string, z.ZodTypeAny> = {
  limit: z.number().int().min(1).max(100).default(20).describe("Entries to return"),
};

export function registerObserveTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "metrics_overview",
    description: "Server metrics overview: cluster stats and current load.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "metrics_overview", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/metrics/stats")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "live_queries",
    description: "List currently running ClickHouse queries.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "live_queries", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/live-queries")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "fleet_snapshots",
    description: "Latest fleet health snapshots across connections.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "fleet_snapshots", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/fleet/snapshots")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_scheduled_jobs",
    description: "List scheduled queries.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_scheduled_jobs", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/scheduled-queries")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "get_scheduled_job",
    description: "Get one scheduled query by id.",
    inputSchema: getJobSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_scheduled_job", id, () =>
        deps.clientFor(ctx).request("GET", `/api/scheduled-queries/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_scheduled_runs",
    description: "Run history for one scheduled query.",
    inputSchema: getJobSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "list_scheduled_runs", id, () =>
        deps.clientFor(ctx).request("GET", `/api/scheduled-queries/${encodeURIComponent(id)}/runs`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_health_checks",
    description: "List data-health promises (checks).",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_health_checks", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/data-health")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "get_health_check",
    description: "Get one data-health check by id, including its incidents.",
    inputSchema: getHealthSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_health_check", id, () =>
        deps.clientFor(ctx).request("GET", `/api/data-health/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "health_timeline",
    description: "Evaluation timeline for one data-health check.",
    inputSchema: getHealthSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "health_timeline", id, () =>
        deps.clientFor(ctx).request("GET", `/api/data-health/${encodeURIComponent(id)}/timeline`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_alerts",
    description: "List alerting configuration and events: channels, rules, or events.",
    inputSchema: listAlertsSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const kind = argEnum(args, "kind", ["channels", "rules", "events"]);
      if (!kind) {
        return runApiTool(ctx, deps.clientFor(ctx), "list_alerts", undefined, async () => {
          throw new Error("kind must be one of: channels, rules, events");
        });
      }
      return runApiTool(ctx, deps.clientFor(ctx), "list_alerts", kind, () =>
        deps.clientFor(ctx).request("GET", `/api/alerting/${kind}`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "audit_list",
    description: "List the caller's audit trail (global entries require audit:view).",
    inputSchema: auditListSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const limit = Math.min(100, Math.max(1, argNumber(args, "limit", 20)));
      return runApiTool(ctx, deps.clientFor(ctx), "audit_list", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/audit", { query: { limit: String(limit) } })
      );
    },
  });
}
