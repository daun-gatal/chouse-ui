/**
 * Explore toolset: database/table discovery, schema, and bounded samples.
 * Read-only; every call inherits the token's data-access policy filters.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { McpDeps } from "../types";
import { runApiTool, apiFor, toolContext } from "./helpers";

interface WithConnection {
  connection_id?: string;
}

export function registerExploreTools(mcp: McpServer, deps: McpDeps): void {
  mcp.registerTool(
    "list_databases",
    {
      description:
        "List the databases and tables visible to this token (respects data-access policies). Returns the filtered database tree.",
      annotations: { readOnlyHint: true },
    },
    async (extra) => {
      const ctx = toolContext(extra);
      return runApiTool(ctx, deps.clientFor(ctx), "list_databases", undefined, () =>
        deps.clientFor(ctx).request("GET", "/api/explorer/databases")
      );
    }
  );

  mcp.registerTool(
    "list_tables",
    {
      description: "List the tables inside one database (respects data-access policies).",
      inputSchema: {
        database: z.string().min(1).describe("Database name"),
        connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { database: string } & WithConnection, extra) => {
      const ctx = toolContext(extra);
      const client = apiFor(ctx, deps.clientFor(ctx), args.connection_id);
      return runApiTool(ctx, client, "list_tables", args.database, async () => {
        const tree = await client.request<Array<{ name: string; children?: Array<{ name: string }> }>>(
          "GET",
          "/api/explorer/databases"
        );
        const database = tree.find((entry) => entry.name === args.database);
        return { database: args.database, tables: (database?.children ?? []).map((table) => table.name) };
      });
    }
  );

  mcp.registerTool(
    "describe_table",
    {
      description: "Describe a table: columns, types, engine, and other metadata.",
      inputSchema: {
        database: z.string().min(1).describe("Database name"),
        table: z.string().min(1).describe("Table name"),
        connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { database: string; table: string } & WithConnection, extra) => {
      const ctx = toolContext(extra);
      const client = apiFor(ctx, deps.clientFor(ctx), args.connection_id);
      return runApiTool(ctx, client, "describe_table", `${args.database}.${args.table}`, () =>
        client.request(
          "GET",
          `/api/explorer/table/${encodeURIComponent(args.database)}/${encodeURIComponent(args.table)}`
        )
      );
    }
  );

  mcp.registerTool(
    "sample_table",
    {
      description: "Preview up to 20 rows of a table (bounded sample).",
      inputSchema: {
        database: z.string().min(1).describe("Database name"),
        table: z.string().min(1).describe("Table name"),
        limit: z.number().int().min(1).max(20).default(10).describe("Rows to sample (max 20)"),
        connection_id: z.string().optional().describe("Connection id (defaults to the request/header connection)"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args: { database: string; table: string; limit: number } & WithConnection, extra) => {
      const ctx = toolContext(extra);
      const client = apiFor(ctx, deps.clientFor(ctx), args.connection_id);
      return runApiTool(ctx, client, "sample_table", `${args.database}.${args.table}`, () =>
        client.request(
          "GET",
          `/api/explorer/table/${encodeURIComponent(args.database)}/${encodeURIComponent(args.table)}/sample`,
          { query: { limit: String(args.limit) } }
        )
      );
    }
  );
}
