/**
 * MCP prompts (ADR 0013 §3): agent workflows as prompt templates. Prompts are
 * pure guidance text — they carry no credentials and execute nothing; the
 * agent still calls tools, which enforce every gate.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

export function registerPrompts(mcp: McpServer): void {
  mcp.registerPrompt(
    "investigate-slow-query",
    {
      title: "Investigate a slow ClickHouse query",
      description: "Workflow: find a slow query and diagnose it with evidence.",
      argsSchema: {
        query_id: z.string().optional().describe("query_id to start from (optional)"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Investigate a slow ClickHouse query using the chouse MCP tools.",
              args?.query_id ? `Focus on query_id: ${args.query_id}.` : "",
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
    })
  );

  mcp.registerPrompt(
    "diagnose-incident",
    {
      title: "Diagnose a data-health incident",
      description: "Workflow: investigate an open data-health incident.",
      argsSchema: {
        incident_id: z.string().optional().describe("Incident id to start from (optional)"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Diagnose a data-health incident using the chouse MCP tools.",
              args?.incident_id ? `Focus on incident: ${args.incident_id}.` : "Start with list_health_checks.",
              "Steps:",
              "1. list_health_checks / get_health_check to read the promise definition.",
              "2. health_timeline for the evaluation history around the incident.",
              "3. Correlate with metrics_overview and live_queries.",
              "4. Report: likely cause, evidence, and recommended remediation (do not ack or mutate).",
            ].join("\n"),
          },
        },
      ],
    })
  );

  mcp.registerPrompt(
    "review-schema",
    {
      title: "Review a table schema",
      description: "Workflow: review a table for type, codec, and partition issues.",
      argsSchema: {
        database: z.string().describe("Database name"),
        table: z.string().describe("Table name"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Review the schema of ${args.database}.${args.table} using the chouse MCP tools.`,
              "Steps:",
              "1. describe_table to read columns, types, engine, and partition key.",
              "2. sample_table (small limit) to see representative data.",
              "3. Note: nullable waste, oversized types, missing codecs, bad sort/partition keys.",
              "4. Suggest ALTERs as text only — never execute them.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  mcp.registerPrompt(
    "plan-schema-migration",
    {
      title: "Plan a schema migration",
      description:
        "Workflow: draft an idempotent, safe DDL migration plan for review. Nothing is executed.",
      argsSchema: {
        database: z.string().describe("Database name"),
        table: z.string().describe("Table name"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Plan a schema migration for ${args.database}.${args.table} using the chouse MCP tools.`,
              "Constraints:",
              "- Read current state with describe_table before proposing anything.",
              "- Propose idempotent DDL (IF EXISTS / IF NOT EXISTS) only.",
              "- Explain the rollout impact (locks, data rewrite, disk usage).",
              "- Present the plan for human review; do NOT call query_raw or any write tool.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
