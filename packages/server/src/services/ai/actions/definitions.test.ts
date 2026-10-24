import { describe, expect, it } from "bun:test";

import { parseDashboardDocument } from "../../dashboards/legacy";
import { ACTION_DEFINITIONS, actionDefinition, dashboardDocument } from "./definitions";
import { RESOURCES } from "./resources";
import { TIERS, TOOLKITS, type ActionApi } from "./types";

describe("action definitions", () => {
  it("describe what will happen in words", () => {
    expect(actionDefinition("kill_query")?.describe({ queryId: "abc-1" })).toBe(`KILL QUERY WHERE query_id = "abc-1"`);
    expect(actionDefinition("create_scheduled_query")?.describe({ name: "Daily orders", frequency: "daily", hour: 6, timezone: "UTC" })).toBe(`Schedule "Daily orders" daily at 06:00 UTC`);
    expect(actionDefinition("create_scheduled_query")?.describe({ name: "x", frequency: "cron", cronExpr: "*/5 * * * *" })).toBe(`Schedule "x" on cron "*/5 * * * *"`);
    expect(actionDefinition("update_table_context")?.describe({ database: "sales", table: "orders", grain: "one order line" })).toBe("Update the context of sales.orders (grain)");
    expect(actionDefinition("propose_remediation")?.describe({ title: "Add a TTL", params: { type: "modify_ttl" } })).toBe(`Propose "Add a TTL" (modify_ttl) for approval in Fixes`);
    expect(actionDefinition("create_dashboard")?.describe({ title: "Ingest", panels: [{}, {}] })).toBe(`Create the dashboard "Ingest" with 2 panel(s)`);
  });

  it("validate their input", () => {
    expect(actionDefinition("kill_query")?.schema.safeParse({}).success).toBe(false);
    expect(actionDefinition("create_scheduled_query")?.schema.safeParse({ name: "x", query: "SELECT 1", frequency: "sometimes" }).success).toBe(false);
    expect(actionDefinition("create_scheduled_query")?.schema.safeParse({ name: "x", query: "SELECT 1", frequency: "daily", hour: 6 }).success).toBe(true);
  });

  it("each belong to a toolkit and have a tier (ADR 0025)", () => {
    for (const d of ACTION_DEFINITIONS) {
      expect(TOOLKITS).toContain(d.toolkit);
      expect(typeof d.tier === "function" || TIERS.includes(d.tier)).toBe(true);
    }
    const names = ACTION_DEFINITIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only offer undo on T1 tools, and every undo names a known resource", () => {
    for (const d of ACTION_DEFINITIONS.filter((x) => x.undo)) {
      expect(d.tier).toBe("t1");
      expect(Object.keys(RESOURCES)).toContain(d.undo?.resource);
    }
  });

  it("decide kill_query's tier by whose query it is", async () => {
    const kill = actionDefinition("kill_query");
    if (!kill || typeof kill.tier === "string") throw new Error("kill_query tier should depend on the call");
    const api = (rows: Array<Record<string, unknown>>): ActionApi => ({
      get: async <T>() => ({ queries: rows }) as T,
      post: async () => { throw new Error("no"); },
      put: async () => { throw new Error("no"); },
      patch: async () => { throw new Error("no"); },
      delete: async () => { throw new Error("no"); },
    });
    const ctx = (rows: Array<Record<string, unknown>>) => ({ api: api(rows), connectionId: "c", userId: "alice" });
    expect(await kill.tier({ queryId: "q1" }, ctx([{ query_id: "q1", rbac_user_id: "alice" }]))).toBe("t2");
    expect(await kill.tier({ queryId: "q1" }, ctx([{ query_id: "q1", rbac_user_id: "bob" }]))).toBe("t3");
    expect(await kill.tier({ queryId: "q1" }, ctx([]))).toBe("t2");
  });

  it("build a dashboard the dashboard parser accepts", () => {
    const doc = dashboardDocument({
      title: "Ingest health",
      description: "Rows per minute and lag",
      panels: [
        { title: "Rows per minute", sql: "SELECT toStartOfMinute(ts) AS t, count() AS n FROM events GROUP BY t", chart: "line", x: "t", y: ["n"] },
        { title: "Current lag", sql: "SELECT max(lag) AS lag FROM ingest", chart: "stat", y: ["lag"] },
        { title: "Latest rows", sql: "SELECT * FROM events ORDER BY ts DESC LIMIT 20", chart: "table" },
      ],
    }, "conn-1");
    const parsed = parseDashboardDocument(doc);
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    expect(parsed.input.title).toBe("Ingest health");
    expect(parsed.input.panels).toHaveLength(3);
    expect(parsed.input.connectionScope).toEqual({ kind: "only", connectionIds: ["conn-1"] });
    expect(parsed.input.timeRange).toBe("24h");
  });

  it("let the dashboard parser explain a panel that cannot work", () => {
    const parsed = parseDashboardDocument(dashboardDocument({ title: "x", panels: [{ title: "bad", sql: "SELECT 1", chart: "line" }] }, "c"));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems.join(" ")).toContain("needs an x column");
  });
});
