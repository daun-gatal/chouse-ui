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
      return { response_headers: { "x-clickhouse-timezone": "UTC" }, json: async () => result };
    },
  }),
}));

const delivered: Array<{ title: string; text: string }> = [];
let deliveryError: string | null = null;
mock.module("../services/alerting/notify/platforms/webhook", () => ({
  postWebhook: async (_config: unknown, message: { title: string; text?: string }) => {
    if (deliveryError) throw new Error(deliveryError);
    delivered.push({ title: message.title, text: message.text ?? "" });
  },
}));

const { Hono: HonoApp } = await import("hono");
const { closeDatabase } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const { freshDatabase, rawAll, rawRun } = await import("../rbac/db/migrationTestHarness");
const { generateAccessToken } = await import("../rbac/services/jwt");
const { errorHandler } = await import("../middleware/error");
const { clearPanelCache } = await import("../services/dashboards/runner");
const { default: dashboards } = await import("./dashboards");
const { createChannel } = await import("../services/alerting/store");
const { ChannelType } = await import("../services/alerting/types");

const ALL = ["dashboards:view", "dashboards:edit", "dashboards:delete", "dashboards:share", "query:execute", "table:select", "alerting:view", "alerting:edit", "alerting:delete", "remediation:propose"];
const USERS = {
  owner: { id: "u-owner", roles: ["team-a"], permissions: ALL },
  peer: { id: "u-peer", roles: ["team-b"], permissions: ["dashboards:view", "dashboards:edit", "query:execute", "table:select"] },
  outsider: { id: "u-out", roles: ["team-c"], permissions: ["dashboards:view", "query:execute", "table:select"] },
  manager: { id: "u-mgr", roles: ["team-a"], permissions: [...ALL, "dashboards:manage"] },
  nobody: { id: "u-none", roles: ["team-d"], permissions: ["metrics:view"] },
  viewOnly: { id: "u-view", roles: ["team-d"], permissions: ["dashboards:view"] },
  observer: { id: "u-obs", roles: ["team-a"], permissions: [...ALL, "observe:view"] },
};
type UserKey = keyof typeof USERS;

const LINE = { version: 2, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null };
const LINE_V1 = { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null };
const ORDERS_SQL = "SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS v FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t ORDER BY t";
const RANGE = { kind: "relative", value: "6h" };

let app: Hono;

async function token(user: UserKey): Promise<string> {
  const u = USERS[user];
  return generateAccessToken({ sub: u.id, email: `${u.id}@test.local`, username: u.id, roles: u.roles, permissions: u.permissions, sessionId: "s1" });
}

