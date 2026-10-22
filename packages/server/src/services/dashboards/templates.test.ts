import { describe, expect, it } from "bun:test";

import { lintPanel } from "./lint";
import { dashboardInputSchema, GRID_COLUMNS, type ChartPanelInput } from "./spec";
import { findTemplate, TEMPLATES } from "./templates";
import { dashboardProblems } from "./validate";

describe("dashboard templates", () => {
  it("have unique ids, and the built-in views each open one", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TEMPLATES.filter((t) => t.openFrom === "performance").map((t) => t.id)).toEqual(["query-latency"]);
    expect(TEMPLATES.filter((t) => t.openFrom === "capacity").map((t) => t.id)).toEqual(["disk-and-tables"]);
    expect(findTemplate("replication")?.title).toBe("Replication");
    expect(findTemplate("nope")).toBeUndefined();
  });

  for (const template of TEMPLATES) {
    describe(template.id, () => {
      const input = { ...template.dashboard, connectionScope: { kind: "any" as const } };
      const charts = template.dashboard.panels.filter((p): p is ChartPanelInput => p.kind === "chart");

      it("is a valid dashboard document", () => {
        const parsed = dashboardInputSchema.safeParse(input);
        expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
      });

      it("passes the save checks", () => {
        expect(dashboardProblems(input)).toEqual([]);
      });

      it("is lint-clean", () => {
        for (const panel of charts) {
          expect({ panel: panel.title, findings: lintPanel(panel.sql, panel.viz).map((f) => f.code) }).toEqual({ panel: panel.title, findings: [] });
        }
      });

      it("leaves CHouse's own queries out of query_log", () => {
        for (const panel of charts) {
          if (panel.sql.includes("system.query_log")) expect(panel.sql).toContain("'dashboards'");
        }
      });

      it("is laid out by the engine: KPIs first, nothing past the right edge, rows filled", () => {
        const first = template.dashboard.panels[0];
        // A template starts with its KPIs or its primary trend, never with a table.
        expect(first.kind === "chart" && first.viz.type !== "table").toBe(true);
        for (const panel of template.dashboard.panels) expect(panel.layout.x + panel.layout.w).toBeLessThanOrEqual(GRID_COLUMNS);
        const rows = new Map<number, number>();
        for (const panel of template.dashboard.panels) rows.set(panel.layout.y, (rows.get(panel.layout.y) ?? 0) + panel.layout.w);
        for (const [y, width] of rows) expect({ y, width }).toEqual({ y, width: GRID_COLUMNS });
      });
    });
  }
});
