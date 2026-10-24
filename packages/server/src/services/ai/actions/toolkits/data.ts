/**
 * Data & Query toolkit (ADR 0025 §2): saved queries, live queries and SQL that
 * changes data or schema.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import type { ActionContext, ActionDefinition, Tier } from "../types";
import { idOf, needConnection, quote, str } from "./shared";

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
];
