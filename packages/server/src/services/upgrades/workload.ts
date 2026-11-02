/**
 * What a connection's workload uses (ADR 0029 §4): column types, table and
 * database engines, settings profiles, MergeTree settings changed on the
 * server, and 30 days of query_log. Read-only, bounded queries; query text is
 * never kept, only names, counts, users and clients.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { NOT_OBSERVE, selectRows } from "../observe/clickhouse";

export const WINDOW_DAYS = 30;
const PER_KIND = 400;
const SYSTEM_DATABASES = "('system', 'INFORMATION_SCHEMA', 'information_schema')";

export interface Use {
  shapes: number;
  runs7d: number;
  users: string[];
  clients: string[];
}

export interface WorkloadFacts {
  columns: Array<{ database: string; table: string; column: string; type: string }>;
  tableBytes: Record<string, number>;
  tables: Array<{ database: string; table: string; engine: string }>;
  databases: Array<{ database: string; engine: string }>;
  profileSettings: Array<{ target: string; setting: string; value: string }>;
  serverMergeTree: string[];
  queries: {
    functions: Record<string, Use>;
    types: Record<string, Use>;
    storages: Record<string, Use>;
    formats: Record<string, Use>;
    settings: Record<string, Use & { values: string[] }>;
  };
  window: { days: number; from: number | null; shapes: number; readable: boolean };
}

interface UseRow {
  name: string;
  shapes: number;
  runs7d: number;
  users: string[];
  clients: string[];
}

const WINDOW = `event_date >= today() - ${WINDOW_DAYS} AND event_time > now() - INTERVAL ${WINDOW_DAYS} DAY AND type = 'QueryFinish' AND ${NOT_OBSERVE}`;
const CALLERS = "uniqExact(normalized_query_hash) AS shapes, countIf(event_time > now() - INTERVAL 7 DAY) AS runs7d, groupUniqArray(5)(user) AS users, groupUniqArray(5)(if(client_name != '', client_name, substring(http_user_agent, 1, 60))) AS clients";

async function uses(client: ClickHouseClient, column: string): Promise<Record<string, Use>> {
  const rows = await selectRows<UseRow>(client, `
    SELECT x AS name, ${CALLERS}
    FROM system.query_log ARRAY JOIN ${column} AS x
    WHERE ${WINDOW}
    GROUP BY name ORDER BY shapes DESC LIMIT ${PER_KIND}`, { maxExecutionTime: 60 });
  return Object.fromEntries(rows.map((r) => [r.name, { shapes: Number(r.shapes), runs7d: Number(r.runs7d), users: r.users.filter(Boolean), clients: r.clients.filter(Boolean) }]));
}

async function settingUses(client: ClickHouseClient): Promise<WorkloadFacts["queries"]["settings"]> {
  const rows = await selectRows<UseRow & { values: string[] }>(client, `
    SELECT k AS name, ${CALLERS}, groupUniqArray(5)(v) AS values
    FROM system.query_log ARRAY JOIN mapKeys(Settings) AS k, mapValues(Settings) AS v
    WHERE ${WINDOW}
    GROUP BY name ORDER BY shapes DESC LIMIT ${PER_KIND}`, { maxExecutionTime: 60 });
  return Object.fromEntries(rows.map((r) => [r.name, { shapes: Number(r.shapes), runs7d: Number(r.runs7d), users: r.users.filter(Boolean), clients: r.clients.filter(Boolean), values: r.values }]));
}

const EMPTY_QUERIES: WorkloadFacts["queries"] = { functions: {}, types: {}, storages: {}, formats: {}, settings: {} };

export async function gatherWorkload(client: ClickHouseClient): Promise<WorkloadFacts> {
  const columns = (await selectRows<{ db: string; tbl: string; name: string; type: string }>(client, `
    SELECT database AS db, table AS tbl, name, type FROM system.columns
    WHERE database NOT IN ${SYSTEM_DATABASES} LIMIT 50000`, { maxExecutionTime: 60 }))
    .map((c) => ({ database: c.db, table: c.tbl, column: c.name, type: c.type }));
  const tables = (await selectRows<{ db: string; name: string; engine: string }>(client, `
    SELECT database AS db, name, engine FROM system.tables WHERE database NOT IN ${SYSTEM_DATABASES} AND NOT is_temporary LIMIT 20000`))
    .map((t) => ({ database: t.db, table: t.name, engine: t.engine }));
  const tableBytes = Object.fromEntries((await selectRows<{ t: string; b: number }>(client, `
    SELECT concat(database, '.', table) AS t, sum(bytes_on_disk) AS b FROM system.parts
    WHERE active AND database NOT IN ${SYSTEM_DATABASES} GROUP BY t ORDER BY b DESC LIMIT 20000`, { maxExecutionTime: 60 })).map((r) => [r.t, Number(r.b)]));
  const databases = (await selectRows<{ name: string; engine: string }>(client, `SELECT name, engine FROM system.databases WHERE name NOT IN ${SYSTEM_DATABASES}`))
    .map((d) => ({ database: d.name, engine: d.engine }));
  const profileSettings = (await selectRows<{ target: string; setting_name: string; value: string }>(client, `
    SELECT coalesce(profile_name, user_name, role_name, '') AS target, setting_name, coalesce(value, '') AS value
    FROM system.settings_profile_elements WHERE setting_name IS NOT NULL LIMIT 5000`)).map((s) => ({ target: s.target, setting: s.setting_name, value: s.value }));
  const serverMergeTree = (await selectRows<{ name: string }>(client, "SELECT name FROM system.merge_tree_settings WHERE changed")).map((r) => r.name);

  let queries = EMPTY_QUERIES;
  let window: WorkloadFacts["window"] = { days: WINDOW_DAYS, from: null, shapes: 0, readable: false };
  try {
    const [w] = await selectRows<{ first: number | null; shapes: number }>(client, `
      SELECT toUnixTimestamp(min(event_time)) * 1000 AS first, uniqExact(normalized_query_hash) AS shapes
      FROM system.query_log WHERE ${WINDOW}`, { maxExecutionTime: 60 });
    const [functions, types, storages, formats, settings] = await Promise.all([
      uses(client, "used_functions"),
      uses(client, "used_data_type_families"),
      uses(client, "used_storages"),
      uses(client, "used_formats"),
      settingUses(client),
    ]);
    queries = { functions, types, storages, formats, settings };
    const shapes = Number(w?.shapes ?? 0);
    window = { days: WINDOW_DAYS, from: shapes > 0 && w?.first ? Number(w.first) : null, shapes, readable: true };
  } catch {
    // No query_log (logging off, or no grant): the schema-based findings still stand, and the coverage says so.
  }
  return { columns, tableBytes, tables, databases, profileSettings, serverMergeTree, queries, window };
}

/** Pure: data type family names inside a column type, e.g. `Nullable(Object('json'))` → Nullable, Object. */
export function typeFamilies(type: string, known: Set<string>): string[] {
  const bare = type.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const out = new Set<string>();
  for (const m of bare.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) if (known.has(m[0])) out.add(m[0]);
  return [...out];
}
