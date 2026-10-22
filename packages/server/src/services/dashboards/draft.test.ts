/**
 * Every AI-drafted panel is reviewed like a save and a run before the user
 * sees it; nothing is repaired, and the model never places panels.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

let columns: Array<{ name: string; type: string }> = [];
let rows: Array<Record<string, unknown>> = [];
let dryRunError: Error | null = null;
const dryRuns: string[] = [];
mock.module("./runner", () => ({
  execute: async (_connectionId: string, compiled: { sql: string }) => {
    dryRuns.push(compiled.sql);
    if (dryRunError) throw dryRunError;
    return { columns, rows, elapsedMs: 0, readRows: 0, readBytes: 0, ranAt: 0, timezone: "UTC" };
  },
}));

let denied: string | null = null;
mock.module("../../middleware/dataAccess", () => ({
  validateQueryAccess: async () => (denied ? { allowed: false, reason: denied } : { allowed: true }),
}));

const { finalizeDraft } = await import("./draft");
const { draftEvidence } = await import("./draftEvidence");

const VIZ = { version: 2, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null };
const REQUEST = { goal: "Watch the orders pipeline", connectionId: "c1", existing: null };
const CTX = { userId: "u1", isAdmin: false, permissions: ["table:select"], connectionId: "c1" };
const GOOD_SQL = "SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t, count() AS v FROM system.part_log WHERE event_time >= {{from}} AND event_time < {{to}} GROUP BY t ORDER BY t";
const TIME_COLUMNS = [{ name: "t", type: "DateTime" }, { name: "v", type: "UInt64" }];

type RawPanel = { title: string; sql: string; viz: unknown; role: unknown; importance: unknown; section: string | null; rationale: string };

function panel(overrides: Partial<RawPanel> = {}): RawPanel {
  return { title: "Parts", sql: GOOD_SQL, viz: VIZ, role: "trend", importance: "primary", section: "Ingestion", rationale: "Shows insert pressure", ...overrides };
}

function draft(panels: RawPanel[], variables: unknown[] = []): Parameters<typeof finalizeDraft>[0] {
  return { title: "Orders", description: "Pipeline health", variables, panels };
}

beforeEach(() => {
  columns = TIME_COLUMNS;
  rows = [{ t: "2026-10-22 00:00:00", v: 1 }];
  dryRunError = null;
  denied = null;
  dryRuns.length = 0;
});

describe("finalizeDraft", () => {
  it("passes a correct panel with its role, importance and section, after a full dry run with native parameters", async () => {
    const result = await finalizeDraft(draft([panel()]), REQUEST, CTX);
    expect(result.panels[0]).toMatchObject({ status: "ok", reasons: [], lint: [], role: "trend", importance: "primary", section: "Ingestion" });
    expect(result.panels[0].panel).toEqual({ id: null, kind: "chart", title: "Parts", sql: GOOD_SQL, viz: VIZ, fleet: false });
    expect(result.panels[0].panel).not.toHaveProperty("layout");
    expect(dryRuns[0]).not.toContain("LIMIT 1");
    expect(dryRuns[0]).toContain("{chouse_from:DateTime}");
  });

  it("treats an empty section as none", async () => {
    expect((await finalizeDraft(draft([panel({ section: "  " })]), REQUEST, CTX)).panels[0].section).toBeNull();
  });

  it("marks lint findings for attention and keeps the fix for the user to apply", async () => {
    columns = [{ name: "t", type: "String" }, { name: "v", type: "UInt64" }];
    const result = await finalizeDraft(draft([panel({ viz: { ...VIZ, type: "pie" }, role: "breakdown", sql: "SELECT name AS t, value AS v FROM system.events ORDER BY v DESC" })]), REQUEST, CTX);
    expect(result.panels[0].status).toBe("attention");
    expect(result.panels[0].lint.map((f) => f.code)).toEqual(["pie_without_limit"]);
    expect(result.panels[0].lint[0].fixedSql).toEndWith("LIMIT 12");
    expect(result.panels[0].panel?.sql).not.toContain("LIMIT 12");
  });

  it("checks the chart against the dry run's result and offers the fixed chart", async () => {
    columns = [{ name: "t", type: "String" }, { name: "v", type: "UInt64" }];
    rows = Array.from({ length: 24 }, (_, i) => ({ t: `p${i}`, v: i }));
    const pie = await finalizeDraft(draft([panel({ viz: { ...VIZ, type: "donut" }, role: "breakdown", sql: "SELECT partition AS t, count() AS v FROM system.parts GROUP BY t LIMIT 30" })]), REQUEST, CTX);
    expect(pie.panels[0].lint.map((f) => f.code)).toEqual(["too_many_slices"]);
    expect(pie.panels[0].lint[0].fixedViz).toEqual({ ...VIZ, type: "horizontal_bar" });
    expect(pie.panels[0].panel?.viz.type).toBe("donut");
    const line = await finalizeDraft(draft([panel()]), REQUEST, CTX);
    expect(line.panels[0].lint.map((f) => f.code)).toEqual(["time_axis_not_time"]);
  });

  it("blocks unreadable chart settings, roles and importance instead of guessing", async () => {
    const result = await finalizeDraft(draft([panel({ viz: { ...VIZ, type: "sparkline" } }), panel({ role: "hero", importance: "high" }), panel({ viz: { ...VIZ, version: 1 } })]), REQUEST, CTX);
    expect(result.panels[0]).toMatchObject({ status: "blocked", panel: null });
    expect(result.panels[0].reasons[0]).toContain("Chart settings");
    expect(result.panels[1].reasons).toEqual(['Role must be one of kpi, trend, breakdown, ranking, distribution, detail, not "hero"', 'Importance must be primary or secondary, not "high"']);
    expect(result.panels[2].status).toBe("blocked");
    expect(dryRuns).toEqual([]);
  });

  it("blocks a chart its role does not allow, without running it", async () => {
    const result = await finalizeDraft(draft([panel({ role: "kpi" })]), REQUEST, CTX);
    expect(result.panels[0]).toMatchObject({ status: "blocked", reasons: ["The role does not fit the chart: a kpi panel is drawn as stat, not line"] });
    expect(result.panels[0].panel?.viz.type).toBe("line");
    expect(dryRuns).toEqual([]);
  });

  it("blocks SQL that is not one read-only SELECT", async () => {
    const result = await finalizeDraft(draft([panel({ sql: "ALTER TABLE t DELETE WHERE 1" })]), REQUEST, CTX);
    expect(result.panels[0].status).toBe("blocked");
    expect(dryRuns).toEqual([]);
  });

  it("blocks a panel the requester may not read, before the dry run", async () => {
    denied = "Access denied to secret.payments";
    const result = await finalizeDraft(draft([panel()]), REQUEST, CTX);
    expect(result.panels[0]).toMatchObject({ status: "blocked", reasons: ["Access denied to secret.payments"] });
    expect(dryRuns).toEqual([]);
  });

  it("blocks a panel whose dry run fails or does not return the charted columns", async () => {
    dryRunError = new Error("Unknown table system.nope");
    expect((await finalizeDraft(draft([panel()]), REQUEST, CTX)).panels[0].reasons[0]).toBe("The dry run failed: Unknown table system.nope");
    dryRunError = null;
    columns = [{ name: "t", type: "DateTime" }, { name: "count", type: "UInt64" }];
    expect((await finalizeDraft(draft([panel()]), REQUEST, CTX)).panels[0].reasons[0]).toBe("The chart names v, which the query does not return (it returns t, count)");
  });

  it("keeps valid variables, reports the dropped ones, and checks panels against what is kept", async () => {
    const good = { name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["default"] }, default: "default" };
    const bad = { name: "Bad Name", label: "x", kind: "string", options: { source: "static", values: ["a"] }, default: "a" };
    const result = await finalizeDraft(draft([panel({ sql: "SELECT now() AS t, count() AS v FROM {{var.db}}.events" }), panel({ sql: "SELECT now() AS t, 1 AS v FROM {{var.other}}.x" })], [good, bad, good]), REQUEST, CTX);
    expect(result.variables.map((v) => v.name)).toEqual(["db"]);
    expect(result.problems).toHaveLength(2);
    expect(result.panels[0].status).toBe("ok");
    expect(result.panels[1].status).toBe("blocked");
  });

  it("takes a multi-value variable and runs the panel with its default list", async () => {
    const tables = { name: "tables", label: "Tables", kind: "multi", options: { source: "static", values: ["a", "b"] }, default: ["a", "b"] };
    const result = await finalizeDraft(draft([panel({ sql: `${GOOD_SQL.replace("GROUP BY", "AND table IN {{var.tables}} GROUP BY")}` })], [tables]), REQUEST, CTX);
    expect(result.panels[0].status).toBe("ok");
    expect(dryRuns[0]).toContain("{v_tables:Array(String)}");
  });
});

describe("draftEvidence", () => {
  it("carries the goal, the dashboard being added to, the rules and example panels with roles, never sizes", () => {
    const evidence = draftEvidence({ ...REQUEST, existing: { title: "Orders", variables: [], panels: [{ title: "Rows", sql: "SELECT 1" }] } });
    expect(evidence.goal).toBe("Watch the orders pipeline");
    expect(evidence.existingDashboard).toEqual({ title: "Orders", variables: [], panels: [{ title: "Rows", sql: "SELECT 1" }] });
    expect(JSON.stringify(evidence.rules)).toContain("{{from}}");
    expect(JSON.stringify(evidence.rules)).toContain("never give sizes or positions");
    const examples = evidence.examplePanels as Array<Record<string, unknown>>;
    expect(examples).toHaveLength(3);
    for (const example of examples) {
      expect(Object.keys(example).sort()).toEqual(["importance", "role", "section", "sql", "title", "viz"]);
    }
    expect(examples[0].importance).toBe("primary");
  });
});
