import { describe, expect, it } from "bun:test";

import fixture from "./spec.fixture.json";
import {
  dashboardInputSchema,
  layoutProblems,
  overlaps,
  readingOrder,
  sizeLimits,
  timeRangeSchema,
  variableSchema,
  variableValuesSchema,
  vizSpecSchema,
  type PanelInput,
} from "./spec";

const LINE = { version: 2, type: "line", x: "t", y: ["v"], series: null, unit: "ms", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null };
const STAT = { ...LINE, type: "stat", x: null, unit: "count", reduce: "last" };

function chart(layout: Record<string, number>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: null, kind: "chart", title: "Rows", sql: "SELECT 1 AS t, 2 AS v", viz: LINE, fleet: false, layout, ...overrides };
}

function dashboard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Orders",
    description: "",
    timeRange: "6h",
    refreshSeconds: 60,
    connectionScope: { kind: "any" },
    variables: [],
    annotations: ["ddl", "alerts"],
    panels: [chart({ x: 0, y: 0, w: 12, h: 9 })],
    ...overrides,
  };
}

function issues(value: unknown): string[] {
  const parsed = dashboardInputSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
}

describe("vizSpecSchema (shared fixture)", () => {
  for (const { name, spec } of fixture.valid) {
    it(`accepts ${name}`, () => {
      const result = vizSpecSchema.safeParse(spec);
      expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([]);
    });
  }
  for (const { name, spec } of fixture.invalid) {
    it(`rejects ${name}`, () => {
      expect(vizSpecSchema.safeParse(spec).success).toBe(false);
    });
  }
});

describe("variableSchema", () => {
  it("accepts a string variable with static options", () => {
    expect(variableSchema.safeParse({ name: "user", label: "User", kind: "string", options: { source: "static", values: ["a", "b"] }, default: "a" }).success).toBe(true);
  });

  it("accepts an identifier variable fed by a query", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "identifier", options: { source: "query", sql: "SELECT name FROM system.databases" }, default: "default" }).success).toBe(true);
  });

  it("rejects an identifier default that is not an identifier", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["default"] }, default: "a b" }).success).toBe(false);
  });

  it("rejects identifier options that are not identifiers", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["ok", "drop table x"] }, default: "ok" }).success).toBe(false);
  });

  it("rejects an unknown kind and a bad name", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "connection", options: { source: "static", values: ["a"] }, default: "a" }).success).toBe(false);
    expect(variableSchema.safeParse({ name: "Db", label: "Database", kind: "string", options: { source: "static", values: ["a"] }, default: "a" }).success).toBe(false);
  });

  it("takes a multi-value variable with a list of 1 to 100 distinct defaults", () => {
    const multi = (d: unknown): boolean => variableSchema.safeParse({ name: "tables", label: "Tables", kind: "multi", options: { source: "static", values: ["a", "b"] }, default: d }).success;
    expect(multi(["a", "b"])).toBe(true);
    expect(multi([])).toBe(false);
    expect(multi("a")).toBe(false);
    expect(multi(["a", "a"])).toBe(false);
    expect(multi(Array.from({ length: 101 }, (_, i) => `v${i}`))).toBe(false);
  });

  it("keeps single-value kinds single", () => {
    expect(variableSchema.safeParse({ name: "user", label: "User", kind: "string", options: { source: "static", values: ["a"] }, default: ["a"] }).success).toBe(false);
  });
});

describe("variableValuesSchema", () => {
  it("takes strings and lists of strings, nothing else", () => {
    expect(variableValuesSchema.safeParse({ user: "a", tables: ["x", "y"] }).success).toBe(true);
    expect(variableValuesSchema.safeParse({ user: 1 }).success).toBe(false);
    expect(variableValuesSchema.safeParse({ tables: Array.from({ length: 1001 }, () => "x") }).success).toBe(false);
  });
});

describe("timeRangeSchema", () => {
  it("accepts relative and absolute ranges", () => {
    expect(timeRangeSchema.safeParse({ kind: "relative", value: "24h" }).success).toBe(true);
    expect(timeRangeSchema.safeParse({ kind: "absolute", from: 1_700_000_000, to: 1_700_003_600 }).success).toBe(true);
  });

  it("rejects a backwards, an unknown and an over-long range", () => {
    expect(timeRangeSchema.safeParse({ kind: "absolute", from: 10, to: 5 }).success).toBe(false);
    expect(timeRangeSchema.safeParse({ kind: "relative", value: "5h" }).success).toBe(false);
    expect(timeRangeSchema.safeParse({ kind: "absolute", from: 1, to: 1 + 401 * 86_400 }).success).toBe(false);
  });
});

