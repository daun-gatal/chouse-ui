/**
 * What a person's own ClickHouse user can see on a `personal` connection
 * (ADR 0033 §7.3). Data access policies do not decide reads there, so pages
 * that show CHouse-collected metadata (gathered with the system role) list
 * only the databases and tables the person's user can see. The list is read
 * as the person and kept for a minute.
 */

import { all, sql, str } from "../observe/db";
import { executorForConnection } from "./executor";
import { personActor } from "./types";

export interface Visible {
  databases: ReadonlySet<string>;
  /** `database` + NUL + `table`. */
  tables: ReadonlySet<string>;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { value: Visible; expires: number }>();

export function visibleKey(database: string, table: string): string {
  return `${database}\u0000${table}`;
}

/** The databases and tables an account's bound user can see. Throws the binding's refusal when there is no active one. */
export async function visibleTo(connectionId: string, accountId: string, now: number = Date.now()): Promise<Visible> {
  // Keyed by the bound user too: on another replica a link replaced within the minute must not serve the old user's list.
  const bound = await all(sql`SELECT clickhouse_user FROM rbac_clickhouse_bindings WHERE connection_id = ${connectionId} AND user_id = ${accountId} AND state = 'active'`);
  const key = `${connectionId}\u0000${accountId}\u0000${bound.length > 0 ? str(bound[0].clickhouse_user) : ""}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;
  const client = (await executorForConnection(connectionId, personActor(accountId), { context: { source: "visible_tables" }, internal: true })).onServiceLane();
  const read = async (query: string): Promise<Array<Record<string, unknown>>> => {
    const result = await client.query({ query, format: "JSONEachRow", abort_signal: AbortSignal.timeout(20_000), clickhouse_settings: { readonly: "1", max_execution_time: 20 } });
    return (await result.json()) as Array<Record<string, unknown>>;
  };
  const [databases, tables] = await Promise.all([read("SELECT name FROM system.databases"), read("SELECT database, name FROM system.tables")]);
  const value: Visible = {
    databases: new Set(databases.map((row) => String(row.name))),
    tables: new Set(tables.map((row) => visibleKey(String(row.database), String(row.name)))),
  };
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { value, expires: now + TTL_MS });
  return value;
}

/** Forget every list (tests, and after a binding changes). */
export function resetVisibleTables(): void {
  cache.clear();
}
