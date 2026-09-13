/**
 * Explore toolset: database/table discovery, schema, and bounded samples.
 * Read-only; every call inherits the token's data-access policy filters.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import {
  runApiTool,
  apiFor,
  toolContext,
  argString,
  argNumber,
  argOptionalString,
  registerChouseTool,
} from "./helpers";

// Schemas hoisted as plain zod v3 records (see helpers.ts note on TS2589).
const listTablesSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().min(1).describe("Database name"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const describeTableSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().min(1).describe("Database name"),
  table: z.string().min(1).describe("Table name"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

const sampleTableSchema: Record<string, z.ZodTypeAny> = {
  database: z.string().min(1).describe("Database name"),
  table: z.string().min(1).describe("Table name"),
  limit: z.number().int().min(1).max(20).default(10).describe("Rows to sample (max 20)"),
  connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
};

export function registerExploreTools(mcp: McpServer, deps: McpDeps): void {
  registerChouseTool(mcp, {
    name: "list_databases",
    description:
      "List the databases and tables visible to this token (respects data-access policies). Returns the filtered database tree.",
    annotations: { readOnlyHint: true },
    handler: async (_args, extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_databases", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/explorer/databases")
      );
    },
  });

  registerChouseTool(mcp, {
    name: "list_tables",
    description: "List the tables inside one database (respects data-access policies).",
    inputSchema: listTablesSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const database = argString(args, "database");
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "list_tables", database, async () => {
        const tree = await client.request<Array<{ name: string; children?: Array<{ name: string }> }>>(
          "GET",
          "/api/explorer/databases"
        );
        const found = tree.find((entry) => entry.name === database);
        return { database, tables: (found?.children ?? []).map((table) => table.name) };
      });
    },
  });

  registerChouseTool(mcp, {
    name: "describe_table",
    description: "Describe a table: columns, types, engine, and other metadata.",
    inputSchema: describeTableSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const database = argString(args, "database");
      const table = argString(args, "table");
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "describe_table", `${database}.${table}`, () =>
        client.request(
          "GET",
          `/api/explorer/table/${encodeURIComponent(database)}/${encodeURIComponent(table)}`
        )
      );
    },
  });

  registerChouseTool(mcp, {
    name: "sample_table",
    description: "Preview up to 20 rows of a table (bounded sample).",
    inputSchema: sampleTableSchema,
    annotations: { readOnlyHint: true },
    handler: async (args, extra) => {
      const ctx = toolContext(extra);
      const database = argString(args, "database");
      const table = argString(args, "table");
      const limit = Math.min(20, Math.max(1, argNumber(args, "limit", 10)));
      const client = apiFor(ctx, deps.clientFor(ctx), argOptionalString(args, "connection_id"));
      return runApiTool(ctx, client, "sample_table", `${database}.${table}`, () =>
        client.request(
          "GET",
          `/api/explorer/table/${encodeURIComponent(database)}/${encodeURIComponent(table)}/sample`,
          { query: { limit: String(limit) } }
        )
      );
    },
  });
}
