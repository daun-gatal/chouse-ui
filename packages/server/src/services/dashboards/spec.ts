/**
 * Custom dashboards (ADR 0021 §1–§3): the viz spec, panels, variables and the
 * dashboard document, validated strictly — an unknown field, chart type, unit
 * or variable kind is rejected, never mapped to a default.
 *
 * NOTE: the browser mirrors the viz spec in src/lib/viz/spec.ts; both are
 * tested against spec.fixture.json — keep them in sync.
 */

import { z } from "zod";

export const CHART_TYPES = [
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar",
  "line", "multi_line", "area", "stacked_area", "pie", "donut",
  "scatter", "radar", "treemap", "funnel", "histogram", "heatmap",
  "stat", "table",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const UNITS = ["none", "ms", "s", "us", "bytes", "rows", "count", "percent", "per_s"] as const;
export const REDUCERS = ["last", "max", "min", "avg", "sum"] as const;
export const COLOR_SCHEMES = ["violet", "blue", "green", "orange", "rainbow"] as const;
export const THRESHOLD_SEVERITIES = ["warning", "critical"] as const;

/** Chart types drawn against an x axis with one or more measures. */
const SERIES_TYPES: ReadonlySet<ChartType> = new Set([
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar",
  "line", "multi_line", "area", "stacked_area", "radar", "heatmap",
]);
/** Chart types that plot one measure per category. */
const SINGLE_MEASURE_TYPES: ReadonlySet<ChartType> = new Set(["pie", "donut", "treemap", "funnel", "scatter"]);
/** Chart types whose x axis is time or a sequence, so they read as trends. */
export const TIME_SERIES_TYPES: ReadonlySet<ChartType> = new Set(["line", "multi_line", "area", "stacked_area"]);
/** Chart types that plot numbers and therefore need a unit. */
export const NUMERIC_TYPES: ReadonlySet<ChartType> = new Set(CHART_TYPES.filter((t) => t !== "table"));

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
  reduce: (typeof REDUCERS)[number] | null;
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
  value: z.number().finite(),
  severity: z.enum(THRESHOLD_SEVERITIES),
}).strict();

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
  for (const message of vizShapeProblems({ ...spec, thresholds: spec.thresholds.length })) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});
export type VizSpec = z.infer<typeof vizSpecSchema>;

// ============================================
// Variables and time ranges (§3)
// ============================================

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_VARIABLES = 10;
export const MAX_STATIC_OPTIONS = 200;
export const MAX_SQL_LENGTH = 20_000;

const optionsSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("static"), values: z.array(z.string().max(500)).min(1).max(MAX_STATIC_OPTIONS) }).strict(),
  z.object({ source: z.literal("query"), sql: z.string().trim().min(1).max(MAX_SQL_LENGTH) }).strict(),
]);

const variableBase = {
  name: z.string().regex(VARIABLE_NAME_RE, "lowercase letters, digits and _ (start with a letter)"),
  label: z.string().trim().min(1).max(80),
  options: optionsSchema,
};

export const variableSchema = z.discriminatedUnion("kind", [
  z.object({ ...variableBase, kind: z.literal("string"), default: z.string().max(500) }).strict(),
  z.object({ ...variableBase, kind: z.literal("identifier"), default: z.string().regex(IDENTIFIER_RE, "a ClickHouse identifier (letters, digits and _)") }).strict(),
]).superRefine((variable, ctx) => {
  if (variable.kind === "identifier" && variable.options.source === "static") {
    const bad = variable.options.values.filter((v) => !IDENTIFIER_RE.test(v));
    if (bad.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `identifier options must be identifiers: ${bad.slice(0, 3).join(", ")}` });
  }
});
export type Variable = z.infer<typeof variableSchema>;

/** Relative ranges a dashboard can default to, with their length in seconds. */
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
const RELATIVE_RANGE_KEYS = Object.keys(RELATIVE_RANGES) as [RelativeRange, ...RelativeRange[]];

export const REFRESH_SECONDS = [0, 30, 60, 300, 900] as const;
/** Longest absolute range a panel may ask for. */
export const MAX_ABSOLUTE_RANGE_SECONDS = 400 * 86_400;

export const timeRangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("relative"), value: z.enum(RELATIVE_RANGE_KEYS) }).strict(),
  z.object({ kind: z.literal("absolute"), from: z.number().int().positive(), to: z.number().int().positive() }).strict(),
]).superRefine((range, ctx) => {
  if (range.kind !== "absolute") return;
  if (range.to <= range.from) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "the range must end after it starts" });
  if (range.to - range.from > MAX_ABSOLUTE_RANGE_SECONDS) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "the range can be at most 400 days" });
});
export type TimeRange = z.infer<typeof timeRangeSchema>;

// ============================================
// Panels and the dashboard document (§1)
// ============================================

export const PANEL_WIDTHS = [3, 4, 6, 8, 12] as const;
export const PANEL_HEIGHTS = ["s", "m", "l"] as const;
export const MAX_PANELS = 40;

export const panelInputSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  sql: z.string().trim().min(1).max(MAX_SQL_LENGTH),
  viz: vizSpecSchema,
  width: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]),
  height: z.enum(PANEL_HEIGHTS),
  fleet: z.boolean(),
}).strict();
export type PanelInput = z.infer<typeof panelInputSchema>;

export const dashboardInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  timeRange: z.enum(RELATIVE_RANGE_KEYS),
  refreshSeconds: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(300), z.literal(900)]),
  variables: z.array(variableSchema).max(MAX_VARIABLES),
  panels: z.array(panelInputSchema).max(MAX_PANELS),
}).strict().superRefine((input, ctx) => {
  const names = input.variables.map((v) => v.name);
  const dupes = names.filter((name, i) => names.indexOf(name) !== i);
  if (dupes.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variables"], message: `variable names must be unique: ${[...new Set(dupes)].join(", ")}` });
  const ids = input.panels.map((p) => p.id).filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panels"], message: "a panel id appears twice" });
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

/** The same document with a `version` — what PUT takes, so a stale save is refused. */
export const dashboardUpdateSchema = z.object({
  version: z.number().int().positive(),
  dashboard: dashboardInputSchema,
}).strict();

/**
 * Exported dashboards: the document plus a format marker and the id it was
 * exported from. Import always creates a new dashboard (new panel ids); the
 * CLI's `apply` uses `id` to update the one it came from.
 */
export const DASHBOARD_EXPORT_FORMAT = "chouse.dashboard/v1";
export const dashboardExportSchema = z.object({
  format: z.literal(DASHBOARD_EXPORT_FORMAT),
  id: z.string().min(1).nullable(),
  dashboard: dashboardInputSchema,
}).strict();
export type DashboardExport = z.infer<typeof dashboardExportSchema>;
