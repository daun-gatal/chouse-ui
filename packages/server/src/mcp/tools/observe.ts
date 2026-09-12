/**
 * Observe toolset: fleet health, live queries, scheduled jobs, data health,
 * alerting, and the audit trail. Read-only.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, toolContext } from "./helpers";

export function registerObserveTools(mcp: McpServer, deps: McpDeps): void {
  mcp.registerTool(
    "metrics_overview",
    {
      description: "Server metrics overview: cluster stats and current load.",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "metrics_overview", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/metrics/stats")
      );
    }
  );

  mcp.registerTool(
    "live_queries",
    {
      description: "List currently running ClickHouse queries.",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "live_queries", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/live-queries")
      );
    }
  );

  mcp.registerTool(
    "fleet_snapshots",
    {
      description: "Latest fleet health snapshots across connections.",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "fleet_snapshots", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/fleet/snapshots")
      );
    }
  );

  mcp.registerTool(
    "list_scheduled_jobs",
    {
      description: "List scheduled queries.",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_scheduled_jobs", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/scheduled-queries")
      );
    }
  );

  mcp.registerTool(
    "get_scheduled_job",
    {
      description: "Get one scheduled query by id.",
      inputSchema: { id: z.string().min(1).describe("Scheduled query id") },
      annotations: { readOnlyHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "get_scheduled_job", args.id, () =>
        deps.clientFor(ctx).request("GET", `/api/scheduled-queries/${encodeURIComponent(args.id)}`)
      );
    }
  );

  mcp.registerTool(
    "list_scheduled_runs",
    {
      description: "Run history for one scheduled query.",
      inputSchema: { id: z.string().min(1).describe("Scheduled query id") },
      annotations: { readOnlyHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_scheduled_runs", args.id, () =>
        deps.clientFor(ctx).request("GET", `/api/scheduled-queries/${encodeURIComponent(args.id)}/runs`)
      );
    }
  );

  mcp.registerTool(
    "list_health_checks",
    {
      description: "List data-health promises (checks).",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_health_checks", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/data-health")
      );
    }
  );

  mcp.registerTool(
    "get_health_check",
    {
      description: "Get one data-health check by id, including its incidents.",
      inputSchema: { id: z.string().min(1).describe("Data-health check id") },
      annotations: { readOnlyHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "get_health_check", args.id, () =>
        deps.clientFor(ctx).request("GET", `/api/data-health/${encodeURIComponent(args.id)}`)
      );
    }
  );

  mcp.registerTool(
    "health_timeline",
    {
      description: "Evaluation timeline for one data-health check.",
      inputSchema: { id: z.string().min(1).describe("Data-health check id") },
      annotations: { readOnlyHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "health_timeline", args.id, () =>
        deps.clientFor(ctx).request("GET", `/api/data-health/${encodeURIComponent(args.id)}/timeline`)
      );
    }
  );

  mcp.registerTool(
    "list_alerts",
    {
      description: "List alerting configuration and events: channels, rules, or events.",
      inputSchema: {
        kind: z.enum(["channels", "rules", "events"]).describe("Which alerting object to list"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { kind: "channels" | "rules" | "events" }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_alerts", args.kind, () =>
        deps.clientFor(ctx).request("GET", `/api/alerting/${args.kind}`)
      );
    }
  );

  mcp.registerTool(
    "audit_list",
    {
      description: "List the caller's audit trail (global entries require audit:view).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe("Entries to return"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { limit: number }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "audit_list", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/rbac/audit", { query: { limit: String(args.limit) } })
      );
    }
  );
}
