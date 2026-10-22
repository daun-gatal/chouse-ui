import { describe, expect, it } from "bun:test";

import { convertGrafana, convertSql, selectColumns, settle, variableName } from "./grafana";
import type { Variable } from "./spec";

const CH = { type: "grafana-clickhouse-datasource", uid: "ch1" };
const SCOPE = { kind: "any" as const };

function grafana(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 39,
    title: "ClickHouse ops",
    description: "From Grafana",
    time: { from: "now-24h", to: "now" },
    refresh: "1m",
    templating: {
      list: [
        { type: "datasource", name: "ds", query: "grafana-clickhouse-datasource" },
        { type: "custom", name: "Database", label: "DB", query: "shop,billing", current: { value: "shop" } },
        { type: "query", name: "tables", multi: true, query: "SELECT name FROM system.tables", current: { value: ["orders", "items"] } },
        { type: "interval", name: "step", query: "1m,5m" },
      ],
    },
    panels: [
      { type: "row", title: "Inserts", gridPos: { x: 0, y: 0, w: 24, h: 1 }, panels: [] },
      {
        type: "timeseries", title: "Insert rate", datasource: CH, gridPos: { x: 0, y: 1, w: 12, h: 8 },
        fieldConfig: { defaults: { unit: "reqps" } },
        targets: [{ rawSql: "SELECT $__timeInterval(event_time) AS t, count() / $__interval_s AS rate FROM system.query_log WHERE $__timeFilter(event_time) AND current_database = '${Database}' AND tables IN (${tables:singlequote}) GROUP BY t ORDER BY t" }],
      },
      { type: "stat", title: "Parts", datasource: { type: "prometheus", uid: "p" }, gridPos: { x: 12, y: 1, w: 6, h: 4 }, targets: [{ expr: "up" }] },
      { type: "stat", title: "Total rows", datasource: "${ds}", gridPos: { x: 12, y: 1, w: 6, h: 4 }, fieldConfig: { defaults: { unit: "short" } }, targets: [{ rawSql: "SELECT sum(rows) AS rows FROM system.parts WHERE active" }] },
      { type: "table", title: "Everything", datasource: CH, gridPos: { x: 0, y: 9, w: 24, h: 8 }, targets: [{ rawSql: "SELECT * FROM system.disks" }] },
      { type: "text", title: "Runbook", gridPos: { x: 18, y: 1, w: 6, h: 4 }, options: { mode: "markdown", content: "Call **ops**" } },
      { type: "nodeGraph", title: "Graph", datasource: CH, gridPos: { x: 0, y: 17, w: 12, h: 8 }, targets: [{ rawSql: "SELECT 1" }] },
      { type: "timeseries", title: "Weird", datasource: CH, gridPos: { x: 12, y: 17, w: 12, h: 8 }, targets: [{ rawSql: "SELECT $__timeFilter_ms(t) AS t, 1 AS v FROM x" }] },
    ],
    ...overrides,
  };
}

