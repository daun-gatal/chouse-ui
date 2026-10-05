/**
 * Destructive tools: KILL, raw SQL, and deletes (ADR 0014).
 *
 * Server-side authorization: off until an administrator turns each one on in
 * AI Governance › MCP (ADR 0017), and every call executes under the caller's PAT
 * scopes via the projected API routes. Human approval is client-side: the host's permission prompt (ask
 * rules) or an explicit user confirmation — agents ask the user first, as
 * their tool descriptions and the server instructions direct.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../rbac/schema/base";
import type { McpDeps } from "../types";
import {
  runApiTool,
  apiFor,
  toolContext,
  argString,
  argOptionalString,
  registerChouseTool, type McpToolSink,
} from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const killQuerySchema: Record<string, z.ZodTypeAny> = {
  query_id: z.string().min(1).describe("query_id of the running query (see live_queries)"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const queryRawSchema: Record<string, z.ZodTypeAny> = {
  sql: z.string().min(1).describe("The SQL statement to execute"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const deleteSavedQuerySchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Saved query id"),
};

const deleteScheduledJobSchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Scheduled query id"),
};

export function registerDestructiveTools(sink: McpToolSink, deps: McpDeps): void {
  registerChouseTool(sink, {
    name: "kill_query",
    title: "Kill a query",
    category: "monitoring",
    access: "destructive",
    permissions: [PERMISSIONS.LIVE_QUERIES_KILL, PERMISSIONS.LIVE_QUERIES_KILL_ALL],
    description:
      "Terminate a running ClickHouse query by query_id. Destructive — enabled by an administrator and limited by " +
      "your token's scopes; the human approves via the client's permission prompt before the call.",
    inputSchema: killQuerySchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const queryId = argString(args, "query_id");
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "kill_query", queryId, () =>
        client.request("POST", "/api/live-queries/kill", { body: { queryId } })
      );
    },
  });

  registerChouseTool(sink, {
    name: "query_raw",
    title: "Run any SQL",
    category: "query",
    access: "destructive",
    permissions: [PERMISSIONS.QUERY_EXECUTE_DDL, PERMISSIONS.QUERY_EXECUTE_DML],
    description:
      "Execute an arbitrary SQL statement (DDL/DML); prefer the read-only 'query' tool for SELECTs. " +
      "Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the " +
      "client's permission prompt before the call.",
    inputSchema: queryRawSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const sql = argString(args, "sql");
      const preview = sql.slice(0, 200);
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "query_raw", preview, () =>
        client.request("POST", "/api/query/execute", { body: { query: sql, format: "JSON" } })
      );
    },
  });

  registerChouseTool(sink, {
    name: "delete_saved_query",
    title: "Delete a saved query",
    category: "query",
    access: "destructive",
    permissions: [PERMISSIONS.SAVED_QUERIES_DELETE],
    description:
      "Delete a saved query by id. Destructive — enabled by an administrator and limited by your token's scopes; " +
      "the human approves via the client's permission prompt before the call.",
    inputSchema: deleteSavedQuerySchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "delete_saved_query", id, () =>
        deps.clientFor(ctx).request("DELETE", `/api/saved-queries/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(sink, {
    name: "delete_scheduled_job",
    title: "Delete a scheduled job",
    category: "scheduling",
    access: "destructive",
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_DELETE],
    description:
      "Delete a scheduled query by id. Destructive — enabled by an administrator and limited by your token's " +
      "scopes; the human approves via the client's permission prompt before the call.",
    inputSchema: deleteScheduledJobSchema,
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "delete_scheduled_job", id, () =>
        deps.clientFor(ctx).request("DELETE", `/api/scheduled-queries/${encodeURIComponent(id)}`)
      );
    },
  });
}
