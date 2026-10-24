/**
 * Data & Query toolkit (ADR 0025 §2): saved queries, live queries and changes
 * to data or schema. Schema changes go through the Explorer's server-built
 * DDL routes where one exists; free-form SQL goes through the typed query
 * routes, which check the statement type and the caller's table access.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { parseStatement, splitSqlStatements } from "../../../../middleware/sqlParser";
import type { ActionContext, ActionDefinition, Tier } from "../types";
import { given, idOf, needConnection, quote, seg, str } from "./shared";

/** Killing someone else's query is T3; your own is T2 (it cannot be undone either way). */
async function killTier(args: Record<string, unknown>, ctx: ActionContext): Promise<Tier> {
  try {
    const live = await ctx.api.get<{ queries?: Array<Record<string, unknown>> }>("/api/live-queries");
    const query = (live.queries ?? []).find((q) => q.query_id === args.queryId);
    if (query && typeof query.rbac_user_id === "string" && query.rbac_user_id !== ctx.userId) return "t3";
  } catch {
    // Unknown owner: the route still enforces kill vs kill-all; ask once.
  }
  return "t2";
}

export interface SqlChange {
  /** The typed query route that runs it, which checks the statement type and permission again. */
  route: string;
  tier: Tier;
  label: string;
}

/**
 * Classify one data or schema change (ADR 0025 §1): creating and inserting
 * ask once; anything that alters, removes or rewrites data needs a second
 * approver. Anything else — several statements, reads, grants, unknown
 * shapes — is refused, never guessed.
 */
export function classifySqlChange(sql: string): SqlChange | { error: string } {
  const statements = splitSqlStatements(sql).filter((s) => s.trim());
  if (statements.length !== 1) return { error: "Send exactly one statement." };
  const statement = statements[0];
  const upper = statement.trim().toUpperCase();
  const parsed = parseStatement(statement);
  switch (parsed.type) {
    case "insert": return { route: "/api/query/table/insert", tier: "t2", label: "INSERT" };
    case "update": return { route: "/api/query/table/update", tier: "t3", label: "UPDATE" };
    case "delete": return { route: "/api/query/table/delete", tier: "t3", label: "DELETE" };
    case "truncate": return { route: "/api/query/table/truncate", tier: "t3", label: "TRUNCATE" };
    case "create":
      if (/^CREATE\s+(OR\s+REPLACE\s+)?(DATABASE|SCHEMA)\b/.test(upper)) return { route: "/api/query/database/create", tier: "t2", label: "CREATE DATABASE" };
      if (/^CREATE\s+(OR\s+REPLACE\s+)?(TABLE|VIEW|MATERIALIZED\s+VIEW)\b/.test(upper)) {
        // OR REPLACE can drop what is there: as risky as a DROP.
        return { route: "/api/query/table/create", tier: /^CREATE\s+OR\s+REPLACE\b/.test(upper) ? "t3" : "t2", label: "CREATE" };
      }
      return { error: "Only CREATE DATABASE, TABLE and VIEW are supported here." };
    case "drop":
      if (/^DROP\s+(DATABASE|SCHEMA)\b/.test(upper)) return { route: "/api/query/database/drop", tier: "t3", label: "DROP DATABASE" };
      return { route: "/api/query/table/drop", tier: "t3", label: "DROP" };
    case "alter":
      if (/^ALTER\s+(DATABASE|SCHEMA)\b/.test(upper)) return { route: "/api/query/database/alter", tier: "t3", label: "ALTER DATABASE" };
      return { route: "/api/query/table/alter", tier: "t3", label: "ALTER" };
    default:
      return { error: "Only INSERT, UPDATE, DELETE, CREATE, DROP, ALTER and TRUNCATE are supported. Use run_select_query to read." };
  }
}

function sqlChangeTier(args: Record<string, unknown>): Tier {
  const change = classifySqlChange(str(args.sql));
  // An unsupported statement fails in execute; the strictest tier until then.
  return "error" in change ? "t3" : change.tier;
}

