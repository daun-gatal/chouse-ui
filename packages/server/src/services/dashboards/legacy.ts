/**
 * Format 1 dashboards (ADR 0021) and their conversion to format 2 (ADR 0023 §3).
 *
 * Format 1 placed panels on a 12-column CSS grid with a fixed width (3, 4, 6,
 * 8 or 12) and height (s, m or l), and used viz spec v1. It is only ever read:
 * from files and API bodies written before format 2, and by migration 1.63.0.
 * Both convert through `convertDashboardV1`, so a v1 file and the dashboard it
 * came from end up identical.
 *
 * Which format a document is in is decided by one explicit rule — format 2
 * documents carry `annotations`, format 1 documents never do — and a document
 * that does not parse in its format is refused with the reason. Nothing is
 * guessed or filled in.
 */

import { z } from "zod";

import {
  COLOR_SCHEMES,
  CHART_TYPES,
  DEFAULT_ANNOTATION_SOURCES,
  GRID_COLUMNS,
  MAX_SQL_LENGTH,
  MAX_Y_COLUMNS,
  REDUCERS,
  RELATIVE_RANGE_KEYS,
  UNITS,
  connectionScopeSchema,
  dashboardExportSchema,
  dashboardInputSchema,
  thresholdSchema,
  variableSchema,
  vizShapeProblems,
  type DashboardInput,
  type Layout,
  type VizSpec,
} from "./spec";

// ============================================
// Format 1 schemas
// ============================================

export const PANEL_WIDTHS_V1 = [3, 4, 6, 8, 12] as const;
export const PANEL_HEIGHTS_V1 = ["s", "m", "l"] as const;
export type PanelWidthV1 = (typeof PANEL_WIDTHS_V1)[number];
export type PanelHeightV1 = (typeof PANEL_HEIGHTS_V1)[number];
const V1_GRID_COLUMNS = 12;

const columnName = z.string().min(1).max(200);

export const vizSpecV1Schema = z.object({
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
export type VizSpecV1 = z.infer<typeof vizSpecV1Schema>;

const widthV1 = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);

export const panelV1Schema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  sql: z.string().trim().min(1).max(MAX_SQL_LENGTH),
  viz: vizSpecV1Schema,
  width: widthV1,
  height: z.enum(PANEL_HEIGHTS_V1),
  fleet: z.boolean(),
}).strict();
export type PanelV1 = z.infer<typeof panelV1Schema>;

/** Format 1 had single-value variables only. */
const variableV1Schema = variableSchema.refine((v) => v.kind === "string" || v.kind === "identifier", "multi-value variables need format 2");

export const dashboardInputV1Schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  timeRange: z.enum(RELATIVE_RANGE_KEYS),
  refreshSeconds: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(300), z.literal(900)]),
  connectionScope: connectionScopeSchema,
  variables: z.array(variableV1Schema).max(10),
  panels: z.array(panelV1Schema).max(40),
}).strict();
export type DashboardInputV1 = z.infer<typeof dashboardInputV1Schema>;

export const DASHBOARD_EXPORT_FORMAT_V1 = "chouse.dashboard/v1";
export const dashboardExportV1Schema = z.object({
  format: z.literal(DASHBOARD_EXPORT_FORMAT_V1),
  id: z.string().min(1).nullable(),
  dashboard: dashboardInputV1Schema,
}).strict();

// ============================================
// Conversion
// ============================================

/** Canvas rows for each format 1 height (32 px rows, 8 px gaps — about the old pixel heights). */
export const V1_HEIGHT_ROWS: Record<PanelHeightV1, number> = { s: 6, m: 9, l: 12 };

export function convertVizV1(spec: VizSpecV1): VizSpec {
  return { ...spec, version: 2, links: [], baseline: null };
}

/**
 * Where format 1 panels sat, on the 24-column canvas. The old grid flowed
 * panels in order, row by row: a panel that did not fit in what was left of a
 * row started the next one, and every panel in a row was stretched to the
 * tallest. Each panel keeps its column and row and takes its row's height, so
 * a converted dashboard looks as it did.
 */
export function layoutFromV1(panels: Array<{ width: PanelWidthV1; height: PanelHeightV1 }>): Layout[] {
  const scale = GRID_COLUMNS / V1_GRID_COLUMNS;
  const rows: number[][] = [];
  const columns: number[] = [];
  let cursor = V1_GRID_COLUMNS;
  panels.forEach((panel, i) => {
    if (cursor + panel.width > V1_GRID_COLUMNS) {
      rows.push([]);
      cursor = 0;
    }
    rows[rows.length - 1].push(i);
    columns[i] = cursor;
    cursor += panel.width;
  });
  const layouts: Layout[] = [];
  let y = 0;
  for (const row of rows) {
    const h = Math.max(...row.map((i) => V1_HEIGHT_ROWS[panels[i].height]));
    for (const i of row) layouts[i] = { x: columns[i] * scale, y, w: panels[i].width * scale, h };
    y += h;
  }
  return layouts;
}

