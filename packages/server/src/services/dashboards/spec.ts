/**
 * Dashboards (ADR 0021 §1–§3, ADR 0023 §1–§8): the viz spec, panels and their
 * layout on the canvas, variables and the dashboard document, validated
 * strictly — an unknown field, chart type, unit, kind or variable kind is
 * rejected, never mapped to a default.
 *
 * This is format 2. Format 1 (fixed widths and heights, viz spec v1) is only
 * read as input and converted, in legacy.ts.
 *
 * NOTE: the browser mirrors the viz spec and the panel geometry in
 * src/lib/viz/spec.ts; both are tested against spec.fixture.json — keep them
 * in sync.
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
export type Unit = (typeof UNITS)[number];
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

/** Where a link takes a value from: a column of the clicked datum, or a fixed value. */
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
    dashboardId: z.string().uuid(),
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

/** What is wrong with the links and the baseline for this chart (empty when valid). */
export function vizExtrasProblems(spec: VizShape & { links: Link[]; baseline: { weeks: number } | null }): string[] {
  const problems: string[] = [];
  // A chart's clicked datum is its x, series and measures; a table row has every column.
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
  value: z.number().finite(),
  severity: z.enum(THRESHOLD_SEVERITIES),
}).strict();

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
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});
export type VizSpec = z.infer<typeof vizSpecSchema>;

// ============================================
// Variables and time ranges (§3, ADR 0023 §7)
// ============================================

export const MAX_VARIABLES = 10;
export const MAX_STATIC_OPTIONS = 200;
export const MAX_SQL_LENGTH = 20_000;
export const MAX_MULTI_DEFAULTS = 100;
/** The most values a multi-value variable sends in one run (an options query returns at most 1,000). */
export const MAX_MULTI_VALUES = 1_000;
export const MAX_VALUE_LENGTH = 500;

const optionsSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("static"), values: z.array(z.string().max(MAX_VALUE_LENGTH)).min(1).max(MAX_STATIC_OPTIONS) }).strict(),
  z.object({ source: z.literal("query"), sql: z.string().trim().min(1).max(MAX_SQL_LENGTH) }).strict(),
]);

const variableBase = {
  name: variableName,
  label: z.string().trim().min(1).max(80),
  options: optionsSchema,
};

export const variableSchema = z.discriminatedUnion("kind", [
  z.object({ ...variableBase, kind: z.literal("string"), default: z.string().max(MAX_VALUE_LENGTH) }).strict(),
  z.object({ ...variableBase, kind: z.literal("identifier"), default: z.string().regex(IDENTIFIER_RE, "a ClickHouse identifier (letters, digits and _)") }).strict(),
  z.object({
    ...variableBase,
    kind: z.literal("multi"),
    default: z.array(z.string().max(MAX_VALUE_LENGTH)).min(1, "a multi-value variable needs at least one default value").max(MAX_MULTI_DEFAULTS),
  }).strict(),
]).superRefine((variable, ctx) => {
  if (variable.kind === "identifier" && variable.options.source === "static") {
    const bad = variable.options.values.filter((v) => !IDENTIFIER_RE.test(v));
    if (bad.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `identifier options must be identifiers: ${bad.slice(0, 3).join(", ")}` });
  }
  if (variable.kind === "multi" && new Set(variable.default).size !== variable.default.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a default value is listed twice" });
  }
});
export type Variable = z.infer<typeof variableSchema>;

/** A value chosen for a variable: one string, or a list for a multi-value variable. */
export const variableValueSchema = z.union([
  z.string().max(MAX_VALUE_LENGTH),
  z.array(z.string().max(MAX_VALUE_LENGTH)).max(MAX_MULTI_VALUES),
]);
export type VariableValue = z.infer<typeof variableValueSchema>;
export const variableValuesSchema = z.record(variableValueSchema);
export type VariableValues = z.infer<typeof variableValuesSchema>;

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
export const RELATIVE_RANGE_KEYS = Object.keys(RELATIVE_RANGES) as [RelativeRange, ...RelativeRange[]];

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
// Annotations (ADR 0023 §5)
// ============================================

export const ANNOTATION_SOURCES = ["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"] as const;
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];
/** What a new or converted dashboard shows: every source. */
export const DEFAULT_ANNOTATION_SOURCES: AnnotationSource[] = [...ANNOTATION_SOURCES];
export const annotationSourcesSchema = z.array(z.enum(ANNOTATION_SOURCES)).max(ANNOTATION_SOURCES.length)
  .refine((sources) => new Set(sources).size === sources.length, "an annotation source is listed twice");

// ============================================
// The canvas (ADR 0023 §1)
// ============================================

export const GRID_COLUMNS = 24;
export const ROW_HEIGHT_PX = 32;
export const ROW_GAP_PX = 8;
/** Deep enough for the most panels at their tallest, so no layout the engine makes can be refused. */
export const MAX_LAYOUT_Y = 60 * 40;
export const MAX_PANEL_ROWS = 40;
export const MAX_PANELS = 60;
export const MAX_CHART_PANELS = 40;
export const MAX_SCOPE_CONNECTIONS = 50;
export const MAX_MARKDOWN_LENGTH = 10_000;

export const layoutSchema = z.object({
  x: z.number().int().min(0).max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(MAX_LAYOUT_Y),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(MAX_PANEL_ROWS),
}).strict().refine((l) => l.x + l.w <= GRID_COLUMNS, `a panel must end within the ${GRID_COLUMNS} columns (x + w ≤ ${GRID_COLUMNS})`);
export type Layout = z.infer<typeof layoutSchema>;

