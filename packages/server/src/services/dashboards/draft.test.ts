/**
 * Every AI-drafted panel is reviewed like a save and a run before the user
 * sees it; nothing is repaired.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

let columns: string[] = ["t", "v"];
let dryRunError: Error | null = null;
const dryRuns: string[] = [];
mock.module("./runner", () => ({
  execute: async (_connectionId: string, compiled: { sql: string }) => {
    dryRuns.push(compiled.sql);
    if (dryRunError) throw dryRunError;
    return { columns: columns.map((name) => ({ name, type: "String" })), rows: [], elapsedMs: 0, readRows: 0, readBytes: 0, ranAt: 0 };
  },
}));

let denied: string | null = null;
mock.module("../../middleware/dataAccess", () => ({
  validateQueryAccess: async () => (denied ? { allowed: false, reason: denied } : { allowed: true }),
}));

const { finalizeDraft } = await import("./draft");
const { draftEvidence } = await import("./draftEvidence");

const VIZ = { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null };
const REQUEST = { goal: "Watch the orders pipeline", connectionId: "c1", existing: null };
const CTX = { userId: "u1", isAdmin: false, permissions: ["table:select"], connectionId: "c1" };
const GOOD_SQL = "SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t, count() AS v FROM system.part_log WHERE event_time >= {{from}} AND event_time < {{to}} GROUP BY t ORDER BY t";

function panel(overrides: Record<string, unknown> = {}): { title: string; sql: string; viz: unknown; width: unknown; height: unknown; rationale: string } {
  return { title: "Parts", sql: GOOD_SQL, viz: VIZ, width: 6, height: "m", rationale: "Shows insert pressure", ...overrides };
}

function draft(panels: ReturnType<typeof panel>[], variables: unknown[] = []): Parameters<typeof finalizeDraft>[0] {
  return { title: "Orders", description: "Pipeline health", variables, panels };
}

beforeEach(() => {
  columns = ["t", "v"];
  dryRunError = null;
  denied = null;
  dryRuns.length = 0;
});

describe("finalizeDraft", () => {
  it("passes a correct panel, after a LIMIT 1 dry run with native parameters", async () => {
    const result = await finalizeDraft(draft([panel()]), REQUEST, CTX);
    expect(result.panels[0]).toMatchObject({ status: "ok", reasons: [], lint: [] });
    expect(result.panels[0].panel).toMatchObject({ id: null, width: 6, height: "m", fleet: false });
    expect(dryRuns[0]).toStartWith("SELECT * FROM (\n");
    expect(dryRuns[0]).toEndWith("\n) LIMIT 1");
    expect(dryRuns[0]).toContain("{chouse_from:DateTime}");
  });

  it("marks lint findings for attention and keeps the fix for the user to apply", async () => {
    const result = await finalizeDraft(draft([panel({ viz: { ...VIZ, type: "pie" }, sql: "SELECT name AS t, value AS v FROM system.events ORDER BY v DESC" })]), REQUEST, CTX);
    expect(result.panels[0].status).toBe("attention");
    expect(result.panels[0].lint.map((f) => f.code)).toEqual(["pie_without_limit"]);
    expect(result.panels[0].lint[0].fixedSql).toEndWith("LIMIT 12");
    expect(result.panels[0].panel?.sql).not.toContain("LIMIT 12");
  });

  it("blocks unreadable chart settings and sizes instead of guessing", async () => {
    const result = await finalizeDraft(draft([panel({ viz: { ...VIZ, type: "sparkline" } }), panel({ width: 5, height: "xl" })]), REQUEST, CTX);
    expect(result.panels[0]).toMatchObject({ status: "blocked", panel: null });
    expect(result.panels[0].reasons[0]).toContain("Chart settings");
    expect(result.panels[1].reasons).toEqual(["Width must be 3, 4, 6, 8 or 12, not 5", "Height must be s, m or l, not \"xl\""]);
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
    columns = ["t", "count"];
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
});

describe("draftEvidence", () => {
  it("carries the goal, the dashboard being added to, the rules and example panels", () => {
    const evidence = draftEvidence({ ...REQUEST, existing: { title: "Orders", variables: [], panels: [{ title: "Rows", sql: "SELECT 1" }] } });
    expect(evidence.goal).toBe("Watch the orders pipeline");
    expect(evidence.existingDashboard).toEqual({ title: "Orders", variables: [], panels: [{ title: "Rows", sql: "SELECT 1" }] });
    expect(JSON.stringify(evidence.rules)).toContain("{{from}}");
    expect((evidence.examplePanels as unknown[]).length).toBe(3);
  });
});