describe("convertGrafana", () => {
  it("converts ClickHouse panels, keeps text and rows, and says why the rest are skipped", () => {
    const result = convertGrafana(grafana(), SCOPE);
    if (!result.ok) throw new Error(result.error);
    const { dashboard, panels, variables, notes } = result.preview;
    expect(panels.map((p) => [p.title, p.status])).toEqual([
      ["Inserts", "ready"],
      ["Insert rate", "changed"],
      ["Parts", "skipped"],
      ["Total rows", "ready"],
      ["Everything", "skipped"],
      ["Runbook", "ready"],
      ["Graph", "skipped"],
      ["Weird", "skipped"],
    ]);
    expect(panels[2].reason).toBe("it reads another data source (only ClickHouse panels convert)");
    expect(panels[4].reason).toBe("its columns could not be read from the SQL (name every column with AS)");
    expect(panels[6].reason).toBe("the panel type nodeGraph has no equivalent");
    expect(panels[7].reason).toBe("the macro $__timeFilter_ms has no equivalent");

    expect(variables.map((v) => [v.name, v.status, v.reason])).toEqual([
      ["Database", "changed", null],
      ["tables", "ready", null],
      ["step", "skipped", "a interval variable has no equivalent"],
    ]);
    expect(dashboard.variables).toEqual([
      { name: "database", label: "DB", kind: "string", options: { source: "static", values: ["shop", "billing"] }, default: "shop" },
      { name: "tables", label: "tables", kind: "multi", options: { source: "query", sql: "SELECT name FROM system.tables" }, default: ["orders", "items"] },
    ]);

    const rate = dashboard.panels[1];
    if (rate.kind !== "chart") throw new Error("expected a chart");
    expect(rate.sql).toBe("SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t, count() / {{interval_s}} AS rate FROM system.query_log WHERE event_time >= {{from}} AND event_time < {{to}} AND current_database = {{var.database}} AND tables IN {{var.tables}} GROUP BY t ORDER BY t");
    expect(rate.viz).toMatchObject({ type: "line", x: "t", y: ["rate"], unit: "per_s" });
    expect(rate.layout).toEqual({ x: 0, y: 1, w: 12, h: 8 });
    expect(dashboard.panels[0]).toMatchObject({ kind: "heading", title: "Inserts", layout: { h: 1 } });
    expect(dashboard.panels[2]).toMatchObject({ kind: "chart", viz: { type: "stat", y: ["rows"], reduce: "last", unit: "none" } });
    expect(dashboard.panels[3]).toMatchObject({ kind: "text", markdown: "Call **ops**" });
    expect(dashboard).toMatchObject({ title: "ClickHouse ops", timeRange: "24h", refreshSeconds: 60, connectionScope: SCOPE });
    // "Total rows" sat on top of "Parts" (skipped) only; "Runbook" overlapped nothing.
    expect(notes).toEqual([]);
  });

  it("pushes panels from collapsed rows down instead of overlapping, and notes what it could not keep", () => {
    const doc = grafana({
      time: { from: "now-90m", to: "now" },
      refresh: "10s",
      panels: [
        { type: "stat", title: "A", datasource: CH, gridPos: { x: 0, y: 0, w: 12, h: 4 }, targets: [{ rawSql: "SELECT 1 AS a" }] },
        { type: "row", title: "More", collapsed: true, gridPos: { x: 0, y: 4, w: 24, h: 1 }, panels: [
          { type: "stat", title: "B", datasource: CH, gridPos: { x: 0, y: 0, w: 12, h: 4 }, targets: [{ rawSql: "SELECT 2 AS b" }] },
        ] },
      ],
    });
    const result = convertGrafana(doc, SCOPE);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.dashboard.panels.map((p) => [p.title, p.layout.y])).toEqual([["A", 0], ["More", 4], ["B", 5]]);
    expect(result.preview.notes).toEqual([
      "Panels that overlapped (from collapsed rows) were moved down",
      "The time range now-90m has no equivalent; the dashboard opens on the last 6 hours",
      "The refresh 10s has no equivalent; auto-refresh is off",
    ]);
    expect(result.preview.dashboard).toMatchObject({ timeRange: "6h", refreshSeconds: 0 });
  });

  it("reads the API export's wrapper and refuses old schemas and non-dashboards", () => {
    expect(convertGrafana({ dashboard: grafana(), meta: {} }, SCOPE).ok).toBe(true);
    expect(convertGrafana(grafana({ schemaVersion: 27 }), SCOPE)).toEqual({ ok: false, error: "Grafana dashboards of schema 30 or later (Grafana 8+) can be imported; this one is schema 27. Open and save it in a newer Grafana first." });
    expect(convertGrafana({ title: "x" }, SCOPE)).toEqual({ ok: false, error: "That is not a Grafana dashboard: it has no panels" });
    expect(convertGrafana([], SCOPE)).toEqual({ ok: false, error: "That is not a Grafana dashboard JSON object" });
  });

  it("makes a variable used as a table name an identifier, and skips a panel using a variable it could not convert", () => {
    const doc = grafana({
      templating: { list: [{ type: "custom", name: "tbl", query: "orders,items", current: { value: "orders" } }] },
      panels: [
        { type: "table", title: "Rows", datasource: CH, gridPos: { x: 0, y: 0, w: 12, h: 8 }, targets: [{ rawSql: "SELECT id, ts FROM shop.$tbl LIMIT 10" }] },
        { type: "table", title: "Other", datasource: CH, gridPos: { x: 12, y: 0, w: 12, h: 8 }, targets: [{ rawSql: "SELECT id FROM t WHERE x = $missing" }] },
      ],
    });
    const result = convertGrafana(doc, SCOPE);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.dashboard.variables[0]).toMatchObject({ name: "tbl", kind: "identifier", default: "orders" });
    expect(result.preview.dashboard.panels[0]).toMatchObject({ sql: "SELECT id, ts FROM shop.{{var.tbl}} LIMIT 10" });
    expect(result.preview.panels[1]).toMatchObject({ status: "skipped", reason: "it uses $missing, which is not a variable that could be converted" });
  });
});

describe("helpers", () => {
  it("reads select-list names", () => {
    expect(selectColumns("SELECT toStartOfMinute(t) AS t, count() AS `c`, db.tbl.col, x FROM y")).toEqual(["t", "c", "col", "x"]);
    expect(selectColumns("SELECT a, (SELECT max(b) FROM z) AS m FROM y")).toEqual(["a", "m"]);
    expect(selectColumns("SELECT 'a, b' AS s FROM y")).toEqual(["s"]);
    expect(selectColumns("SELECT count() FROM y")).toBeNull();
    expect(selectColumns("SELECT * FROM y")).toBeNull();
  });

  it("names variables", () => {
    expect(variableName("Data-Base")).toBe("data_base");
    expect(variableName("1st")).toBe("v_1st");
  });

  it("converts bare and bracketed variable forms", () => {
    const vars = new Map<string, Variable>([["db", { name: "db", label: "db", kind: "string", options: { source: "static", values: ["a"] }, default: "a" }]]);
    expect(convertSql("SELECT 1 AS x FROM t WHERE a = $db AND b = [[db]] AND c = ${db:raw}", vars)).toEqual({ ok: true, sql: "SELECT 1 AS x FROM t WHERE a = {{var.db}} AND b = {{var.db}} AND c = {{var.db}}", changes: ["$db became {{var.db}}"] });
  });

  it("pushes overlapping layouts down in reading order", () => {
    expect(settle([{ x: 0, y: 0, w: 12, h: 4 }, { x: 6, y: 2, w: 12, h: 4 }, { x: 18, y: 0, w: 6, h: 2 }])).toEqual([
      { x: 0, y: 0, w: 12, h: 4 }, { x: 6, y: 4, w: 12, h: 4 }, { x: 18, y: 0, w: 6, h: 2 },
    ]);
  });
});
