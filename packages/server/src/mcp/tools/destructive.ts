/**
 * Destructive toolset: KILL, raw SQL, and deletes.
 *
 * Double gate (ADR 0013 §4): registered only when
 * MCP_ALLOW_DESTRUCTIVE=true (which also requires MCP_ALLOW_WRITES=true), and
 * every invocation requires in-host human approval via MCP elicitation
 * (`elicitation/create`, form mode). Hosts without elicitation support get a
 * fail-closed error pointing at the UI/CLI — never a silent refusal to ask.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types";
import type { McpDeps } from "../types";
import { runApiTool, apiFor, textResult, toolContext, type ToolExtra } from "./helpers";
import { auditMcpToolCall } from "../audit";

/**
 * Ask the human in the MCP host to approve the described action. Returns an
 * error message when approval is denied or the client cannot elicit.
 */
async function requireHumanApproval(extra: ToolExtra, message: string): Promise<string> {
  try {
    const result = await extra.sendRequest(
      {
        method: "elicitation/create",
        params: {
          message,
          requestedSchema: {
            type: "object",
            properties: {
              approve: {
                type: "string",
                enum: ["yes"],
                title: "Type 'yes' to approve",
                description: "The action executes only if the human types exactly 'yes'.",
              },
            },
            required: ["approve"],
          },
        },
      },
      ElicitResultSchema,
      {
        relatedRequestId: extra.requestId,
        timeout: 300_000,
      }
    );
    if (result.action !== "accept" || result.content?.approve !== "yes") {
      return `Approval not granted (action=${result.action}). Nothing was executed.`;
    }
    return "";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return (
      "Refused: this MCP client does not support elicitation (human approval), so the action was not executed. " +
      `Run it from the UI or CLI instead. (${reason})`
    );
  }
}

export function registerDestructiveTools(mcp: McpServer, deps: McpDeps): void {
  mcp.registerTool(
    "kill_query",
    {
      description:
        "Terminate a running ClickHouse query by query_id. Requires human approval in the MCP host.",
      inputSchema: {
        query_id: z.string().min(1).describe("query_id of the running query (see live_queries)"),
        connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
      },
      annotations: { destructiveHint: true },
    },
    async (args: { query_id: string; connection_id?: string }, extra) => {
      const ctx = toolContext(extra);
      const denied = await requireHumanApproval(
        extra,
        `Kill running ClickHouse query '${args.query_id}'? This terminates its execution immediately.`
      );
      if (denied) {
        await auditMcpToolCall(ctx.identity, {
          tool: "kill_query",
          target: args.query_id,
          connectionId: ctx.connectionId,
          status: "failed",
          error: denied,
        });
        return textResult(denied, true);
      }
      const client = apiFor(ctx, deps.clientFor(ctx), args.connection_id);
      return runApiTool(ctx, client, "kill_query", args.query_id, () =>
        client.request("POST", "/api/live-queries/kill", { body: { queryId: args.query_id } })
      );
    }
  );

  mcp.registerTool(
    "query_raw",
    {
      description:
        "Execute an arbitrary SQL statement (DDL/DML). Requires human approval in the MCP host. Prefer the read-only 'query' tool for SELECTs.",
      inputSchema: {
        sql: z.string().min(1).describe("The SQL statement to execute"),
        connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
      },
      annotations: { destructiveHint: true },
    },
    async (args: { sql: string; connection_id?: string }, extra) => {
      const ctx = toolContext(extra);
      const preview = args.sql.slice(0, 200);
      const denied = await requireHumanApproval(
        extra,
        `Execute raw SQL: ${preview}${args.sql.length > 200 ? "…" : ""}? This may mutate data.`
      );
      if (denied) {
        await auditMcpToolCall(ctx.identity, {
          tool: "query_raw",
          target: preview,
          connectionId: ctx.connectionId,
          status: "failed",
          error: denied,
        });
        return textResult(denied, true);
      }
      const client = apiFor(ctx, deps.clientFor(ctx), args.connection_id);
      return runApiTool(ctx, client, "query_raw", preview, () =>
        client.request("POST", "/api/query/execute", { body: { query: args.sql, format: "JSON" } })
      );
    }
  );

  mcp.registerTool(
    "delete_saved_query",
    {
      description: "Delete a saved query. Requires human approval in the MCP host.",
      inputSchema: { id: z.string().min(1).describe("Saved query id") },
      annotations: { destructiveHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      const denied = await requireHumanApproval(extra, `Delete saved query '${args.id}'?`);
      if (denied) {
        await auditMcpToolCall(ctx.identity, {
          tool: "delete_saved_query",
          target: args.id,
          connectionId: ctx.connectionId,
          status: "failed",
          error: denied,
        });
        return textResult(denied, true);
      }
      return runApiTool(ctx, deps.clientFor(ctx), "delete_saved_query", args.id, () =>
        deps.clientFor(ctx).request("DELETE", `/api/saved-queries/${encodeURIComponent(args.id)}`)
      );
    }
  );

  mcp.registerTool(
    "delete_scheduled_job",
    {
      description: "Delete a scheduled query. Requires human approval in the MCP host.",
      inputSchema: { id: z.string().min(1).describe("Scheduled query id") },
      annotations: { destructiveHint: true },
    },
    async (args: { id: string }, extra) => {
      const ctx = toolContext(extra);
      const denied = await requireHumanApproval(extra, `Delete scheduled query '${args.id}'?`);
      if (denied) {
        await auditMcpToolCall(ctx.identity, {
          tool: "delete_scheduled_job",
          target: args.id,
          connectionId: ctx.connectionId,
          status: "failed",
          error: denied,
        });
        return textResult(denied, true);
      }
      return runApiTool(ctx, deps.clientFor(ctx), "delete_scheduled_job", args.id, () =>
        deps.clientFor(ctx).request("DELETE", `/api/scheduled-queries/${encodeURIComponent(args.id)}`)
      );
    }
  );
}
