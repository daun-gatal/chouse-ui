import { describe, expect, it } from "vitest";

import type { Variable } from "@/lib/viz/spec";

import { bucketQueriesSql, linkAction } from "./links";

const RANGE = { kind: "relative" as const, value: "6h" as const };
const TABLE: Variable = { name: "table", label: "Table", kind: "identifier", options: { source: "static", values: ["orders"] }, default: "orders" };
const USERS: Variable = { name: "users", label: "Users", kind: "multi", options: { source: "static", values: ["a"] }, default: ["a"] };
const DASH = "6f1c2a8e-3b7d-4c55-9a1e-2f0b9d4c7e11";

describe("linkAction", () => {
  it("opens a dashboard with the current range and values from the datum or fixed", () => {
    const action = linkAction({ kind: "dashboard", label: "Detail", dashboardId: DASH, values: { table: { from: "column", column: "name" }, db: { from: "value", value: "shop" } } }, { name: "orders" }, RANGE, []);
    expect(action).toEqual({ kind: "navigate", to: `/dashboards/${DASH}?range=6h&var-table=orders&var-db=shop` });
    const absolute = linkAction({ kind: "dashboard", label: "D", dashboardId: DASH, values: {} }, {}, { kind: "absolute", from: 10, to: 20 }, []);
    expect(absolute).toEqual({ kind: "navigate", to: `/dashboards/${DASH}?from=10&to=20` });
  });

  it("refuses a link whose value the datum does not have, instead of following it without", () => {
    expect(linkAction({ kind: "dashboard", label: "D", dashboardId: DASH, values: { t: { from: "column", column: "user" } } }, { t: "x" }, RANGE, []).kind).toBe("error");
    expect(linkAction({ kind: "dashboard", label: "D", dashboardId: DASH, values: { t: { from: "column", column: "user" } } }, { user: null }, RANGE, [])).toEqual({ kind: "error", message: "user is empty here" });
  });

  it("filters this dashboard, as a list for a multi-value variable, and checks identifiers", () => {
    expect(linkAction({ kind: "filter", label: "Only", variable: "users", column: "u" }, { u: "bob" }, RANGE, [USERS])).toEqual({ kind: "filter", variable: "users", value: ["bob"] });
    expect(linkAction({ kind: "filter", label: "Only", variable: "table", column: "t" }, { t: "orders" }, RANGE, [TABLE])).toEqual({ kind: "filter", variable: "table", value: "orders" });
    expect(linkAction({ kind: "filter", label: "Only", variable: "table", column: "t" }, { t: "x; DROP" }, RANGE, [TABLE]).kind).toBe("error");
    expect(linkAction({ kind: "filter", label: "Only", variable: "gone", column: "t" }, { t: "x" }, RANGE, [TABLE])).toEqual({ kind: "error", message: "This dashboard has no variable gone" });
  });

  it("opens a table in Explorer", () => {
    expect(linkAction({ kind: "explorer", label: "E", database: { from: "value", value: "shop" }, table: { from: "column", column: "t" } }, { t: "orders" }, RANGE, []))
      .toEqual({ kind: "navigate", to: "/explorer?database=shop&table=orders" });
  });
});

describe("bucketQueriesSql", () => {
  it("bounds query_log to the bucket in unix seconds", () => {
    const sql = bucketQueriesSql(1_800_000_000_500, 1_800_000_060_000);
    expect(sql).toContain("event_time >= toDateTime(1800000000) AND event_time < toDateTime(1800000060)");
    expect(sql).toContain("LIMIT 100");
  });
});
