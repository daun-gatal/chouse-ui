import { describe, expect, it } from "bun:test";

import { parseDashboardDocument } from "../../dashboards/legacy";
import { ACTION_DEFINITIONS, actionDefinition, dashboardDocument } from "./definitions";

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

  it("are all either low or high risk, and only the remediation proposal is high", () => {
    expect(ACTION_DEFINITIONS.filter((d) => d.risk === "high").map((d) => d.name)).toEqual(["propose_remediation"]);
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
