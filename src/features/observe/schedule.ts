/**
 * Pure helpers for the collection schedule (issue #380): interval labels and
 * choices, what a setting inherits, and the payload a save sends. The server
 * validates every save; these only shape the UI.
 */

import type { CollectorScheduleRow, CollectorScheduleSetting } from "@/api/observe";

export type ScheduleScope = "defaults" | "connection";

/** Intervals offered in the picker, within each collector's limits. */
export const INTERVAL_PRESETS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

const DAY_SECONDS = 86_400;

/** Runs per day at an interval, for "≈ N runs a day". */
export function runsPerDay(seconds: number): number {
  return seconds > 0 ? DAY_SECONDS / seconds : 0;
}

/** The presets a collector allows, plus any stored value that isn't one, ascending. */
export function intervalChoices(row: Pick<CollectorScheduleRow, "minSeconds" | "maxSeconds" | "builtInSeconds">, current: Array<number | null | undefined>): number[] {
  const values = new Set(INTERVAL_PRESETS.filter((s) => s >= row.minSeconds && s <= row.maxSeconds));
  values.add(row.builtInSeconds);
  for (const value of current) if (value != null) values.add(value);
  return [...values].sort((a, b) => a - b);
}

/** What this scope stores for the collector (the defaults, or this connection's override). */
export function storedSetting(row: CollectorScheduleRow, scope: ScheduleScope): CollectorScheduleSetting {
  return (scope === "defaults" ? row.defaults : row.override) ?? {};
}

/** The interval this scope inherits when it sets none, with where it comes from. */
export function inheritedInterval(row: CollectorScheduleRow, scope: ScheduleScope): { seconds: number; from: string } {
  if (scope === "connection" && row.defaults.intervalSeconds != null) return { seconds: row.defaults.intervalSeconds, from: "default" };
  return { seconds: row.builtInSeconds, from: "built-in" };
}

/** Whether this scope inherits a pause when it sets none. */
export function inheritedPaused(row: CollectorScheduleRow, scope: ScheduleScope): boolean {
  return scope === "connection" && row.defaults.paused === true;
}

function same(a: CollectorScheduleSetting | undefined, b: CollectorScheduleSetting | undefined): boolean {
  return (a?.intervalSeconds ?? null) === (b?.intervalSeconds ?? null) && (a?.paused ?? null) === (b?.paused ?? null);
}

/** Whether the drafts differ from what is stored. */
export function scheduleDirty(rows: CollectorScheduleRow[], scope: ScheduleScope, drafts: Record<string, CollectorScheduleSetting>): boolean {
  return rows.some((row) => !same(storedSetting(row, scope), drafts[row.name]));
}

/** The save payload: only collectors this scope sets something for. */
export function schedulePayload(drafts: Record<string, CollectorScheduleSetting>): Record<string, CollectorScheduleSetting> {
  const out: Record<string, CollectorScheduleSetting> = {};
  for (const [name, setting] of Object.entries(drafts)) {
    const intervalSeconds = setting.intervalSeconds ?? null;
    const paused = setting.paused ?? null;
    if (intervalSeconds === null && paused === null) continue;
    out[name] = { ...(intervalSeconds !== null ? { intervalSeconds } : {}), ...(paused !== null ? { paused } : {}) };
  }
  return out;
}

/** Drafts that start from what this scope stores. */
export function initialDrafts(rows: CollectorScheduleRow[], scope: ScheduleScope): Record<string, CollectorScheduleSetting> {
  return Object.fromEntries(rows.map((row) => [row.name, { ...storedSetting(row, scope) }]));
}

export interface ScheduleSummary {
  /** Collectors this connection sets something for. */
  ownSettings: number;
  /** Collectors that are paused here (by default or by this connection). */
  paused: number;
  /** What every collector reads per day here; null before any run was measured. */
  bytesPerDay: number | null;
}

/** One line about a connection's schedule, for the connection dialog. */
export function scheduleSummary(rows: CollectorScheduleRow[]): ScheduleSummary {
  let bytesPerDay: number | null = null;
  for (const row of rows) if (row.projectedBytesPerDay !== null) bytesPerDay = (bytesPerDay ?? 0) + row.projectedBytesPerDay;
  return {
    ownSettings: rows.filter((row) => row.override && (row.override.intervalSeconds != null || row.override.paused != null)).length,
    paused: rows.filter((row) => row.effective.paused).length,
    bytesPerDay,
  };
}
