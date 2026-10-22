import { describe, expect, it } from "bun:test";

import fixture from "./draftLayout.fixture.json";
import { appendBelow, arrange, kpiWidths, roleOf, roleProblem, roleSize, ROLE_CHARTS, ROLES, tidy, type ArrangeItem, type Importance, type Role } from "./layout";
import { CHART_TYPES, GRID_COLUMNS, overlaps, sizeLimits, type ChartType, type Layout } from "./spec";

function item(ref: string, role: Role, importance: Importance = "secondary"): ArrangeItem<string> {
  return { ref, kind: "chart", role, importance, size: null };
}

function byRef<T>(placed: Array<{ ref: T; layout: Layout }>): Map<T, Layout> {
  return new Map(placed.map((p) => [p.ref, p.layout]));
}

describe("roles", () => {
  it("give every chart type a role, and that role allows it", () => {
    for (const type of CHART_TYPES) expect({ type, problem: roleProblem(roleOf(type), type) }).toEqual({ type, problem: null });
  });

  it("refuse a chart its role does not allow, saying which it allows", () => {
    expect(roleProblem("kpi", "line")).toBe("a kpi panel is drawn as stat, not line");
    expect(roleProblem("detail", "pie")).toBe("a detail panel is drawn as table, not pie");
    expect(roleProblem("trend", "bar")).toBeNull();
  });

  it("read a chart's role from its type", () => {
    expect(roleOf("stat")).toBe("kpi");
    expect(roleOf("area")).toBe("trend");
    expect(roleOf("heatmap")).toBe("distribution");
    expect(roleOf("horizontal_bar")).toBe("ranking");
    expect(roleOf("table")).toBe("detail");
    expect(roleOf("donut")).toBe("breakdown");
  });
});

describe("kpiWidths", () => {
  it("fills the row with equal widths, the remainder going first", () => {
    expect(kpiWidths(1)).toEqual([24]);
    expect(kpiWidths(4)).toEqual([6, 6, 6, 6]);
    expect(kpiWidths(5)).toEqual([5, 5, 5, 5, 4]);
    expect(kpiWidths(6)).toEqual([4, 4, 4, 4, 4, 4]);
    for (let n = 1; n <= 6; n++) expect(kpiWidths(n).reduce((a, b) => a + b, 0)).toBe(GRID_COLUMNS);
  });
});

describe("arrange", () => {
  it("puts KPIs in a row on top, the primary trend full width, pairs in the middle and tables last", () => {
    const placed = byRef(arrange([{ heading: null, items: [item("table", "detail"), item("bar", "breakdown"), item("trend", "trend", "primary"), item("k1", "kpi"), item("k2", "kpi"), item("rank", "ranking")] }]));
    expect(placed.get("k1")).toEqual({ x: 0, y: 0, w: 12, h: 4 });
    expect(placed.get("k2")).toEqual({ x: 12, y: 0, w: 12, h: 4 });
    expect(placed.get("trend")).toEqual({ x: 0, y: 4, w: 24, h: 9 });
    expect(placed.get("bar")).toEqual({ x: 0, y: 13, w: 12, h: 9 });
    expect(placed.get("rank")).toEqual({ x: 12, y: 13, w: 12, h: 9 });
    expect(placed.get("table")).toEqual({ x: 0, y: 22, w: 24, h: 10 });
  });

  it("gives an odd chart out the whole row", () => {
    const placed = byRef(arrange([{ heading: null, items: [item("a", "breakdown"), item("b", "breakdown"), item("c", "breakdown")] }]));
    expect(placed.get("c")).toEqual({ x: 0, y: 9, w: 24, h: 9 });
  });

  it("wraps more than six KPIs to a new row", () => {
    const kpis = Array.from({ length: 7 }, (_, i) => item(`k${i}`, "kpi"));
    const placed = byRef(arrange([{ heading: null, items: kpis }]));
    expect(placed.get("k5")).toEqual({ x: 20, y: 0, w: 4, h: 4 });
    expect(placed.get("k6")).toEqual({ x: 0, y: 4, w: 24, h: 4 });
  });

  it("puts secondary trends after breakdowns, and keeps a text panel's size", () => {
    const text: ArrangeItem<string> = { ref: "note", kind: "text", role: null, importance: "secondary", size: { w: 8, h: 6 } };
    const placed = byRef(arrange([{ heading: null, items: [item("t2", "trend"), text, item("b", "breakdown")] }]));
    expect(placed.get("note")).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect(placed.get("b")).toEqual({ x: 8, y: 0, w: 12, h: 9 });
    expect(placed.get("t2")).toEqual({ x: 0, y: 9, w: 24, h: 9 });
  });

  it("starts each section with its heading, in the order given", () => {
    const placed = arrange([
      { heading: "Top", items: [item("k", "kpi")] },
      { heading: "Detail", items: [item("t", "detail")] },
    ]);
    expect(placed).toEqual([
      { ref: "Top", layout: { x: 0, y: 0, w: 24, h: 2 } },
      { ref: "k", layout: { x: 0, y: 2, w: 24, h: 4 } },
      { ref: "Detail", layout: { x: 0, y: 6, w: 24, h: 2 } },
      { ref: "t", layout: { x: 0, y: 8, w: 24, h: 10 } },
    ]);
  });

  it("is deterministic", () => {
    const sections = [{ heading: null, items: [item("a", "trend", "primary"), item("b", "breakdown"), item("c", "kpi")] }];
    expect(arrange(sections)).toEqual(arrange(sections));
  });
});