const SAVED_QUERY_FIELDS = ["name", "query", "description"] as const;
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const DATA_ACTIONS: ActionDefinition[] = [
  {
    name: "kill_query",
    title: "Kill a query",
    toolkit: "data",
    category: "operations",
    tier: killTier,
    connectionScoped: true,
    permissions: [PERMISSIONS.LIVE_QUERIES_KILL, PERMISSIONS.LIVE_QUERIES_KILL_ALL],
    description: "Stop a running ClickHouse query by its query_id (from get_running_queries).",
    schema: z.object({ queryId: z.string().min(1).describe("query_id of the running query") }),
    describe: (args) => `KILL QUERY WHERE query_id = ${quote(str(args.queryId))}`,
    execute: async (args, ctx) => ctx.api.post("/api/live-queries/kill", { queryId: str(args.queryId) }),
  },
  {
    name: "create_saved_query",
    title: "Save a query",
    toolkit: "data",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SAVED_QUERIES_CREATE],
    description: "Save a SQL query to the user's saved queries on the active connection.",
    schema: z.object({
      name: z.string().min(1).max(200),
      query: z.string().min(1),
      description: z.string().max(2000).optional(),
    }),
    describe: (args) => `Save the query ${quote(str(args.name))}`,
    execute: async (args, ctx) => ctx.api.post("/api/saved-queries", {
      connectionId: needConnection(ctx),
      name: str(args.name),
      query: str(args.query),
      description: typeof args.description === "string" ? args.description : undefined,
    }),
    undo: { mode: "delete-created", resource: "saved_query", id: (result) => idOf(result) },
  },
  {
    name: "update_saved_query",
    title: "Edit a saved query",
    toolkit: "data",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SAVED_QUERIES_UPDATE],
    description: "Change a saved query's name, SQL or description (from list_saved_queries). Only the fields given change.",
    schema: z.object({
      id: z.string().min(1).describe("Saved query id"),
      name: z.string().min(1).max(200).optional(),
      query: z.string().min(1).optional(),
      description: z.string().max(2000).optional(),
    }),
    describe: (args) => `Edit the saved query ${quote(str(args.id))} (${SAVED_QUERY_FIELDS.filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => ctx.api.put(`/api/saved-queries/${seg(args.id)}`, given(args, SAVED_QUERY_FIELDS)),
    undo: { mode: "restore", resource: "saved_query", id: (args) => str(args.id) },
  },
  {
    name: "delete_saved_query",
    title: "Delete a saved query",
    toolkit: "data",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SAVED_QUERIES_DELETE],
    description: "Delete one of the user's saved queries. Undo saves it again (with a new id).",
    schema: z.object({ id: z.string().min(1).describe("Saved query id") }),
    describe: (args) => `Delete the saved query ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/saved-queries/${seg(args.id)}`),
    undo: { mode: "recreate-deleted", resource: "saved_query", id: (args) => str(args.id) },
  },
  {
    name: "share_saved_query",
    title: "Share a saved query",
    toolkit: "data",
    category: "data",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.SAVED_QUERIES_SHARE],
    description: "Make a saved query visible to everyone who can see saved queries, or private again.",
    schema: z.object({
      id: z.string().min(1).describe("Saved query id"),
      shared: z.boolean().describe("true to share with everyone, false to make it private"),
    }),
    describe: (args) => `${args.shared === true ? "Share" : "Stop sharing"} the saved query ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.put(`/api/saved-queries/${seg(args.id)}`, { isPublic: args.shared === true }),
  },
  {
    name: "create_database",
    title: "Create a database",
    toolkit: "data",
    category: "schema",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.DB_CREATE],
    description: "Create a ClickHouse database on the active connection.",
    schema: z.object({
      name: z.string().regex(IDENTIFIER, "Letters, digits and underscores, not starting with a digit"),
      engine: z.string().max(100).optional().describe("Database engine, default Atomic"),
      cluster: z.string().max(200).optional().describe("ON CLUSTER name"),
    }),
    describe: (args) => `CREATE DATABASE ${str(args.name)}${args.cluster ? ` ON CLUSTER ${str(args.cluster)}` : ""}`,
    execute: async (args, ctx) => ctx.api.post("/api/explorer/database", given(args, ["name", "engine", "cluster"])),
  },
  {
    name: "create_table",
    title: "Create a table",
    toolkit: "data",
    category: "schema",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.TABLE_CREATE],
    description: "Create a ClickHouse table on the active connection from columns, an engine and keys; CHouse validates every type and key expression.",
    schema: z.object({
      database: z.string().min(1).max(64),
      name: z.string().regex(IDENTIFIER, "Letters, digits and underscores, not starting with a digit"),
      columns: z.array(z.object({
        name: z.string().min(1).max(128),
        type: z.string().min(1).max(200),
        default: z.string().max(500).optional(),
        comment: z.string().max(500).optional(),
      })).min(1).max(200),
      engine: z.string().max(200).optional().describe("Default MergeTree()"),
      orderBy: z.string().max(500).optional(),
      partitionBy: z.string().max(500).optional(),
      primaryKey: z.string().max(500).optional(),
      cluster: z.string().max(200).optional(),
    }),
    describe: (args) => `CREATE TABLE ${str(args.database)}.${str(args.name)} with ${Array.isArray(args.columns) ? args.columns.length : 0} column(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/explorer/table", given(args, ["database", "name", "columns", "engine", "orderBy", "partitionBy", "primaryKey", "cluster"])),
  },
  {
    name: "drop_table",
    title: "Drop a table",
    toolkit: "data",
    category: "schema",
    tier: "t3",
    connectionScoped: true,
    permissions: [PERMISSIONS.TABLE_DROP],
    description: "Drop a ClickHouse table on the active connection. Irreversible: a second person approves it.",
    schema: z.object({ database: z.string().min(1).max(64), table: z.string().min(1).max(128) }),
    describe: (args) => `DROP TABLE ${str(args.database)}.${str(args.table)}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/explorer/table/${seg(args.database)}/${seg(args.table)}`),
  },
  {
    name: "drop_database",
    title: "Drop a database",
    toolkit: "data",
    category: "schema",
    tier: "t3",
    connectionScoped: true,
    permissions: [PERMISSIONS.DB_DROP],
    description: "Drop a ClickHouse database and every table in it, on the active connection. Irreversible: a second person approves it.",
    schema: z.object({ name: z.string().min(1).max(64) }),
    describe: (args) => `DROP DATABASE ${str(args.name)}`,
    execute: async (args, ctx) => ctx.api.delete(`/api/explorer/database/${seg(args.name)}`),
  },
  {
    name: "run_sql_change",
    title: "Change data or schema with SQL",
    toolkit: "data",
    category: "query",
    tier: (args) => sqlChangeTier(args),
    connectionScoped: true,
    permissions: [
      PERMISSIONS.QUERY_EXECUTE_DML, PERMISSIONS.QUERY_EXECUTE_DDL, PERMISSIONS.TABLE_INSERT, PERMISSIONS.TABLE_UPDATE, PERMISSIONS.TABLE_DELETE,
      PERMISSIONS.TABLE_CREATE, PERMISSIONS.TABLE_ALTER, PERMISSIONS.TABLE_DROP, PERMISSIONS.DB_CREATE, PERMISSIONS.DB_DROP,
    ],
    description: "Run one INSERT, UPDATE, DELETE, CREATE, DROP, ALTER or TRUNCATE statement on the active connection. INSERT and CREATE ask once; anything that alters, removes or rewrites data needs a second person's approval. Prefer create_table, drop_table and create_database when they fit.",
    schema: z.object({ sql: z.string().min(1).max(100_000).describe("Exactly one statement") }),
    describe: (args) => {
      const change = classifySqlChange(str(args.sql));
      const text = str(args.sql).replace(/\s+/g, " ").trim();
      return `${"error" in change ? "SQL" : change.label}: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`;
    },
    execute: async (args, ctx) => {
      const change = classifySqlChange(str(args.sql));
      if ("error" in change) throw new Error(change.error);
      needConnection(ctx);
      return ctx.api.post(change.route, { query: str(args.sql), format: "JSON" });
    },
  },
];