/** A format 1 dashboard as format 2: same settings and panels, laid out as before, every annotation source on. */
export function convertDashboardV1(input: DashboardInputV1): DashboardInput {
  const layouts = layoutFromV1(input.panels);
  return {
    title: input.title,
    description: input.description,
    timeRange: input.timeRange,
    refreshSeconds: input.refreshSeconds,
    connectionScope: input.connectionScope,
    variables: input.variables,
    annotations: [...DEFAULT_ANNOTATION_SOURCES],
    panels: input.panels.map((panel, i) => ({
      id: panel.id,
      kind: "chart" as const,
      title: panel.title,
      sql: panel.sql,
      viz: convertVizV1(panel.viz),
      fleet: panel.fleet,
      layout: layouts[i],
    })),
  };
}

// ============================================
// Reading a document in either format
// ============================================

export type ParsedDocument =
  | { ok: true; input: DashboardInput; format: 1 | 2 }
  | { ok: false; problems: string[] };

/** Zod issues as messages, each prefixed with where it is. */
export function issueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function panelsOf(raw: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(raw.panels) ? raw.panels.filter(isRecord) : [];
}

/**
 * A dashboard document (an API body or the `dashboard` of an export) in
 * either format, as format 2. Format 2 documents carry `annotations`; format 1
 * documents never did.
 */
export function parseDashboardDocument(raw: unknown): ParsedDocument {
  if (!isRecord(raw)) return { ok: false, problems: ["The dashboard must be a JSON object"] };
  const panels = panelsOf(raw);
  if ("annotations" in raw) {
    const oldStyle = panels.findIndex((p) => "width" in p || "height" in p);
    if (oldStyle >= 0) {
      return { ok: false, problems: [`panels.${oldStyle}: this panel uses the format 1 width and height, but the dashboard is format 2 (it has annotations). A document is all one format: give every panel a layout and a kind.`] };
    }
    const parsed = dashboardInputSchema.safeParse(raw);
    return parsed.success ? { ok: true, input: parsed.data, format: 2 } : { ok: false, problems: issueMessages(parsed.error) };
  }
  const newStyle = panels.findIndex((p) => "layout" in p || "kind" in p);
  if (newStyle >= 0) {
    return { ok: false, problems: [`panels.${newStyle}: this panel has a layout or kind (format 2), but the dashboard has no annotations (format 1). Add "annotations" to read it as format 2.`] };
  }
  const v1 = dashboardInputV1Schema.safeParse(raw);
  if (!v1.success) return { ok: false, problems: issueMessages(v1.error) };
  // The converted document is checked like any other: a format 1 dashboard that breaks a format 2 rule is refused, not trimmed.
  const converted = dashboardInputSchema.safeParse(convertDashboardV1(v1.data));
  return converted.success ? { ok: true, input: converted.data, format: 1 } : { ok: false, problems: issueMessages(converted.error) };
}

export type ParsedExport =
  | { ok: true; id: string | null; input: DashboardInput; format: 1 | 2 }
  | { ok: false; problems: string[] };

/** An export (`{format, id, dashboard}`) in either format, as format 2. */
export function parseDashboardExport(raw: unknown): ParsedExport {
  if (!isRecord(raw)) return { ok: false, problems: ["The export must be a JSON object"] };
  if (raw.format === DASHBOARD_EXPORT_FORMAT_V1) {
    const v1 = dashboardExportV1Schema.safeParse(raw);
    if (!v1.success) return { ok: false, problems: issueMessages(v1.error) };
    const converted = dashboardInputSchema.safeParse(convertDashboardV1(v1.data.dashboard));
    return converted.success ? { ok: true, id: v1.data.id, input: converted.data, format: 1 } : { ok: false, problems: issueMessages(converted.error) };
  }
  const v2 = dashboardExportSchema.safeParse(raw);
  if (!v2.success) {
    if (typeof raw.format !== "string" || raw.format !== "chouse.dashboard/v2") {
      return { ok: false, problems: [`format must be "chouse.dashboard/v2" (or "${DASHBOARD_EXPORT_FORMAT_V1}" for an export from before CHouse 3.16)`] };
    }
    return { ok: false, problems: issueMessages(v2.error) };
  }
  return { ok: true, id: v2.data.id, input: v2.data.dashboard, format: 2 };
}