/** `connection` is the caller's current connection, sent like the browser, CLI and MCP send it. */
async function call(user: UserKey, method: string, path: string, body?: unknown, connection: string | null = "conn-1"): Promise<{ status: number; json: { success: boolean; data?: any; error?: any } }> {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(user)}`, "Content-Type": "application/json", ...(connection === null ? {} : { "X-Connection-Id": connection }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: any; error?: any } };
}

/** A chart panel; dashboard() stacks panels without a layout one under the other. */
function panel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: null, kind: "chart", title: "Orders", sql: ORDERS_SQL, viz: LINE, fleet: false, ...overrides };
}

function dashboard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const panels = ((overrides.panels as Array<Record<string, unknown>> | undefined) ?? [panel()])
    .map((p, i) => ("layout" in p ? p : { ...p, layout: { x: 0, y: i * 9, w: 12, h: 9 } }));
  return { title: "Shop", description: "", timeRange: "6h", refreshSeconds: 60, connectionScope: { kind: "any" }, variables: [], annotations: [], ...overrides, panels };
}

/** The same dashboard as a format 1 document (CHouse 3.15 and before). */
function dashboardV1(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Shop", description: "", timeRange: "6h", refreshSeconds: 60, connectionScope: { kind: "any" }, variables: [],
    panels: [{ id: null, title: "Orders", sql: ORDERS_SQL, viz: LINE_V1, width: 6, height: "m", fleet: false }],
    ...overrides,
  };
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
  for (const [id, name] of [["role-a", "team-a"], ["role-b", "team-b"], ["role-c", "team-c"], ["role-d", "team-d"]]) {
    await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at) VALUES (${id}, ${name}, ${name}, 0, 0, 1, unixepoch(), unixepoch())`);
  }
  const membership: Array<[string, string]> = [["u-owner", "role-a"], ["u-peer", "role-b"], ["u-out", "role-c"], ["u-mgr", "role-a"], ["u-none", "role-d"], ["u-view", "role-d"], ["u-obs", "role-a"]];
  for (const [user, role] of membership) {
    await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES (${`${user}-${role}`}, ${user}, ${role}, unixepoch())`);
  }
  // gamma exists, but no rule lets anyone here use it.
  for (const [id, name] of [["conn-1", "alpha"], ["conn-2", "beta"], ["conn-3", "gamma"]]) {
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
      VALUES (${id}, ${name}, 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  }
  // team-a and team-b may read database "shop" on both connections; team-c has no access at all.
  await rawRun(sql`INSERT INTO rbac_data_access_policies (id, name, is_system, created_at, updated_at) VALUES ('pol-shop', 'shop', 0, unixepoch(), unixepoch())`);
  for (const conn of ["conn-1", "conn-2"]) {
    await rawRun(sql`INSERT INTO rbac_data_access_policy_rules (id, policy_id, connection_id, database_pattern, table_pattern, is_allowed, priority, created_at, updated_at)
      VALUES (${`rule-${conn}`}, 'pol-shop', ${conn}, 'shop', '*', 1, 0, unixepoch(), unixepoch())`);
  }
  // Alerts evaluate as their owner from the database, not from a token.
  for (const permission of ["dashboards:view", "query:execute", "table:select"]) {
    await rawRun(sql`INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
      SELECT ${`rp-a-${permission}`}, 'role-a', id, unixepoch() FROM rbac_permissions WHERE name = ${permission}`);
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
    expect(exported.json.data.format).toBe("chouse.dashboard/v2");
    expect(exported.json.data.id).toBe(created.dashboard.id);
    expect(exported.json.data.dashboard.panels[0].id).toBe(created.panels[0].id);
    const imported = await call("owner", "POST", "/dashboards/import", exported.json.data);
    expect(imported.status).toBe(201);
    expect(imported.json.data.dashboard.id).not.toBe(created.dashboard.id);
    expect(imported.json.data.panels[0].id).not.toBe(created.panels[0].id);
    expect((await call("owner", "POST", "/dashboards/import", { ...exported.json.data, format: "grafana" })).status).toBe(400);
  });
});

describe("templates", () => {
  it("lists templates for viewers and copies one for editors", async () => {
    const list = await call("viewOnly", "GET", "/dashboards/templates");
    expect(list.status).toBe(200);
    expect(list.json.data.map((t: { id: string }) => t.id)).toContain("clickhouse-overview");
    const forAlpha = { connectionScope: { kind: "only", connectionIds: ["conn-1"] } };
    expect((await call("viewOnly", "POST", "/dashboards/templates/replication/instantiate", forAlpha)).status).toBe(403);
    const copy = await call("owner", "POST", "/dashboards/templates/replication/instantiate", forAlpha);
    expect(copy.status).toBe(201);
    expect(copy.json.data.dashboard.title).toBe("Replication");
    expect(copy.json.data.dashboard.ownerId).toBe("u-owner");
    expect(copy.json.data.panels.length).toBeGreaterThan(0);
    expect(copy.json.data.dashboard.connectionScope).toEqual({ kind: "only", connectionIds: ["conn-1"] });
    expect((await call("owner", "POST", "/dashboards/templates/nope/instantiate", forAlpha)).status).toBe(404);
    expect((await call("outsider", "POST", "/dashboards/templates/replication/instantiate", forAlpha)).status).toBe(403);
    // The maker picks the connections; one they cannot use, or none at all, is refused.
    const all = await call("owner", "POST", "/dashboards/templates/replication/instantiate", { connectionScope: { kind: "any" } });
    expect(all.json.data.dashboard.connectionScope).toEqual({ kind: "any" });
    expect((await call("owner", "POST", "/dashboards/templates/replication/instantiate", { connectionScope: { kind: "only", connectionIds: ["conn-3"] } })).status).toBe(400);
    expect((await call("owner", "POST", "/dashboards/templates/replication/instantiate")).status).toBe(400);
  });
});

describe("running panels", () => {
  it("runs read-only with caps, native parameters and a dashboards log_comment", async () => {
    const created = await create();
    const [p] = created.panels;
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${p.id}/run`, { range: RANGE, values: {}});
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
    const first = await call("owner", "POST", path, { range: RANGE, values: {}});
    const second = await call("peer", "POST", path, { range: RANGE, values: {}});
    expect(first.json.data.cached).toBe(false);
    expect(second.json.data.cached).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("checks the viewer's own table access on every run, before the cache", async () => {
    const created = await create("manager", { panels: [panel({ sql: "SELECT now() AS t, count() AS v FROM secret.payments" })] });
    const id = created.dashboard.id;
    await call("manager", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    const path = `/dashboards/${id}/panels/${created.panels[0].id}/run`;
    const denied = await call("peer", "POST", path, { range: RANGE, values: {}});
    expect(denied.status).toBe(403);
    expect(denied.json.error.message).toContain("secret.payments");
    expect(sent).toHaveLength(0);
  });

  it("refuses a connection the viewer may not use and a run without query:execute", async () => {
    const created = await create();
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    await call("owner", "PUT", `/dashboards/${created.dashboard.id}/shares`, { shares: [{ roleId: "role-c", canEdit: false }] });
    expect((await call("outsider", "POST", path, { range: RANGE, values: {}})).status).toBe(403);
    expect((await call("viewOnly", "POST", path, { range: RANGE, values: {}})).json.error.message).toContain("query:execute");
  });

  it("runs on the caller's current connection and never guesses one", async () => {
    const created = await create();
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    const onBeta = await call("owner", "POST", path, { range: RANGE, values: {} }, "conn-2");
    expect(onBeta.json.data.connectionId).toBe("conn-2");
    expect(sent.map((q) => q.connectionId)).toEqual(["conn-2"]);
    const none = await call("owner", "POST", path, { range: RANGE, values: {} }, null);
    expect(none.status).toBe(400);
    expect(none.json.error.message).toBe("Pick a connection to run this on");
    expect(sent).toHaveLength(1);
  });

  it("names the connection when a table is not on it", async () => {
    respond = () => new ClickHouseError({ message: "Table shop.orders does not exist", code: "60", type: "UNKNOWN_TABLE" });
    const created = await create();
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`, { range: RANGE, values: {} }, "conn-2");
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe("beta does not have this table or database. ClickHouse: Table shop.orders does not exist");
  });

  it("says to aggregate further instead of truncating", async () => {
    respond = () => new ClickHouseError({ message: "Limit for result exceeded", code: "396", type: "TOO_MANY_ROWS_OR_BYTES" });
    const created = await create();
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`, { range: RANGE, values: {}});
    expect(res.status).toBe(400);
    expect(res.json.error.message).toContain("more than 10,000 rows");
  });

  it("runs a fleet panel on every connection and reports each failure on its own", async () => {
    respond = (connectionId) => (connectionId === "conn-2" ? new ClickHouseError({ message: "Table shop.orders does not exist", code: "60", type: "UNKNOWN_TABLE" }) : ROWS);
    const created = await create("owner", { panels: [panel({ fleet: true })] });
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`, { range: RANGE, values: {}});
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
    expect((await call("owner", "POST", path, { range: RANGE, values: { table: "refunds" }})).status).toBe(200);
    expect(sent[0].query).toBe("SELECT now() AS t, count() AS v FROM shop.{v_table:Identifier}");
    expect(sent[0].params).toEqual({ v_table: "refunds" });
    expect((await call("owner", "POST", path, { range: RANGE, values: { nope: "x" }})).status).toBe(400);
    expect((await call("owner", "POST", path, { range: RANGE, values: { table: "x; DROP" }})).status).toBe(400);
    const options = await call("owner", "POST", `/dashboards/${created.dashboard.id}/variables/table/options`);
    expect(options.json.data.values).toEqual(["orders", "refunds"]);
  });

  it("previews an unsaved panel with lint, for editors only", async () => {
    const body = { sql: "SELECT name AS t, value AS v FROM system.events", viz: { ...LINE, unit: "none" }, fleet: false, variables: [], values: {}, range: RANGE, connectionScope: { kind: "any" } };
    expect((await call("viewOnly", "POST", "/dashboards/preview", body)).status).toBe(403);
    const res = await call("manager", "POST", "/dashboards/preview", body);
    expect(res.status).toBe(200);
    expect(res.json.data.result.kind).toBe("single");
    expect(res.json.data.lint.map((f: { code: string }) => f.code)).toEqual(["cumulative_counter", "missing_unit"]);
    const lint = await call("owner", "POST", "/dashboards/lint", { sql: body.sql, viz: body.viz });
    expect(lint.json.data.findings).toHaveLength(2);
  });
});

describe("connection assignments", () => {
  const ONLY_ALPHA = { kind: "only", connectionIds: ["conn-1"] };

  it("shows a viewer the connections a dashboard is assigned to and refuses to run elsewhere", async () => {
    const created = await create("owner", { connectionScope: ONLY_ALPHA });
    expect(created.scope).toEqual({ kind: "only", connections: [{ id: "conn-1", name: "alpha" }], hidden: 0 });
    const listed = (await call("owner", "GET", "/dashboards")).json.data.find((d: { id: string }) => d.id === created.dashboard.id);
    expect(listed.scope).toEqual(created.scope);
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    expect((await call("owner", "POST", path, { range: RANGE, values: {} }, "conn-1")).status).toBe(200);
    const elsewhere = await call("owner", "POST", path, { range: RANGE, values: {} }, "conn-2");
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.json.error.message).toBe("This dashboard is not assigned to the connection you are on. It is assigned to alpha.");
    expect(sent.map((q) => q.connectionId)).toEqual(["conn-1"]);
    const preview = { sql: ORDERS_SQL, viz: LINE, fleet: false, variables: [], values: {}, range: RANGE, connectionScope: { kind: "only", connectionIds: ["conn-2"] } };
    expect((await call("owner", "POST", "/dashboards/preview", preview, "conn-1")).status).toBe(400);
  });

  it("runs a fleet panel on the assigned connections only", async () => {
    const created = await create("owner", { connectionScope: ONLY_ALPHA, panels: [panel({ fleet: true })] });
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`, { range: RANGE, values: {} });
    expect(res.json.data.connections.map((e: { connectionName: string }) => e.connectionName)).toEqual(["alpha"]);
    expect(res.json.data.omitted).toBe(0);
  });

  it("assigns only connections that exist and the saver may use, on save and on import", async () => {
    const gamma = await call("owner", "POST", "/dashboards", dashboard({ connectionScope: { kind: "only", connectionIds: ["conn-3"] } }));
    expect(gamma.status).toBe(400);
    expect(gamma.json.error.message).toBe("You cannot use the connection gamma, so you cannot assign the dashboard to it");
    const imported = await call("owner", "POST", "/dashboards/import", { format: "chouse.dashboard/v1", id: null, dashboard: dashboardV1({ connectionScope: { kind: "only", connectionIds: ["conn-9"] } }) });
    expect(imported.status).toBe(400);
    expect(imported.json.error.message).toBe("There is no connection conn-9 to assign the dashboard to");
  });

  it("keeps a connection an editor cannot use, counted but not named", async () => {
    const { createDashboard } = await import("../services/dashboards/store");
    const id = await createDashboard(dashboard({ connectionScope: { kind: "only", connectionIds: ["conn-1", "conn-3"] } }) as never, "u-owner", { userId: "u-owner", source: "ui" });
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    const seen = await call("peer", "GET", `/dashboards/${id}`);
    expect(seen.json.data.scope).toEqual({ kind: "only", connections: [{ id: "conn-1", name: "alpha" }], hidden: 1 });
    const save = await call("peer", "PUT", `/dashboards/${id}`, { version: seen.json.data.dashboard.version, dashboard: { ...dashboard(), title: "Renamed", connectionScope: { kind: "only", connectionIds: ["conn-1", "conn-3"] } } });
    expect(save.status).toBe(200);
    const elsewhere = await call("peer", "POST", `/dashboards/${id}/panels/${save.json.data.panels[0].id}/run`, { range: RANGE, values: {} }, "conn-2");
    expect(elsewhere.json.error.message).toBe("This dashboard is not assigned to the connection you are on. It is assigned to alpha, 1 connection you cannot use.");
  });
});

