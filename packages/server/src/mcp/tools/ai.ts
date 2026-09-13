/**
 * AI toolset: LLM-backed capabilities and fleet doctor reports.
 * Opt-in only — never in the default toolset, because these tools spend
 * LLM money on every call (ADR 0013 §3).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, apiFor, toolContext, argString, argOptionalNumber, argOptionalString, registerChouseTool } from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const aiOptimizeSchema: Record<string, z.ZodTypeAny> = {
  sql: z.string().min(1).describe("The SQL query to optimize"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const doctorScanSchema: Record<string, z.ZodTypeAny> = {
  hours: z.number().int().min(1).max(72).optional().describe("Lookback window in hours"),
};

const getDoctorReportSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Doctor report id"),
};

export function registerAiTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "ai_optimize",
    description:
      "Ask the AI optimizer to analyze a SQL query and suggest rewrites (spends LLM budget).",
    inputSchema: aiOptimizeSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "ai_optimize", undefined, () =>
        client.request("POST", "/api/ai/invoke", {
          body: { capability: "optimize-query", input: { query: argString(args, "sql") } },
        })
      );
    },
  });

  registerChouseTool(mcp, {
    name: "doctor_scan",
    description:
      "Run the AI fleet doctor across connections and return a structured report (spends LLM budget).",
    inputSchema: doctorScanSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "doctor_scan", undefined, () =>
        deps.clientFor(ctx).request("POST", "/api/fleet/doctor/scan", {
          body: { hours: argOptionalNumber(args, "hours") },
        })
      );
    },
  });

  registerChouseTool(mcp, {
    name: "doctor_reports",
    description: "List past AI doctor reports.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "doctor_reports", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/fleet/doctor/reports")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "get_doctor_report",
    description: "Get one AI doctor report by id.",
    inputSchema: getDoctorReportSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_doctor_report", id, () =>
        deps.clientFor(ctx).request("GET", `/api/fleet/doctor/reports/${encodeURIComponent(id)}`)
      );
    },
  });
}
