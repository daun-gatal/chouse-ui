import { describe, expect, it } from "vitest";

import { safeAppPath, uiActionFor } from "./chobiUi";

describe("safeAppPath", () => {
  it("allows CHouse pages only", () => {
    expect(safeAppPath("/data/incidents")).toBe("/data/incidents");
    expect(safeAppPath("/dashboards/d1?range=1h")).toBe("/dashboards/d1?range=1h");
    for (const bad of ["/login", "/api/rbac/users", "https://evil.example/data", "//evil.example/data", "/data/../login", "javascript:alert(1)", "/data<x>", 7, null, `/data/${"a".repeat(400)}`]) {
      expect(safeAppPath(bad)).toBeNull();
    }
  });
});

describe("uiActionFor", () => {
  it("navigates for navigate and open_entity", () => {
    expect(uiActionFor({ name: "navigate", args: { path: "/fleet" } })).toEqual({ kind: "navigate", path: "/fleet" });
    expect(uiActionFor({ name: "open_entity", args: { kind: "incident", source: "observe", id: "a/b" } })).toEqual({ kind: "navigate", path: "/data/incidents/observe/a%2Fb" });
    expect(uiActionFor({ name: "open_entity", args: { kind: "dataset", database: "shop", table: "orders" } })).toEqual({ kind: "navigate", path: "/data/datasets/shop/orders" });
    expect(uiActionFor({ name: "open_entity", args: { kind: "scheduled_job", id: "j1" } })).toEqual({ kind: "navigate", path: "/data/scheduled-queries/jobs?job=j1" });
  });

  it("refuses what it cannot do safely", () => {
    expect(uiActionFor({ name: "navigate", args: { path: "https://evil.example" } })).toBeNull();
    expect(uiActionFor({ name: "open_entity", args: { kind: "incident", id: "x" } })).toBeNull();
    expect(uiActionFor({ name: "open_entity", args: { kind: "user", id: "x" } })).toBeNull();
    expect(uiActionFor({ name: "fill_form", args: { form: "users", values: { sql: "x" } } })).toBeNull();
    expect(uiActionFor({ name: "fill_form", args: { form: "sql_editor", values: { sql: "x".repeat(20_001) } } })).toBeNull();
    expect(uiActionFor({ name: "run_select_query", args: { sql: "SELECT 1" } })).toBeNull();
  });

  it("puts SQL in the editor for fill_form", () => {
    expect(uiActionFor({ name: "fill_form", args: { form: "sql_editor", values: { sql: "SELECT 1" } } })).toEqual({ kind: "fill_sql", sql: "SELECT 1" });
  });
});
