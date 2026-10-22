import { describe, expect, it } from "vitest";

import type { ChartPanelInput, DashboardInput } from "@/api/dashboards";

import { diffVersions, isEmptyDiff } from "./versionDiff";

const VIZ = { version: 2 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null, links: [], baseline: null };
const chart = (id: string, over: Partial<ChartPanelInput> = {}): ChartPanelInput => ({ id, kind: "chart", title: id.toUpperCase(), sql: "SELECT 1", viz: VIZ, fleet: false, layout: { x: 0, y: 0, w: 12, h: 9 }, ...over });
const DOC: DashboardInput = {
  title: "Orders", description: "", timeRange: "1h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: ["ddl", "alerts"],
  panels: [chart("a"), chart("b"), { id: "t", kind: "text", title: "", markdown: "hi", layout: { x: 12, y: 0, w: 12, h: 4 } }],
};

describe("diffVersions", () => {
  it("is empty for the same document, whatever the annotation order", () => {
    expect(isEmptyDiff(diffVersions(DOC, { ...DOC, annotations: ["alerts", "ddl"] }))).toBe(true);
  });

  it("names panels restoring brings back, removes and changes", () => {
    const old: DashboardInput = {
      ...DOC,
      title: "Orders v1",
      variables: [{ kind: "text", name: "db", label: "DB", default: "shop" }],
      panels: [
        chart("a", { sql: "SELECT 2", layout: { x: 0, y: 9, w: 12, h: 9 } }),
        chart("z", { title: "" }),
        { id: "t", kind: "text", title: "", markdown: "bye", layout: { x: 12, y: 0, w: 12, h: 4 } },
      ],
    };
    expect(diffVersions(DOC, old)).toEqual({
      settings: ["title", "variables"],
      added: [{ id: "z", title: "Untitled chart" }],
      removed: [{ id: "b", title: "B" }],
      changed: [
        { id: "a", title: "A", parts: ["query", "position"] },
        { id: "t", title: "Untitled text", parts: ["text"] },
      ],
    });
  });

  it("reports a kind change and a chart settings change", () => {
    const old: DashboardInput = { ...DOC, panels: [chart("a", { viz: { ...VIZ, type: "area" } }), { id: "b", kind: "heading", title: "B", description: "", layout: { x: 0, y: 0, w: 12, h: 9 } }, DOC.panels[2]] };
    expect(diffVersions(DOC, old).changed).toEqual([
      { id: "a", title: "A", parts: ["chart"] },
      { id: "b", title: "B", parts: ["chart"] },
    ]);
  });
});
