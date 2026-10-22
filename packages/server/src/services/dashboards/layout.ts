/**
 * The layout engine (ADR 0023 §4): panels in, places on the 24-column canvas
 * out. AI drafts, templates, Tidy up and Grafana import all go through it, so
 * a dashboard CHouse lays out always follows the same conventions — and an AI
 * never picks coordinates.
 *
 * Pure and deterministic: the same panels in the same order always land in
 * the same places.
 */

import { GRID_COLUMNS, TIME_SERIES_TYPES, sizeLimits, type ChartType, type Layout, type PanelKind } from "./spec";

export const ROLES = ["kpi", "trend", "breakdown", "ranking", "distribution", "detail"] as const;
export type Role = (typeof ROLES)[number];
export const IMPORTANCES = ["primary", "secondary"] as const;
export type Importance = (typeof IMPORTANCES)[number];

/** The chart types each role may use. A draft whose chart does not fit its role is blocked, not retyped. */
export const ROLE_CHARTS: Record<Role, readonly ChartType[]> = {
  kpi: ["stat"],
  trend: ["line", "multi_line", "area", "stacked_area", "bar", "stacked_bar"],
  breakdown: ["bar", "grouped_bar", "stacked_bar", "horizontal_bar", "pie", "donut", "treemap", "funnel", "radar"],
  ranking: ["horizontal_bar", "bar", "table"],
  distribution: ["histogram", "heatmap", "scatter"],
  detail: ["table"],
};

/** Why `type` cannot serve `role` (null when it can). */
export function roleProblem(role: Role, type: ChartType): string | null {
  return ROLE_CHARTS[role].includes(type) ? null : `a ${role} panel is drawn as ${ROLE_CHARTS[role].join(", ")}, not ${type}`;
}

/** The role a chart plays, read from its type alone (Tidy up, templates, imports). */
export function roleOf(type: ChartType): Role {
  if (type === "stat") return "kpi";
  if (TIME_SERIES_TYPES.has(type)) return "trend";
  if (type === "histogram" || type === "heatmap" || type === "scatter") return "distribution";
  if (type === "horizontal_bar") return "ranking";
  if (type === "table") return "detail";
  return "breakdown";
}

export const KPI_HEIGHT = 4;
export const CHART_HEIGHT = 9;
export const DETAIL_HEIGHT = 10;
export const HEADING_HEIGHT = 2;
const MAX_KPIS_PER_ROW = 6;
const HALF = GRID_COLUMNS / 2;

export interface ArrangeItem<T> {
  ref: T;
  kind: PanelKind;
  /** The chart's role; null for text panels. */
  role: Role | null;
  importance: Importance;
  /** Text panels keep their size; charts are sized by role. */
  size: { w: number; h: number } | null;
}

export interface ArrangeSection<T> {
  /** The section's heading panel, or null for panels before any heading. */
  heading: T | null;
  items: ArrangeItem<T>[];
}

export interface Placed<T> {
  ref: T;
  layout: Layout;
}

