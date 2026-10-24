import { describe, expect, it } from "bun:test";

import { dashboardInputSchema } from "../../../dashboards/spec";
import { chartPanel } from "./dashboards";
import { given, idOf } from "./shared";

describe("toolkit helpers", () => {
  it("find the id of what a route created, bare or wrapped", () => {
    expect(idOf({ id: "a" })).toBe("a");
    expect(idOf({ promise: { id: "p" }, initialRun: { id: "r" } })).toBe("p");
    expect(idOf({ dashboard: { id: "d" } })).toBe("d");
    expect(idOf({ nothing: true })).toBeNull();
    expect(idOf(null)).toBeNull();
  });

  it("keep only the fields the model sent", () => {
    expect(given({ a: 1, b: undefined, c: null }, ["a", "b", "c", "d"])).toEqual({ a: 1, c: null });
  });

  it("place a new chart panel below every other one, in a document the dashboard schema accepts", () => {
    const existing = [{ id: null, kind: "heading", title: "Top", description: "", layout: { x: 0, y: 0, w: 24, h: 2 } }];
    const panel = chartPanel({ title: "Rows", sql: "SELECT 1 AS n", chart: "stat", y: ["n"] }, existing);
    expect(panel.layout).toEqual({ x: 0, y: 2, w: 12, h: 4 });
    const table = chartPanel({ title: "All", sql: "SELECT 1", chart: "table" }, [...existing, panel]);
    expect(table.layout).toEqual({ x: 0, y: 6, w: 24, h: 8 });
    const parsed = dashboardInputSchema.safeParse({
      title: "t", description: "", timeRange: "24h", refreshSeconds: 0, connectionScope: { kind: "any" }, variables: [], annotations: [], panels: [...existing, panel, table],
    });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  });
});