describe("panel alerts", () => {
  let channelId = "";
  beforeAll(async () => {
    channelId = await createChannel({ name: "ops", type: ChannelType.Webhook, config: { url: "https://hooks.test/ops" }, enabled: true });
  });

  const alertBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: "Orders spike",
    severity: "warning",
    connectionId: "conn-1",
    channelIds: [channelId],
    enabled: true,
    config: { kind: "threshold", column: "v", reduce: "max", op: ">", value: 100, forEvaluations: 1, everyMinutes: 5, range: "15m", values: {} },
    ...overrides,
  });

  it("creates, lists, checks and deletes an alert on a panel", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const panelId = created.panels[0].id;
    const made = await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody());
    expect(made.status).toBe(201);
    expect(made.json.data).toMatchObject({ name: "Orders spike", ownerId: "u-owner", channelIds: [channelId] });
    const list = await call("owner", "GET", `/dashboards/${id}/alerts`);
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].status.state).toBe("ok");
    const all = await call("owner", "GET", "/dashboards/alerts");
    expect(all.json.data.find((a: { id: string }) => a.id === made.json.data.id).dashboardTitle).toBe("Shop");
    const check = await call("owner", "POST", `/dashboards/${id}/alerts/${made.json.data.id}/check`);
    expect(check.json.data).toEqual({ kind: "value", value: 7, breached: false });
    expect((await call("owner", "DELETE", `/dashboards/${id}/alerts/${made.json.data.id}`)).status).toBe(200);
    expect((await call("owner", "GET", `/dashboards/${id}/alerts`)).json.data).toEqual([]);
  });

  it("refuses alerts that could never evaluate", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const panelId = created.panels[0].id;
    const notY = await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody({ config: { ...(alertBody().config as object), column: "t" } }));
    expect(notY.status).toBe(400);
    expect(notY.json.error.message).toContain("y columns: v");
    expect((await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody({ channelIds: ["nope"] }))).status).toBe(400);
    expect((await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody({ config: { ...(alertBody().config as object), values: { db: "x" } } }))).status).toBe(400);
    expect((await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody({ connectionId: "conn-x" }))).status).toBe(403);
  });

  it("keeps alerts on the dashboard's connections", async () => {
    const created = await create("owner", { connectionScope: { kind: "only", connectionIds: ["conn-1", "conn-2"] } });
    const id = created.dashboard.id;
    const panelId = created.panels[0].id;
    expect((await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody({ connectionId: "conn-2" }))).status).toBe(201);
    const narrowed = await call("owner", "PUT", `/dashboards/${id}`, { version: created.dashboard.version, dashboard: dashboard({ panels: [{ ...panel(), id: panelId }], connectionScope: { kind: "only", connectionIds: ["conn-1"] } }) });
    expect(narrowed.status).toBe(400);
    expect(narrowed.json.error.message).toBe('The alert "Orders spike" watches a connection this would remove from the dashboard. Delete the alert or keep that connection.');
    const onlyAlpha = await create("owner", { connectionScope: { kind: "only", connectionIds: ["conn-1"] } });
    const outside = await call("owner", "POST", `/dashboards/${onlyAlpha.dashboard.id}/panels/${onlyAlpha.panels[0].id}/alerts`, alertBody({ connectionId: "conn-2" }));
    expect(outside.status).toBe(400);
    expect(outside.json.error.message).toContain("not assigned to the connection");
    const fleet = await create("owner", { panels: [panel({ fleet: true })] });
    const onFleet = await call("owner", "POST", `/dashboards/${fleet.dashboard.id}/panels/${fleet.panels[0].id}/alerts`, alertBody());
    expect(onFleet.status).toBe(400);
    expect(onFleet.json.error.message).toContain("across the fleet");
  });

  it("needs alerting permissions and edit access", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const path = `/dashboards/${id}/panels/${created.panels[0].id}/alerts`;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    expect((await call("peer", "POST", path, alertBody())).status).toBe(403);
    expect((await call("peer", "GET", `/dashboards/${id}/alerts`)).status).toBe(403);
    expect((await call("viewOnly", "GET", "/dashboards/alerts")).status).toBe(403);
  });

  it("goes with its panel when a save removes the panel", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const made = await call("owner", "POST", `/dashboards/${id}/panels/${created.panels[0].id}/alerts`, alertBody());
    expect(made.status).toBe(201);
    const saved = await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ panels: [panel({ title: "Replacement" })] }) });
    expect(saved.status).toBe(200);
    expect((await call("owner", "GET", `/dashboards/${id}/alerts`)).json.data).toEqual([]);
  });

  it("tells every viewer how many alerts each panel has", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const panelId = created.panels[0].id;
    await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody());
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    expect((await call("peer", "GET", `/dashboards/${id}`)).json.data.alertCounts).toEqual({ [panelId]: 1 });
  });

  it("refuses a save that turns a watched panel into a text panel", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const panelId = created.panels[0].id;
    await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, alertBody());
    const asText = await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ panels: [{ id: panelId, kind: "text", title: "", markdown: "gone", layout: { x: 0, y: 0, w: 6, h: 4 } }] }) });
    expect(asText.status).toBe(400);
    expect(asText.json.error.message).toBe('The alert "Orders spike" watches a panel this would turn into a text panel. Delete the alert first.');
  });
});

describe("format 1 documents (CHouse 3.15 and before)", () => {
  it("creates from a format 1 body, laid out as the old grid placed it", async () => {
    const res = await call("owner", "POST", "/dashboards", dashboardV1({ panels: [
      { id: null, title: "A", sql: ORDERS_SQL, viz: LINE_V1, width: 6, height: "s", fleet: false },
      { id: null, title: "B", sql: ORDERS_SQL, viz: LINE_V1, width: 6, height: "l", fleet: false },
      { id: null, title: "C", sql: ORDERS_SQL, viz: LINE_V1, width: 12, height: "m", fleet: false },
    ] }));
    expect(res.status).toBe(201);
    expect(res.json.data.panels.map((p: { title: string; layout: unknown }) => [p.title, p.layout])).toEqual([
      ["A", { x: 0, y: 0, w: 12, h: 12 }],
      ["B", { x: 12, y: 0, w: 12, h: 12 }],
      ["C", { x: 0, y: 12, w: 24, h: 9 }],
    ]);
    expect(res.json.data.panels[0].viz).toEqual(LINE);
    expect(res.json.data.dashboard.annotations).toEqual(["ddl", "upgrades", "settings", "writers", "alerts", "incidents", "fixes", "notes"]);
  });

  it("updates in place from a format 1 body, keeping panel ids (and so their alerts)", async () => {
    const created = await create();
    const panelId = created.panels[0].id;
    const res = await call("owner", "PUT", `/dashboards/${created.dashboard.id}`, { version: 1, dashboard: dashboardV1({ title: "Renamed", panels: [{ id: panelId, title: "Orders", sql: ORDERS_SQL, viz: LINE_V1, width: 12, height: "l", fleet: false }] }) });
    expect(res.status).toBe(200);
    expect(res.json.data.panels[0]).toMatchObject({ id: panelId, layout: { x: 0, y: 0, w: 24, h: 12 } });
  });

  it("imports a format 1 export file as it was written, and the export comes back as format 2", async () => {
    const imported = await call("owner", "POST", "/dashboards/import", { format: "chouse.dashboard/v1", id: "old-id", dashboard: dashboardV1() });
    expect(imported.status).toBe(201);
    expect(imported.json.data.panels[0].layout).toEqual({ x: 0, y: 0, w: 12, h: 9 });
    const exported = await call("owner", "GET", `/dashboards/${imported.json.data.dashboard.id}/export`);
    expect(exported.json.data.format).toBe("chouse.dashboard/v2");
    expect(exported.json.data.dashboard.panels[0]).not.toHaveProperty("width");
  });

  it("refuses a document that mixes the formats, and a v1 export that holds a v2 dashboard", async () => {
    const mixed = await call("owner", "POST", "/dashboards", { ...dashboardV1(), annotations: [] });
    expect(mixed.status).toBe(400);
    expect(mixed.json.error.message).toContain("this panel uses the format 1 width and height");
    expect((await call("owner", "POST", "/dashboards/import", { format: "chouse.dashboard/v1", id: null, dashboard: dashboard() })).status).toBe(400);
  });
});

