/**
 * What a ClickHouse server contains, read from its own system tables (ADR 0029
 * §3): settings with their defaults and obsolete flag, MergeTree settings,
 * functions, data types, table engines, formats and database engines. Two of
 * these, one per server, diff into exactly what an upgrade changes.
 */

import type { ClickHouseClient } from "@clickhouse/client";

import { selectRows } from "../observe/clickhouse";

export interface VersionSnapshot {
  version: string;
  settings: Map<string, { value: string; obsolete: boolean }>;
  mergeTree: Map<string, string>;
  functions: Set<string>;
  types: Set<string>;
  engines: Set<string>;
  formats: Set<string>;
  dbEngines: Set<string>;
}

/**
 * Defaults that depend on the machine (`auto(18)`) compare as `auto`. Older
 * servers quote them (`'auto(18)'`), newer ones don't.
 */
export function normaliseValue(value: string): string {
  const bare = /^'auto\(\d+\)'$/.test(value) ? value.slice(1, -1) : value;
  return bare.replace(/^auto\(\d+\)$/, "auto");
}

async function names(client: ClickHouseClient, query: string, fallback?: string): Promise<Set<string>> {
  try {
    return new Set((await selectRows<{ name: string }>(client, query)).map((r) => r.name));
  } catch (error) {
    if (!fallback) throw error;
    return new Set((await selectRows<{ name: string }>(client, fallback)).map((r) => r.name));
  }
}

export async function readSnapshot(client: ClickHouseClient): Promise<VersionSnapshot> {
  const [v] = await selectRows<{ v: string }>(client, "SELECT version() AS v");
  let settingRows: Array<{ name: string; value: string; is_obsolete: number }>;
  try {
    settingRows = await selectRows(client, "SELECT name, value, toUInt8(is_obsolete) AS is_obsolete FROM system.settings");
  } catch {
    settingRows = (await selectRows<{ name: string; value: string }>(client, "SELECT name, value FROM system.settings")).map((r) => ({ ...r, is_obsolete: 0 }));
  }
  const mergeTreeRows = await selectRows<{ name: string; value: string }>(client, "SELECT name, value FROM system.merge_tree_settings");
  const [functions, types, engines, formats, dbEngines] = await Promise.all([
    names(client, "SELECT name FROM system.functions WHERE alias_to = ''", "SELECT name FROM system.functions"),
    names(client, "SELECT name FROM system.data_type_families WHERE alias_to = ''", "SELECT name FROM system.data_type_families"),
    names(client, "SELECT name FROM system.table_engines"),
    names(client, "SELECT name FROM system.formats"),
    names(client, "SELECT name FROM system.database_engines", "SELECT '' AS name WHERE 0"),
  ]);
  return {
    version: v?.v ?? "",
    settings: new Map(settingRows.map((r) => [r.name, { value: normaliseValue(String(r.value)), obsolete: Number(r.is_obsolete) === 1 }])),
    mergeTree: new Map(mergeTreeRows.map((r) => [r.name, normaliseValue(String(r.value))])),
    functions,
    types,
    engines,
    formats,
    dbEngines,
  };
}

export interface SnapshotDiff {
  removed: { functions: string[]; types: string[]; engines: string[]; formats: string[]; dbEngines: string[] };
  changedSettings: Array<{ name: string; from: string; to: string }>;
  changedMergeTree: Array<{ name: string; from: string; to: string }>;
  newlyObsolete: string[];
  counts: {
    settings: [number, number];
    mergeTree: [number, number];
    functions: [number, number];
    types: [number, number];
    engines: [number, number];
    formats: [number, number];
    dbEngines: [number, number];
  };
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort((a, b) => a.localeCompare(b));
const minus = (a: Set<string>, b: Set<string>): string[] => sorted([...a].filter((x) => !b.has(x)));

/** Pure: what changes going from `from` to `to`. Settings never disappear; they turn obsolete. */
export function diffSnapshots(from: VersionSnapshot, to: VersionSnapshot): SnapshotDiff {
  const changedSettings: SnapshotDiff["changedSettings"] = [];
  const newlyObsolete: string[] = [];
  for (const [name, a] of from.settings) {
    const b = to.settings.get(name);
    if (!b) continue;
    if (b.obsolete && !a.obsolete) {
      newlyObsolete.push(name);
      continue;
    }
    if (!a.obsolete && !b.obsolete && a.value !== b.value) changedSettings.push({ name, from: a.value, to: b.value });
  }
  const changedMergeTree: SnapshotDiff["changedMergeTree"] = [];
  for (const [name, a] of from.mergeTree) {
    const b = to.mergeTree.get(name);
    if (b !== undefined && a !== b) changedMergeTree.push({ name, from: a, to: b });
  }
  const pair = (a: { size: number }, b: { size: number }): [number, number] => [a.size, b.size];
  return {
    removed: {
      functions: minus(from.functions, to.functions),
      types: minus(from.types, to.types),
      engines: minus(from.engines, to.engines),
      formats: minus(from.formats, to.formats),
      dbEngines: minus(from.dbEngines, to.dbEngines),
    },
    changedSettings: changedSettings.sort((a, b) => a.name.localeCompare(b.name)),
    changedMergeTree: changedMergeTree.sort((a, b) => a.name.localeCompare(b.name)),
    newlyObsolete: sorted(newlyObsolete),
    counts: {
      settings: pair(from.settings, to.settings),
      mergeTree: pair(from.mergeTree, to.mergeTree),
      functions: pair(from.functions, to.functions),
      types: pair(from.types, to.types),
      engines: pair(from.engines, to.engines),
      formats: pair(from.formats, to.formats),
      dbEngines: pair(from.dbEngines, to.dbEngines),
    },
  };
}
