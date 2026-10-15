/**
 * Collection schedule (issue #380): how often each observability collector
 * runs, managed in the UI (Admin › Connections) instead of env.
 *
 * One JSON document in `obs_settings`, like the MCP settings, so every replica
 * schedules from the same state and a change applies without a restart. A
 * collector's interval and pause switch resolve, most specific first, from the
 * connection's override, the default set for every connection, then the
 * collector's built-in interval. Reads are cached for a few seconds per pod.
 */

import { z } from "zod";

import { logger } from "../../utils/logger";
import { one, run, sql, str } from "./db";

const SETTINGS_KEY = "collector_settings";
const CACHE_TTL_MS = 5_000;
export const MAX_INTERVAL_SECONDS = 24 * 3600;

export interface CollectorInfo {
  name: string;
  label: string;
  description: string;
  /** What reads cost: the system tables a run reads. */
  reads: string;
  /** What gets slower when it runs less often. */
  slower: string;
  /** Fastest interval allowed. */
  minSeconds: number;
  /** Runs once for all connections (fleet), so it has no per-connection override. */
  global: boolean;
  /** Whether it can be paused. Fleet feeds Monitoring and alerting, so it can't. */
  pausable: boolean;
}

/** Every collector the schedule knows about, in the order the UI lists them. */
export const COLLECTOR_INFO: readonly CollectorInfo[] = [
  { name: "fleet", label: "Fleet health", description: "Node metrics for Monitoring and alerting, for every connection at once.", reads: "system.metrics, system.asynchronous_metrics, system.processes, replication tables", slower: "Monitoring charts and alert rules see fewer samples.", minSeconds: 10, global: true, pausable: false },
  { name: "pipelines", label: "Pipelines", description: "Status of materialized and refreshable views, queue engines, Distributed and Buffer tables, dictionaries and jobs.", reads: "system.query_log (new rows), engine and view status tables", slower: "Pipeline failures and their incidents surface later.", minSeconds: 30, global: false, pausable: true },
  { name: "catalog", label: "Catalog", description: "Tables, columns, dictionaries and the structural lineage graph.", reads: "system.tables, system.columns, system.databases, system.dictionaries", slower: "New and dropped tables appear on the Data page later.", minSeconds: 60, global: false, pausable: true },
  { name: "tables", label: "Table baselines", description: "Freshness, write cadence, volume and trust state of every table.", reads: "system.part_log (new rows), system.parts", slower: "Stale and quiet tables are detected later.", minSeconds: 60, global: false, pausable: true },
  { name: "lineage", label: "Observed lineage", description: "Writers and readers of each table, from the queries that ran.", reads: "system.query_log (new rows)", slower: "New writers and readers appear later.", minSeconds: 60, global: false, pausable: true },
  { name: "changes", label: "Changes", description: "DDL, version upgrades, settings changes and new client versions for regressions and root cause.", reads: "system.query_log (new rows), settings tables", slower: "Changes are linked to regressions later.", minSeconds: 60, global: false, pausable: true },
  { name: "usage", label: "Usage", description: "Who reads each table, the columns they filter on, criticality and known-good query patterns.", reads: "system.query_log (new rows)", slower: "Readers, criticality and query patterns update later.", minSeconds: 300, global: false, pausable: true },
  { name: "queries", label: "Query performance", description: "Hourly rollups per query shape and regression detection.", reads: "system.query_log (new rows)", slower: "Performance regressions are detected later.", minSeconds: 300, global: false, pausable: true },
  { name: "capacity", label: "Capacity", description: "Disk usage per node and the days-until-full forecast.", reads: "system.disks", slower: "Capacity forecasts and incidents update later.", minSeconds: 300, global: false, pausable: true },
  { name: "profiles", label: "Column profiles", description: "Sampled profiles of critical tables and tables with a distribution promise.", reads: "a bounded sample of the profiled tables", slower: "Column profiles and distribution checks update later.", minSeconds: 300, global: false, pausable: true },
];

const INFO_BY_NAME = new Map(COLLECTOR_INFO.map((info) => [info.name, info]));

export function collectorInfo(name: string): CollectorInfo | undefined {
  return INFO_BY_NAME.get(name);
}

const scheduleSchema = z.object({
  /** Seconds between runs; null or absent inherits. */
  intervalSeconds: z.number().int().positive().max(MAX_INTERVAL_SECONDS).nullable().optional(),
  /** true pauses, false resumes over an inherited pause; null or absent inherits. */
  paused: z.boolean().nullable().optional(),
}).strict();

export type Schedule = z.infer<typeof scheduleSchema>;

/** One scope's schedules, keyed by collector name. */
export const scheduleMapSchema = z.record(z.string().regex(/^[a-z][a-z_]*$/).max(40), scheduleSchema);
export type ScheduleMap = z.infer<typeof scheduleMapSchema>;

const settingsSchema = z.object({
  defaults: scheduleMapSchema,
  connections: z.record(z.string().min(1).max(200), scheduleMapSchema),
});

export type CollectorSettings = z.infer<typeof settingsSchema>;

export interface StoredCollectorSettings extends CollectorSettings {
  updatedBy: string | null;
  updatedAt: number | null;
}

const EMPTY: StoredCollectorSettings = { defaults: {}, connections: {}, updatedBy: null, updatedAt: null };

let cache: { value: StoredCollectorSettings; expiresAt: number } | null = null;