describe("panel kinds", () => {
  it("saves headings and text panels, and runs only charts", async () => {
    const created = await create("owner", { panels: [
      { id: null, kind: "heading", title: "Ingestion", description: "Rows in", layout: { x: 0, y: 0, w: 24, h: 2 } },
      panel({ layout: { x: 0, y: 2, w: 16, h: 9 } }),
      { id: null, kind: "text", title: "Runbook", markdown: "Page **#oncall**", layout: { x: 16, y: 2, w: 8, h: 9 } },
    ] });
    expect(created.panels.map((p: { kind: string }) => p.kind)).toEqual(["heading", "chart", "text"]);
    expect(created.panels[2].markdown).toBe("Page **#oncall**");
    expect(Object.keys(created.lint)).toEqual([created.panels[1].id]);
    const text = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[2].id}/run`, { range: RANGE, values: {} });
    expect(text.status).toBe(400);
    expect(text.json.error.message).toBe("This is a text panel; only chart panels run queries");
  });

  it("refuses overlapping panels, naming both", async () => {
    const res = await call("owner", "POST", "/dashboards", dashboard({ panels: [panel({ layout: { x: 0, y: 0, w: 12, h: 9 } }), panel({ title: "Other", layout: { x: 8, y: 4, w: 12, h: 9 } })] }));
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe("Panel 1 (Orders) and Panel 2 (Other) overlap");
  });
});

describe("multi-value variables", () => {
  it("run with a list as an Array(String) parameter, and refuse an empty list or a list for a single-value variable", async () => {
    const tables = { name: "tables", label: "Tables", kind: "multi", options: { source: "static", values: ["orders", "refunds"] }, default: ["orders"] };
    const user = { name: "user", label: "User", kind: "string", options: { source: "static", values: ["a"] }, default: "a" };
    const created = await create("owner", { variables: [tables, user], panels: [panel({ sql: "SELECT now() AS t, count() AS v FROM shop.orders WHERE kind IN {{var.tables}} AND user = {{var.user}}" })] });
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    expect((await call("owner", "POST", path, { range: RANGE, values: { tables: ["orders", "refunds"] } })).status).toBe(200);
    expect(sent[0].query).toContain("{v_tables:Array(String)}");
    expect(sent[0].params).toEqual({ v_tables: ["orders", "refunds"], v_user: "a" });
    const empty = await call("owner", "POST", path, { range: RANGE, values: { tables: [] } });
    expect(empty.status).toBe(400);
    expect(empty.json.error.message).toBe("Pick at least one value for Tables");
    expect((await call("owner", "POST", path, { range: RANGE, values: { user: ["a", "b"] } })).json.error.message).toBe("Variable User takes one value, not a list");
  });
});

describe("drill-down links", () => {
  it("must name a dashboard the saver can view, and only its variables", async () => {
    const target = await create("owner", { variables: [{ name: "table", label: "Table", kind: "string", options: { source: "static", values: ["orders"] }, default: "orders" }] });
    const link = (dashboardId: string, values: Record<string, unknown>): Record<string, unknown> => panel({ viz: { ...LINE, type: "bar", links: [{ kind: "dashboard", label: "Details", dashboardId, values }] } });
    const ok = await call("owner", "POST", "/dashboards", dashboard({ panels: [link(target.dashboard.id, { table: { from: "column", column: "t" } })] }));
    expect(ok.status).toBe(201);
    const unknownVariable = await call("owner", "POST", "/dashboards", dashboard({ panels: [link(target.dashboard.id, { db: { from: "value", value: "x" } })] }));
    expect(unknownVariable.json.error.message).toBe('Panel 1 (Orders), link "Details": Shop has no variable db');
    const missing = await call("owner", "POST", "/dashboards", dashboard({ panels: [link("6f1c2a8e-3b7d-4c55-9a1e-2f0b9d4c7e11", {})] }));
    expect(missing.json.error.message).toBe('Panel 1 (Orders), link "Details": there is no dashboard 6f1c2a8e-3b7d-4c55-9a1e-2f0b9d4c7e11 you can view');
    // The peer cannot see the owner's dashboard, so cannot link to it either.
    const hidden = await call("peer", "POST", "/dashboards", dashboard({ panels: [link(target.dashboard.id, {})] }));
    expect(hidden.status).toBe(400);
  });
});

describe("layout engine", () => {
  it("arranges sections of new panels by role, with headings", async () => {
    const res = await call("owner", "POST", "/dashboards/layout", {
      mode: "arrange",
      sections: [{ heading: { title: "Throughput", description: "" }, panels: [
        { key: "trend", kind: "chart", chartType: "line", role: "trend", importance: "primary", size: null },
        { key: "kpi", kind: "chart", chartType: "stat", role: "kpi", importance: "secondary", size: null },
      ] }],
    });
    expect(res.status).toBe(200);
    expect(res.json.data.placed).toEqual([
      { key: null, heading: { title: "Throughput", description: "" }, layout: { x: 0, y: 0, w: 24, h: 2 } },
      { key: "kpi", layout: { x: 0, y: 2, w: 24, h: 4 } },
      { key: "trend", layout: { x: 0, y: 6, w: 24, h: 9 } },
    ]);
  });

  it("refuses a chart its role does not allow, a role on a text panel and duplicate keys", async () => {
    const one = (p: Record<string, unknown>): Record<string, unknown> => ({ mode: "arrange", sections: [{ heading: null, panels: [p] }] });
    const misfit = await call("owner", "POST", "/dashboards/layout", one({ key: "a", kind: "chart", chartType: "line", role: "kpi", importance: "secondary", size: null }));
    expect(misfit.json.error.message).toBe("Panel a: a kpi panel is drawn as stat, not line");
    expect((await call("owner", "POST", "/dashboards/layout", one({ key: "a", kind: "text", chartType: null, role: "trend", importance: "secondary", size: { w: 6, h: 4 } }))).status).toBe(400);
    const dup = { mode: "tidy", panels: [{ key: "a", kind: "text", chartType: null, size: { w: 6, h: 4 } }, { key: "a", kind: "text", chartType: null, size: { w: 6, h: 4 } }] };
    expect((await call("owner", "POST", "/dashboards/layout", dup)).json.error.message).toBe("A panel key is listed twice");
    expect((await call("viewOnly", "POST", "/dashboards/layout", dup)).status).toBe(403);
  });

  it("tidies an existing dashboard's panels", async () => {
    const res = await call("owner", "POST", "/dashboards/layout", { mode: "tidy", panels: [
      { key: "t", kind: "chart", chartType: "table", size: { w: 6, h: 5 } },
      { key: "s", kind: "chart", chartType: "stat", size: { w: 3, h: 3 } },
    ] });
    expect(res.json.data.placed).toEqual([
      { key: "s", layout: { x: 0, y: 0, w: 24, h: 4 } },
      { key: "t", layout: { x: 0, y: 4, w: 24, h: 10 } },
    ]);
  });
});

describe("version history", () => {
  it("records every save with where it came from, and restores an old version as a new one", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const saved = await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ title: "Renamed" }) });
    expect(saved.status).toBe(200);
    const versions = await call("owner", "GET", `/dashboards/${id}/versions`);
    expect(versions.json.data.map((v: { version: number; source: string; savedByName: string }) => [v.version, v.source, v.savedByName])).toEqual([[2, "ui", "u-owner"], [1, "ui", "u-owner"]]);
    const first = await call("owner", "GET", `/dashboards/${id}/versions/1`);
    expect(first.json.data.document.title).toBe("Shop");
    expect(first.json.data.document.panels[0].id).toBe(created.panels[0].id);
    const stale = await call("owner", "POST", `/dashboards/${id}/versions/1/restore`, { currentVersion: 1 });
    expect(stale.status).toBe(409);
    const restored = await call("owner", "POST", `/dashboards/${id}/versions/1/restore`, { currentVersion: 2 });
    expect(restored.status).toBe(200);
    expect(restored.json.data.dashboard).toMatchObject({ title: "Shop", version: 3 });
    expect((await call("owner", "GET", `/dashboards/${id}/versions`)).json.data[0]).toMatchObject({ version: 3, source: "restore" });
    expect((await call("owner", "GET", `/dashboards/${id}/versions/99`)).status).toBe(404);
    expect((await call("owner", "GET", `/dashboards/${id}/versions/abc`)).status).toBe(400);
  });

  it("lists the alerts a restore would delete, and needs edit access", async () => {
    const created = await create();
    const id = created.dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ panels: [panel({ title: "New" })] }) });
    const fresh = (await call("owner", "GET", `/dashboards/${id}`)).json.data;
    const channel = await createChannel({ name: "restore-ops", type: ChannelType.Webhook, config: { url: "https://hooks.test/restore" }, enabled: true });
    const made = await call("owner", "POST", `/dashboards/${id}/panels/${fresh.panels[0].id}/alerts`, {
      name: "Orders spike", severity: "warning", connectionId: "conn-1", channelIds: [channel], enabled: true,
      config: { kind: "threshold", column: "v", reduce: "max", op: ">", value: 100, forEvaluations: 1, everyMinutes: 5, range: "15m", values: {} },
    });
    expect(made.status).toBe(201);
    const preview = await call("owner", "GET", `/dashboards/${id}/versions/1/restore-preview`);
    expect(preview.json.data).toEqual({ removedPanels: 1, removedAlerts: [{ id: expect.any(String), name: "Orders spike" }] });
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-c", canEdit: false }] });
    expect((await call("outsider", "GET", `/dashboards/${id}/versions`)).status).toBe(200);
    expect((await call("outsider", "GET", `/dashboards/${id}/versions/1/restore-preview`)).status).toBe(403);
  });

  it("marks imports, duplicates and template copies, and keeps the last 50 versions", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const copy = await call("owner", "POST", `/dashboards/${id}/duplicate`);
    expect((await call("owner", "GET", `/dashboards/${copy.json.data.dashboard.id}/versions`)).json.data[0].source).toBe("duplicate");
    let version = 1;
    for (let i = 0; i < 51; i++) {
      const res = await call("owner", "PUT", `/dashboards/${id}`, { version, dashboard: dashboard({ title: `Save ${i}` }) });
      version = res.json.data.dashboard.version;
    }
    const kept = (await call("owner", "GET", `/dashboards/${id}/versions`)).json.data;
    expect(kept).toHaveLength(50);
    expect(kept[0].version).toBe(52);
    expect(kept[49].version).toBe(3);
  });
});

describe("compare with an earlier window", () => {
  it("runs a line chart a day or a week earlier, with every check, and refuses what cannot be compared", async () => {
    const created = await create();
    const path = `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/run`;
    const now = await call("owner", "POST", path, { range: RANGE, values: {} });
    const week = await call("owner", "POST", path, { range: RANGE, values: {}, shiftSeconds: 604_800 });
    expect(week.status).toBe(200);
    expect(week.json.data.window.from).toBe(now.json.data.window.from - 604_800);
    expect(week.json.data.window.intervalSeconds).toBe(now.json.data.window.intervalSeconds);
    expect(sent[1].params.chouse_to).toBe(Number(sent[0].params.chouse_to) - 604_800);
    expect((await call("owner", "POST", path, { range: RANGE, values: {}, shiftSeconds: 3_600 })).status).toBe(400);
    const stat = await create("owner", { panels: [panel({ viz: { ...LINE, type: "stat", x: null, reduce: "last" } })] });
    const refused = await call("owner", "POST", `/dashboards/${stat.dashboard.id}/panels/${stat.panels[0].id}/run`, { range: RANGE, values: {}, shiftSeconds: 86_400 });
    expect(refused.json.error.message).toBe("Compare needs a line or area chart");
    const fleet = await create("owner", { panels: [panel({ fleet: true })] });
    expect((await call("owner", "POST", `/dashboards/${fleet.dashboard.id}/panels/${fleet.panels[0].id}/run`, { range: RANGE, values: {}, shiftSeconds: 86_400 })).json.error.message)
      .toBe("Compare runs on one connection; this panel runs across the fleet");
  });
});

describe("annotations and notes", () => {
  it("reads each source on its own: events, or why not, never a silent gap", async () => {
    const created = await create("observer");
    await call("observer", "PUT", `/dashboards/${created.dashboard.id}/shares`, { shares: [{ roleId: "role-a", canEdit: false }] });
    const id = created.dashboard.id;
    const at = Date.now() - 60_000;
    await rawRun(sql`INSERT INTO obs_change_events (id, connection_id, kind, occurred_at, node, object_ref, summary, details)
      VALUES ('ddl:1', 'conn-1', 'ddl', ${at}, NULL, 'shop.orders', 'ALTER TABLE shop.orders ADD COLUMN x UInt8', '{"kind":"Alter","user":"alice"}'),
             ('ddl:2', 'conn-1', 'ddl', ${at}, NULL, 'secret.payments', 'ALTER TABLE secret.payments DROP COLUMN card', '{"kind":"Alter","user":"bob"}'),
             ('ddl:3', 'conn-2', 'ddl', ${at}, NULL, 'shop.orders', 'ALTER on beta', '{"kind":"Alter"}'),
             ('ver:1', 'conn-1', 'version', ${at}, 'ch-1', NULL, '25.3 → 25.8', '{}')`);
    const res = await call("observer", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["ddl", "upgrades", "notes"] });
    expect(res.status).toBe(200);
    const [ddl, upgrades, notes] = res.json.data.sources;
    expect(ddl).toMatchObject({ source: "ddl", ok: true, truncated: false });
    // secret.payments is not readable by team-a, and conn-2's events are not on view.
    expect(ddl.events.map((e: { title: string; detail: string }) => [e.title, e.detail])).toEqual([["ALTER shop.orders", "ALTER TABLE shop.orders ADD COLUMN x UInt8 — by alice"]]);
    expect(upgrades.events[0].title).toBe("Upgraded ch-1: 25.3 → 25.8");
    expect(notes).toEqual({ source: "notes", ok: true, events: [], truncated: false });
    // Without observe:view the change sources say why.
    const owner = await call("owner", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["ddl", "alerts"] });
    expect(owner.json.data.sources).toEqual([
      { source: "ddl", ok: false, error: "Needs observe:view" },
      { source: "alerts", ok: true, events: [], truncated: false },
    ]);
    expect((await call("owner", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["tweets"] })).status).toBe(400);
  });

  it("shows this dashboard's alert events on the connection they watch", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const channel = await createChannel({ name: "notes-ops", type: ChannelType.Webhook, config: { url: "https://hooks.test/n" }, enabled: true });
    const alert = await call("owner", "POST", `/dashboards/${id}/panels/${created.panels[0].id}/alerts`, {
      name: "Orders spike", severity: "warning", connectionId: "conn-1", channelIds: [channel], enabled: true,
      config: { kind: "threshold", column: "v", reduce: "max", op: ">", value: 100, forEvaluations: 1, everyMinutes: 5, range: "15m", values: {} },
    });
    const at = Date.now() - 120_000;
    await rawRun(sql`INSERT INTO alert_events (id, rule_id, severity, fired_at, payload, delivered_to) VALUES ('ev-1', ${alert.json.data.id}, 'warning', ${at}, ${JSON.stringify({ title: "🟠 Orders spike", text: "max of v is 120" })}, '[]')`);
    const onAlpha = await call("owner", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["alerts"] });
    expect(onAlpha.json.data.sources[0].events).toEqual([{ id: "alert:ev-1", source: "alerts", at, title: "🟠 Orders spike", detail: "max of v is 120", objectRef: null }]);
    const onBeta = await call("owner", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["alerts"] }, "conn-2");
    expect(onBeta.json.data.sources[0].events).toEqual([]);
  });

  it("adds notes for editors, on the connection on view, and lets the author or an editor delete them", async () => {
    const created = await create();
    const id = created.dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    const at = Date.now() - 30_000;
    expect((await call("peer", "POST", `/dashboards/${id}/notes`, { at, text: "x" })).status).toBe(403);
    expect((await call("owner", "POST", `/dashboards/${id}/notes`, { at, text: "  " })).status).toBe(400);
    expect((await call("owner", "POST", `/dashboards/${id}/notes`, { at, text: "x".repeat(501) })).status).toBe(400);
    const note = await call("owner", "POST", `/dashboards/${id}/notes`, { at, text: "Backfill finished" });
    expect(note.status).toBe(201);
    const listed = await call("peer", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["notes"] });
    expect(listed.json.data.sources[0].events).toEqual([{ id: note.json.data.id, source: "notes", at, title: "Backfill finished", detail: null, objectRef: null, authorId: "u-owner", authorName: "u-owner" }]);
    expect((await call("peer", "POST", `/dashboards/${id}/annotations`, { range: RANGE, sources: ["notes"] }, "conn-2")).json.data.sources[0].events).toEqual([]);
    expect((await call("peer", "DELETE", `/dashboards/${id}/notes/${note.json.data.id}`)).status).toBe(403);
    expect((await call("owner", "DELETE", `/dashboards/${id}/notes/${note.json.data.id}`)).status).toBe(200);
    expect((await call("owner", "DELETE", `/dashboards/${id}/notes/${note.json.data.id}`)).status).toBe(404);
    const audit = await rawAll(sql`SELECT action FROM rbac_audit_logs WHERE resource_id = ${id} AND action LIKE 'dashboard.note%' ORDER BY created_at`);
    expect(audit.map((a) => a.action)).toEqual(["dashboard.note_create", "dashboard.note_delete"]);
  });
});

describe("expected-range bands", () => {
  const BANDED = { ...LINE, baseline: { weeks: 2 } };

  it("runs the panel for the past weeks, through the pipeline, and says when the band is still learning", async () => {
    const { clearBaselineCache } = await import("../services/dashboards/baseline");
    clearBaselineCache();
    const plain = await create();
    expect((await call("owner", "POST", `/dashboards/${plain.dashboard.id}/panels/${plain.panels[0].id}/baseline`, { range: RANGE, values: {} })).json.error.message).toBe("This panel does not draw an expected-range band");
    const created = await create("owner", { panels: [panel({ viz: BANDED })] });
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/baseline`, { range: RANGE, values: {} });
    expect(res.status).toBe(200);
    // The mock returns the same two buckets for every week, so nothing lines up with the current ones.
    expect(res.json.data).toEqual({ state: "learning", weeks: 2, points: [], reason: "Only 0 of the past 2 weeks returned data; a band needs at least 2" });
    expect(sent).toHaveLength(3);
    const week = 604_800;
    expect(Number(sent[0].params.chouse_to) - Number(sent[1].params.chouse_to)).toBeLessThanOrEqual(week);
    expect(Number(sent[1].params.chouse_to) % 900).toBe(0);
    expect(Number(sent[1].params.chouse_to) - Number(sent[2].params.chouse_to)).toBe(week);
    // The earlier weeks are kept 15 minutes; only the current window runs again.
    await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${created.panels[0].id}/baseline`, { range: RANGE, values: {} });
    expect(sent).toHaveLength(3);
  });

  it("accepts an outside-band alert only on a panel with a band, and keeps the band while the alert is there", async () => {
    const channel = await createChannel({ name: "band-ops", type: ChannelType.Webhook, config: { url: "https://hooks.test/b" }, enabled: true });
    const body = { name: "Unusual orders", severity: "warning", connectionId: "conn-1", channelIds: [channel], enabled: true, config: { kind: "outside_band", column: "v", forEvaluations: 2, everyMinutes: 5, range: "6h", values: {} } };
    const plain = await create();
    const refused = await call("owner", "POST", `/dashboards/${plain.dashboard.id}/panels/${plain.panels[0].id}/alerts`, body);
    expect(refused.json.error.message).toContain("needs a panel that draws an expected-range band");
    const banded = await create("owner", { panels: [panel({ viz: BANDED })] });
    const id = banded.dashboard.id;
    const panelId = banded.panels[0].id;
    expect((await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/alerts`, body)).status).toBe(201);
    const off = await call("owner", "PUT", `/dashboards/${id}`, { version: 1, dashboard: dashboard({ panels: [panel({ id: panelId })] }) });
    expect(off.json.error.message).toBe('The alert "Unusual orders" watches this panel\'s expected-range band, which this would turn off. Delete the alert first.');
  });
});

