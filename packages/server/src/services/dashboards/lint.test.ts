import { describe, expect, it } from "bun:test";

import { chartFit, codeOnly, isTimeType, lintPanel } from "./lint";
import type { VizSpec } from "./spec";

function viz(overrides: Partial<VizSpec> = {}): VizSpec {
  return { version: 2, type: "line", x: "t", y: ["v"], series: null, unit: "ms", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null, ...overrides };
}

describe("chartFit", () => {
  const rows = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})): Array<Record<string, unknown>> => Array.from({ length: n }, (_, i) => ({ t: `k${i}`, v: i, ...extra(i) }));
  const text = [{ name: "t", type: "String" }, { name: "v", type: "UInt64" }];
  const time = [{ name: "t", type: "DateTime('UTC')" }, { name: "v", type: "UInt64" }];

  it("turns a pie with more than 8 slices into horizontal bars, and leaves 8 alone", () => {
    const pie = viz({ type: "pie", unit: "count" });
    expect(chartFit(pie, { columns: text, rows: rows(8) })).toEqual([]);
    const [finding] = chartFit(pie, { columns: text, rows: rows(9) });
    expect(finding.code).toBe("too_many_slices");
    expect(finding.fixedViz).toEqual({ ...pie, type: "horizontal_bar" });
  });

  it("turns a trend over something that is not time into bars, dropping a band that would no longer apply", () => {
    const banded = viz({ baseline: { weeks: 4 } });
    const [finding] = chartFit(banded, { columns: text, rows: rows(3) });
    expect(finding).toMatchObject({ code: "time_axis_not_time", fixedViz: { ...banded, type: "bar", baseline: null } });
    expect(chartFit(banded, { columns: time, rows: rows(3) })).toEqual([]);
  });

  it("flags too many series and too many bars without a mechanical fix", () => {
    const split = viz({ series: "user" });
    const many = chartFit(split, { columns: [...time, { name: "user", type: "String" }], rows: rows(13, (i) => ({ user: `u${i}` })) });
    expect(many).toEqual([expect.objectContaining({ code: "too_many_series" })]);
    expect(many[0].fixedViz).toBeUndefined();
    expect(chartFit(viz({ type: "bar" }), { columns: text, rows: rows(51) }).map((f) => f.code)).toEqual(["too_many_categories"]);
  });

  it("knows date and time types through Nullable and LowCardinality", () => {
    for (const t of ["Date", "Date32", "DateTime", "DateTime('UTC')", "DateTime64(3)", "Nullable(DateTime)", "LowCardinality(Nullable(Date))"]) expect(isTimeType(t)).toBe(true);
    for (const t of ["String", "UInt32", "Nullable(String)", "Array(DateTime)"]) expect(isTimeType(t)).toBe(false);
  });
});

const codes = (sql: string, spec: VizSpec): string[] => lintPanel(sql, spec).map((f) => f.code);

describe("lintPanel", () => {
  it("is quiet for a well-formed time series", () => {
    expect(codes("SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t, quantile(0.95)(query_duration_ms) AS v FROM system.query_log WHERE event_time >= {{from}} AND event_time < {{to}} GROUP BY t ORDER BY t", viz())).toEqual([]);
  });

  it("flags running totals plotted as a line, unless a delta is taken", () => {
    expect(codes("SELECT now() AS t, value AS v FROM system.events", viz())).toContain("cumulative_counter");
    expect(codes("SELECT t, runningDifference(v) AS v FROM (SELECT now() AS t, value AS v FROM system.errors)", viz())).not.toContain("cumulative_counter");
    expect(codes("SELECT name AS t, value AS v FROM system.events", viz({ type: "bar" }))).not.toContain("cumulative_counter");
  });

  it("flags a numeric chart without a unit, but not a table or histogram", () => {
    expect(codes("SELECT 1 AS t, 2 AS v", viz({ unit: "none" }))).toContain("missing_unit");
    expect(codes("SELECT 1", viz({ type: "table", x: null, y: [], unit: "none" }))).not.toContain("missing_unit");
    expect(codes("SELECT 1 AS d", viz({ type: "histogram", x: "d", y: [], unit: "none" }))).not.toContain("missing_unit");
  });

  it("flags averages of quantiles", () => {
    expect(codes("SELECT t, avg(quantile(0.9)(ms)) AS v FROM x GROUP BY t", viz())).toContain("avg_of_quantiles");
    expect(codes("SELECT t, avg( quantileExact(0.9)(ms) ) AS v FROM x GROUP BY t", viz())).toContain("avg_of_quantiles");
  });

  it("flags a system log read without {{from}}", () => {
    expect(codes("SELECT event_time AS t, 1 AS v FROM system.part_log", viz())).toContain("unbounded_log_scan");
    expect(codes("SELECT event_time AS t, 1 AS v FROM system.part_log WHERE event_time >= {{from}}", viz())).not.toContain("unbounded_log_scan");
  });

  it("ignores table names inside strings and comments", () => {
    expect(codes("SELECT 'system.query_log' AS t, 1 AS v -- system.events", viz())).toEqual([]);
  });

  it("suggests a LIMIT for a pie, mechanically only when safe", () => {
    const [finding] = lintPanel("SELECT database AS d, sum(bytes) AS b FROM system.parts GROUP BY d ORDER BY b DESC;", viz({ type: "pie", x: "d", y: ["b"], unit: "bytes" }));
    expect(finding.code).toBe("pie_without_limit");
    expect(finding.fixedSql).toBe("SELECT database AS d, sum(bytes) AS b FROM system.parts GROUP BY d ORDER BY b DESC\nLIMIT 12");
    const [withSettings] = lintPanel("SELECT d, b FROM x SETTINGS max_threads = 1", viz({ type: "donut", x: "d", y: ["b"], unit: "bytes" }));
    expect(withSettings.code).toBe("pie_without_limit");
    expect(withSettings.fixedSql).toBeUndefined();
    expect(codes("SELECT d, b FROM x LIMIT 5", viz({ type: "pie", x: "d", y: ["b"], unit: "bytes" }))).toEqual([]);
  });
});

describe("codeOnly", () => {
  it("blanks strings, quoted identifiers and comments but keeps positions", () => {
    const sql = "SELECT 'a''b', `c`, \"d\" -- e\n/* f */ g";
    const out = codeOnly(sql);
    expect(out.length).toBe(sql.length);
    expect(out).toContain("SELECT");
    expect(out).toContain("g");
    for (const hidden of ["a", "b", "c", "d", "e", "f"]) expect(out.replace(/SELECT|g/g, "")).not.toContain(hidden);
  });
});
