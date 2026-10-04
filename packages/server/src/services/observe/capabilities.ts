/**
 * Per-connection capability probe (ADR 0016 §4): which system tables and
 * columns exist on this server version. Adapters declare what they need; a
 * missing table yields an explicit `unsupported_on_version`, never a silent
 * switch to a weaker signal. Also checks read privileges and renders the
 * exact GRANT statements an operator must run.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { json, num, one, run, sql, str } from "./db";
import { selectRows } from "./clickhouse";

/** System tables the collector reads; probed for existence and privileges. */
export const OBSERVED_SYSTEM_TABLES = [
  "tables",
  "columns",
  "databases",
  "dictionaries",
  "parts",
  "part_log",
  "query_log",
  "query_views_log",
  "processes",
  "merges",
  "mutations",
  "replicas",
  "disks",
  "errors",
  "settings_profile_elements",
  "kafka_consumers",
  "s3queue",
  "s3queue_log",
  "azure_queue",
  "azure_queue_log",
  "view_refreshes",
  "distribution_queue",
  "asynchronous_insert_log",
  "asynchronous_inserts",
  "asynchronous_metrics",
  "data_skipping_indices",
] as const;

export interface Capabilities {
  connectionId: string;
  serverVersion: string | null;
  systemTables: Set<string>;
  systemColumns: Map<string, Set<string>>;
  probedAt: number;
}

const REPROBE_MS = 6 * 3600 * 1000;

export function hasTable(caps: Capabilities, table: string): boolean {
  return caps.systemTables.has(table);
}

export function hasColumn(caps: Capabilities, table: string, column: string): boolean {
  return caps.systemColumns.get(table)?.has(column) ?? false;
}

/** "system.view_refreshes is not available on ClickHouse 23.8" */
export function missingMessage(caps: Capabilities, table: string): string {
  return `system.${table} is not available on ClickHouse ${caps.serverVersion ?? "(unknown version)"}`;
}

async function load(connectionId: string): Promise<Capabilities | null> {
  const row = await one(sql`SELECT * FROM obs_capabilities WHERE connection_id = ${connectionId}`);
  if (!row) return null;
  const columns = json<Record<string, string[]>>(row.system_columns, {});
  return {
    connectionId,
    serverVersion: str(row.server_version) || null,
    systemTables: new Set(json<string[]>(row.system_tables, [])),
    systemColumns: new Map(Object.entries(columns).map(([t, cols]) => [t, new Set(cols)])),
    probedAt: num(row.probed_at),
  };
}

export async function probeCapabilities(connectionId: string, client: ClickHouseClient, force = false): Promise<Capabilities> {
  const cached = await load(connectionId);
  const [versionRow] = await selectRows<{ v: string }>(client, "SELECT version() AS v");
  const version = versionRow?.v ?? null;
  if (cached && !force && cached.serverVersion === version && Date.now() - cached.probedAt < REPROBE_MS) return cached;

  const wanted = OBSERVED_SYSTEM_TABLES.map((t) => `'${t}'`).join(", ");
  const tables = await selectRows<{ name: string }>(client, `SELECT name FROM system.tables WHERE database = 'system' AND name IN (${wanted})`);
  const columns = await selectRows<{ table: string; name: string }>(client, `SELECT table, name FROM system.columns WHERE database = 'system' AND table IN (${wanted})`);
  const byTable: Record<string, string[]> = {};
  for (const c of columns) (byTable[c.table] ??= []).push(c.name);
  const now = Date.now();
  const names = tables.map((t) => t.name);
  await run(sql`
    INSERT INTO obs_capabilities (connection_id, server_version, system_tables, system_columns, probed_at)
    VALUES (${connectionId}, ${version}, ${JSON.stringify(names)}, ${JSON.stringify(byTable)}, ${now})
    ON CONFLICT (connection_id) DO UPDATE SET server_version = ${version}, system_tables = ${JSON.stringify(names)}, system_columns = ${JSON.stringify(byTable)}, probed_at = ${now}
  `);
  return {
    connectionId,
    serverVersion: version,
    systemTables: new Set(names),
    systemColumns: new Map(Object.entries(byTable).map(([t, cols]) => [t, new Set(cols)])),
    probedAt: now,
  };
}

export interface PrivilegeReport {
  missing: string[];
  grants: string[];
}

/**
 * Which existing system tables the connection's user cannot read. Saving a
 * connection never fails on this (ADR 0016 §18) — the report becomes a warning
 * and the affected collectors show `missing_privileges`.
 */
export async function checkPrivileges(client: ClickHouseClient, caps: Capabilities, username: string): Promise<PrivilegeReport> {
  const missing: string[] = [];
  for (const table of OBSERVED_SYSTEM_TABLES) {
    if (!caps.systemTables.has(table)) continue;
    try {
      await selectRows(client, `SELECT * FROM system.${table} LIMIT 0`, { maxExecutionTime: 5 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ACCESS_DENIED|Not enough privileges/i.test(message)) missing.push(table);
    }
  }
  const user = /^[A-Za-z_][A-Za-z0-9_]*$/.test(username) ? username : `\`${username.replace(/`/g, "")}\``;
  return { missing, grants: missing.map((t) => `GRANT SELECT ON system.${t} TO ${user}`) };
}
