/**
 * MCP prompts (ADR 0013 §3): agent workflows as prompt templates. Prompts are
 * pure guidance text — they carry no credentials and execute nothing; the
 * agent still calls tools, which enforce every gate.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { argOptionalString, argString, registerChousePrompt } from "./tools/helpers";

// Schemas hoisted as plain zod v3 records (see tools/helpers.ts note on TS2589).
const investigateArgsSchema: Record<string, z.ZodTypeAny> = {
  query_id: z.string().optional().describe("query_id to start from (optional)"),
};

const diagnoseArgsSchema: Record<string, z.ZodTypeAny> = {
  incident_id: z.string().optional().describe("Incident id to start from (optional)"),
};

const reviewArgsSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().describe("Database name"),
  table: z.string().describe("Table name"),
};

const migrationArgsSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().describe("Database name"),
  table: z.string().describe("Table name"),
};

export function registerPrompts(mcp: McpServer): void {
  registerChousePrompt(mcp, {
    name: "investigate-slow-query",
    title: "Investigate a slow ClickHouse query",
    description: "Workflow: find a slow query and diagnose it with evidence.",
    argsSchema: investigateArgsSchema,
    handler: (args) => {
      const queryId = argOptionalString(args, "query_id");
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Investigate a slow ClickHouse query using the chouse MCP tools.",
                queryId ? `Focus on query_id: ${queryId}.` : "",
                "Steps:",
                "1. call metrics_overview for cluster stats, then live_queries for running queries.",
                "2. Pick the slowest query, call explain_query with its SQL (reconstruct it if needed).",
                "3. If a saved/scheduled job is involved, inspect it with get_saved_query or get_scheduled_job.",
                "4. Summarize: what it reads, why it is slow, and concrete changes (no execution).",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  });

  registerChousePrompt(mcp, {
    name: "diagnose-incident",
    title: "Diagnose a data-health incident",
    description: "Workflow: investigate an open data-health incident.",
    argsSchema: diagnoseArgsSchema,
    handler: (args) => {
      const incidentId = argOptionalString(args, "incident_id");
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Diagnose a data-health incident using the chouse MCP tools.",
                incidentId ? `Focus on incident: ${incidentId}.` : "Start with list_health_checks.",
                "Steps:",
                "1. list_health_checks / get_health_check to read the promise definition.",
                "2. health_timeline for the evaluation history around the incident.",
                "3. Correlate with metrics_overview and live_queries.",
                "4. Report: likely cause, evidence, and recommended remediation (do not ack or mutate).",
              ].join("\n"),
            },
          },
        ],
      };
    },
  });

  registerChousePrompt(mcp, {
    name: "review-schema",
    title: "Review a table schema",
    description: "Workflow: review a table for type, codec, and partition issues.",
    argsSchema: reviewArgsSchema,
    handler: (args) => {
      const database = argString(args, "database");
      const table = argString(args, "table");
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Review the schema of ${database}.${table} using the chouse MCP tools.`,
                "Steps:",
                "1. describe_table to read columns, types, engine, and partition key.",
                "2. sample_table (small limit) to see representative data.",
                "3. Note: nullable waste, oversized types, missing codecs, bad sort/partition keys.",
                "4. Suggest ALTERs as text only — never execute them.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  });

  registerChousePrompt(mcp, {
    name: "plan-schema-migration",
    title: "Plan a schema migration",
    description:
      "Workflow: draft an idempotent, safe DDL migration plan for review. Nothing is executed.",
    argsSchema: migrationArgsSchema,
    handler: (args) => {
      const database = argString(args, "database");
      const table = argString(args, "table");
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Plan a schema migration for ${database}.${table} using the chouse MCP tools.`,
                "Constraints:",
                "- Read current state with describe_table before proposing anything.",
                "- Propose idempotent DDL (IF EXISTS / IF NOT EXISTS) only.",
                "- Explain the rollout impact (locks, data rewrite, disk usage).",
                "- Present the plan for human review; do NOT call query_raw or any write tool.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  });
}
