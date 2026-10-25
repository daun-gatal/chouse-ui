/**
 * Per-connection capability probe (ADR 0016 §4): which system tables and
 * columns exist on this server version. Adapters declare what they need; a
 * missing table yields an explicit `unsupported_on_version`, never a silent
 * switch to a weaker signal. Read privileges are checked by
 * `services/connectionPrivileges.ts`.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { json, num, one, run, sql, str } from "./db";
import { selectRows } from "./clickhouse";
import { OBSERVED_SYSTEM_TABLES } from "./systemTables";

export { OBSERVED_SYSTEM_TABLES };

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
