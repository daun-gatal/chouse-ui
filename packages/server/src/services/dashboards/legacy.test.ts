import { describe, expect, it } from "bun:test";

import { convertDashboardV1, convertVizV1, layoutFromV1, parseDashboardDocument, parseDashboardExport, type DashboardInputV1 } from "./legacy";
import { ANNOTATION_SOURCES, dashboardInputSchema } from "./spec";

const LINE_V1 = { version: 1 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "ms" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null };
const STAT_V1 = { ...LINE_V1, type: "stat" as const, x: null, unit: "count" as const, reduce: "last" as const };

function panelV1(width: number, height: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: null, title: `${width}${height}`, sql: "SELECT 1 AS t, 2 AS v", viz: LINE_V1, width, height, fleet: false, ...overrides };
}

function dashboardV1(panels: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Orders", description: "Old", timeRange: "6h", refreshSeconds: 60, connectionScope: { kind: "any" }, variables: [], panels, ...overrides };
}

describe("layoutFromV1", () => {
  it("places panels as the 12-column grid flowed them, at twice the width", () => {
    expect(layoutFromV1([{ width: 6, height: "m" }, { width: 6, height: "m" }, { width: 12, height: "l" }])).toEqual([
      { x: 0, y: 0, w: 12, h: 9 },
      { x: 12, y: 0, w: 12, h: 9 },
      { x: 0, y: 9, w: 24, h: 12 },
    ]);
  });

  it("starts a new row when a panel does not fit in what is left", () => {
    expect(layoutFromV1([{ width: 8, height: "s" }, { width: 6, height: "s" }, { width: 4, height: "s" }])).toEqual([
      { x: 0, y: 0, w: 16, h: 6 },
      { x: 0, y: 6, w: 12, h: 6 },
      { x: 12, y: 6, w: 8, h: 6 },
    ]);
  });

  it("stretches every panel in a row to the tallest, as the old grid did", () => {
    expect(layoutFromV1([{ width: 3, height: "s" }, { width: 3, height: "l" }, { width: 6, height: "m" }, { width: 4, height: "s" }])).toEqual([
      { x: 0, y: 0, w: 6, h: 12 },
      { x: 6, y: 0, w: 6, h: 12 },
      { x: 12, y: 0, w: 12, h: 12 },
      { x: 0, y: 12, w: 8, h: 6 },
    ]);
  });

  it("fills a row exactly with four quarter panels", () => {
    expect(layoutFromV1([3, 3, 3, 3].map((width) => ({ width: width as 3, height: "s" as const }))).map((l) => l.x)).toEqual([0, 6, 12, 18]);
  });

  it("returns nothing for no panels", () => {
    expect(layoutFromV1([])).toEqual([]);
  });

  it("always gives a place the canvas accepts", () => {
    const widths = [3, 4, 6, 8, 12] as const;
    const heights = ["s", "m", "l"] as const;
    for (const w of widths) {
      for (const h of heights) {
        const converted = convertDashboardV1(dashboardV1([panelV1(w, h), panelV1(w, h, { viz: STAT_V1 }), panelV1(w, h, { viz: { ...LINE_V1, type: "table", x: null, y: [], unit: "none" } })]) as unknown as DashboardInputV1);
        const parsed = dashboardInputSchema.safeParse(converted);
        expect({ w, h, issues: parsed.success ? [] : parsed.error.issues.map((i) => i.message) }).toEqual({ w, h, issues: [] });
      }
    }
  });
});

describe("convertDashboardV1", () => {
  it("keeps settings, ids and SQL, converts chart settings and turns every annotation source on", () => {
    const id = "4b2c8a7e-3b8f-4a5e-9c1d-0e6f7a8b9c0d";
    const variable = { name: "db", label: "DB", kind: "identifier" as const, options: { source: "static" as const, values: ["a"] }, default: "a" };
    const converted = convertDashboardV1(dashboardV1([panelV1(6, "m", { id, fleet: true })], { variables: [variable] }) as unknown as DashboardInputV1);
    expect(converted).toEqual({
      title: "Orders",
      description: "Old",
      timeRange: "6h",
      refreshSeconds: 60,
      connectionScope: { kind: "any" },
      variables: [variable],
      annotations: [...ANNOTATION_SOURCES],
      panels: [{ id, kind: "chart", title: "6m", sql: "SELECT 1 AS t, 2 AS v", viz: { ...LINE_V1, version: 2, links: [], baseline: null }, fleet: true, layout: { x: 0, y: 0, w: 12, h: 9 } }],
    });
  });

  it("converts a viz spec without touching what it shows", () => {
    expect(convertVizV1({ ...LINE_V1, thresholds: [{ value: 5, severity: "warning" }] })).toEqual({ ...LINE_V1, version: 2, thresholds: [{ value: 5, severity: "warning" }], links: [], baseline: null });
  });
});

