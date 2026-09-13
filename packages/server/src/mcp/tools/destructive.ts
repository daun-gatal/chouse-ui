/**
 * Destructive toolset: KILL, raw SQL, and deletes (ADR 0014).
 *
 * Server-side authorization: registered only when
 * MCP_ALLOW_DESTRUCTIVE=true (which also requires MCP_ALLOW_WRITES=true), and
 * every call executes under the caller's PAT scopes via the projected API
 * routes. Human approval is client-side: the host's permission prompt (ask
 * rules) or an explicit user confirmation — agents ask the user first, as
 * their tool descriptions and the server instructions direct.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import {
  runApiTool,
  apiFor,
  toolContext,
  argString,
  argOptionalString,
  registerChouseTool,
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

export function registerDestructiveTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "kill_query",
    description:
      "Terminate a running ClickHouse query by query_id. Destructive — gated by the operator's flags and " +
      "your token's scopes; the human approves via the client's permission prompt before the call.",
    inputSchema: killQuerySchema,
    annotations: { destructiveHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const queryId = argString(args, "query_id");
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "kill_query", queryId, () =>
        client.request("POST", "/api/live-queries/kill", { body: { queryId } })
      );
    },
  });

  registerChouseTool(mcp, {
    name: "query_raw",
    description:
      "Execute an arbitrary SQL statement (DDL/DML); prefer the read-only 'query' tool for SELECTs. " +
      "Destructive — gated by the operator's flags and your token's scopes; the human approves via the " +
      "client's permission prompt before the call.",
    inputSchema: queryRawSchema,
    annotations: { destructiveHint: true },
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

  registerChouseTool(mcp, {
    name: "delete_saved_query",
    description:
      "Delete a saved query by id. Destructive — gated by the operator's flags and your token's scopes; " +
      "the human approves via the client's permission prompt before the call.",
    inputSchema: deleteSavedQuerySchema,
    annotations: { destructiveHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "delete_saved_query", id, () =>
        deps.clientFor(ctx).request("DELETE", `/api/saved-queries/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "delete_scheduled_job",
    description:
      "Delete a scheduled query by id. Destructive — gated by the operator's flags and your token's " +
      "scopes; the human approves via the client's permission prompt before the call.",
    inputSchema: deleteScheduledJobSchema,
    annotations: { destructiveHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "delete_scheduled_job", id, () =>
        deps.clientFor(ctx).request("DELETE", `/api/scheduled-queries/${encodeURIComponent(id)}`)
      );
    },
  });
}
