import { describe, expect, it } from "vitest";

import type { Variable } from "@/lib/viz/spec";
import { parseView, writeView } from "./urlState";

const DB: Variable = { name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["a"] }, default: "a" };
const TABLES: Variable = { name: "tables", label: "Tables", kind: "multi", options: { source: "static", values: ["x", "y"] }, default: ["x"] };
const DASH = { timeRange: "6h" as const, variables: [DB, TABLES] };
const BASE = { compare: null, hidden: [] };

describe("parseView", () => {
  it("uses the dashboard's settings without params", () => {
    expect(parseView(new URLSearchParams(), DASH)).toEqual({ view: { range: { kind: "relative", value: "6h" }, values: {}, ...BASE }, problems: [] });
  });

  it("reads range, absolute window, variables, lists, compare and hidden sources", () => {
    expect(parseView(new URLSearchParams("range=24h&var-db=orders&var-tables=x&var-tables=y&cmp=7d&ann-off=ddl,notes"), DASH).view).toEqual({
      range: { kind: "relative", value: "24h" },
      values: { db: "orders", tables: ["x", "y"] },
      compare: "7d",
      hidden: ["ddl", "notes"],
    });
    expect(parseView(new URLSearchParams("from=100&to=200"), DASH).view.range).toEqual({ kind: "absolute", from: 100, to: 200 });
  });

  it("reports what it cannot use and keeps the dashboard's setting for it", () => {
    const parsed = parseView(new URLSearchParams("range=5h&var-nope=x&cmp=2d&ann-off=tweets&var-db=a&var-db=b"), DASH);
    expect(parsed.view).toEqual({ range: { kind: "relative", value: "6h" }, values: { db: "a" }, ...BASE });
    expect(parsed.problems).toEqual([
      'The link\'s time range "5h" is not one of 15m, 1h, 3h, 6h, 12h, 24h, 2d, 7d, 30d',
      "The link sets nope, which is not a variable of this dashboard",
      "The link sets Database more than once; it takes one value",
      'The link\'s compare "2d" is not one of 1d, 7d',
      'The link hides "tweets", which is not an annotation source',
    ]);
    expect(parseView(new URLSearchParams("from=200&to=100"), DASH).problems).toHaveLength(1);
  });
});

describe("writeView", () => {
  it("round-trips and keeps unrelated params", () => {
    const view = { range: { kind: "absolute" as const, from: 10, to: 20 }, values: { db: "x", tables: ["a", "b,c"] }, compare: "1d" as const, hidden: ["fixes" as const] };
    const params = writeView(new URLSearchParams("edit=1&range=1h&cmp=7d"), view);
    expect(params.toString()).toBe("edit=1&from=10&to=20&var-db=x&var-tables=a&var-tables=b%2Cc&cmp=1d&ann-off=fixes");
    expect(parseView(params, DASH).view).toEqual(view);
  });
});
