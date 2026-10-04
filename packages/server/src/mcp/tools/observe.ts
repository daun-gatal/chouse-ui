/**
 * Observe tools: fleet health, live queries, scheduled jobs, data health,
 * alerting, and the audit trail. Read-only.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import { runApiTool, toolContext, argString, argNumber, argEnum, registerChouseTool, type McpToolSink } from "./helpers";

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

export function registerObserveTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "metrics_overview",
    title: "Server metrics",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.METRICS_VIEW],
    description: "Server metrics overview: cluster stats and current load.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "metrics_overview", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/metrics/stats")
      );
    },
  });

  registerChouseTool(sink, {
    name: "live_queries",
    title: "Running queries",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.LIVE_QUERIES_VIEW],
    description: "List currently running ClickHouse queries.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "live_queries", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/live-queries")
      );
    },
  });

  registerChouseTool(sink, {
    name: "fleet_snapshots",
    title: "Fleet health",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.FLEET_VIEW],
    description: "Latest fleet health snapshots across connections.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "fleet_snapshots", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/fleet/snapshots")
      );
    },
  });

  registerChouseTool(sink, {
    name: "list_scheduled_jobs",
    title: "List scheduled jobs",
    category: "scheduling",
    access: "read",
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_VIEW],
    description: "List scheduled queries.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_scheduled_jobs", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/scheduled-queries")
      );
    },
  });

  registerChouseTool(sink, {
    name: "get_scheduled_job",
    title: "Get a scheduled job",
    category: "scheduling",
    access: "read",
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_VIEW],
    description: "Get one scheduled query by id.",
    inputSchema: getJobSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_scheduled_job", id, () =>
        deps.clientFor(ctx).request("GET", `/api/scheduled-queries/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "list_scheduled_runs",
    title: "Scheduled job runs",
    category: "scheduling",
    access: "read",
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_VIEW],
    description: "Run history for one scheduled query.",
    inputSchema: getJobSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "list_scheduled_runs", id, () =>
        deps.clientFor(ctx).request("GET", `/api/scheduled-queries/${encodeURIComponent(id)}/runs`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "list_health_checks",
    title: "List data health promises",
    category: "data_health",
    access: "read",
    permissions: [PERMISSIONS.DATA_HEALTH_VIEW],
    description: "List data-health promises (checks).",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_health_checks", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/data-health")
      );
    },
  });

  registerChouseTool(sink, {
    name: "get_health_check",
    title: "Get a data health promise",
    category: "data_health",
    access: "read",
    permissions: [PERMISSIONS.DATA_HEALTH_VIEW],
    description: "Get one data-health check by id, including its incidents.",
    inputSchema: getHealthSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_health_check", id, () =>
        deps.clientFor(ctx).request("GET", `/api/data-health/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "health_timeline",
    title: "Data health timeline",
    category: "data_health",
    access: "read",
    permissions: [PERMISSIONS.DATA_HEALTH_VIEW],
    description: "Evaluation timeline for one data-health check.",
    inputSchema: getHealthSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "health_timeline", id, () =>
        deps.clientFor(ctx).request("GET", `/api/data-health/${encodeURIComponent(id)}/timeline`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "list_alerts",
    title: "Alert rules and channels",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.ALERTING_VIEW],
    description: "List alerting configuration and events: channels, rules, or events.",
    inputSchema: listAlertsSchema,
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

  registerChouseTool(sink, {
    name: "audit_list",
    title: "Audit log",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.AUDIT_VIEW],
    description: "List the caller's audit trail (global entries require audit:view).",
    inputSchema: auditListSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const limit = Math.min(100, Math.max(1, argNumber(args, "limit", 20)));
      return runApiTool(ctx, deps.clientFor(ctx), "audit_list", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/audit", { query: { limit: String(limit) } })
      );
    },
  });
}
