/**
 * Turn a panel's viz spec and its query result into something drawable
 * (ADR 0021 §2) — or into a reason it cannot be drawn. Nothing is guessed: a
 * missing column, a measure that is not numeric or too many series is an
 * error that names what to change, unlike the chat's chart repair.
 */

import type { VizSpec } from "./spec";
import { toNumber } from "./units";

export interface ResultColumn {
  name: string;
  type: string;
}

export interface ResultData {
  columns: ResultColumn[];
  rows: Array<Record<string, unknown>>;
}

/** The most lines or bars a split by series may produce. */
export const MAX_SERIES = 20;

export interface ResolvedChart {
  /** Rows with every measure as a number (or null for a gap). */
  rows: Array<Record<string, unknown>>;
  columns: ResultColumn[];
  x: string;
  /** Measure columns to draw (after a split by series, one per series value). */
  y: string[];
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

function missing(columns: ResultColumn[], names: string[]): string[] {
  const have = new Set(columns.map((c) => c.name));
  return names.filter((n) => !have.has(n));
}

/** Coerce `column` in every row to a number; null stays null (a gap), anything else non-numeric is an error. */
function numeric(rows: Array<Record<string, unknown>>, column: string): Resolved<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const raw = row[column];
    if (raw === null || raw === undefined) {
      out.push({ ...row, [column]: null });
      continue;
    }
    const n = toNumber(raw);
    if (n === null) return { ok: false, error: `Column ${column} has a value that is not a number ("${String(raw).slice(0, 40)}"); pick a numeric column` };
    out.push({ ...row, [column]: n });
  }
  return { ok: true, value: out };
}

/** Long rows (x, series, y) to wide rows (x, one column per series value), in first-seen order. */
export function pivot(rows: Array<Record<string, unknown>>, x: string, series: string, y: string): Resolved<{ rows: Array<Record<string, unknown>>; keys: string[] }> {
  const keys: string[] = [];
  const byX = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = String(row[series] ?? "NULL");
    if (key === x) return { ok: false, error: `A ${series} value is named like the x column ${x}; rename the x column` };
    if (!keys.includes(key)) {
      if (keys.length === MAX_SERIES) {
        return { ok: false, error: `Splitting by ${series} makes more than ${MAX_SERIES} series; filter the query or keep the top ${MAX_SERIES} with a subquery and LIMIT` };
      }
      keys.push(key);
    }
    const xKey = String(row[x]);
    const wide = byX.get(xKey) ?? { [x]: row[x] };
    if (key in wide) return { ok: false, error: `${series} = ${key} has more than one row at ${x} = ${xKey}; aggregate by ${x} and ${series}` };
    wide[key] = row[y];
    byX.set(xKey, wide);
  }
  return { ok: true, value: { rows: [...byX.values()], keys } };
}

/** Resolve a chart (not stat or table) for drawing. */
export function resolveChart(spec: VizSpec, data: ResultData): Resolved<ResolvedChart> {
  if (spec.type === "stat" || spec.type === "table") return { ok: false, error: `${spec.type} panels are not charts` };
  if (spec.x === null) return { ok: false, error: "The chart has no x column" };
  const absent = missing(data.columns, [spec.x, ...spec.y, ...(spec.series ? [spec.series] : [])]);
  if (absent.length > 0) {
    return { ok: false, error: `The result has no column ${absent.join(", ")}. Columns: ${data.columns.map((c) => c.name).join(", ")}` };
  }
  if (data.rows.length === 0) return { ok: false, error: "The query returned no rows" };
  let rows = data.rows;
  if (spec.type === "histogram" || spec.type === "scatter") {
    const x = numeric(rows, spec.x);
    if (!x.ok) return x;
    rows = x.value;
  }
  for (const column of spec.y) {
    const converted = numeric(rows, column);
    if (!converted.ok) return converted;
    rows = converted.value;
  }
  if (spec.series !== null) {
    const wide = pivot(rows, spec.x, spec.series, spec.y[0]);
    if (!wide.ok) return wide;
    const xColumn = data.columns.filter((c) => c.name === spec.x);
    return {
      ok: true,
      value: {
        rows: wide.value.rows,
        columns: [...xColumn, ...wide.value.keys.map((k) => ({ name: k, type: "Float64" }))],
        x: spec.x,
        y: wide.value.keys,
      },
    };
  }
  return { ok: true, value: { rows, columns: data.columns, x: spec.x, y: spec.y } };
}

/** A stat panel's number: `reduce` over its y column. */
export function resolveStat(spec: VizSpec, data: ResultData): Resolved<number> {
  const column = spec.y[0];
  if (spec.type !== "stat" || spec.reduce === null) return { ok: false, error: "Not a stat panel" };
  if (missing(data.columns, [column]).length > 0) {
    return { ok: false, error: `The result has no column ${column}. Columns: ${data.columns.map((c) => c.name).join(", ")}` };
  }
  if (data.rows.length === 0) return { ok: false, error: "The query returned no rows" };
  const values: number[] = [];
  for (const row of data.rows) {
    const n = toNumber(row[column]);
    if (n === null) return { ok: false, error: `Column ${column} has a value that is not a number (${String(row[column])})` };
    values.push(n);
  }
  switch (spec.reduce) {
    case "last": return { ok: true, value: values[values.length - 1] };
    case "max": return { ok: true, value: Math.max(...values) };
    case "min": return { ok: true, value: Math.min(...values) };
    case "sum": return { ok: true, value: values.reduce((a, b) => a + b, 0) };
    case "avg": return { ok: true, value: values.reduce((a, b) => a + b, 0) / values.length };
  }
}

/** The highest threshold `value` meets or exceeds, if any — what a stat panel colors by. */
export function crossedThreshold(spec: VizSpec, value: number): VizSpec["thresholds"][number] | null {
  const crossed = spec.thresholds.filter((t) => value >= t.value).sort((a, b) => b.value - a.value);
  return crossed[0] ?? null;
}

export interface FleetPart {
  connectionName: string;
  data: ResultData;
}

/** Fleet results as one result with a `connection` column, for a split by connection. */
export function mergeFleet(parts: FleetPart[]): ResultData {
  const base = parts[0]?.data.columns ?? [];
  return {
    columns: [{ name: "connection", type: "String" }, ...base],
    rows: parts.flatMap((p) => p.data.rows.map((row) => ({ connection: p.connectionName, ...row }))),
  };
}