describe("annotations as a GET", () => {
  it("reads the same sources from query parameters, and refuses an unknown source", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const res = await call("owner", "GET", `/dashboards/${id}/annotations?range=6h&sources=notes,alerts`);
    expect(res.status).toBe(200);
    expect(res.json.data.sources.map((s: { source: string }) => s.source).sort()).toEqual(["alerts", "notes"]);
    const every = await call("owner", "GET", `/dashboards/${id}/annotations?range=1h`);
    expect(every.json.data.sources).toHaveLength(8);
    expect((await call("owner", "GET", `/dashboards/${id}/annotations?range=1h&sources=gossip`)).status).toBe(400);
    expect((await call("owner", "GET", `/dashboards/${id}/annotations?range=5h`)).status).toBe(400);
  });
});

describe("snapshots", () => {
  const NOW_S = Math.floor(Date.now() / 1000);
  const body = (overrides: Record<string, unknown> = {}) => ({ name: "Incident 42", from: NOW_S - 3600, to: NOW_S - 60, values: {}, roleIds: [], expiresInDays: 7, incidentId: null, ...overrides });

  it("freezes each chart panel for the range, and opens only for its creator and roles that still see the dashboard", async () => {
    const created = await create("owner", { panels: [panel(), { id: null, kind: "text", title: "", markdown: "notes" }, panel({ title: "Broken", sql: "SELECT 1 AS t, 2 AS v FROM shop.missing" })] });
    const id = created.dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }, { roleId: "role-c", canEdit: false }] });
    respond = (_conn, query) => (query.includes("shop.missing") ? new Error("Table shop.missing does not exist") : ROWS);
    const res = await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ roleIds: ["role-b", "role-c"] }));
    expect(res.status).toBe(201);
    const snapshotId = res.json.data.id;
    expect(res.json.data).toMatchObject({ name: "Incident 42", connectionId: "conn-1", range: { from: NOW_S - 3600, to: NOW_S - 60 }, roleIds: ["role-b", "role-c"] });
    // Both chart panels ran; the range is absolute, so the time-bounded one ran for exactly it.
    expect(sent).toHaveLength(2);
    const timed = sent.find((q) => q.query.includes("shop.orders"));
    expect([timed?.params.chouse_from, timed?.params.chouse_to]).toEqual([NOW_S - 3600, NOW_S - 60]);

    sent.length = 0;
    const opened = await call("peer", "GET", `/dashboards/${id}/snapshots/${snapshotId}`);
    expect(opened.status).toBe(200);
    const [orders, , broken] = opened.json.data.document.panels;
    expect(opened.json.data.results[orders.id]).toMatchObject({ ok: true, kind: "single", data: { rows: ROWS.data } });
    expect(opened.json.data.results[broken.id]).toEqual({ ok: false, error: expect.stringContaining("shop.missing") });
    // Opening never runs anything.
    expect(sent).toEqual([]);

    // team-c sees the dashboard but may not read shop: the data is withheld, not shown.
    const denied = await call("outsider", "GET", `/dashboards/${id}/snapshots/${snapshotId}`);
    expect(denied.json.data.results[orders.id]).toEqual({ ok: false, error: "Access denied" });

    expect((await call("peer", "GET", `/dashboards/${id}/snapshots`)).json.data.map((s: { id: string }) => s.id)).toEqual([snapshotId]);
    // Unshared, the role no longer sees the dashboard, so not the snapshot either.
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-c", canEdit: false }] });
    expect((await call("peer", "GET", `/dashboards/${id}/snapshots/${snapshotId}`)).status).toBe(404);
    // A manager sees the dashboard but holds none of the snapshot's roles.
    expect((await call("manager", "GET", `/dashboards/${id}/snapshots/${snapshotId}`)).status).toBe(404);
  });

  it("refuses a range that ends in the future, roles the dashboard is not shared with, and an unknown incident", async () => {
    const created = await create();
    const id = created.dashboard.id;
    expect((await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ to: NOW_S + 3600 }))).json.error.message).toBe("A snapshot's range cannot end in the future");
    expect((await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ from: NOW_S - 60, to: NOW_S - 3600 }))).json.error.message).toBe("A snapshot's range must end after it starts");
    expect((await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ roleIds: ["role-b"] }))).json.error.message).toBe("A snapshot can only be opened by roles the dashboard is shared with");
    expect((await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ incidentId: "nope" }))).json.error.message).toBe("That incident does not exist");
    expect((await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ expiresInDays: 400 }))).status).toBe(400);
    expect((await call("viewOnly", "POST", `/dashboards/${id}/snapshots`, body())).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("refuses results over 10 MiB whole, instead of cutting them down", async () => {
    const created = await create();
    const big = "x".repeat(1_200);
    respond = () => ({ ...ROWS, data: Array.from({ length: 10_000 }, (_, i) => ({ t: "2026-10-17 00:00:00", v: i, s: big })), rows: 10_000 });
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/snapshots`, body());
    expect(res.status).toBe(413);
    expect(res.json.error.message).toMatch(/^The snapshot's results are 1\d\.\d MiB; the limit is 10\.0 MiB/);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_snapshots WHERE dashboard_id = ${created.dashboard.id}`)).toEqual([]);
  });

  it("hides an expired snapshot, sweeps it, and lets only the creator or an editor delete one", async () => {
    const created = await create();
    const id = created.dashboard.id;
    await call("owner", "PUT", `/dashboards/${id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    const keep = (await call("owner", "POST", `/dashboards/${id}/snapshots`, body({ roleIds: ["role-b"] }))).json.data.id;
    const old = (await call("owner", "POST", `/dashboards/${id}/snapshots`, body())).json.data.id;
    await rawRun(sql`UPDATE dashboard_snapshots SET expires_at = 1 WHERE id = ${old}`);
    expect((await call("owner", "GET", `/dashboards/${id}/snapshots/${old}`)).json.error.message).toBe("This snapshot has expired");
    expect((await call("owner", "GET", `/dashboards/${id}/snapshots`)).json.data.map((s: { id: string }) => s.id)).toEqual([keep]);
    const { deleteExpiredSnapshots } = await import("../services/dashboards/snapshots");
    expect(await deleteExpiredSnapshots()).toBeGreaterThanOrEqual(1);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_snapshots WHERE id = ${old}`)).toEqual([]);

    expect((await call("peer", "DELETE", `/dashboards/${id}/snapshots/${keep}`)).status).toBe(403);
    expect((await call("owner", "DELETE", `/dashboards/${id}/snapshots/${keep}`)).status).toBe(200);
    expect((await call("owner", "GET", `/dashboards/${id}/snapshots/${keep}`)).status).toBe(404);
  });

  it("goes with its dashboard", async () => {
    const created = await create();
    const id = created.dashboard.id;
    await call("owner", "POST", `/dashboards/${id}/snapshots`, body());
    expect((await call("owner", "DELETE", `/dashboards/${id}`)).status).toBe(200);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_snapshots WHERE dashboard_id = ${id}`)).toEqual([]);
  });
});

describe("panel cost and rollups", () => {
  const ROLLABLE = "SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS v FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t ORDER BY t";
  const TYPES = [{ name: "bucket", type: "DateTime" }, { name: "a_v", type: "AggregateFunction(count)" }];
  const clickhouse = (_conn: string, query: string): unknown => {
    if (query.startsWith("DESCRIBE")) return TYPES;
    if (query.includes("system.tables")) return [{ value: 0 }];
    return ROWS;
  };

  it("reports what a run reads, per hour at the refresh, and whether a rollup can serve it", async () => {
    const created = await create("owner", { panels: [panel({ sql: ROLLABLE }), panel({ title: "Raw", sql: "SELECT 1 AS t, 2 AS v" })] });
    const [rollable, raw] = created.panels;
    const res = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${rollable.id}/cost`, { range: RANGE, values: {} });
    expect(res.json.data).toMatchObject({ readBytes: 100, readRows: 10, refreshSeconds: 60, readsPerHour: 60, bytesPerHour: 6000, heavy: false, rollup: { eligible: true, source: "shop.orders" } });
    expect(res.json.data.rollup.target).toMatch(/^shop\.chouse_rollup_[0-9a-f]{12}$/);
    const other = await call("owner", "POST", `/dashboards/${created.dashboard.id}/panels/${raw.id}/cost`, { range: RANGE, values: {} });
    expect(other.json.data.rollup).toEqual({ eligible: false, reason: "it reads no table" });
  });

  it("proposes the rollup as a class 2 action, and switches the panel only while its query is unchanged", async () => {
    respond = clickhouse;
    const created = await create("owner", { panels: [panel({ sql: ROLLABLE })] });
    const id = created.dashboard.id;
    const panelId = created.panels[0].id;
    const res = await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/rollup`, { backfillDays: 7, cluster: null });
    expect(res.status).toBe(201);
    const action = res.json.data;
    expect(action).toMatchObject({ type: "create_panel_rollup", approvalClass: 2, status: "proposed", connectionId: "conn-1" });
    expect(action.prior.rollup).toEqual({ panelSql: ROLLABLE, types: { bucket: "DateTime", a_v: "AggregateFunction(count)" } });
    expect(sent.some((q) => q.query.startsWith("DESCRIBE TABLE (SELECT toStartOfMinute(`ts`) AS `bucket`, countState() AS `a_v` FROM `shop`.`orders`"))).toBe(true);

    const { switchPanelToRollup } = await import("../services/dashboards/rollupAction");
    expect(await switchPanelToRollup(action.params, action.prior, "u-owner")).toBeNull();
    const after = (await call("owner", "GET", `/dashboards/${id}`)).json.data;
    expect(after.panels[0].sql).toContain(`FROM \`shop\`.\`${action.params.target}\``);
    expect(after.dashboard.version).toBe(2);
    expect((await call("owner", "GET", `/dashboards/${id}/versions`)).json.data[0].source).toBe("rollup");
    // A second verification of the same action finds it switched already.
    expect(await switchPanelToRollup(action.params, action.prior, "u-owner")).toBeNull();
    // The panel now reads a rollup: no second one.
    expect((await call("owner", "POST", `/dashboards/${id}/panels/${panelId}/cost`, { range: RANGE, values: {} })).json.data.rollup).toEqual({ eligible: false, reason: "it already reads a rollup" });

    const edited = await create("owner", { panels: [panel({ sql: ROLLABLE })] });
    const proposed = (await call("owner", "POST", `/dashboards/${edited.dashboard.id}/panels/${edited.panels[0].id}/rollup`, { backfillDays: 1, cluster: null })).json.data;
    await call("owner", "PUT", `/dashboards/${edited.dashboard.id}`, { version: 1, dashboard: dashboard({ panels: [panel({ id: edited.panels[0].id, sql: ROLLABLE.replace("count()", "count() + 0") })] }) });
    expect(await switchPanelToRollup(proposed.params, proposed.prior, "u-owner")).toBe("The panel's query changed after the rollup was proposed; it was left as it is");
  });

  it("refuses an ineligible panel, a viewer without edit access, an existing target, and the generic catalog route", async () => {
    respond = clickhouse;
    const rollable = await create("owner", { panels: [panel({ sql: ROLLABLE })] });
    await call("owner", "PUT", `/dashboards/${rollable.dashboard.id}/shares`, { shares: [{ roleId: "role-b", canEdit: false }] });
    expect((await call("peer", "POST", `/dashboards/${rollable.dashboard.id}/panels/${rollable.panels[0].id}/rollup`, { backfillDays: 7, cluster: null })).status).toBe(403);
    respond = (conn, query) => (query.includes("system.tables") ? [{ value: 1 }] : clickhouse(conn, query));
    expect((await call("owner", "POST", `/dashboards/${rollable.dashboard.id}/panels/${rollable.panels[0].id}/rollup`, { backfillDays: 7, cluster: null })).json.error.message).toMatch(/already exists; drop it or use it$/);
    respond = (conn, query) => (query.startsWith("DESCRIBE") ? [{ name: "bucket", type: "DateTime" }, { name: "a_v", type: "AggregateFunction(sum, Float64)" }] : clickhouse(conn, query));
    expect((await call("owner", "POST", `/dashboards/${rollable.dashboard.id}/panels/${rollable.panels[0].id}/rollup`, { backfillDays: 7, cluster: null })).json.error.message).toBe("v sums a Float column, which a rollup cannot reproduce exactly");
    const bare = await create("owner", { panels: [panel({ sql: "SELECT 1 AS t, 2 AS v" })] });
    expect((await call("owner", "POST", `/dashboards/${bare.dashboard.id}/panels/${bare.panels[0].id}/rollup`, { backfillDays: 7, cluster: null })).json.error.message).toBe("This panel cannot be rolled up: it reads no table");
  });
});

