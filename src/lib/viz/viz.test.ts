import { describe, expect, it } from "vitest";

import { isNumericType, suggestSpec, unitFromName } from "./autodetect";
import { crossedThreshold, MAX_SERIES, mergeFleet, pivot, resolveChart, resolveStat } from "./resolve";
import { vizSpecProblems, type VizSpec } from "./spec";
import { formatValue, toNumber } from "./units";

function spec(overrides: Partial<VizSpec> = {}): VizSpec {
  return { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, ...overrides };
}

const TIME_COLS = [{ name: "t", type: "DateTime" }, { name: "v", type: "UInt64" }];

describe("formatValue", () => {
  it("formats each unit", () => {
    expect(formatValue(1_500, "count")).toBe("1.5K");
    expect(formatValue(2_500_000, "rows")).toBe("2.5M");
    expect(formatValue(12, "per_s")).toBe("12/s");
    expect(formatValue(42.123, "percent")).toBe("42.1%");
    expect(formatValue(1536, "bytes")).toBe("1.5 KiB");
    expect(formatValue(3 * 1024 ** 4, "bytes")).toBe("3 TiB");
    expect(formatValue(800, "ms")).toBe("800 ms");
    expect(formatValue(2500, "ms")).toBe("2.5 s");
    expect(formatValue(90, "s")).toBe("1.5 min");
    expect(formatValue(500, "us")).toBe("500 µs");
    expect(formatValue(7200, "s", 0)).toBe("2 h");
  });

  it("shows non-numbers as they are and null as a dash", () => {
    expect(formatValue("abc", "count")).toBe("abc");
    expect(formatValue(null, "count")).toBe("—");
    expect(toNumber("12")).toBe(12);
    expect(toNumber("")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

describe("suggestSpec", () => {
  it("suggests a valid spec for every shape", () => {
    const cases = [
      { cols: TIME_COLS, rows: 50, type: "line" },
      { cols: [...TIME_COLS, { name: "user", type: "String" }], rows: 50, type: "line" },
      { cols: [{ name: "lag", type: "Int64" }], rows: 1, type: "stat" },
      { cols: [{ name: "db", type: "LowCardinality(String)" }, { name: "bytes", type: "UInt64" }], rows: 3, type: "bar" },
      { cols: [{ name: "db", type: "String" }, { name: "bytes", type: "UInt64" }], rows: 30, type: "horizontal_bar" },
      { cols: [{ name: "name", type: "String" }, { name: "msg", type: "String" }], rows: 30, type: "table" },
    ];
    for (const c of cases) {
      const suggested = suggestSpec(c.cols, c.rows);
      expect({ type: suggested.type, problems: vizSpecProblems(suggested) }).toEqual({ type: c.type, problems: [] });
    }
  });

  it("splits one measure by a text column and guesses units from names", () => {
    expect(suggestSpec([...TIME_COLS, { name: "user", type: "String" }], 10).series).toBe("user");
    expect(unitFromName("query_duration_ms")).toBe("ms");
    expect(unitFromName("read_bytes")).toBe("bytes");
    expect(unitFromName("absolute_delay")).toBe("s");
    expect(unitFromName("rows_per_s")).toBe("per_s");
    expect(unitFromName("failures")).toBe("count");
    expect(isNumericType("Nullable(Float64)")).toBe(true);
    expect(isNumericType("String")).toBe(false);
  });
});

describe("resolveChart", () => {
  it("coerces measures to numbers and keeps nulls as gaps", () => {
    const result = resolveChart(spec(), { columns: TIME_COLS, rows: [{ t: "a", v: "3" }, { t: "b", v: null }] });
    expect(result).toEqual({ ok: true, value: { rows: [{ t: "a", v: 3 }, { t: "b", v: null }], columns: TIME_COLS, x: "t", y: ["v"] } });
  });

  it("names missing columns and refuses non-numeric measures", () => {
    expect(resolveChart(spec({ y: ["nope"] }), { columns: TIME_COLS, rows: [{ t: "a", v: 1 }] })).toEqual({ ok: false, error: "The result has no column nope. Columns: t, v" });
    const text = resolveChart(spec(), { columns: TIME_COLS, rows: [{ t: "a", v: "high" }] });
    expect(text.ok).toBe(false);
    expect(resolveChart(spec(), { columns: TIME_COLS, rows: [] })).toEqual({ ok: false, error: "The query returned no rows" });
  });

  it("splits by series into one column per value", () => {
    const rows = [{ t: "a", user: "x", v: 1 }, { t: "a", user: "y", v: 2 }, { t: "b", user: "x", v: 3 }];
    const result = resolveChart(spec({ series: "user" }), { columns: [...TIME_COLS, { name: "user", type: "String" }], rows });
    expect(result.ok && result.value.y).toEqual(["x", "y"]);
    expect(result.ok && result.value.rows).toEqual([{ t: "a", x: 1, y: 2 }, { t: "b", x: 3 }]);
  });
});

describe("pivot", () => {
  it("refuses too many series, duplicate cells and a series named like x", () => {
    const many = Array.from({ length: MAX_SERIES + 1 }, (_, i) => ({ t: "a", s: `s${i}`, v: i }));
    expect(pivot(many, "t", "s", "v").ok).toBe(false);
    expect(pivot([{ t: "a", s: "x", v: 1 }, { t: "a", s: "x", v: 2 }], "t", "s", "v")).toEqual({ ok: false, error: "s = x has more than one row at t = a; aggregate by t and s" });
    expect(pivot([{ t: "a", s: "t", v: 1 }], "t", "s", "v").ok).toBe(false);
  });
});

describe("stats and fleet", () => {
  it("reduces a stat and finds the highest crossed threshold", () => {
    const stat = spec({ type: "stat", x: null, reduce: "max", thresholds: [{ value: 10, severity: "warning" }, { value: 20, severity: "critical" }] });
    expect(resolveStat(stat, { columns: TIME_COLS, rows: [{ v: 4 }, { v: 15 }] })).toEqual({ ok: true, value: 15 });
    expect(crossedThreshold(stat, 15)?.severity).toBe("warning");
    expect(crossedThreshold(stat, 25)?.severity).toBe("critical");
    expect(crossedThreshold(stat, 5)).toBeNull();
    expect(resolveStat(stat, { columns: TIME_COLS, rows: [] }).ok).toBe(false);
  });

  it("merges fleet results with a connection column", () => {
    const merged = mergeFleet([
      { connectionName: "alpha", data: { columns: TIME_COLS, rows: [{ t: "a", v: 1 }] } },
      { connectionName: "beta", data: { columns: TIME_COLS, rows: [{ t: "a", v: 2 }] } },
    ]);
    expect(merged.columns[0]).toEqual({ name: "connection", type: "String" });
    expect(merged.rows).toEqual([{ connection: "alpha", t: "a", v: 1 }, { connection: "beta", t: "a", v: 2 }]);
  });
});