describe("tidy", () => {
  it("starts sections at headings and makes each section's first trend its primary one", () => {
    const placed = byRef(tidy([
      { ref: "s1", kind: "chart", chartType: "stat", size: { w: 3, h: 3 } },
      { ref: "l1", kind: "chart", chartType: "line", size: { w: 6, h: 9 } },
      { ref: "l2", kind: "chart", chartType: "line", size: { w: 6, h: 9 } },
      { ref: "h", kind: "heading", chartType: null, size: { w: 24, h: 2 } },
      { ref: "l3", kind: "chart", chartType: "area", size: { w: 6, h: 9 } },
      { ref: "note", kind: "text", chartType: null, size: { w: 6, h: 4 } },
    ]));
    expect(placed.get("s1")).toEqual({ x: 0, y: 0, w: 24, h: 4 });
    expect(placed.get("l1")).toEqual({ x: 0, y: 4, w: 24, h: 9 });
    expect(placed.get("l2")).toEqual({ x: 0, y: 13, w: 24, h: 9 });
    expect(placed.get("h")).toEqual({ x: 0, y: 22, w: 24, h: 2 });
    expect(placed.get("l3")).toEqual({ x: 0, y: 24, w: 24, h: 9 });
    expect(placed.get("note")).toEqual({ x: 0, y: 33, w: 6, h: 4 });
  });

  it("places every panel it is given, once", () => {
    const panels = CHART_TYPES.map((type, i) => ({ ref: `p${i}`, kind: "chart" as const, chartType: type, size: { w: 6, h: 6 } }));
    const placed = tidy(panels);
    expect(placed.map((p) => p.ref).sort()).toEqual(panels.map((p) => p.ref).sort());
  });
});

describe("appendBelow and roleSize", () => {
  it("puts a new panel under everything", () => {
    expect(appendBelow([{ x: 0, y: 0, w: 12, h: 9 }, { x: 12, y: 3, w: 12, h: 12 }], { w: 12, h: 9 })).toEqual({ x: 0, y: 15, w: 12, h: 9 });
    expect(appendBelow([], { w: 30, h: 9 })).toEqual({ x: 0, y: 0, w: 24, h: 9 });
  });

  it("sizes a single panel by its role, within the minimums", () => {
    for (const role of ROLES) {
      const size = roleSize(role);
      for (const type of ROLE_CHARTS[role]) {
        const limits = sizeLimits("chart", type);
        expect({ role, type, fits: size.w >= limits.minW && size.h >= limits.minH }).toEqual({ role, type, fits: true });
      }
    }
  });
});

describe("AI-draft layout eval (draftLayout.fixture.json)", () => {
  for (const { goal, panels } of fixture.goals) {
    it(goal, () => {
      const sections = new Map<string | null, Array<ArrangeItem<number>>>();
      panels.forEach((p, i) => {
        const role = p.role as Role;
        expect(roleProblem(role, p.chart as ChartType)).toBeNull();
        const list = sections.get(p.section) ?? [];
        list.push({ ref: i, kind: "chart", role, importance: p.importance as Importance, size: null });
        sections.set(p.section, list);
      });
      const placed = arrange([...sections.entries()].map(([section, items]) => ({ heading: section === null ? null : -1 - [...sections.keys()].indexOf(section), items })));
      const charts = placed.filter((p) => p.ref >= 0);
      expect(charts.length).toBe(panels.length);
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i].layout, placed[j].layout)).toBe(false);
      }
      for (const { ref, layout } of charts) {
        const limits = sizeLimits("chart", panels[ref].chart as ChartType);
        expect(layout.w).toBeGreaterThanOrEqual(limits.minW);
        expect(layout.h).toBeGreaterThanOrEqual(limits.minH);
        expect(layout.x + layout.w).toBeLessThanOrEqual(GRID_COLUMNS);
      }
      // Within each section, every KPI sits above every other chart.
      for (const items of sections.values()) {
        const of = (role: Role): Layout[] => items.filter((it) => it.role === role).map((it) => charts.find((c) => c.ref === it.ref)?.layout as Layout);
        const kpiBottom = Math.max(-1, ...of("kpi").map((l) => l.y + l.h));
        const others = items.filter((it) => it.role !== "kpi").map((it) => charts.find((c) => c.ref === it.ref)?.layout as Layout);
        for (const l of others) expect(l.y).toBeGreaterThanOrEqual(kpiBottom);
        const detailTop = Math.min(Infinity, ...of("detail").map((l) => l.y));
        for (const l of items.filter((it) => it.role !== "detail").map((it) => charts.find((c) => c.ref === it.ref)?.layout as Layout)) expect(l.y + l.h).toBeLessThanOrEqual(detailTop);
      }
    });
  }
});
