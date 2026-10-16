import { describe, expect, it } from "bun:test";

import { lintPanel } from "./lint";
import { dashboardInputSchema } from "./spec";
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
      const input = { ...template.dashboard, connectionId: null };

      it("is a valid dashboard document", () => {
        const parsed = dashboardInputSchema.safeParse(input);
        expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
      });

      it("passes the save checks", () => {
        expect(dashboardProblems(input)).toEqual([]);
      });

      it("is lint-clean", () => {
        for (const panel of template.dashboard.panels) {
          expect({ panel: panel.title, findings: lintPanel(panel.sql, panel.viz).map((f) => f.code) }).toEqual({ panel: panel.title, findings: [] });
        }
      });

      it("leaves CHouse's own queries out of query_log", () => {
        for (const panel of template.dashboard.panels) {
          if (panel.sql.includes("system.query_log")) expect(panel.sql).toContain("'dashboards'");
        }
      });
    });
  }
});
