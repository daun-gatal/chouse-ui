/**
 * Expected-range bands (ADR 0023 §8). A panel with `viz.baseline` is run for
 * each of the past `weeks` weeks, shifted by whole weeks, through the full
 * run pipeline. Each bucket of the current window gets
 *
 *     median ± max(3 × 1.4826 × MAD, 0.05 × |median|)
 *
 * over the weeks that have that bucket. A bucket fewer than 2 weeks have gets
 * no band. The band is `ready` when at least half the current buckets have
 * one, and `learning` (with the reason) otherwise — never replaced by a
 * fixed threshold.
 *
 * The shifted windows are aligned to 15 minutes and cached for 15 minutes in
 * their own cache: a band costs `weeks` queries every 15 minutes per pod, not
 * on every refresh.
 */

import { AppError } from "../../types";
import type { Viewer } from "./access";
import { ResultCache } from "./cache";
import type { Window } from "./macros";
import { runPanel, runPanelWindow, type AgentFor, type PanelData, type PanelQuery } from "./runner";
import { nearestIndex, toUtcMs, zoneOfColumn } from "./time";

export const BASELINE_ALIGN_SECONDS = 900;
export const BASELINE_CACHE_TTL_MS = 15 * 60_000;
const WEEK_SECONDS = 7 * 86_400;
const MAD_SCALE = 1.4826;
const MAD_WIDTH = 3;
const MIN_RELATIVE_WIDTH = 0.05;
const MIN_WEEKS_PER_BUCKET = 2;
const READY_SHARE = 0.5;

const baselineCache = new ResultCache<PanelData>(BASELINE_CACHE_TTL_MS, 200, 64 * 1024 * 1024);

/** For tests: forget every cached baseline run. */
export function clearBaselineCache(): void {
  baselineCache.clear();
}

export interface BandPoint {
  /** The current bucket's x value, as the chart has it. */
  x: string;
  lo: number;
  hi: number;
  median: number;
}

export type Baseline =
  | { state: "ready"; weeks: number; points: BandPoint[] }
  | { state: "learning"; weeks: number; points: BandPoint[]; reason: string };

export interface TimeSeries {
  /** Each bucket's x as returned, and as UTC milliseconds (null when it is not a time). */
  xs: string[];
  xsMs: Array<number | null>;
  values: Array<number | null>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A run's x and y columns as a time series, reading x in its own zone. */
export function toSeries(data: PanelData, xColumn: string, yColumn: string): TimeSeries {
  const column = data.columns.find((c) => c.name === xColumn);
  if (!column) throw AppError.badRequest(`The result has no column ${xColumn}`);
  if (!data.columns.some((c) => c.name === yColumn)) throw AppError.badRequest(`The result has no column ${yColumn}`);
  const zone = zoneOfColumn(column.type, data.timezone);
  if (zone === null) throw AppError.badRequest("ClickHouse did not report its time zone, so the times on this chart cannot be lined up");
  const xs: string[] = [];
  const xsMs: Array<number | null> = [];
  const values: Array<number | null> = [];
  for (const row of data.rows) {
    const x = row[xColumn];
    xs.push(String(x));
    xsMs.push(toUtcMs(x, zone));
    const raw = row[yColumn];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
    values.push(Number.isFinite(n) ? n : null);
  }
  return { xs, xsMs, values };
}

/**
 * The band over the current buckets from earlier weeks' runs. `past[k]` is the
 * run k + 1 weeks back; its buckets are moved forward by those weeks and
 * matched to the nearest current bucket within half an interval.
 */
export function computeBand(current: TimeSeries, past: TimeSeries[], intervalMs: number, weeks: number): Baseline {
  const samples: number[][] = current.xs.map(() => []);
  let weeksWithData = 0;
  past.forEach((series, k) => {
    const shift = (k + 1) * WEEK_SECONDS * 1000;
    let any = false;
    series.xsMs.forEach((ms, i) => {
      const value = series.values[i];
      if (ms === null || value === null) return;
      const at = nearestIndex(current.xsMs, ms + shift, intervalMs);
      if (at === null) return;
      samples[at].push(value);
      any = true;
    });
    if (any) weeksWithData += 1;
  });
  const points: BandPoint[] = [];
  samples.forEach((values, i) => {
    if (values.length < MIN_WEEKS_PER_BUCKET || current.xsMs[i] === null) return;
    const m = median(values);
    const mad = median(values.map((v) => Math.abs(v - m)));
    const half = Math.max(MAD_WIDTH * MAD_SCALE * mad, MIN_RELATIVE_WIDTH * Math.abs(m));
    points.push({ x: current.xs[i], lo: m - half, hi: m + half, median: m });
  });
  const buckets = current.xsMs.filter((ms) => ms !== null).length;
  if (buckets > 0 && points.length >= READY_SHARE * buckets) return { state: "ready", weeks, points };
  const reason = weeksWithData < MIN_WEEKS_PER_BUCKET
    ? `Only ${weeksWithData} of the past ${weeks} weeks returned data; a band needs at least ${MIN_WEEKS_PER_BUCKET}`
    : `Only ${points.length} of ${buckets} buckets have at least ${MIN_WEEKS_PER_BUCKET} earlier weeks of data`;
  return { state: "learning", weeks, points, reason };
}

/** Week k's window: the current one k weeks back, aligned to 15 minutes so it can be cached. */
export function pastWindow(current: Window, k: number): Window {
  const from = Math.floor(current.from / BASELINE_ALIGN_SECONDS) * BASELINE_ALIGN_SECONDS;
  const to = Math.ceil(current.to / BASELINE_ALIGN_SECONDS) * BASELINE_ALIGN_SECONDS;
  return { from: from - k * WEEK_SECONDS, to: to - k * WEEK_SECONDS, intervalSeconds: current.intervalSeconds };
}

export interface BaselineRequest {
  viewer: Viewer;
  connectionId: string;
  query: PanelQuery;
  xColumn: string;
  yColumn: string;
  weeks: number;
  agentFor: AgentFor;
  nowMs: number;
}

/** The current run and its band (see the module comment). */
export async function runBaseline(req: BaselineRequest): Promise<{ current: TimeSeries; baseline: Baseline; window: Window }> {
  // The current window runs like any panel run (fresh within 30 s); only the earlier weeks are kept 15 minutes.
  const now = await runPanel(req.viewer, req.connectionId, req.query, req.agentFor, req.nowMs);
  const window = now.window;
  const current = toSeries(now.data, req.xColumn, req.yColumn);
  const past: TimeSeries[] = [];
  for (let k = 1; k <= req.weeks; k++) {
    const run = await runPanelWindow(req.viewer, req.connectionId, req.query, pastWindow(window, k), req.agentFor, baselineCache);
    past.push(toSeries(run.data, req.xColumn, req.yColumn));
  }
  return { current, baseline: computeBand(current, past, window.intervalSeconds * 1000, req.weeks), window };
}