/** Drop the per-pod cache (tests, and after a local write). */
export function resetCollectorSettingsCache(): void {
  cache = null;
}

export async function getCollectorSettings(maxAgeMs = CACHE_TTL_MS): Promise<StoredCollectorSettings> {
  if (cache && cache.expiresAt > Date.now() && maxAgeMs > 0) return cache.value;
  const row = await one(sql`SELECT value, updated_by, updated_at FROM obs_settings WHERE setting_key = ${SETTINGS_KEY}`);
  let value = EMPTY;
  if (row) {
    try {
      const parsed = settingsSchema.safeParse(JSON.parse(str(row.value)));
      if (parsed.success) value = { ...parsed.data, updatedBy: row.updated_by === null ? null : str(row.updated_by), updatedAt: Number(row.updated_at) || null };
      else logger.warn({ module: "Observe" }, "Stored collector schedule is invalid; using built-in intervals");
    } catch {
      logger.warn({ module: "Observe" }, "Stored collector schedule is not JSON; using built-in intervals");
    }
  }
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/**
 * Reasons a scope's schedules can't be saved: an unknown collector, an
 * interval outside its limits, pausing a collector that can't be paused, or a
 * per-connection override of a global collector.
 */
export function scheduleProblems(map: ScheduleMap, scope: "defaults" | "connection"): string[] {
  const problems: string[] = [];
  for (const [name, schedule] of Object.entries(map)) {
    const info = INFO_BY_NAME.get(name);
    if (!info) {
      problems.push(`Unknown collector '${name}'`);
      continue;
    }
    if (scope === "connection" && info.global && (schedule.intervalSeconds != null || schedule.paused != null)) {
      problems.push(`${info.label} runs once for every connection; set it in the defaults`);
    }
    const seconds = schedule.intervalSeconds;
    if (seconds != null && (seconds < info.minSeconds || seconds > MAX_INTERVAL_SECONDS)) {
      problems.push(`${info.label} must run every ${info.minSeconds}–${MAX_INTERVAL_SECONDS} seconds`);
    }
    if (schedule.paused === true && !info.pausable) problems.push(`${info.label} can't be paused`);
  }
  return problems;
}

/** Drop entries that inherit everything, so the stored document stays small. */
function compact(map: ScheduleMap): ScheduleMap {
  return Object.fromEntries(Object.entries(map).filter(([, s]) => s.intervalSeconds != null || s.paused != null));
}

async function save(next: CollectorSettings, actor: string): Promise<StoredCollectorSettings> {
  const now = Date.now();
  const value = JSON.stringify(next);
  await run(sql`
    INSERT INTO obs_settings (setting_key, value, updated_by, updated_at) VALUES (${SETTINGS_KEY}, ${value}, ${actor}, ${now})
    ON CONFLICT (setting_key) DO UPDATE SET value = ${value}, updated_by = ${actor}, updated_at = ${now}
  `);
  resetCollectorSettingsCache();
  return { ...next, updatedBy: actor, updatedAt: now };
}

/**
 * Replace the defaults, or one connection's overrides (`connectionId`).
 * Overrides of connections that no longer exist are dropped on every save.
 */
export async function saveSchedules(scope: { connectionId: string | null }, map: ScheduleMap, liveConnectionIds: Set<string>, actor: string): Promise<StoredCollectorSettings> {
  const current = await getCollectorSettings(0);
  const connections = Object.fromEntries(Object.entries(current.connections).filter(([id]) => liveConnectionIds.has(id)));
  if (scope.connectionId === null) return save({ defaults: compact(map), connections }, actor);
  const own = compact(map);
  if (Object.keys(own).length > 0) connections[scope.connectionId] = own;
  else delete connections[scope.connectionId];
  return save({ defaults: current.defaults, connections }, actor);
}

export type ScheduleSource = "built-in" | "default" | "connection";

export interface EffectiveSchedule {
  intervalMs: number;
  intervalSource: ScheduleSource;
  paused: boolean;
  pausedSource: ScheduleSource;
}

/** The schedule a collector runs on for one connection (null: a global collector). */
export function effectiveSchedule(settings: CollectorSettings, name: string, builtInMs: number, connectionId: string | null): EffectiveSchedule {
  const info = INFO_BY_NAME.get(name);
  const fallback = settings.defaults[name] ?? {};
  const own = connectionId !== null && !info?.global ? settings.connections[connectionId]?.[name] ?? {} : {};
  const clamp = (seconds: number): number => Math.min(MAX_INTERVAL_SECONDS, Math.max(info?.minSeconds ?? 1, seconds)) * 1000;

  let intervalMs = builtInMs;
  let intervalSource: ScheduleSource = "built-in";
  if (own.intervalSeconds != null) {
    intervalMs = clamp(own.intervalSeconds);
    intervalSource = "connection";
  } else if (fallback.intervalSeconds != null) {
    intervalMs = clamp(fallback.intervalSeconds);
    intervalSource = "default";
  }

  let paused = false;
  let pausedSource: ScheduleSource = "built-in";
  if (info?.pausable !== false) {
    if (own.paused != null) {
      paused = own.paused;
      pausedSource = "connection";
    } else if (fallback.paused != null) {
      paused = fallback.paused;
      pausedSource = "default";
    }
  }
  return { intervalMs, intervalSource, paused, pausedSource };
}