describe("Grafana import", () => {
  const GRAFANA = {
    schemaVersion: 39,
    title: "From Grafana",
    time: { from: "now-6h", to: "now" },
    templating: { list: [] },
    panels: [
      { type: "timeseries", title: "Orders", datasource: { type: "grafana-clickhouse-datasource", uid: "x" }, gridPos: { x: 0, y: 0, w: 12, h: 8 }, targets: [{ rawSql: "SELECT $__timeInterval(ts) AS t, count() AS v FROM shop.orders WHERE $__timeFilter(ts) GROUP BY t ORDER BY t" }] },
      { type: "graph", title: "Old", datasource: "Prometheus", gridPos: { x: 12, y: 0, w: 12, h: 8 }, targets: [{ expr: "up" }] },
    ],
  };

  it("previews without saving, and the preview imports through the normal import", async () => {
    const before = (await rawAll(sql`SELECT COUNT(*) AS c FROM dashboards`))[0].c;
    const res = await call("owner", "POST", "/dashboards/import/grafana", { grafana: GRAFANA, connectionScope: { kind: "only", connectionIds: ["conn-1"] } });
    expect(res.status).toBe(200);
    expect(res.json.data.panels.map((p: { status: string }) => p.status)).toEqual(["changed", "skipped"]);
    expect((await rawAll(sql`SELECT COUNT(*) AS c FROM dashboards`))[0].c).toBe(before);
    const imported = await call("owner", "POST", "/dashboards/import", { format: "chouse.dashboard/v2", id: null, dashboard: res.json.data.dashboard });
    expect(imported.status).toBe(201);
    expect(imported.json.data.panels[0]).toMatchObject({ kind: "chart", title: "Orders" });
    const run = await call("owner", "POST", `/dashboards/${imported.json.data.dashboard.id}/panels/${imported.json.data.panels[0].id}/run`, { range: RANGE, values: {} });
    expect(run.status).toBe(200);
  });

  it("refuses an old schema, connections the caller cannot use, and callers who cannot edit", async () => {
    expect((await call("owner", "POST", "/dashboards/import/grafana", { grafana: { ...GRAFANA, schemaVersion: 16 }, connectionScope: { kind: "any" } })).json.error.message).toContain("schema 30 or later");
    expect((await call("owner", "POST", "/dashboards/import/grafana", { grafana: GRAFANA, connectionScope: { kind: "only", connectionIds: ["conn-3"] } })).status).toBe(400);
    expect((await call("viewOnly", "POST", "/dashboards/import/grafana", { grafana: GRAFANA, connectionScope: { kind: "any" } })).status).toBe(403);
  });
});

