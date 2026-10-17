import { describe, expect, it } from "vitest";

import type { Variable } from "@/lib/viz/spec";
import { parseView, writeView } from "./urlState";

const DB: Variable = { name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["a"] }, default: "a" };
const DASH = { timeRange: "6h" as const, connectionId: "c1", variables: [DB] };

describe("parseView", () => {
  it("uses the dashboard's settings without params", () => {
    expect(parseView(new URLSearchParams(), DASH)).toEqual({ view: { range: { kind: "relative", value: "6h" }, values: {}, connectionId: "c1" }, problems: [] });
  });

  it("reads range, absolute window, variables and connection", () => {
    expect(parseView(new URLSearchParams("range=24h&var-db=orders&connection=c2"), DASH).view).toEqual({ range: { kind: "relative", value: "24h" }, values: { db: "orders" }, connectionId: "c2" });
    expect(parseView(new URLSearchParams("from=100&to=200"), DASH).view.range).toEqual({ kind: "absolute", from: 100, to: 200 });
  });

  it("reports what it cannot use and keeps the dashboard's setting for it", () => {
    const parsed = parseView(new URLSearchParams("range=5h&var-nope=x"), DASH);
    expect(parsed.view.range).toEqual({ kind: "relative", value: "6h" });
    expect(parsed.view.values).toEqual({});
    expect(parsed.problems).toHaveLength(2);
    expect(parseView(new URLSearchParams("from=200&to=100"), DASH).problems).toHaveLength(1);
  });
});

describe("writeView", () => {
  it("round-trips and keeps unrelated params", () => {
    const params = writeView(new URLSearchParams("edit=1&range=1h"), { range: { kind: "absolute", from: 10, to: 20 }, values: { db: "x" }, connectionId: "c2" }, "c1");
    expect(params.toString()).toBe("edit=1&from=10&to=20&var-db=x&connection=c2");
    expect(parseView(params, DASH).view).toEqual({ range: { kind: "absolute", from: 10, to: 20 }, values: { db: "x" }, connectionId: "c2" });
  });

  it("leaves the dashboard's own connection out of the link", () => {
    expect(writeView(new URLSearchParams(), { range: { kind: "relative", value: "6h" }, values: {}, connectionId: "c1" }, "c1").toString()).toBe("range=6h");
  });
});
