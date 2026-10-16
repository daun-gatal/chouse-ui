/**
 * Performance, capacity and upgrade tools (ADR 0016 §8–9), plus the
 * observability collectors behind them: query-shape regressions against their
 * own baselines, disk forecasts and growth, upgrade readiness and canary
 * replays, and what each collector last read and how often it runs. All
 * read-only projections of the Monitoring and Admin › Connections pages.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import { apiFor, argOptionalString, argString, registerChouseTool, runApiTool, toolContext, type McpToolSink } from "./helpers";

const connectionArg = z.string().min(1).optional().describe("Connection id (defaults to the request's connection)");

const connectionSchema: Record<string, z.ZodTypeAny> = { connection_id: connectionArg };

const fingerprintSchema: Record<string, z.ZodTypeAny> = {
  fingerprint: z.string().min(1).max(40).describe("Query shape fingerprint from get_query_regressions"),
  connection_id: connectionArg,
};

const idSchema = (what: string): Record<string, z.ZodTypeAny> => ({ id: z.string().min(1).describe(`${what} id`) });

const scheduleSchema: Record<string, z.ZodTypeAny> = {
  connection_id: z.string().min(1).optional().describe("A connection's effective schedule; omit for the defaults every connection inherits"),
};

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function registerPerformanceTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "get_query_regressions",
    title: "Query regressions",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.PERFORMANCE_VIEW],
    description:
      "Query shapes that got slower or heavier than their own baseline, with the upgrades, DDL and setting changes around their onset, " +
      "plus hourly totals. Sample query text is included only with query:history:view:all.",
    inputSchema: connectionSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, api, "get_query_regressions", argOptionalString(args, "connection_id"), () => api.request("GET", "/api/observe/performance"));
    },
  });

  registerChouseTool(sink, {
    name: "get_query_shape_history",
    title: "Query shape history",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.PERFORMANCE_VIEW],
    description: "Hourly runs, errors, p50/p95 latency, bytes read and server version of one query shape, per replica.",
    inputSchema: fingerprintSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      const fingerprint = argString(args, "fingerprint");
      return runApiTool(ctx, api, "get_query_shape_history", fingerprint, () =>
        api.request("GET", `/api/observe/performance/fingerprints/${segment(fingerprint)}`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "get_capacity",
    title: "Capacity and cost",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.CAPACITY_VIEW],
    description:
      "Disk forecasts per node (days until the threshold), the fastest-growing tables, cold tables, measured codec savings, " +
      "and cost by consumer when the token also has cost:view.",
    inputSchema: connectionSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, api, "get_capacity", argOptionalString(args, "connection_id"), () => api.request("GET", "/api/observe/capacity"));
    },
  });

  registerChouseTool(sink, {
    name: "list_upgrade_assessments",
    title: "Upgrade assessments",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.UPGRADES_VIEW],
    description: "Upgrade readiness assessments of a connection (target version, verdict, findings) and its canary workload replays.",
    inputSchema: connectionSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, api, "list_upgrade_assessments", argOptionalString(args, "connection_id"), () => api.request("GET", "/api/upgrades/assessments"));
    },
  });

  registerChouseTool(sink, {
    name: "get_upgrade_assessment",
    title: "Upgrade assessment",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.UPGRADES_VIEW],
    description: "One upgrade readiness assessment: every rule checked against the real workload, with the evidence behind each finding.",
    inputSchema: idSchema("Assessment"),
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const id = argString(args, "id");
      return runApiTool(ctx, api, "get_upgrade_assessment", id, () => api.request("GET", `/api/upgrades/assessments/${segment(id)}`));
    },
  });

  registerChouseTool(sink, {
    name: "get_canary_replay",
    title: "Canary replay",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.UPGRADES_VIEW],
    description:
      "One workload replay on a canary connection: queries replayed, skipped and missing on the canary, and the most serious result " +
      "or latency differences. Replayed query text is included only with query:history:view:all.",
    inputSchema: idSchema("Replay"),
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const id = argString(args, "id");
      return runApiTool(ctx, api, "get_canary_replay", id, () => api.request("GET", `/api/upgrades/replays/${segment(id)}`));
    },
  });

  registerChouseTool(sink, {
    name: "get_upgrade_rollout",
    title: "Upgrade rollout",
    category: "performance",
    access: "read",
    permissions: [PERMISSIONS.UPGRADES_VIEW],
    description: "Every connection the token can use with its ClickHouse version and rollout gates: replica lag, open regressions and sick replicas.",
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      return runApiTool(ctx, api, "get_upgrade_rollout", undefined, () => api.request("GET", "/api/upgrades/rollout"));
    },
  });

  registerChouseTool(sink, {
    name: "get_collector_status",
    title: "Collector status",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.OBSERVE_VIEW],
    description:
      "Each observability collector of a connection: state, last run and last success, last error, missing grants, whether it is paused, " +
      "and what its last run read from ClickHouse. Use it when observability data looks stale or missing.",
    inputSchema: connectionSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, api, "get_collector_status", argOptionalString(args, "connection_id"), () => api.request("GET", "/api/observe/status"));
    },
  });

  registerChouseTool(sink, {
    name: "get_collector_schedule",
    title: "Collection schedule",
    category: "monitoring",
    access: "read",
    permissions: [PERMISSIONS.CONNECTIONS_VIEW],
    description:
      "How often each observability collector runs and whether it is paused: the defaults, or one connection's effective schedule with " +
      "its overrides, each collector's last run, and the bytes it reads from ClickHouse per day at that interval.",
    inputSchema: scheduleSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const api = deps.clientFor(ctx);
      const connectionId = argOptionalString(args, "connection_id");
      return runApiTool(ctx, api, "get_collector_schedule", connectionId ?? "defaults", () =>
        api.request("GET", connectionId ? `/api/observe/collectors/schedule/${segment(connectionId)}` : "/api/observe/collectors/schedule")
      );
    },
  });
}
