/**
 * AI toolset: LLM-backed capabilities and fleet doctor reports.
 * Opt-in only — never in the default toolset, because these tools spend
 * LLM money on every call (ADR 0013 §3).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, apiFor, toolContext } from "./helpers";

export function registerAiTools(mcp: McpServer, deps: McpDeps): void {
  mcp.registerTool(
    "ai_optimize",
    {
      description:
        "Ask the AI optimizer to analyze a SQL query and suggest rewrites (spends LLM budget).",
      inputSchema: {
        sql: z.string().min(1).describe("The SQL query to optimize"),
        connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
      },
    },
    async (args: { sql: string; connection_id?: string }, extra) => {
      const ctx = toolContext(extra);
      const client = apiFor(ctx, deps.clientFor(ctx), args.connection_id);
      return runApiTool(ctx, client, "ai_optimize", undefined, () =>
        client.request("POST", "/api/ai/invoke", {
          body: { capability: "optimize-query", input: { query: args.sql } },
        })
      );
    }
  );

  mcp.registerTool(
    "doctor_scan",
    {
      description:
        "Run the AI fleet doctor across connections and return a structured report (spends LLM budget).",
      inputSchema: {
        hours: z.number().int().min(1).max(72).optional().describe("Lookback window in hours"),
      },
    },
    async (args: { hours?: number }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "doctor_scan", undefined, () =>
        deps.clientFor(ctx).request("POST", "/api/fleet/doctor/scan", {
          body: { hours: args.hours },
        })
      );
    }
  );

  mcp.registerTool(
    "doctor_reports",
    {
      description: "List past AI doctor reports.",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "doctor_reports", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/fleet/doctor/reports")
      );
    }
  );

  mcp.registerTool(
    "get_doctor_report",
    {
      description: "Get one AI doctor report by id.",
      inputSchema: { id: z.string().min(1).describe("Doctor report id") },
      annotations: { readOnlyHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "get_doctor_report", args.id, () =>
        deps.clientFor(ctx).request("GET", `/api/fleet/doctor/reports/${encodeURIComponent(args.id)}`)
      );
    }
  );
}