describe("parseDashboardDocument", () => {
  it("reads format 1 (no annotations) and converts it", () => {
    const parsed = parseDashboardDocument(dashboardV1([panelV1(6, "m"), panelV1(6, "m")]));
    expect(parsed.ok && parsed.format).toBe(1);
    expect(parsed.ok && parsed.input.panels.map((p) => p.layout)).toEqual([{ x: 0, y: 0, w: 12, h: 9 }, { x: 12, y: 0, w: 12, h: 9 }]);
  });

  it("reads format 2 as it is", () => {
    const v2 = { ...dashboardV1([]), annotations: ["ddl"], panels: [{ id: null, kind: "text", title: "", markdown: "hi", layout: { x: 0, y: 0, w: 6, h: 4 } }] };
    const parsed = parseDashboardDocument(v2);
    expect(parsed.ok && parsed.format).toBe(2);
    expect(parsed.ok && parsed.input.annotations).toEqual(["ddl"]);
  });

  it("decides an empty dashboard's format by annotations alone", () => {
    expect(parseDashboardDocument(dashboardV1([]))).toMatchObject({ ok: true, format: 1 });
    expect(parseDashboardDocument({ ...dashboardV1([]), annotations: [] })).toMatchObject({ ok: true, format: 2, input: { annotations: [] } });
  });

  it("refuses a document that mixes the formats, saying which panel", () => {
    const mixed = { ...dashboardV1([panelV1(6, "m")]), annotations: [] };
    expect(parseDashboardDocument(mixed)).toEqual({ ok: false, problems: [expect.stringContaining("panels.0: this panel uses the format 1 width and height")] });
    const backwards = dashboardV1([{ id: null, kind: "chart", title: "x", sql: "SELECT 1", viz: LINE_V1, fleet: false, layout: { x: 0, y: 0, w: 6, h: 6 } }]);
    expect(parseDashboardDocument(backwards)).toEqual({ ok: false, problems: [expect.stringContaining("panels.0: this panel has a layout or kind (format 2)")] });
  });

  it("refuses what is not a document, and a format 1 document that does not parse", () => {
    expect(parseDashboardDocument([])).toEqual({ ok: false, problems: ["The dashboard must be a JSON object"] });
    expect(parseDashboardDocument(null)).toEqual({ ok: false, problems: ["The dashboard must be a JSON object"] });
    const bad = parseDashboardDocument(dashboardV1([panelV1(5, "m")]));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.problems[0]).toContain("panels.0.width");
  });

  it("refuses a multi-value variable in a format 1 document", () => {
    const multi = { name: "tables", label: "Tables", kind: "multi", options: { source: "static", values: ["a"] }, default: ["a"] };
    const parsed = parseDashboardDocument(dashboardV1([], { variables: [multi] }));
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problems.join(" ")).toContain("multi-value variables need format 2");
  });
});

describe("parseDashboardExport", () => {
  it("reads a v1 export and converts its dashboard, keeping the id", () => {
    const parsed = parseDashboardExport({ format: "chouse.dashboard/v1", id: "d1", dashboard: dashboardV1([panelV1(12, "s")]) });
    expect(parsed).toMatchObject({ ok: true, id: "d1", format: 1 });
    expect(parsed.ok && parsed.input.panels[0].layout).toEqual({ x: 0, y: 0, w: 24, h: 6 });
  });

  it("reads a v2 export", () => {
    const parsed = parseDashboardExport({ format: "chouse.dashboard/v2", id: null, dashboard: { ...dashboardV1([]), annotations: [] } });
    expect(parsed).toMatchObject({ ok: true, id: null, format: 2 });
  });

  it("names the formats it takes when the format is unknown, and the issues when a v2 export is wrong", () => {
    expect(parseDashboardExport({ format: "grafana", id: null, dashboard: {} })).toEqual({ ok: false, problems: ['format must be "chouse.dashboard/v2" (or "chouse.dashboard/v1" for an export from before CHouse 3.16)'] });
    const wrong = parseDashboardExport({ format: "chouse.dashboard/v2", id: null, dashboard: dashboardV1([panelV1(6, "m")]) });
    expect(wrong.ok).toBe(false);
    expect(parseDashboardExport("x")).toEqual({ ok: false, problems: ["The export must be a JSON object"] });
  });
});