describe("the canvas", () => {
  it("knows when two places share a cell", () => {
    expect(overlaps({ x: 0, y: 0, w: 12, h: 9 }, { x: 12, y: 0, w: 12, h: 9 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 12, h: 9 }, { x: 0, y: 9, w: 12, h: 9 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 12, h: 9 }, { x: 11, y: 8, w: 2, h: 2 })).toBe(true);
    expect(overlaps({ x: 4, y: 4, w: 2, h: 2 }, { x: 0, y: 0, w: 24, h: 24 })).toBe(true);
  });

  it("sizes headings, text, stats, tables and charts differently", () => {
    expect(sizeLimits("heading", null)).toEqual({ minW: 4, minH: 1, maxH: 3 });
    expect(sizeLimits("text", null)).toEqual({ minW: 3, minH: 2, maxH: 40 });
    expect(sizeLimits("chart", "stat")).toEqual({ minW: 3, minH: 3, maxH: 40 });
    expect(sizeLimits("chart", "table")).toEqual({ minW: 6, minH: 5, maxH: 40 });
    expect(sizeLimits("chart", "line")).toEqual({ minW: 4, minH: 5, maxH: 40 });
  });

  it("names both panels that overlap, and a panel under its minimum", () => {
    const a = chart({ x: 0, y: 0, w: 12, h: 9 }, { title: "A" }) as unknown as PanelInput;
    const b = chart({ x: 6, y: 4, w: 12, h: 9 }, { title: "B" }) as unknown as PanelInput;
    const tiny = chart({ x: 0, y: 20, w: 3, h: 4 }, { title: "Tiny" }) as unknown as PanelInput;
    expect(layoutProblems([a, b, tiny])).toEqual([
      "Panel 3 (Tiny) is 3 × 4; it must be at least 4 × 5",
      "Panel 1 (A) and Panel 2 (B) overlap",
    ]);
  });

  it("orders panels top to bottom, then left to right", () => {
    const at = (x: number, y: number): { layout: { x: number; y: number; w: number; h: number }; name: string } => ({ layout: { x, y, w: 4, h: 4 }, name: `${x},${y}` });
    expect(readingOrder([at(12, 4), at(0, 4), at(6, 0)]).map((p) => p.name)).toEqual(["6,0", "0,4", "12,4"]);
  });
});