export const PANEL_KINDS = ["chart", "text", "heading"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

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

const panelId = z.string().uuid().nullable();

export const chartPanelSchema = z.object({
  id: panelId,
  kind: z.literal("chart"),
  title: z.string().trim().min(1).max(200),
  sql: z.string().trim().min(1).max(MAX_SQL_LENGTH),
  viz: vizSpecSchema,
  fleet: z.boolean(),
  layout: layoutSchema,
}).strict();

export const textPanelSchema = z.object({
  id: panelId,
  kind: z.literal("text"),
  title: z.string().trim().max(200),
  markdown: z.string().trim().min(1).max(MAX_MARKDOWN_LENGTH),
  layout: layoutSchema,
}).strict();

export const headingPanelSchema = z.object({
  id: panelId,
  kind: z.literal("heading"),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500),
  layout: layoutSchema,
}).strict();

export const panelInputSchema = z.discriminatedUnion("kind", [chartPanelSchema, textPanelSchema, headingPanelSchema]);
export type PanelInput = z.infer<typeof panelInputSchema>;
export type ChartPanelInput = z.infer<typeof chartPanelSchema>;
export type TextPanelInput = z.infer<typeof textPanelSchema>;
export type HeadingPanelInput = z.infer<typeof headingPanelSchema>;

/** How a panel is called in messages: its title, or its kind when a text panel has none. */
export function panelLabel(panel: PanelInput, index: number): string {
  return panel.title ? `Panel ${index + 1} (${panel.title})` : `Panel ${index + 1} (${panel.kind})`;
}

/** What is wrong with the panels' places on the canvas (empty when they fit). */
export function layoutProblems(panels: PanelInput[]): string[] {
  const problems: string[] = [];
  panels.forEach((panel, i) => {
    const limits = sizeLimits(panel.kind, panel.kind === "chart" ? panel.viz.type : null);
    const { w, h } = panel.layout;
    if (w < limits.minW || h < limits.minH) problems.push(`${panelLabel(panel, i)} is ${w} × ${h}; it must be at least ${limits.minW} × ${limits.minH}`);
    if (h > limits.maxH) problems.push(`${panelLabel(panel, i)} is ${h} rows tall; it can be at most ${limits.maxH}`);
  });
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      if (overlaps(panels[i].layout, panels[j].layout)) problems.push(`${panelLabel(panels[i], i)} and ${panelLabel(panels[j], j)} overlap`);
    }
  }
  return problems;
}

/** Panels in reading order: top to bottom, then left to right (what `position` stores). */
export function readingOrder<T extends { layout: Layout }>(panels: T[]): T[] {
  return [...panels].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
}

// ============================================
// The dashboard document (§1)
// ============================================

/**
 * Which connections a dashboard is made for (ADR 0021 §3). It still runs on
 * the caller's active connection; outside the scope it refuses to, rather than
 * fail panel by panel on tables that cluster does not have. Fleet panels run
 * on the scoped connections only.
 */
export const connectionScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }).strict(),
  z.object({
    kind: z.literal("only"),
    connectionIds: z.array(z.string().min(1)).min(1).max(MAX_SCOPE_CONNECTIONS)
      .refine((ids) => new Set(ids).size === ids.length, "a connection is listed twice"),
  }).strict(),
]);
export type ConnectionScope = z.infer<typeof connectionScopeSchema>;

export function inScope(scope: ConnectionScope, connectionId: string): boolean {
  return scope.kind === "any" || scope.connectionIds.includes(connectionId);
}

export const dashboardInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  timeRange: z.enum(RELATIVE_RANGE_KEYS),
  refreshSeconds: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(300), z.literal(900)]),
  connectionScope: connectionScopeSchema,
  variables: z.array(variableSchema).max(MAX_VARIABLES),
  annotations: annotationSourcesSchema,
  panels: z.array(panelInputSchema).max(MAX_PANELS),
}).strict().superRefine((input, ctx) => {
  const names = input.variables.map((v) => v.name);
  const dupes = names.filter((name, i) => names.indexOf(name) !== i);
  if (dupes.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variables"], message: `variable names must be unique: ${[...new Set(dupes)].join(", ")}` });
  const ids = input.panels.map((p) => p.id).filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panels"], message: "a panel id appears twice" });
  const charts = input.panels.filter((p) => p.kind === "chart").length;
  if (charts > MAX_CHART_PANELS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panels"], message: `a dashboard can have at most ${MAX_CHART_PANELS} chart panels` });
  for (const message of layoutProblems(input.panels)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  input.panels.forEach((panel, i) => {
    if (panel.kind !== "chart") return;
    for (const link of panel.viz.links) {
      if (link.kind === "filter" && !names.includes(link.variable)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${panelLabel(panel, i)}: the link "${link.label}" sets ${link.variable}, which is not a variable of this dashboard` });
      }
    }
  });
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

/** The same document with a `version` — what PUT takes, so a stale save is refused. */
export const dashboardUpdateSchema = z.object({
  version: z.number().int().positive(),
  dashboard: z.unknown(),
}).strict();

/**
 * Exported dashboards: the document plus a format marker and the id it was
 * exported from. Import always creates a new dashboard (new panel ids); the
 * CLI's `apply` uses `id` to update the one it came from. Format 1 exports
 * are read by legacy.ts.
 */
export const DASHBOARD_EXPORT_FORMAT = "chouse.dashboard/v2";
export const dashboardExportSchema = z.object({
  format: z.literal(DASHBOARD_EXPORT_FORMAT),
  id: z.string().min(1).nullable(),
  dashboard: dashboardInputSchema,
}).strict();
export type DashboardExport = z.infer<typeof dashboardExportSchema>;
