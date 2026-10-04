/**
 * Data Health promise definitions that cannot compile are the caller's
 * mistake: create and preview answer 400 with the reason, not a 500.
 * Query sources compile without ClickHouse, so this runs on the in-memory
 * RBAC database alone.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import dataHealth from "./data-health";

const USER = "dh-validation-user";
const CONNECTION = "dh-validation-conn";
let app: Hono;

async function post(path: string, body: unknown): Promise<Response> {
  const token = await generateAccessToken({ sub: USER, email: "dh@test.local", username: "dh", roles: ["super_admin"], permissions: ["data_health:edit", "data_health:view"], sessionId: "s1" });
  return app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function promise(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "orders volume",
    connectionId: CONNECTION,
    source: { sourceType: "query", sourceQuery: "SELECT 1 AS x" },
    frequency: "manual",
    runNow: false,
    checks: [{ checkKey: "rows", name: "Rows", type: "row_count", config: { min: 1 } }],
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'dh@test.local', 'dh', 'x', 1, unixepoch(), unixepoch())`);
  await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
    VALUES (${CONNECTION}, 'dh', 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  app = new Hono();
  app.onError(errorHandler);
  app.route("/data-health", dataHealth);
});

afterAll(async () => {
  await closeDatabase();
});

describe("invalid Data Health definitions", () => {
  for (const path of ["/data-health", "/data-health/preview"]) {
    it(`${path}: a windowed check without an event-time column is a 400 with the reason`, async () => {
      const res = await post(path, promise());
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(body.error.message).toBe("row_count requires an event-time column");
    });

    it(`${path}: duplicate check keys are a 400`, async () => {
      const check = { checkKey: "rows", name: "Rows", type: "row_count", config: { min: 1 } };
      const res = await post(path, promise({ source: { sourceType: "query", sourceQuery: "SELECT now() AS ts", eventTimeColumn: "ts", eventTimeType: "DateTime", eventTimeEncoding: "native" }, checks: [check, check] }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Duplicate check key: rows");
    });
  }

  it("does not store anything when the definition is rejected", async () => {
    await post("/data-health", promise());
    const rows = await rawAll(sql`SELECT count(*) AS n FROM scheduled_queries WHERE kind = 'data_health_check'`);
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
