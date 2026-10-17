/**
 * CHouse management tools against the real API router (ADR 0019 §9): the
 * in-process client must pass API protection and JWT auth, and the route's own
 * permission check must decide — the tool can never see more than the user.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../../../rbac/services/jwt";
import { errorHandler } from "../../../middleware/error";
import api from "../../../routes";
import { buildGrantedTools } from "./catalog";
import { registerInProcessApi } from "./inProcessApi";
import { runInToolStep, UsageRun } from "../usage";

const USER = "in-process-user";

async function token(roles: string[], permissions: string[]): Promise<string> {
  return generateAccessToken({ sub: USER, email: "ip@test.local", username: "inprocess", roles, permissions, sessionId: "s1" });
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'ip@test.local', 'inprocess', 'x', 1, unixepoch(), unixepoch())`);
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/api", api);
  registerInProcessApi(app);
});

afterAll(async () => {
  registerInProcessApi(new Hono());
  await closeDatabase();
});

describe("management tools through the real API", () => {
  it("whoami answers with the caller's own profile", async () => {
    const [whoami] = buildGrantedTools(["whoami"], { ctx: { bearerToken: await token(["custom"], []), permissions: [] } });
    const result = (await whoami.invoke({})) as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result)).toContain("inprocess");
  });

  it("lists users when the caller may, and returns the route's refusal when not", async () => {
    const allowed = buildGrantedTools(["list_users"], { ctx: { bearerToken: await token(["custom"], ["users:view"]), permissions: ["users:view"] } });
    const rows = (await allowed[0].invoke({})) as { rows?: Array<{ username: string }>; error?: string };
    expect(rows.error).toBeUndefined();
    expect(rows.rows?.some((u) => u.username === "inprocess")).toBe(true);

    // The catalog would not even offer the tool; force-build it the way an admin
    // (who sees every tool) would, but call with a token lacking the permission.
    // ADR 0020: inside a usage run the rows the tool returns are recorded as CHouse data sent to the model.
    const run = new UsageRun({ featureId: "chat", source: "chat", userId: USER, connectionId: null });
    const step = run.beginTool("list_users", "chouse-admin", { model: null, connectionId: null, defaultDatabase: null });
    const again = (await runInToolStep(step, () => allowed[0].invoke({}))) as { rows?: unknown[] };
    expect(run.egress).toHaveLength(1);
    expect(run.egress[0]).toMatchObject({ kind: "chouse", source: "List users", rows: again.rows?.length });
    expect(run.egress[0].columns).toContain("username");

    const forced = buildGrantedTools(["list_users"], { ctx: { bearerToken: await token(["custom"], []), isAdmin: true } });
    const refused = (await forced[0].invoke({})) as { error?: string };
    expect(refused.error).toMatch(/permission/i);
  });

  it("answers operations and AI governance questions from the real routes", async () => {
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
      VALUES ('conn-ip', 'in-process', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
    const permissions = [
      "performance:view", "capacity:view", "upgrades:view", "observe:view", "connections:view", "remediation:approve",
      "doctor:view", "ai_usage:view", "ai_agents:view",
    ];
    const bearerToken = await token(["super_admin"], permissions);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_query_regressions", {}],
      ["get_capacity", {}],
      ["list_upgrade_assessments", {}],
      ["get_upgrade_rollout", {}],
      ["get_collector_status", {}],
      ["get_collector_schedule", {}],
      ["get_collector_schedule", { connectionId: "conn-ip" }],
      ["list_remediation_actions", { status: ["proposed"] }],
      ["get_ai_usage", { part: "summary", days: 30 }],
      ["get_ai_usage", { part: "models" }],
      ["get_ai_usage", { part: "egress", q: "orders" }],
      ["list_ai_requests", { origin: "mcp" }],
      ["list_ai_agents", {}],
    ];
    for (const [name, args] of calls) {
      const [tool] = buildGrantedTools([name], { ctx: { bearerToken, permissions, connectionId: "conn-ip" } });
      const result = (await tool.invoke(args)) as Record<string, unknown>;
      expect({ name, args, error: result.error }).toEqual({ name, args, error: undefined });
    }
    const [summary] = buildGrantedTools(["get_ai_usage"], { ctx: { bearerToken, permissions, connectionId: "conn-ip" } });
    expect(await summary.invoke({ part: "summary" })).toMatchObject({ scope: "all", requests: 0, byOrigin: [] });
    const [agents] = buildGrantedTools(["list_ai_agents"], { ctx: { bearerToken, permissions } });
    const registry = (await agents.invoke({})) as Record<string, unknown>;
    expect(Object.keys(registry).sort()).toEqual(["agents", "features", "harnesses", "problems", "skills", "version"]);
    // A route's own refusals come back as tool errors, never as made-up data.
    const [notebook] = buildGrantedTools(["get_investigation_notebook"], { ctx: { bearerToken, permissions } });
    expect(await notebook.invoke({ attachedTo: "doctor_report", ref: "missing" })).toEqual({ error: "This incident or report has no notebook yet" });
    const [request] = buildGrantedTools(["get_ai_request"], { ctx: { bearerToken, permissions } });
    expect(await request.invoke({ id: "missing" })).toEqual({ error: "AI request not found" });
    const [actions] = buildGrantedTools(["list_remediation_actions"], { ctx: { bearerToken, permissions } });
    expect(await actions.invoke({})).toEqual({ error: "No connection: pass connectionId" });
  });

  it("lists and reads the user's dashboards as compact projections, and refuses one they cannot see", async () => {
    const { createDashboard } = await import("../../dashboards/store");
    const viz = { version: 1 as const, type: "line" as const, x: "t", y: ["v"], series: null, unit: "count" as const, decimals: null, thresholds: [], colorScheme: "violet" as const, reduce: null };
    const id = await createDashboard({
      title: "Orders", description: "Pipeline", connectionScope: { kind: "only", connectionIds: ["conn-elsewhere"] }, timeRange: "6h", refreshSeconds: 0, variables: [],
      panels: [{ id: null, title: "Rows", sql: "SELECT now() AS t, 1 AS v", viz, width: 6, height: "m", fleet: false }],
    }, USER);
    const permissions = ["dashboards:view"];
    const bearerToken = await token(["custom"], permissions);
    const [list] = buildGrantedTools(["list_dashboards"], { ctx: { bearerToken, permissions } });
    expect(await list.invoke({})).toEqual([expect.objectContaining({ id, title: "Orders", owner: "inprocess", panels: 1, connections: { names: [], others: 1 }, sharedWith: [], pinned: false })]);
    const [get] = buildGrantedTools(["get_dashboard"], { ctx: { bearerToken, permissions } });
    const detail = (await get.invoke({ id })) as Record<string, unknown>;
    // A connection the user cannot use is counted, not named.
    expect(detail.connections).toEqual({ names: [], others: 1 });
    expect(detail.panels).toEqual([expect.objectContaining({ title: "Rows", sql: "SELECT now() AS t, 1 AS v", chart: "line", unit: "count", fleet: false })]);
    expect(await get.invoke({ id: "missing" })).toEqual({ error: "Dashboard not found" });
  });
});