describe("dashboardInputSchema", () => {
  it("accepts a dashboard with a chart, a text panel and a heading", () => {
    expect(issues(dashboard({
      panels: [
        { id: null, kind: "heading", title: "Ingestion", description: "Rows arriving", layout: { x: 0, y: 0, w: 24, h: 2 } },
        chart({ x: 0, y: 2, w: 16, h: 9 }),
        { id: null, kind: "text", title: "", markdown: "**Runbook**: page #oncall", layout: { x: 16, y: 2, w: 8, h: 9 } },
      ],
    }))).toEqual([]);
  });

  it("rejects duplicate variable names and duplicate panel ids", () => {
    const v = { name: "db", label: "DB", kind: "identifier", options: { source: "static", values: ["a"] }, default: "a" };
    expect(dashboardInputSchema.safeParse(dashboard({ variables: [v, v] })).success).toBe(false);
    const id = "4b2c8a7e-3b8f-4a5e-9c1d-0e6f7a8b9c0d";
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [chart({ x: 0, y: 0, w: 12, h: 9 }, { id }), chart({ x: 12, y: 0, w: 12, h: 9 }, { id })] })).success).toBe(false);
  });

  it("rejects a format 1 size, an unknown refresh, range, field or kind", () => {
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [chart({ x: 0, y: 0, w: 12, h: 9 }, { width: 6 })] })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ refreshSeconds: 10 })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ timeRange: "90m" })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ theme: "dark" })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [{ id: null, kind: "image", title: "x", layout: { x: 0, y: 0, w: 6, h: 6 } }] })).success).toBe(false);
  });

  it("refuses places off the canvas, overlapping panels and panels under their minimum", () => {
    expect(issues(dashboard({ panels: [chart({ x: 20, y: 0, w: 8, h: 9 })] }))).toContain("a panel must end within the 24 columns (x + w ≤ 24)");
    expect(issues(dashboard({ panels: [chart({ x: 0, y: 0, w: 12, h: 9 }), chart({ x: 6, y: 0, w: 12, h: 9 })] }))).toContain("Panel 1 (Rows) and Panel 2 (Rows) overlap");
    expect(issues(dashboard({ panels: [chart({ x: 0, y: 0, w: 2, h: 9 }, { viz: STAT })] }))).toContain("Panel 1 (Rows) is 2 × 9; it must be at least 3 × 3");
    expect(issues(dashboard({ panels: [{ id: null, kind: "heading", title: "Big", description: "", layout: { x: 0, y: 0, w: 24, h: 4 } }] }))).toContain("Panel 1 (Big) is 4 rows tall; it can be at most 3");
    expect(issues(dashboard({ panels: [chart({ x: -1, y: 0, w: 12, h: 9 })] })).length).toBeGreaterThan(0);
    expect(issues(dashboard({ panels: [chart({ x: 0, y: 0, w: 12.5, h: 9 })] })).length).toBeGreaterThan(0);
  });

  it("allows gaps between panels", () => {
    expect(issues(dashboard({ panels: [chart({ x: 0, y: 0, w: 8, h: 9 }), chart({ x: 16, y: 30, w: 8, h: 9 })] }))).toEqual([]);
  });

  it("caps chart panels at 40 and panels at 60", () => {
    const charts = Array.from({ length: 41 }, (_, i) => chart({ x: (i % 4) * 6, y: Math.floor(i / 4) * 5, w: 6, h: 5 }, { viz: STAT }));
    expect(issues(dashboard({ panels: charts }))).toContain("a dashboard can have at most 40 chart panels");
    const texts = Array.from({ length: 61 }, (_, i) => ({ id: null, kind: "text", title: "", markdown: "x", layout: { x: (i % 8) * 3, y: Math.floor(i / 8) * 2, w: 3, h: 2 } }));
    expect(dashboardInputSchema.safeParse(dashboard({ panels: texts })).success).toBe(false);
  });

  it("refuses a text panel without Markdown and a heading without a title", () => {
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [{ id: null, kind: "text", title: "", markdown: "  ", layout: { x: 0, y: 0, w: 6, h: 4 } }] })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [{ id: null, kind: "heading", title: "", description: "", layout: { x: 0, y: 0, w: 24, h: 2 } }] })).success).toBe(false);
  });

  it("refuses a filter link to a variable the dashboard does not have", () => {
    const linked = { ...LINE, links: [{ kind: "filter", label: "Only this", variable: "user", column: "t" }] };
    expect(issues(dashboard({ panels: [chart({ x: 0, y: 0, w: 12, h: 9 }, { viz: linked })] }))).toContain('Panel 1 (Rows): the link "Only this" sets user, which is not a variable of this dashboard');
    const user = { name: "user", label: "User", kind: "string", options: { source: "static", values: ["a"] }, default: "a" };
    expect(issues(dashboard({ variables: [user], panels: [chart({ x: 0, y: 0, w: 12, h: 9 }, { viz: linked })] }))).toEqual([]);
  });

  it("states its annotation sources: known ones, each once", () => {
    expect(issues(dashboard({ annotations: [] }))).toEqual([]);
    expect(dashboardInputSchema.safeParse(dashboard({ annotations: ["ddl", "ddl"] })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ annotations: ["tweets"] })).success).toBe(false);
    const { annotations: _omitted, ...without } = dashboard();
    expect(dashboardInputSchema.safeParse(without).success).toBe(false);
  });

  it("takes all connections or a non-empty list of distinct ones, nothing else", () => {
    const ok = (connectionScope: unknown): boolean => dashboardInputSchema.safeParse(dashboard({ connectionScope })).success;
    expect(ok({ kind: "any" })).toBe(true);
    expect(ok({ kind: "only", connectionIds: ["c1", "c2"] })).toBe(true);
    expect(ok({ kind: "only", connectionIds: [] })).toBe(false);
    expect(ok({ kind: "only", connectionIds: ["c1", "c1"] })).toBe(false);
    expect(ok({ kind: "any", connectionIds: ["c1"] })).toBe(false);
    expect(ok({ kind: "some" })).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});
