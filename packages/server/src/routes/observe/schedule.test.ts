/**
 * Collection schedule routes (issue #380) against a real in-memory RBAC
 * database: read and save the defaults and one connection's overrides,
 * validation of every limit, the audit trail, and the view's inheritance.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../../rbac/services/jwt";
import { errorHandler } from "../../middleware/error";
import { resetCollectorSettingsCache } from "../../services/observe/collectorSettings";
import observe from "./index";

const USER = "schedule-user";
const VIEW = ["connections:view"];
const EDIT = ["connections:view", "connections:edit"];
const CONN = "conn-schedule";
const OTHER = "conn-other";
let app: Hono;

interface Row {
  name: string;
  builtInSeconds: number;
  defaults: { intervalSeconds?: number | null; paused?: boolean | null };
  override: { intervalSeconds?: number | null; paused?: boolean | null } | null;
  effective: { intervalSeconds: number; intervalSource: string; paused: boolean; pausedSource: string };
  status: { readBytes: number | null; queryCount: number | null } | null;
  projectedBytesPerDay: number | null;
  overriddenOn: number;
  pausedOn: number;
}

async function call(method: string, path: string, permissions: string[], body?: unknown): Promise<Response> {
  const token = await generateAccessToken({ sub: USER, email: "s@test.local", username: "schedule", roles: ["super_admin"], permissions, sessionId: "s1" });
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function rows(res: Response): Promise<Row[]> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { collectors: Row[] } }).data.collectors;
}

function row(list: Row[], name: string): Row {
  const found = list.find((r) => r.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

async function addConnection(id: string): Promise<void> {
  await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${id}, ${id}, 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 's@test.local', 'schedule', 'x', 1, unixepoch(), unixepoch())`);
  await addConnection(CONN);
  await addConnection(OTHER);
  app = new Hono();
  app.onError(errorHandler);
  app.route("/observe", observe);
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await rawRun(sql`DELETE FROM obs_settings`);
  await rawRun(sql`DELETE FROM obs_collector_status`);
  resetCollectorSettingsCache();
});

describe("collection schedule", () => {
  it("lists every collector at its built-in interval until something is set", async () => {
    const list = await rows(await call("GET", "/observe/collectors/schedule", VIEW));
    expect(list.map((r) => r.name)).toEqual(["fleet", "pipelines", "catalog", "tables", "lineage", "changes", "usage", "queries", "capacity", "profiles"]);
    expect(row(list, "usage").effective).toEqual({ intervalSeconds: 900, intervalSource: "built-in", paused: false, pausedSource: "built-in" });
    expect(row(list, "pipelines").builtInSeconds).toBe(60);
  });

  it("saves defaults and applies them to every connection", async () => {
    const saved = await rows(await call("PUT", "/observe/collectors/schedule", EDIT, { collectors: { usage: { intervalSeconds: 3600 }, profiles: { paused: true } } }));
    expect(row(saved, "usage").effective).toMatchObject({ intervalSeconds: 3600, intervalSource: "default" });
    expect(row(saved, "profiles").effective).toMatchObject({ paused: true, pausedSource: "default" });
    expect(row(saved, "profiles").pausedOn).toBe(2);

    const conn = await rows(await call("GET", `/observe/collectors/schedule/${CONN}`, VIEW));
    expect(row(conn, "usage").effective).toMatchObject({ intervalSeconds: 3600, intervalSource: "default" });
    expect(row(conn, "usage").override).toEqual({});

    const audit = await rawAll(sql`SELECT action, resource_id FROM rbac_audit_logs WHERE action = 'observe.collectors_update'`);
    expect(audit.map((a) => String(a.resource_id))).toContain("defaults");
  });

  it("lets one connection override the defaults, including un-pausing", async () => {
    await call("PUT", "/observe/collectors/schedule", EDIT, { collectors: { usage: { intervalSeconds: 3600 }, profiles: { paused: true } } });
    const conn = await rows(await call("PUT", `/observe/collectors/schedule/${CONN}`, EDIT, { collectors: { usage: { intervalSeconds: 21600 }, profiles: { paused: false } } }));
    expect(row(conn, "usage").effective).toMatchObject({ intervalSeconds: 21600, intervalSource: "connection" });
    expect(row(conn, "profiles").effective).toMatchObject({ paused: false, pausedSource: "connection" });

    const other = await rows(await call("GET", `/observe/collectors/schedule/${OTHER}`, VIEW));
    expect(row(other, "usage").effective.intervalSeconds).toBe(3600);

    const all = await rows(await call("GET", "/observe/collectors/schedule", VIEW));
    expect(row(all, "usage").overriddenOn).toBe(1);
    expect(row(all, "profiles").pausedOn).toBe(1);

    // Saving the defaults keeps the connection's overrides.
    await call("PUT", "/observe/collectors/schedule", EDIT, { collectors: {} });
    const after = await rows(await call("GET", `/observe/collectors/schedule/${CONN}`, VIEW));
    expect(row(after, "usage").effective).toMatchObject({ intervalSeconds: 21600, intervalSource: "connection" });
  });

  it("clears an override when every field inherits again", async () => {
    await call("PUT", `/observe/collectors/schedule/${CONN}`, EDIT, { collectors: { usage: { intervalSeconds: 3600 } } });
    await call("PUT", `/observe/collectors/schedule/${CONN}`, EDIT, { collectors: { usage: { intervalSeconds: null, paused: null } } });
    const stored = await rawAll(sql`SELECT value FROM obs_settings WHERE setting_key = 'collector_settings'`);
    expect(JSON.parse(String(stored[0].value)).connections).toEqual({});
  });

  it("refuses intervals outside the limits, unknown collectors, pausing fleet and per-connection fleet", async () => {
    const bad = async (path: string, collectors: unknown, message: string): Promise<void> => {
      const res = await call("PUT", path, EDIT, { collectors });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(message);
    };
    await bad("/observe/collectors/schedule", { usage: { intervalSeconds: 60 } }, "Usage must run every 300");
    await bad("/observe/collectors/schedule", { usage: { intervalSeconds: 90_000 } }, "");
    await bad("/observe/collectors/schedule", { nope: { intervalSeconds: 600 } }, "Unknown collector 'nope'");
    await bad("/observe/collectors/schedule", { fleet: { paused: true } }, "Fleet health can't be paused");
    await bad(`/observe/collectors/schedule/${CONN}`, { fleet: { intervalSeconds: 60 } }, "set it in the defaults");
    await bad("/observe/collectors/schedule", { usage: { intervalSeconds: 600, extra: 1 } }, "");
    expect(await rawAll(sql`SELECT value FROM obs_settings`)).toEqual([]);
  });

  it("projects each collector's daily cost from its last run", async () => {
    await rawRun(sql`INSERT INTO obs_collector_status (connection_id, collector, state, last_run_at, duration_ms, read_rows, read_bytes, query_count)
      VALUES (${CONN}, 'usage', 'ok', 1, 96, 1000, ${1_000_000}, 3)`);
    await rawRun(sql`INSERT INTO obs_collector_status (connection_id, collector, state, last_run_at, duration_ms, read_rows, read_bytes, query_count)
      VALUES (${OTHER}, 'usage', 'ok', 1, 96, 1000, ${2_000_000}, 3)`);
    const conn = await rows(await call("GET", `/observe/collectors/schedule/${CONN}`, VIEW));
    // 96 runs a day at the built-in 15 minutes.
    expect(row(conn, "usage").projectedBytesPerDay).toBe(96_000_000);
    expect(row(conn, "usage").status).toMatchObject({ readBytes: 1_000_000, queryCount: 3 });
    expect(row(conn, "catalog").projectedBytesPerDay).toBeNull();

    await call("PUT", `/observe/collectors/schedule/${OTHER}`, EDIT, { collectors: { usage: { intervalSeconds: 3600 } } });
    const all = await rows(await call("GET", "/observe/collectors/schedule", VIEW));
    expect(row(all, "usage").projectedBytesPerDay).toBe(96_000_000 + 24 * 2_000_000);

    await call("PUT", `/observe/collectors/schedule/${CONN}`, EDIT, { collectors: { usage: { paused: true } } });
    const paused = await rows(await call("GET", `/observe/collectors/schedule/${CONN}`, VIEW));
    expect(row(paused, "usage").projectedBytesPerDay).toBe(0);
  });

  it("drops overrides of deleted connections and 404s unknown ones", async () => {
    await addConnection("conn-doomed");
    await call("PUT", "/observe/collectors/schedule/conn-doomed", EDIT, { collectors: { usage: { paused: true } } });
    await rawRun(sql`DELETE FROM rbac_clickhouse_connections WHERE id = 'conn-doomed'`);
    await call("PUT", "/observe/collectors/schedule", EDIT, { collectors: {} });
    const stored = await rawAll(sql`SELECT value FROM obs_settings WHERE setting_key = 'collector_settings'`);
    expect(JSON.parse(String(stored[0].value)).connections).toEqual({});
    expect((await call("GET", "/observe/collectors/schedule/conn-doomed", VIEW)).status).toBe(404);
    expect((await call("PUT", "/observe/collectors/schedule/conn-doomed", EDIT, { collectors: {} })).status).toBe(404);
  });
});
