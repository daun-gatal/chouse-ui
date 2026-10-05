/**
 * RBAC matrix for every ADR 0016 endpoint: a caller without the gating
 * permission is refused (403); a caller with it gets past the gate. Runs
 * against a real in-memory RBAC database and real JWTs.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../../rbac/services/jwt";
import { errorHandler } from "../../middleware/error";
import agents from "../agents";
import contextRoute from "../context";
import notebooks from "../notebooks";
import remediation from "../remediation";
import upgrades from "../upgrades";
import observe from "./index";

const USER = "rbac-matrix-user";
let app: Hono;
let connectionId = "";

async function token(permissions: string[], roles: string[] = ["custom"]): Promise<string> {
  return generateAccessToken({ sub: USER, email: "m@test.local", username: "matrix", roles, permissions, sessionId: "s1" });
}

interface Case {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  permissions: string[];
  body?: unknown;
}

const C = (): string => `connectionId=${connectionId}`;

function cases(): Case[] {
  return [
    { method: "GET", path: `/observe/status?${C()}`, permissions: ["observe:view"] },
    { method: "GET", path: `/observe/overview?${C()}`, permissions: ["observe:view"] },
    { method: "GET", path: `/observe/lineage?${C()}`, permissions: ["observe:view"] },
    { method: "GET", path: `/observe/pipelines?${C()}`, permissions: ["observe:view"] },
    { method: "GET", path: `/observe/datasets?${C()}`, permissions: ["observe:view"] },
    { method: "GET", path: `/observe/coverage?${C()}`, permissions: ["observe:view"] },
    { method: "PUT", path: `/observe/datasets/shop/b/criticality?${C()}`, permissions: ["observe:edit"], body: { criticality: "critical" } },
    { method: "POST", path: `/observe/suggestions/dismiss?${C()}`, permissions: ["observe:edit"], body: { key: "freshness:a.b" } },
    { method: "GET", path: `/observe/incidents?${C()}`, permissions: ["observe:view"] },
    { method: "GET", path: `/observe/performance?${C()}`, permissions: ["performance:view"] },
    { method: "GET", path: `/observe/capacity?${C()}`, permissions: ["capacity:view"] },
    { method: "PUT", path: "/observe/cost-rates", permissions: ["cost:view", "settings:update"], body: { currency: "USD", perTibRead: 5, perCpuHour: 0.1 } },
    { method: "POST", path: `/observe/codec-trials?${C()}`, permissions: ["upgrades:run"], body: { database: "shop", table: "b", column: "c", candidateCodec: "ZSTD(3)" } },
    { method: "POST", path: `/observe/preflight?${C()}`, permissions: ["query:execute:ddl"], body: { sql: "ALTER TABLE a.b DROP COLUMN c" } },
    { method: "GET", path: `/observe/privileges?${C()}`, permissions: ["connections:view"] },
    { method: "GET", path: "/remediation/catalog", permissions: ["remediation:propose"] },
    { method: "GET", path: `/remediation/actions?${C()}`, permissions: ["remediation:approve"] },
    { method: "POST", path: "/remediation/actions", permissions: ["remediation:propose"], body: { connectionId, params: { type: "kill_query", queryId: "q1" } } },
    { method: "GET", path: `/remediation/credentials/${connectionId}`, permissions: ["connections:view"] },
    { method: "PUT", path: `/remediation/credentials/${connectionId}`, permissions: ["connections:edit"], body: { username: "u", password: "p" } },
    { method: "GET", path: `/context/tables?${C()}`, permissions: ["observe:view"] },
    { method: "PUT", path: `/context/tables/shop/b?${C()}`, permissions: ["context:edit"], body: { description: "x" } },
    { method: "POST", path: `/context/dbt-import?${C()}`, permissions: ["context:edit"], body: { nodes: {} } },
    { method: "POST", path: `/context/tables/shop/b/draft?${C()}`, permissions: ["context:edit", "ai:optimize"], body: {} },
    { method: "POST", path: `/context/watchers/compile?${C()}`, permissions: ["data_health:edit", "ai:optimize"], body: { text: "tell me when it breaks" } },
    { method: "GET", path: `/upgrades/assessments?${C()}`, permissions: ["upgrades:view"] },
    { method: "POST", path: `/upgrades/assessments?${C()}`, permissions: ["upgrades:run"], body: { targetVersion: "25.3" } },
    { method: "GET", path: "/upgrades/rules", permissions: ["upgrades:view"] },
    { method: "GET", path: "/agents/summary", permissions: ["agents:view"] },
    { method: "GET", path: "/agents/policies", permissions: ["agents:view"] },
    { method: "POST", path: "/agents/pause", permissions: ["agents:manage"], body: { paused: false } },
    { method: "PUT", path: "/agents/policies", permissions: ["agents:manage"], body: { scopeKind: "default", scopeId: "*", maxBytesPerQuery: null, dailyBytes: null, partitionFilterBytes: null, incidentMode: "warn", alertMultiplier: null } },
    { method: "GET", path: "/agents/mcp", permissions: ["agents:view"] },
    { method: "PUT", path: "/agents/mcp", permissions: ["agents:manage"], body: { enabled: false } },
    { method: "POST", path: "/notebooks/ensure", permissions: ["doctor:view"], body: { kind: "doctor_report", ref: "missing" } },
  ];
}

async function call(c: Case, permissions: string[]): Promise<Response> {
  return app.request(c.path, {
    method: c.method,
    headers: { Authorization: `Bearer ${await token(permissions)}`, "Content-Type": "application/json" },
    body: c.body === undefined ? undefined : JSON.stringify(c.body),
  });
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'm@test.local', 'matrix', 'x', 1, unixepoch(), unixepoch())`);
  connectionId = "conn-matrix";
  await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${connectionId}, 'matrix', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  // The user may use the connection (database "shop" only), so only the permission gate decides.
  await rawRun(sql`INSERT INTO rbac_roles (id, name, display_name, is_system, is_default, priority, created_at, updated_at) VALUES ('role-m', 'matrix', 'matrix', 0, 0, 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_user_roles (id, user_id, role_id, assigned_at) VALUES ('ur-m', ${USER}, 'role-m', unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_data_access_policies (id, name, is_system, created_at, updated_at) VALUES ('pol-m', 'matrix', 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_data_access_policy_rules (id, policy_id, connection_id, database_pattern, table_pattern, is_allowed, priority, created_at, updated_at)
    VALUES ('rule-m', 'pol-m', ${connectionId}, 'shop', '*', 1, 0, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_role_data_access_policies (id, role_id, policy_id, created_at) VALUES ('rdp-m', 'role-m', 'pol-m', unixepoch())`);
  app = new Hono();
  app.onError(errorHandler);
  app.route("/observe", observe);
  app.route("/remediation", remediation);
  app.route("/notebooks", notebooks);
  app.route("/context", contextRoute);
  app.route("/upgrades", upgrades);
  app.route("/agents", agents);
});

afterAll(async () => {
  await closeDatabase();
});

describe("ADR 0016 RBAC gates", () => {
  it("refuses every endpoint without its permission", async () => {
    for (const c of cases()) {
      const res = await call(c, ["metrics:view"]);
      expect({ path: `${c.method} ${c.path}`, status: res.status }).toEqual({ path: `${c.method} ${c.path}`, status: 403 });
    }
  });

  it("lets a caller with the permission past the gate", async () => {
    for (const c of cases()) {
      const res = await call(c, c.permissions);
      // Past the gate the request may still fail on missing data or ClickHouse — never with a permission error.
      const body = await res.text();
      const permissionError = res.status === 403 && /permission|required/i.test(body);
      expect({ path: `${c.method} ${c.path}`, permissionError }).toEqual({ path: `${c.method} ${c.path}`, permissionError: false });
    }
  });

  it("enforces per-table data access on dataset detail for non-admins", async () => {
    const res = await app.request(`/observe/datasets/secret/table?${C()}`, { headers: { Authorization: `Bearer ${await token(["observe:view"])}` } });
    expect(res.status).toBe(403);
  });

  it("refuses a Chouse AI context draft on a table the caller cannot read", async () => {
    const res = await app.request(`/context/tables/secret/table/draft?${C()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await token(["context:edit", "ai:optimize"])}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("enforces connection access", async () => {
    const res = await app.request("/observe/overview?connectionId=not-mine", { headers: { Authorization: `Bearer ${await token(["observe:view"])}` } });
    expect(res.status).toBe(403);
  });
});
