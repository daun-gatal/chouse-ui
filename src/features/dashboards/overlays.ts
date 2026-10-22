/**
 * What a dashboard draws over a time chart (ADR 0023 §5, §8): annotations at
 * the bucket that holds each event, the series a day or a week earlier, and
 * the expected-range band. Pure: every function takes the chart's rows and
 * returns what to draw, so the arithmetic is tested without a chart.
 *
 * Times are compared in UTC milliseconds (time.ts): a chart's x values are
 * read in their column's zone or the run's, never the browser's.
 */

import type { AnnotationEvent, BandPoint } from "@/api/dashboards";
import type { ResultColumn, ResultData } from "@/lib/viz/resolve";
import type { AnnotationSource } from "@/lib/viz/spec";
import { bucketIndex, isTimeType, nearestIndex, toUtcMs, zoneOfColumn } from "@/lib/viz/time";

/** What each annotation source draws, for the settings and the view bar. */
export const ANNOTATION_LABELS: Record<AnnotationSource, string> = {
  ddl: "Schema changes (DDL)",
  upgrades: "Server upgrades",
  settings: "Settings profile changes",
  writers: "New writer versions",
  alerts: "This dashboard's alerts",
  incidents: "Observability incidents",
  fixes: "Applied fixes",
  notes: "Notes",
};

export const ANNOTATION_COLORS: Record<AnnotationSource, string> = {
  ddl: "#60A5FA",
  upgrades: "#A1A1AA",
  settings: "#C084FC",
  writers: "#2DD4BF",
  alerts: "#F87171",
  incidents: "#FB923C",
  fixes: "#4ADE80",
  notes: "#FFCC01",
};

export const BAND_LO = "__band_lo";
export const BAND_HI = "__band_hi";

/** A chart's x values as UTC milliseconds, or the reason they cannot be read as times. */
export type ChartTime = { ok: true; xsMs: Array<number | null>; intervalMs: number } | { ok: false; reason: string };

export function chartTime(rows: Array<Record<string, unknown>>, columns: ResultColumn[], xColumn: string, runZone: string | null, intervalSeconds: number): ChartTime {
  const column = columns.find((c) => c.name === xColumn);
  if (!column || !isTimeType(column.type)) return { ok: false, reason: `${xColumn} is not a date or time` };
  const zone = zoneOfColumn(column.type, runZone);
  if (zone === null) return { ok: false, reason: "ClickHouse did not report its time zone" };
  return { ok: true, xsMs: rows.map((row) => toUtcMs(row[xColumn], zone)), intervalMs: intervalSeconds * 1000 };
}

export interface Marker {
  id: string;
  x: string;
  color: string;
  label: string;
  event: AnnotationEvent;
}

/** Each event at the bucket that holds it; events outside the chart are left out. */
export function markersFor(events: AnnotationEvent[], rows: Array<Record<string, unknown>>, xColumn: string, time: Extract<ChartTime, { ok: true }>): Marker[] {
  const markers: Marker[] = [];
  for (const event of events) {
    const index = bucketIndex(time.xsMs, event.at, time.intervalMs);
    if (index === null) continue;
    markers.push({ id: event.id, x: String(rows[index][xColumn]), color: ANNOTATION_COLORS[event.source], label: event.title, event });
  }
  return markers;
}

/** The key a compared measure is drawn under. */
export function compareKey(y: string, label: string): string {
  return `${y} · ${label}`;
}

/**
 * The current rows with each measure's earlier value added (Compare): every
 * earlier bucket is moved forward by `shiftSeconds` and lands on the nearest
 * current bucket within half an interval.
 */
export function mergeCompare(
  rows: Array<Record<string, unknown>>,
  time: Extract<ChartTime, { ok: true }>,
  earlier: ResultData & { timezone: string | null },
  xColumn: string,
  yColumns: string[],
  shiftSeconds: number,
  label: string,
): { rows: Array<Record<string, unknown>>; keys: Array<{ key: string; label: string }> } {
  const earlierTime = chartTime(earlier.rows, earlier.columns, xColumn, earlier.timezone, time.intervalMs / 1000);
  const out = rows.map((row) => ({ ...row }));
  const keys = yColumns.map((y) => ({ key: compareKey(y, label), label: compareKey(y, label) }));
  if (!earlierTime.ok) return { rows: out, keys };
  earlier.rows.forEach((row, i) => {
    const ms = earlierTime.xsMs[i];
    if (ms === null) return;
    const at = nearestIndex(time.xsMs, ms + shiftSeconds * 1000, time.intervalMs);
    if (at === null) return;
    for (const y of yColumns) {
      const raw = row[y];
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
      out[at][compareKey(y, label)] = Number.isFinite(n) ? n : null;
    }
  });
  return { rows: out, keys };
}

/** The rows with each bucket's expected range, where the band has one. */
export function mergeBand(rows: Array<Record<string, unknown>>, xColumn: string, points: BandPoint[]): Array<Record<string, unknown>> {
  const byX = new Map(points.map((p) => [p.x, p]));
  return rows.map((row) => {
    const point = byX.get(String(row[xColumn]));
    return point ? { ...row, [BAND_LO]: point.lo, [BAND_HI]: point.hi } : row;
  });
}
