/**
 * `POST /api/notebooks/ensure` with the titles incidents really carry: whole
 * ClickHouse errors with the failing SQL, far longer than a notebook title.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import notebooks from "./notebooks";

const USER = "notebook-title-user";
const CONNECTION = "conn-notebook";
const LONG_ERROR = `Hourly query_log x metric_log join (last 7 hours): 1 errors in the last 3 samples: Identifier 'q.hostname' cannot be resolved from table with name q. In scope SELECT q.hostname AS hostname, ${"sum(q.read_rows) AS read_rows, ".repeat(40)}FROM system.query_log AS q`;

let app: Hono;
let incident = 0;

async function headers(): Promise<Record<string, string>> {
  const token = await generateAccessToken({ sub: USER, email: "n@test.local", username: "nb", roles: ["custom"], permissions: ["observe:view"], sessionId: "s1" });
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** A fresh Observe incident, so every case creates its notebook instead of finding one. */
async function newIncident(): Promise<string> {
  incident += 1;
  const id = `inc-${incident}`;
  await rawRun(sql`INSERT INTO obs_incidents (id, connection_id, kind, subject_ref, status, severity, summary, opened_at, last_event_at, created_at, updated_at)
    VALUES (${id}, ${CONNECTION}, 'capacity', ${`disk-${incident}`}, 'open', 'critical', 'x', 1, 1, 1, 1)`);
  return id;
}

async function ensure(ref: string, title: unknown): Promise<Response> {
  return app.request("/notebooks/ensure", {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(title === undefined ? { kind: "incident_observe", ref } : { kind: "incident_observe", ref, title }),
  });
}

async function titleOf(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { notebook: { title: string } } };
  return body.data.notebook.title;
}

beforeAll(async () => {
  process.env.JWT_SECRET ||= "notebook-title-test-secret-at-least-32-characters";
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'n@test.local', 'nb', 'x', 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${CONNECTION}, 'nb', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at) VALUES ('role-nb', 'nb', 'nb', 0, 0, 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES ('ur-nb', ${USER}, 'role-nb', unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_data_access_policies (id, name, is_system, created_at, updated_at) VALUES ('pol-nb', 'nb', 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_data_access_policy_rules (id, policy_id, connection_id, database_pattern, table_pattern, is_allowed, priority, created_at, updated_at)
    VALUES ('rule-nb', 'pol-nb', ${CONNECTION}, '*', '*', 1, 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_role_data_access_policies (id, role_id, policy_id, created_at) VALUES ('rdp-nb', 'role-nb', 'pol-nb', unixepoch())`);
  app = new Hono();
  app.onError(errorHandler);
  app.route("/notebooks", notebooks);
});

afterAll(async () => {
  await closeDatabase();
});

describe("POST /notebooks/ensure titles", () => {
  it("opens the notebook of an incident whose title is a whole error message", async () => {
    expect(LONG_ERROR.length).toBeGreaterThan(1000);
    const title = await titleOf(await ensure(await newIncident(), LONG_ERROR));
    expect(Array.from(title).length).toBeLessThanOrEqual(200);
    expect(title.endsWith("…")).toBe(true);
    expect(LONG_ERROR.startsWith(title.slice(0, -1))).toBe(true);
  });

  it("keeps a title of exactly 200 characters", async () => {
    const exact = "t".repeat(200);
    expect(await titleOf(await ensure(await newIncident(), exact))).toBe(exact);
  });

  it("keeps the first line of a multi-line title", async () => {
    expect(await titleOf(await ensure(await newIncident(), "  Merges stuck on shop.orders\nCode: 241. DB::Exception: Memory limit\n"))).toBe("Merges stuck on shop.orders");
  });

  it("falls back to the default title when none, or only whitespace, is given", async () => {
    expect(await titleOf(await ensure(await newIncident(), undefined))).toBe("Incident investigation");
    expect(await titleOf(await ensure(await newIncident(), ""))).toBe("Incident investigation");
    expect(await titleOf(await ensure(await newIncident(), " \n\t "))).toBe("Incident investigation");
  });

  it("refuses absurd payloads", async () => {
    expect((await ensure(await newIncident(), "x".repeat(10_001))).status).toBe(400);
    expect((await ensure(await newIncident(), 42)).status).toBe(400);
  });

  it("returns the existing notebook unchanged on a second call", async () => {
    const ref = await newIncident();
    const first = await titleOf(await ensure(ref, "First title"));
    expect(await titleOf(await ensure(ref, LONG_ERROR))).toBe(first);
  });
});
