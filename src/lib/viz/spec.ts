/**
 * The dashboard viz spec and canvas geometry (ADR 0021 §2, ADR 0023 §1–§2),
 * validated in the browser so the editor can say what is wrong before a save.
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
export const MAX_LINKS = 6;
export const MAX_LINK_VALUES = 10;
export const MIN_BASELINE_WEEKS = 2;
export const MAX_BASELINE_WEEKS = 8;
const columnName = z.string().min(1).max(200);

/** Chart types that draw threshold lines (stat panels color their value instead). */
export const THRESHOLD_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar", "line", "multi_line", "area", "stacked_area", "stat",
]);

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

// ============================================
// Drill-down links (ADR 0023 §6)
// ============================================

export const linkValueSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("column"), column: columnName }).strict(),
  z.object({ from: z.literal("value"), value: z.string().max(500) }).strict(),
]);
export type LinkValue = z.infer<typeof linkValueSchema>;

const linkLabel = z.string().trim().min(1).max(80);
const variableName = z.string().regex(VARIABLE_NAME_RE, "lowercase letters, digits and _ (start with a letter)");

export const linkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dashboard"),
    label: linkLabel,
    dashboardId: z.uuid(),
    values: z.record(variableName, linkValueSchema)
      .refine((values) => Object.keys(values).length <= MAX_LINK_VALUES, `a link sets at most ${MAX_LINK_VALUES} variables`),
  }).strict(),
  z.object({ kind: z.literal("filter"), label: linkLabel, variable: variableName, column: columnName }).strict(),
  z.object({ kind: z.literal("explorer"), label: linkLabel, database: linkValueSchema, table: linkValueSchema }).strict(),
]);
export type Link = z.infer<typeof linkSchema>;

/** Every column a link reads from the clicked datum. */
export function linkColumns(link: Link): string[] {
  const of = (value: LinkValue): string[] => (value.from === "column" ? [value.column] : []);
  switch (link.kind) {
    case "dashboard": return Object.values(link.values).flatMap(of);
    case "filter": return [link.column];
    case "explorer": return [...of(link.database), ...of(link.table)];
  }
}

// ============================================
// The viz spec (v2)
// ============================================

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

/** What is wrong with the links and the baseline for this chart (empty when valid). */
export function vizExtrasProblems(spec: VizShape & { links: Link[]; baseline: { weeks: number } | null }): string[] {
  const problems: string[] = [];
  if (spec.type !== "table") {
    const named = new Set([spec.x, spec.series, ...spec.y].filter((c): c is string => c !== null));
    for (const link of spec.links) {
      const unknown = linkColumns(link).filter((c) => !named.has(c));
      if (unknown.length > 0) problems.push(`the link "${link.label}" reads ${unknown.join(", ")}, which the chart does not plot (use its x, series or y columns)`);
    }
  }
  if (spec.type === "stat" && spec.links.some((l) => linkColumns(l).length > 0)) problems.push("a stat panel's links can only use fixed values");
  if (spec.baseline !== null) {
    if (!TIME_SERIES_TYPES.has(spec.type)) problems.push("an expected-range band needs a line or area chart");
    else if (spec.y.length !== 1 || spec.series !== null) problems.push("an expected-range band needs exactly one y column and no split by series");
  }
  return problems;
}

export const thresholdSchema = z.object({
  value: z.number(),
  severity: z.enum(THRESHOLD_SEVERITIES),
}).strict();
export type Threshold = z.infer<typeof thresholdSchema>;

export const baselineSchema = z.object({
  weeks: z.number().int().min(MIN_BASELINE_WEEKS).max(MAX_BASELINE_WEEKS),
}).strict();

export const vizSpecSchema = z.object({
  version: z.literal(2),
  type: z.enum(CHART_TYPES),
  x: columnName.nullable(),
  y: z.array(columnName).max(MAX_Y_COLUMNS),
  series: columnName.nullable(),
  unit: z.enum(UNITS),
  decimals: z.number().int().min(0).max(6).nullable(),
  thresholds: z.array(thresholdSchema).max(4),
  colorScheme: z.enum(COLOR_SCHEMES),
  reduce: z.enum(REDUCERS).nullable(),
  links: z.array(linkSchema).max(MAX_LINKS),
  baseline: baselineSchema.nullable(),
}).strict().superRefine((spec, ctx) => {
  const shape = { ...spec, thresholds: spec.thresholds.length };
  for (const message of [...vizShapeProblems(shape), ...vizExtrasProblems({ ...shape, links: spec.links, baseline: spec.baseline })]) {
    ctx.addIssue({ code: "custom", message });
  }
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

export type VariableOptions = { source: "static"; values: string[] } | { source: "query"; sql: string };

export interface Variable {
  name: string;
  label: string;
  kind: "string" | "identifier";
  options: VariableOptions;
  default: string;
}

export type TimeRange = { kind: "relative"; value: RelativeRange } | { kind: "absolute"; from: number; to: number };

// ============================================
// Annotations and the canvas (ADR 0023 §1, §5)
// ============================================

export const ANNOTATION_SOURCES = ["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"] as const;
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];

export const GRID_COLUMNS = 24;
export const ROW_HEIGHT_PX = 32;
export const ROW_GAP_PX = 8;
export const MAX_PANEL_ROWS = 40;
export const MAX_PANELS = 60;
export const MAX_CHART_PANELS = 40;

export interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PanelKind = "chart" | "text" | "heading";

export interface SizeLimits {
  minW: number;
  minH: number;
  maxH: number;
}

/** The smallest (and for headings, tallest) a panel may be on the canvas. */
export function sizeLimits(kind: PanelKind, chartType: ChartType | null): SizeLimits {
  if (kind === "heading") return { minW: 4, minH: 1, maxH: 3 };
  if (kind === "text") return { minW: 3, minH: 2, maxH: MAX_PANEL_ROWS };
  if (chartType === "stat") return { minW: 3, minH: 3, maxH: MAX_PANEL_ROWS };
  if (chartType === "table") return { minW: 6, minH: 5, maxH: MAX_PANEL_ROWS };
  return { minW: 4, minH: 5, maxH: MAX_PANEL_ROWS };
}

/** Whether two layouts share any cell. */
export function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A panel's height in pixels for `h` canvas rows. */
export function rowsToPx(h: number): number {
  return h * ROW_HEIGHT_PX + (h - 1) * ROW_GAP_PX;
}
