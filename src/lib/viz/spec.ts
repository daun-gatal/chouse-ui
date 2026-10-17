/**
 * The dashboard viz spec (ADR 0021 §2), validated in the browser so the editor
 * can say what is wrong before a save.
 *
 * NOTE: mirrors packages/server/src/services/dashboards/spec.ts; both are
 * tested against packages/server/src/services/dashboards/spec.fixture.json —
 * keep them in sync.
 */

import * as z from "zod";

export const CHART_TYPES = [
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar",
  "line", "multi_line", "area", "stacked_area", "pie", "donut",
  "scatter", "radar", "treemap", "funnel", "histogram", "heatmap",
  "stat", "table",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const UNITS = ["none", "ms", "s", "us", "bytes", "rows", "count", "percent", "per_s"] as const;
export type Unit = (typeof UNITS)[number];
export const REDUCERS = ["last", "max", "min", "avg", "sum"] as const;
export type Reducer = (typeof REDUCERS)[number];
export const COLOR_SCHEMES = ["violet", "blue", "green", "orange", "rainbow"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];
export const THRESHOLD_SEVERITIES = ["warning", "critical"] as const;

const SERIES_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar",
  "line", "multi_line", "area", "stacked_area", "radar", "heatmap",
]);
const SINGLE_MEASURE_TYPES: ReadonlySet<ChartType> = new Set<ChartType>(["pie", "donut", "treemap", "funnel", "scatter"]);
/** Chart types whose x axis is time or a sequence. */
export const TIME_SERIES_TYPES: ReadonlySet<ChartType> = new Set<ChartType>(["line", "multi_line", "area", "stacked_area"]);

export const MAX_Y_COLUMNS = 12;
const columnName = z.string().min(1).max(200);

/** Chart types that draw threshold lines (stat panels color their value instead). */
export const THRESHOLD_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "multi_line", "area", "stacked_area", "stat",
]);

export interface VizShape {
  type: ChartType;
  x: string | null;
  y: string[];
  series: string | null;
  /** How many thresholds the spec sets. */
  thresholds: number;
  reduce: Reducer | null;
}

/** What is wrong with the axes for this chart type (empty when it is drawable). */
export function vizShapeProblems(spec: VizShape): string[] {
  const problems: string[] = [];
  const { type, x, y, series, reduce } = spec;
  if (type !== "stat" && reduce !== null) problems.push("only a stat panel has a reduce");
  if (spec.thresholds > 0 && !THRESHOLD_TYPES.has(type)) problems.push("thresholds are drawn on line, area, bar and stat panels only");
  if (new Set(y).size !== y.length) problems.push("y lists a column twice");
  if (x !== null && y.includes(x)) problems.push("x cannot also be a y column");
  if (SERIES_TYPES.has(type)) {
    if (x === null) problems.push(`a ${type} chart needs an x column`);
    if (y.length === 0) problems.push(`a ${type} chart needs at least one y column`);
    if (series !== null && y.length !== 1) problems.push("split by series needs exactly one y column");
    if (series !== null && (series === x || y.includes(series))) problems.push("the series column must differ from x and y");
  } else if (SINGLE_MEASURE_TYPES.has(type)) {
    if (x === null) problems.push(`a ${type} chart needs an x column`);
    if (y.length !== 1) problems.push(`a ${type} chart needs exactly one y column`);
    if (series !== null) problems.push(`a ${type} chart cannot split by series`);
  } else if (type === "histogram") {
    if (x === null) problems.push("a histogram needs the x column to bin");
    if (y.length !== 0) problems.push("a histogram counts rows and takes no y column");
    if (series !== null) problems.push("a histogram cannot split by series");
  } else if (type === "stat") {
    if (x !== null) problems.push("a stat panel takes no x column");
    if (y.length !== 1) problems.push("a stat panel needs exactly one y column");
    if (series !== null) problems.push("a stat panel cannot split by series");
    if (reduce === null) problems.push("a stat panel needs a reduce (last, max, min, avg or sum)");
  } else if (type === "table") {
    if (x !== null || y.length !== 0 || series !== null) problems.push("a table shows every column and takes no x, y or series");
  }
  return problems;
}

export const thresholdSchema = z.object({
  value: z.number(),
  severity: z.enum(THRESHOLD_SEVERITIES),
}).strict();
export type Threshold = z.infer<typeof thresholdSchema>;

export const vizSpecSchema = z.object({
  version: z.literal(1),
  type: z.enum(CHART_TYPES),
  x: columnName.nullable(),
  y: z.array(columnName).max(MAX_Y_COLUMNS),
  series: columnName.nullable(),
  unit: z.enum(UNITS),
  decimals: z.number().int().min(0).max(6).nullable(),
  thresholds: z.array(thresholdSchema).max(4),
  colorScheme: z.enum(COLOR_SCHEMES),
  reduce: z.enum(REDUCERS).nullable(),
}).strict().superRefine((spec, ctx) => {
  for (const message of vizShapeProblems({ ...spec, thresholds: spec.thresholds.length })) ctx.addIssue({ code: "custom", message });
});
export type VizSpec = z.infer<typeof vizSpecSchema>;

/** Every problem with `value` as a viz spec, as messages (empty when valid). */
export function vizSpecProblems(value: unknown): string[] {
  const result = vizSpecSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message));
}

// ============================================
// Dashboard-level constants (server: spec.ts)
// ============================================

export const RELATIVE_RANGES = {
  "15m": 900,
  "1h": 3_600,
  "3h": 10_800,
  "6h": 21_600,
  "12h": 43_200,
  "24h": 86_400,
  "2d": 172_800,
  "7d": 604_800,
  "30d": 2_592_000,
} as const;
export type RelativeRange = keyof typeof RELATIVE_RANGES;
export const RELATIVE_RANGE_KEYS = Object.keys(RELATIVE_RANGES) as RelativeRange[];

export const REFRESH_SECONDS = [0, 30, 60, 300, 900] as const;
export type RefreshSeconds = (typeof REFRESH_SECONDS)[number];

export const PANEL_WIDTHS = [3, 4, 6, 8, 12] as const;
export type PanelWidth = (typeof PANEL_WIDTHS)[number];
export const PANEL_HEIGHTS = ["s", "m", "l"] as const;
export type PanelHeight = (typeof PANEL_HEIGHTS)[number];

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type VariableOptions = { source: "static"; values: string[] } | { source: "query"; sql: string };

export interface Variable {
  name: string;
  label: string;
  kind: "string" | "identifier";
  options: VariableOptions;
  default: string;
}

export type TimeRange = { kind: "relative"; value: RelativeRange } | { kind: "absolute"; from: number; to: number };
