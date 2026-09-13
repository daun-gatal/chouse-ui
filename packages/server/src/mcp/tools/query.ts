/**
 * Query toolset: safe SELECT-only execution and explain plans (ADR 0013 §4).
 *
 * The AST-based classifier (middleware/sqlParser) — the same one that guards
 * the API's SQL injection surface — decides what may run here: a single
 * read statement (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN). Anything else,
 * including multi-statement input and unparsable SQL, fails closed.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import {
  runApiTool,
  apiFor,
  textResult,
  toolContext,
  argString,
  argNumber,
  argOptionalString,
  registerChouseTool,
} from "./helpers";
import { auditMcpToolCall } from "../audit";
import {
  splitSqlStatements,
  parseStatement,
} from "../../middleware/sqlParser";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const querySchema: Record<string, z.ZodTypeAny> = {
  sql: z.string().min(1).describe("The SELECT/WITH/SHOW/DESCRIBE/EXPLAIN statement"),
  limit: z.number().int().min(1).max(500).default(100).describe("Maximum rows to return"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const explainQuerySchema: Record<string, z.ZodTypeAny> = {
  sql: z.string().min(1).describe("The SELECT/WITH statement to explain"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const getSavedQuerySchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Saved query id"),
};

const runSavedQuerySchema: Record<string, z.ZodTypeAny> = {
  id: z.string().min(1).describe("Saved query id"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const READ_STATEMENT_TYPES = new Set(["select", "show", "describe", "explain"]);

export interface SqlClassification {
  allowed: boolean;
  reason?: string;
}

/**
 * Fail-closed classifier: exactly one statement and it must be one of the
 * read types. The explicit allowlist is the contract — anything the parser
 * cannot confidently identify as a read is rejected.
 */
export function classifyReadSql(sql: string): SqlClassification {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { allowed: false, reason: "Empty SQL statement." };
  }
  const statements = splitSqlStatements(trimmed);
  if (statements.length !== 1) {
    return {
      allowed: false,
      reason: `Exactly one statement is allowed (got ${statements.length}). Multi-statement input is rejected.`,
    };
  }
  const parsed = parseStatement(statements[0]);
  if (!READ_STATEMENT_TYPES.has(parsed.type)) {
    return {
      allowed: false,
      reason: `Statement type '${parsed.type}' is not allowed by the MCP query tool. Use the UI for writes, or enable destructive tools (query_raw) on the server.`,
    };
  }
  return { allowed: true };
}

export function registerQueryTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "query",
    description:
      "Run a single read-only SELECT/WITH/SHOW/DESCRIBE/EXPLAIN query against ClickHouse. Writes and multi-statement input are rejected. Results are capped (100 rows default, max 500).",
    inputSchema: querySchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const sql = argString(args, "sql");
      const limit = Math.min(500, Math.max(1, argNumber(args, "limit", 100)));
      const classification = classifyReadSql(sql);
      if (!classification.allowed) {
        await auditMcpToolCall(ctx.identity, {
          tool: "query",
          connectionId: ctx.connectionId,
          status: "failed",
          error: classification.reason,
        });
        return textResult(`Refused: ${classification.reason}`, true);
      }
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "query", undefined, () =>
        client.request("POST", "/api/query/table/select", {
          body: { query: sql, format: "JSON", maxResultRows: limit },
        })
      );
    },
  });

  registerChouseTool(mcp, {
    name: "explain_query",
    description: "Return the EXPLAIN plan for a SELECT/WITH query without executing it.",
    inputSchema: explainQuerySchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "explain_query", undefined, () =>
        client.request("POST", "/api/query/explain", { body: { query: argString(args, "sql") } })
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_saved_queries",
    description: "List saved queries visible to this token.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_saved_queries", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/saved-queries")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "get_saved_query",
    description: "Get one saved query definition by id.",
    inputSchema: getSavedQuerySchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      return runApiTool(ctx, deps.clientFor(ctx), "get_saved_query", id, () =>
        deps.clientFor(ctx).request("GET", `/api/saved-queries/${encodeURIComponent(id)}`)
      );
    },
  });

  registerChouseTool(mcp, {
    name: "run_saved_query",
    description:
      "Execute a saved query through the safe SELECT-only path. Saved queries that write are refused — use the UI for those.",
    inputSchema: runSavedQuerySchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const id = argString(args, "id");
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      let definition: { query?: string };
      try {
        definition = await client.request<{ query?: string }>(
          "GET",
          `/api/saved-queries/${encodeURIComponent(id)}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await auditMcpToolCall(ctx.identity, {
          tool: "run_saved_query",
          target: id,
          connectionId: ctx.connectionId,
          status: "failed",
          error: message,
        });
        return textResult(message, true);
      }
      const sql = definition.query ?? "";
      const classification = classifyReadSql(sql);
      if (!classification.allowed) {
        await auditMcpToolCall(ctx.identity, {
          tool: "run_saved_query",
          target: id,
          connectionId: ctx.connectionId,
          status: "failed",
          error: classification.reason,
        });
        return textResult(
          `Refused: saved query ${id} is not a read-only query (${classification.reason}). Run it from the UI.`,
          true
        );
      }
      return runApiTool(ctx, client, "run_saved_query", id, () =>
        client.request("POST", "/api/query/table/select", {
          body: { query: sql, format: "JSON", maxResultRows: 100 },
        })
      );
    },
  });
}
