/**
 * /api/dashboards against a real in-memory RBAC database, real JWTs and the
 * real data-access rules; only ClickHouse is faked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { ClickHouseError } from "@clickhouse/client";
import type { Hono } from "hono";
import { sql } from "drizzle-orm";

interface SentQuery {
  connectionId: string;
  query: string;
  params: Record<string, unknown>;
  settings: Record<string, unknown>;
}

const sent: SentQuery[] = [];
const ROWS = {
  meta: [{ name: "t", type: "DateTime" }, { name: "v", type: "UInt64" }],
  data: [{ t: "2026-10-17 00:00:00", v: 5 }, { t: "2026-10-17 00:05:00", v: 7 }],
  rows: 2,
  statistics: { elapsed: 0.002, rows_read: 10, bytes_read: 100 },
};
let respond: (connectionId: string, query: string) => unknown = () => ROWS;

mock.module("../services/scheduledQueries/chClient", () => ({
  clientForConnection: async (connectionId: string) => ({
    query: async (args: { query: string; query_params?: Record<string, unknown>; clickhouse_settings?: Record<string, unknown> }) => {
      sent.push({ connectionId, query: args.query, params: args.query_params ?? {}, settings: args.clickhouse_settings ?? {} });
      const result = respond(connectionId, args.query);
      if (result instanceof Error) throw result;
      return { json: async () => result };
    },
  }),
}));

const { Hono: HonoApp } = await import("hono");
const { closeDatabase } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const { freshDatabase, rawAll, rawRun } = await import("../rbac/db/migrationTestHarness");
const { generateAccessToken } = await import("../rbac/services/jwt");
const { errorHandler } = await import("../middleware/error");
const { clearPanelCache } = await import("../services/dashboards/runner");
const { default: dashboards } = await import("./dashboards");

const ALL = ["dashboards:view", "dashboards:edit", "dashboards:delete", "dashboards:share", "query:execute", "table:select"];
const USERS = {
  owner: { id: "u-owner", roles: ["team-a"], permissions: ALL },
  peer: { id: "u-peer", roles: ["team-b"], permissions: ["dashboards:view", "dashboards:edit", "query:execute", "table:select"] },
  outsider: { id: "u-out", roles: ["team-c"], permissions: ["dashboards:view", "query:execute", "table:select"] },
  manager: { id: "u-mgr", roles: ["team-a"], permissions: [...ALL, "dashboards:manage"] },
  nobody: { id: "u-none", roles: ["team-a"], permissions: ["metrics:view"] },
  viewOnly: { id: "u-view", roles: ["team-a"], permissions: ["dashboards:view"] },
};
type UserKey = keyof typeof USERS;

const LINE = { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null };
const ORDERS_SQL = "SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS v FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t ORDER BY t";
const RANGE = { kind: "relative", value: "6h" };

let app: Hono;

async function token(user: UserKey): Promise<string> {
  const u = USERS[user];
  return generateAccessToken({ sub: u.id, email: `${u.id}@test.local`, username: u.id, roles: u.roles, permissions: u.permissions, sessionId: "s1" });
}

async function call(user: UserKey, method: string, path: string, body?: unknown): Promise<{ status: number; json: { success: boolean; data?: any; error?: any } }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(user)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; error?: any } };
}

function panel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: null, title: "Orders", sql: ORDERS_SQL, viz: LINE, width: 6, height: "m", fleet: false, ...overrides };
}

function dashboard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Shop", description: "", connectionId: "conn-1", timeRange: "6h", refreshSeconds: 60, variables: [], panels: [panel()], ...overrides };
}

async function create(user: UserKey = "owner", overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await call(user, "POST", "/dashboards", dashboard(overrides));
  expect(res.status).toBe(201);
  return res.json.data;
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  for (const u of Object.values(USERS)) {
    await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${u.id}, ${`${u.id}@test.local`}, ${u.id}, 'x', 1, unixepoch(), unixepoch())`);
  }
  for (const [id, name] of [["role-a", "team-a"], ["role-b", "team-b"], ["role-c", "team-c"]]) {
    await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at) VALUES (${id}, ${name}, ${name}, 0, 0, 1, unixepoch(), unixepoch())`);
  }
  const membership: Array<[string, string]> = [["u-owner", "role-a"], ["u-peer", "role-b"], ["u-out", "role-c"], ["u-mgr", "role-a"], ["u-none", "role-a"], ["u-view", "role-a"]];
  for (const [user, role] of membership) {
    await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`${user}-${role}`}, ${user}, ${role}, unixepoch())`);
  }
  for (const [id, name] of [["conn-1", "alpha"], ["conn-2", "beta"]]) {
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
      VALUES (${id}, ${name}, 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  }
  // team-a and team-b may read database "shop" on both connections; team-c has no access at all.
  await rawRun(sql`INSERT INTO rbac_data_access_policies (id, name, is_system, created_at, updated_at) VALUES ('pol-shop', 'shop', 0, unixepoch(), unixepoch())`);
  for (const conn of ["conn-1", "conn-2"]) {
    await rawRun(sql`INSERT INTO rbac_data_access_policy_rules (id, policy_id, connection_id, database_pattern, table_pattern, is_allowed, priority, created_at, updated_at)
      VALUES (${`rule-${conn}`}, 'pol-shop', ${conn}, 'shop', '*', 1, 0, unixepoch(), unixepoch())`);
  }
  for (const role of ["role-a", "role-b"]) {
    await rawRun(sql`INSERT INTO rbac_role_data_access_policies (id, role_id, policy_id, created_at) VALUES (${`rdp-${role}`}, ${role}, 'pol-shop', unixepoch())`);
  }
  app = new HonoApp();
  app.onError(errorHandler);
  app.route("/dashboards", dashboards);
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  sent.length = 0;
  respond = () => ROWS;
  clearPanelCache();
});

describe("permission gates", () => {
  it("refuses callers without the dashboards permission", async () => {
    expect((await call("nobody", "GET", "/dashboards")).status).toBe(403);
    expect((await call("nobody", "POST", "/dashboards", dashboard())).status).toBe(403);
    expect((await call("viewOnly", "POST", "/dashboards", dashboard())).status).toBe(403);
    expect((await call("peer", "GET", "/dashboards/share-targets")).status).toBe(403);
  });
});

describe("create and read", () => {
  it("creates a dashboard with its panels and lint", async () => {
    const created = await create();
    expect(created.dashboard.title).toBe("Shop");
    expect(created.dashboard.ownerId).toBe("u-owner");
    expect(created.dashboard.version).toBe(1);
    expect(created.panels).toHaveLength(1);
    expect(created.access).toEqual({ owner: true, view: true, edit: true, delete: true, share: true });
    expect(created.lint[created.panels[0].id]).toEqual([]);
    const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE resource_id = ${created.dashboard.id}`);
    expect(audit.map((a) => a.action)).toContain("dashboard.create");
  });

  it("refuses SQL that is not one read-only SELECT, a bad macro, a strict-schema violation and a FORMAT clause", async () => {
    const drop = await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ sql: "DROP TABLE shop.orders" })] }));
    expect(drop.status).toBe(400);
    expect(drop.json.error.message).toContain("Panel 1 (Orders)");
    const macro = await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ sql: "SELECT '{{from}}' AS t, 1 AS v" })] }));
    expect(macro.status).toBe(400);
    expect(macro.json.error.message).toContain("quoted string");
    const unknownVar = await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ sql: "SELECT {{var.db}} AS t, 1 AS v" })] }));
    expect(unknownVar.status).toBe(400);
    expect((await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ viz: { ...LINE, type: "sparkline" } })] }))).status).toBe(400);
    const format = await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ sql: "SELECT 1 AS t, 2 AS v FORMAT CSV" })] }));
    expect(format.status).toBe(400);
    expect(format.json.error.message).toContain("FORMAT");
  });

  it("refuses a fleet panel that cannot split by connection", async () => {
    const res = await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ fleet: true, viz: { ...LINE, type: "pie", x: "t", y: ["v"] } })] }));
    expect(res.status).toBe(400);
    expect(res.json.error.message).toContain("cannot run across the fleet");
  });

  it("refuses a connection the creator may not use", async () => {
    const res = await call("outsider", "POST", "/dashboards", dashboard());
    expect(res.status).toBe(403);
  });

  it("hides a dashboard from users it is not shared with, and lists it for them once shared", async () => {
    const created = await create();
    const id = created.dashboard.id;
    expect((await call("peer", "GET", `/dashboards/${id}`)).status).toBe(404);
    expect((await call("peer", "GET", "/dashboards")).json.data.map((d: { id: string }) => d.id)).not.toContain(id);
    expect((await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] })).status).toBe(200);
    const seen = await call("peer", "GET", `/dashboards/${id}`);
    expect(seen.status).toBe(200);
    expect(seen.json.data.access).toEqual({ owner: false, view: true, edit: false, delete: false, share: false });
    expect((await call("peer", "GET", "/dashboards")).json.data.map((d: { id: string }) => d.id)).toContain(id);
    expect((await call("manager", "GET", `/dashboards/${id}`)).json.data.access.edit).toBe(true);
  });

  it("refuses unknown and duplicate roles in shares, and sharing by non-owners", async () => {
    const id = (await create()).dashboard.id;
    expect((await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-x", canEdit: false }] })).status).toBe(400);
    expect((await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }, { roleId: "role-b", canEdit: true }] })).status).toBe(400);
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    expect((await call("peer", "PUT", `/dashboards/${id}/shares`, { shares: [] })).status).toBe(403);
  });
});

describe("update", () => {
  it("saves with the loaded version, keeps panel ids and refuses a stale save", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const keptId = created.panels[0].id;
    const next = dashboard({ title: "Shop v2", panels: [panel({ id: keptId, title: "Orders (kept)" }), panel({ title: "New" })] });
    const saved = await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: next });
    expect(saved.status).toBe(200);
    expect(saved.json.data.dashboard.version).toBe(2);
    expect(saved.json.data.panels.map((p: { id: string; title: string }) => [p.id === keptId, p.title])).toEqual([[true, "Orders (kept)"], [false, "New"]]);
    const stale = await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ title: "Lost" }) });
    expect(stale.status).toBe(409);
    expect((await call("owner", "GET", `/dashboards/${id}`)).json.data.dashboard.title).toBe("Shop v2");
  });

  it("removes panels left out of a save and treats foreign panel ids as new", async () => {
    const a = await create();
    const b = await create();
    const foreign = b.panels[0].id;
    const saved = await call("owner", "PUT", `/dashboards/${a.dashboard.id}`, { version: 1, dashboard: dashboard({ panels: [panel({ id: foreign, title: "Foreign" })] }) });
    expect(saved.status).toBe(200);
    expect(saved.json.data.panels).toHaveLength(1);
    expect(saved.json.data.panels[0].id).not.toBe(foreign);
    expect(saved.json.data.panels[0].id).not.toBe(a.panels[0].id);
    expect((await call("owner", "GET", `/dashboards/${b.dashboard.id}`)).json.data.panels[0].id).toBe(foreign);
  });

  it("lets an edit share save, and refuses a view share", async () => {
    const id = (await create()).dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    expect((await call("peer", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard() })).status).toBe(403);
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    expect((await call("peer", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ title: "By peer" }) })).status).toBe(200);
  });
});

describe("delete, pin, duplicate, export and import", () => {
  it("deletes only for the owner or a manager", async () => {
    const id = (await create()).dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    expect((await call("peer", "DELETE", `/dashboards/${id}`)).status).toBe(403);
    expect((await call("manager", "DELETE", `/dashboards/${id}`)).status).toBe(200);
    expect((await call("owner", "GET", `/dashboards/${id}`)).status).toBe(404);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_panels WHERE dashboard_id = ${id}`)).toEqual([]);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_shares WHERE dashboard_id = ${id}`)).toEqual([]);
  });

  it("pins per user", async () => {
    const id = (await create()).dashboard.id;
    expect((await call("owner", "POST", `/dashboards/${id}/pin`)).status).toBe(200);
    expect((await call("owner", "GET", `/dashboards/${id}`)).json.data.pinned).toBe(true);
    expect((await call("manager", "GET", `/dashboards/${id}`)).json.data.pinned).toBe(false);
    expect((await call("owner", "DELETE", `/dashboards/${id}/pin`)).status).toBe(200);
    expect((await call("owner", "GET", `/dashboards/${id}`)).json.data.pinned).toBe(false);
    expect((await call("peer", "POST", `/dashboards/${id}/pin`)).status).toBe(404);
  });

  it("duplicates into a copy owned by the caller", async () => {
    const id = (await create()).dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    const copy = await call("peer", "POST", `/dashboards/${id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.json.data.dashboard.title).toBe("Copy of Shop");
    expect(copy.json.data.dashboard.ownerId).toBe("u-peer");
    expect(copy.json.data.shares).toEqual([]);
  });

  it("exports and re-imports as a new dashboard with new panel ids", async () => {
    const created = await create();
    const exported = await call("owner", "GET", `/dashboards/${created.dashboard.id}/export`);
    expect(exported.json.data.format).toBe("chouse.dashboard/v1");
    expect(exported.json.data.id).toBe(created.dashboard.id);
    expect(exported.json.data.dashboard.panels[0].id).toBe(created.panels[0].id);
    const imported = await call("owner", "POST", "/dashboards/import", exported.json.data);
    expect(imported.status).toBe(201);
    expect(imported.json.data.dashboard.id).not.toBe(created.dashboard.id);
    expect(imported.json.data.panels[0].id).not.toBe(created.panels[0].id);
    expect((await call("owner", "POST", "/dashboards/import", { ...exported.json.data, format: "grafana" })).status).toBe(400);
  });
});

describe("running panels", () => {
  it("runs read-only with caps, native parameters and a dashboards log_comment", async () => {
    const created = await create();
    const [p] = created.panels;
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${p.id}/run`, { range: RANGE, values: {}, connectionId: null });
    expect(res.status).toBe(200);
    expect(res.json.data.kind).toBe("single");
    expect(res.json.data.connectionId).toBe("conn-1");
    expect(res.json.data.cached).toBe(false);
    expect(res.json.data.data.rows).toEqual(ROWS.data);
    expect(res.json.data.data.columns).toEqual(ROWS.meta);
    expect(sent).toHaveLength(1);
    const [q] = sent;
    expect(q.query).toContain("{chouse_from:DateTime}");
    expect(q.query).not.toContain("{{");
    expect(Object.keys(q.params).sort()).toEqual(["chouse_from", "chouse_interval_s", "chouse_to"]);
    expect(q.settings).toMatchObject({ readonly: "1", max_execution_time: 30, max_result_rows: "10000", result_overflow_mode: "throw", read_overflow_mode: "throw" });
    expect(JSON.parse(String(q.settings.log_comment))).toEqual({ source: "dashboards", dashboardId: created.dashboard.id, panelId: p.id });
  });

  it("shares one execution between viewers of the same query", async () => {
    const created = await create();
    const id = created.dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    const path = `/dashboards/${id}/panels/${created.panels[0].id}/run`;
    const first = await call("owner", "POST", path, { range: RANGE, values: {}, connectionId: null });
    const second = await call("peer", "POST", path, { range: RANGE, values: {}, connectionId: null });
    expect(first.json.data.cached).toBe(false);
    expect(second.json.data.cached).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("checks the viewer's own table access on every run, before the cache", async () => {
    const created = await create("manager", { panels: [panel({ sql: "SELECT now() AS t, count() AS v FROM secret.payments" })] });
    const id = created.dashboard.id;
    await call("manager", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    const path = `/dashboards/${id}/panels/${created.panels[0].id}/run`;
    const denied = await call("peer", "POST", path, { range: RANGE, values: {}, connectionId: null });
    expect(denied.status).toBe(403);
    expect(denied.json.error.message).toContain("secret.payments");
    expect(sent).toHaveLength(0);
  });

  it("refuses a connection the viewer may not use and a run without query:execute", async () => {
    const created = await create();
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    await call("owner", "PUT", `/dashboards/${created.dashboard.id}/shares`, { shares: [{ roleId: "role-c", canEdit: false }] });
    expect((await call("outsider", "POST", path, { range: RANGE, values: {}, connectionId: null })).status).toBe(403);
    expect((await call("viewOnly", "POST", path, { range: RANGE, values: {}, connectionId: null })).json.error.message).toContain("query:execute");
  });

  it("says to aggregate further instead of truncating", async () => {
    respond = () => new ClickHouseError({ message: "Limit for result exceeded", code: "396", type: "TOO_MANY_ROWS_OR_BYTES" });
    const created = await create();
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`, { range: RANGE, values: {}, connectionId: null });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toContain("more than 10,000 rows");
  });

  it("runs a fleet panel on every connection and reports each failure on its own", async () => {
    respond = (connectionId) => (connectionId === "conn-2" ? new ClickHouseError({ message: "Table shop.orders does not exist", code: "60", type: "UNKNOWN_TABLE" }) : ROWS);
    const created = await create("owner", { panels: [panel({ fleet: true })] });
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`, { range: RANGE, values: {}, connectionId: null });
    expect(res.status).toBe(200);
    expect(res.json.data.kind).toBe("fleet");
    expect(res.json.data.omitted).toBe(0);
    const byName = Object.fromEntries(res.json.data.connections.map((e: { connectionName: string }) => [e.connectionName, e]));
    expect(byName.alpha.ok).toBe(true);
    expect(byName.alpha.data.rows).toEqual(ROWS.data);
    expect(byName.beta).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
  });

  it("binds variable values as parameters and refuses undeclared ones", async () => {
    const variables = [{ name: "table", label: "Table", kind: "identifier", options: { source: "static", values: ["orders", "refunds"] }, default: "orders" }];
    const created = await create("owner", { variables, panels: [panel({ sql: "SELECT now() AS t, count() AS v FROM shop.{{var.table}}" })] });
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    expect((await call("owner", "POST", path, { range: RANGE, values: { table: "refunds" }, connectionId: null })).status).toBe(200);
    expect(sent[0].query).toBe("SELECT now() AS t, count() AS v FROM shop.{v_table:Identifier}");
    expect(sent[0].params).toEqual({ v_table: "refunds" });
    expect((await call("owner", "POST", path, { range: RANGE, values: { nope: "x" }, connectionId: null })).status).toBe(400);
    expect((await call("owner", "POST", path, { range: RANGE, values: { table: "x; DROP" }, connectionId: null })).status).toBe(400);
    const options = await call("owner", "POST", `/dashboards/${created.dashboard.id}/variables/table/options`, { connectionId: null });
    expect(options.json.data.values).toEqual(["orders", "refunds"]);
  });

  it("previews an unsaved panel with lint, for editors only", async () => {
    const body = { sql: "SELECT name AS t, value AS v FROM system.events", viz: { ...LINE, unit: "none" }, fleet: false, variables: [], values: {}, range: RANGE, connectionId: "conn-1" };
    expect((await call("viewOnly", "POST", "/dashboards/preview", body)).status).toBe(403);
    const res = await call("manager", "POST", "/dashboards/preview", body);
    expect(res.status).toBe(200);
    expect(res.json.data.result.kind).toBe("single");
    expect(res.json.data.lint.map((f: { code: string }) => f.code)).toEqual(["cumulative_counter", "missing_unit"]);
    const lint = await call("owner", "POST", "/dashboards/lint", { sql: body.sql, viz: body.viz });
    expect(lint.json.data.findings).toHaveLength(2);
  });
});