/** KPI widths for one row of `n`: equal, the remainder going to the first ones, so the row is full. */
export function kpiWidths(n: number): number[] {
  const base = Math.floor(GRID_COLUMNS / n);
  const extra = GRID_COLUMNS - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

function rank<T>(item: ArrangeItem<T>): number {
  if (item.role === "kpi") return 0;
  if (item.role === "trend" && item.importance === "primary") return 1;
  if (item.role === "detail") return 4;
  if (item.role === "trend") return 3;
  return 2;
}

/**
 * Place every section's heading and panels, top to bottom:
 *   - a heading (24 × 2) when the section has one;
 *   - KPIs in rows of up to six, in equal widths, 4 rows tall;
 *   - each primary trend at full width (24 × 9);
 *   - breakdowns, rankings, distributions, secondary trends and text panels
 *     two to a row (12 × 9; text keeps its size), an odd chart out at full width;
 *   - detail tables at full width (24 × 10).
 * Within a group panels keep their order.
 */
export function arrange<T>(sections: ArrangeSection<T>[]): Placed<T>[] {
  const placed: Placed<T>[] = [];
  let y = 0;
  const put = (ref: T, x: number, w: number, h: number): void => {
    placed.push({ ref, layout: { x, y, w, h } });
  };

  for (const section of sections) {
    if (section.heading !== null) {
      put(section.heading, 0, GRID_COLUMNS, HEADING_HEIGHT);
      y += HEADING_HEIGHT;
    }
    const ordered = section.items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i).map((e) => e.item);

    const kpis = ordered.filter((it) => rank(it) === 0);
    for (let start = 0; start < kpis.length; start += MAX_KPIS_PER_ROW) {
      const row = kpis.slice(start, start + MAX_KPIS_PER_ROW);
      let x = 0;
      kpiWidths(row.length).forEach((w, i) => { put(row[i].ref, x, w, KPI_HEIGHT); x += w; });
      y += KPI_HEIGHT;
    }

    for (const item of ordered.filter((it) => rank(it) === 1)) {
      put(item.ref, 0, GRID_COLUMNS, CHART_HEIGHT);
      y += CHART_HEIGHT;
    }

    // The middle: packed left to right in rows of 24, each row as tall as its tallest panel.
    const middle = ordered.filter((it) => rank(it) === 2 || rank(it) === 3);
    let row: Array<{ item: ArrangeItem<T>; w: number; h: number }> = [];
    const flush = (): void => {
      if (row.length === 0) return;
      // A chart alone in its row takes the whole row rather than leave half of it empty.
      if (row.length === 1 && row[0].item.kind === "chart") row[0].w = GRID_COLUMNS;
      let x = 0;
      for (const cell of row) { put(cell.item.ref, x, cell.w, cell.h); x += cell.w; }
      y += Math.max(...row.map((cell) => cell.h));
      row = [];
    };
    for (const item of middle) {
      const limits = sizeLimits(item.kind, null);
      const w = item.size ? Math.min(GRID_COLUMNS, Math.max(limits.minW, item.size.w)) : HALF;
      const h = item.size ? Math.min(limits.maxH, Math.max(limits.minH, item.size.h)) : CHART_HEIGHT;
      if (row.reduce((sum, cell) => sum + cell.w, 0) + w > GRID_COLUMNS) flush();
      row.push({ item, w, h });
    }
    flush();

    for (const item of ordered.filter((it) => rank(it) === 4)) {
      put(item.ref, 0, GRID_COLUMNS, DETAIL_HEIGHT);
      y += DETAIL_HEIGHT;
    }
  }
  return placed;
}

/** Where a panel of `size` goes when added to a dashboard: below everything, at the left. */
export function appendBelow(existing: Layout[], size: { w: number; h: number }): Layout {
  const bottom = existing.reduce((max, l) => Math.max(max, l.y + l.h), 0);
  return { x: 0, y: bottom, w: Math.min(GRID_COLUMNS, size.w), h: size.h };
}

/** The size a role's panel gets when it is added on its own (Pin to dashboard). */
export function roleSize(role: Role): { w: number; h: number } {
  if (role === "kpi") return { w: 6, h: KPI_HEIGHT };
  if (role === "detail") return { w: GRID_COLUMNS, h: DETAIL_HEIGHT };
  if (role === "trend") return { w: GRID_COLUMNS, h: CHART_HEIGHT };
  return { w: HALF, h: CHART_HEIGHT };
}

/**
 * Tidy up (ADR 0023 §4): lay out an existing dashboard's panels again. Headings
 * start sections, a chart's role comes from its type, and the first trend of
 * each section is its primary one.
 */
export function tidy<T>(panels: Array<{ ref: T; kind: PanelKind; chartType: ChartType | null; size: { w: number; h: number } }>): Placed<T>[] {
  const sections: ArrangeSection<T>[] = [{ heading: null, items: [] }];
  let trendSeen = false;
  for (const panel of panels) {
    if (panel.kind === "heading") {
      sections.push({ heading: panel.ref, items: [] });
      trendSeen = false;
      continue;
    }
    const current = sections[sections.length - 1];
    if (panel.kind === "text") {
      current.items.push({ ref: panel.ref, kind: "text", role: null, importance: "secondary", size: panel.size });
      continue;
    }
    if (panel.chartType === null) throw new Error("a chart panel needs its chart type");
    const role = roleOf(panel.chartType);
    const importance: Importance = role === "trend" && !trendSeen ? "primary" : "secondary";
    if (role === "trend") trendSeen = true;
    current.items.push({ ref: panel.ref, kind: "chart", role, importance, size: null });
  }
  return arrange(sections.filter((s) => s.heading !== null || s.items.length > 0));
}