describe("scheduled reports", () => {
  const BASE = "https://chouse.example";
  const schedule = { kind: "daily", dayOfWeek: null, hour: 9, minute: 0, timezone: "UTC" };
  let channel = "";
  const reportBody = (overrides: Record<string, unknown> = {}) => ({ name: "Daily shop", connectionId: "conn-1", schedule, range: "24h", onlyIfAlert: false, enabled: true, channelIds: [channel], ...overrides });

  beforeAll(async () => {
    channel = await createChannel({ name: "reports", type: ChannelType.Webhook, config: { url: "https://hooks.test/r" }, enabled: true });
  });
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = `${BASE}/`;
    delivered.length = 0;
    deliveryError = null;
  });
  afterAll(() => {
    delete process.env.PUBLIC_BASE_URL;
  });

  it("refuses a report without PUBLIC_BASE_URL, with an unknown channel, or on a connection outside the dashboard", async () => {
    const created = await create("owner", { connectionScope: { kind: "only", connectionIds: ["conn-1"] } });
    const id = created.dashboard.id;
    delete process.env.PUBLIC_BASE_URL;
    expect((await call("owner", "POST", `/dashboards/${id}/reports`, reportBody())).json.error.message).toBe("Reports link back to the dashboard, which needs PUBLIC_BASE_URL set on the server");
    process.env.PUBLIC_BASE_URL = BASE;
    expect((await call("owner", "POST", `/dashboards/${id}/reports`, reportBody({ channelIds: ["nope"] }))).json.error.message).toBe("Unknown notification channel: nope");
    expect((await call("owner", "POST", `/dashboards/${id}/reports`, reportBody({ connectionId: "conn-2" }))).json.error.message).toContain("not assigned to the connection");
    expect((await call("owner", "POST", `/dashboards/${id}/reports`, reportBody({ schedule: { ...schedule, kind: "weekly" } }))).status).toBe(400);
    // Reports need alerting:edit and edit access to the dashboard.
    expect((await call("peer", "POST", `/dashboards/${id}/reports`, reportBody())).status).toBe(403);
  });

  it("schedules, sends a digest with a link to the range as its owner, and records the run", async () => {
    const created = await create("owner", { panels: [panel(), panel({ title: "Broken", sql: "SELECT 1 AS t, 2 AS v FROM shop.missing" })] });
    const id = created.dashboard.id;
    respond = (_conn, query) => (query.includes("shop.missing") ? new Error("Table shop.missing does not exist") : ROWS);
    const made = await call("owner", "POST", `/dashboards/${id}/reports`, reportBody());
    expect(made.status).toBe(201);
    const report = made.json.data;
    expect(report).toMatchObject({ ownerId: "u-owner", channelIds: [channel], lastStatus: null });
    expect(new Date(report.nextRunAt).toISOString()).toMatch(/T09:00:00\.000Z$/);
    expect((await call("owner", "GET", `/dashboards/${id}/reports`)).json.data).toMatchObject({ reports: [{ id: report.id }], publicBaseUrl: true });

    const sentNow = await call("owner", "POST", `/dashboards/${id}/reports/${report.id}/send`);
    expect(sentNow.json.data.status).toBe("sent");
    expect(delivered).toHaveLength(1);
    expect(delivered[0].title).toBe("📊 Daily shop");
    expect(delivered[0].text).toContain("*Orders*\n  v: min 5 · avg 6 · max 7 · last 7");
    expect(delivered[0].text).toContain("*Broken* — error:");
    expect(delivered[0].text).toMatch(new RegExp(`Open: ${BASE}/dashboards/${id}\\?from=\\d+&to=\\d+$`));
    const [from, to] = /from=(\d+)&to=(\d+)/.exec(delivered[0].text)?.slice(1).map(Number) ?? [];
    expect(to - from).toBe(86_400);
    const after = (await call("owner", "GET", `/dashboards/${id}/reports`)).json.data.reports[0];
    expect(after).toMatchObject({ lastStatus: "sent", lastError: null, nextRunAt: report.nextRunAt });
    const events = await rawAll(sql`SELECT payload, delivered_to FROM alert_events WHERE rule_id = ${report.id}`);
    expect(events).toHaveLength(1);
    expect(JSON.parse(String(events[0].payload))).toMatchObject({ source: "dashboard_report", status: "sent", dashboardId: id });
  });

  it("runs due reports from the scheduler once, skips one with no alert when asked, and fails without sending when the owner may no longer see the dashboard", async () => {
    const { DashboardReportScheduler } = await import("../services/dashboards/reports");
    const created = await create();
    const id = created.dashboard.id;
    const quiet = (await call("owner", "POST", `/dashboards/${id}/reports`, reportBody({ name: "Only on alerts", onlyIfAlert: true }))).json.data;
    const shared = await create("owner");
    await call("owner", "PUT", `/dashboards/${shared.dashboard.id}/shares`, { shares: [{ roleId: "role-b", canEdit: true }] });
    const theirs = (await call("peer", "POST", `/dashboards/${shared.dashboard.id}/reports`, reportBody({ name: "Peer report" })));
    // peer has no alerting:edit.
    expect(theirs.status).toBe(403);
    const lost = (await call("manager", "POST", `/dashboards/${shared.dashboard.id}/reports`, reportBody({ name: "Manager report" }))).json.data;
    // Its owner becomes someone the dashboard is not shared with, as when a share is withdrawn.
    await rawRun(sql`UPDATE dashboard_reports SET owner_id = 'u-out' WHERE id = ${lost.id}`);
    await rawRun(sql`UPDATE dashboard_reports SET next_run_at = 1 WHERE id IN (${quiet.id}, ${lost.id})`);
    await DashboardReportScheduler.getInstance().tick(Date.now());
    const reportsNow = [
      ...(await call("owner", "GET", `/dashboards/${id}/reports`)).json.data.reports,
      ...(await call("owner", "GET", `/dashboards/${shared.dashboard.id}/reports`)).json.data.reports,
    ];
    const byName = new Map(reportsNow.map((r: { name: string }) => [r.name, r]));
    expect(byName.get("Only on alerts")).toMatchObject({ lastStatus: "skipped", lastError: "No panel alert fired in the range" });
    expect(byName.get("Manager report")).toMatchObject({ lastStatus: "failed", lastError: "The report's owner can no longer view this dashboard" });
    for (const r of reportsNow) expect((r as { nextRunAt: number }).nextRunAt).toBeGreaterThan(Date.now());
    expect(delivered).toEqual([]);
    // Nothing is due any more: a second tick sends nothing.
    await DashboardReportScheduler.getInstance().tick(Date.now());
    expect(await rawAll(sql`SELECT 1 FROM alert_events WHERE rule_id IN (${quiet.id}, ${lost.id})`)).toHaveLength(2);
  });

  it("records a failed delivery, and goes with its dashboard", async () => {
    const created = await create();
    const id = created.dashboard.id;
    const report = (await call("owner", "POST", `/dashboards/${id}/reports`, reportBody())).json.data;
    deliveryError = "webhook returned 500";
    const res = await call("owner", "POST", `/dashboards/${id}/reports/${report.id}/send`);
    expect(res.json.data).toMatchObject({ status: "failed", error: "reports: webhook returned 500" });
    expect((await call("owner", "DELETE", `/dashboards/${id}`)).status).toBe(200);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_reports WHERE dashboard_id = ${id}`)).toEqual([]);
    expect(await rawAll(sql`SELECT 1 FROM dashboard_report_channels WHERE report_id = ${report.id}`)).toEqual([]);
  });
});
