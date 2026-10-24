/**
 * Watches (ADR 0025 §6, migration 1.73.0): a Data Health promise with an
 * expiry. It is always its creator's, ends within 7 days, each person keeps
 * at most five per connection, and the scheduler removes it once it ends —
 * with its execution job, checks and incidents.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import { freshDatabase, rawAll, rawRun } from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { ScheduledQueryScheduler } from "../services/scheduledQueries/scheduler";
import dataHealth, { WATCH_LIMIT } from "./data-health";

const ALICE = "watch-alice";
const BOB = "watch-bob";
const CONNECTION = "watch-conn";
const OTHER = "watch-conn-2";
const HOUR = 60 * 60 * 1000;
let app: Hono;

async function post(body: unknown, user = ALICE): Promise<{ status: number; json: { data?: { promise?: { id: string; ownerId: string | null; expiresAt: number | null; scheduledQueryId: string } }; error?: { code?: string; message?: string } } }> {
  const token = await generateAccessToken({ sub: user, email: `${user}@test.local`, username: user, roles: ["super_admin"], permissions: ["data_health:edit", "data_health:view"], sessionId: "s1" });
  const res = await app.request("/data-health", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

function watch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Watch: shop.orders",
    connectionId: CONNECTION,
    source: { sourceType: "query", sourceQuery: "SELECT now() AS ts", eventTimeColumn: "ts", eventTimeEncoding: "native", eventTimeType: "DateTime" },
    frequency: "cron",
    cronExpr: "*/15 * * * *",
    runNow: false,
    checks: [{ checkKey: "fresh", name: "Fresh", type: "freshness", severity: "critical", config: { eventTimeColumn: "ts", maxAgeSeconds: 3600 } }],
    expiresAt: Date.now() + HOUR,
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  for (const id of [ALICE, BOB]) {
    await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
  }
  for (const id of [CONNECTION, OTHER]) {
    await rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, password_encrypted, database, is_default, is_active, ssl_enabled, created_at, updated_at)
      VALUES (${id}, ${id}, 'localhost', 8123, 'default', NULL, 'default', 0, 1, 0, unixepoch(), unixepoch())`);
  }
  app = new Hono();
  app.onError(errorHandler);
  app.route("/data-health", dataHealth);
});

afterAll(async () => {
  await closeDatabase();
});

describe("watches", () => {
  it("are always their creator's, with the expiry stored", async () => {
    const expiresAt = Date.now() + 2 * HOUR;
    const res = await post(watch({ ownerId: BOB, expiresAt }));
    expect(res.status).toBe(201);
    expect(res.json.data?.promise).toMatchObject({ ownerId: ALICE, expiresAt });

    // A permanent promise still takes the owner an admin chose.
    const permanent = await post(watch({ ownerId: BOB, expiresAt: undefined, name: "orders volume" }));
    expect(permanent.status).toBe(201);
    expect(permanent.json.data?.promise).toMatchObject({ ownerId: BOB, expiresAt: null });
  });

  it("must end in the future, within 7 days", async () => {
    const past = await post(watch({ expiresAt: Date.now() - 1000 }));
    expect(past.status).toBe(400);
    expect(past.json.error?.message).toContain("future");
    const long = await post(watch({ expiresAt: Date.now() + 8 * 24 * HOUR }));
    expect(long.status).toBe(400);
    expect(long.json.error?.message).toContain("7 days");
  });

  it("are limited per person and per connection", async () => {
    const existing = await rawAll(sql`SELECT COUNT(*) AS n FROM data_health_promises WHERE owner_id = ${ALICE} AND connection_id = ${CONNECTION} AND expires_at IS NOT NULL`);
    for (let i = Number(existing[0]?.n ?? 0); i < WATCH_LIMIT; i++) expect((await post(watch({ name: `w${i}` }))).status).toBe(201);
    const over = await post(watch({ name: "one too many" }));
    expect(over.status).toBe(409);
    expect(over.json.error?.code).toBe("WATCH_LIMIT");

    // Another connection, or another person, has its own five.
    expect((await post(watch({ connectionId: OTHER, name: "elsewhere" }))).status).toBe(201);
    expect((await post(watch({ name: "bob's" }), BOB)).status).toBe(201);
  });

  it("are removed by the scheduler once they end, with their job, and only then", async () => {
    const created = await post(watch({ connectionId: OTHER, name: "ending" }));
    const promise = created.json.data?.promise;
    expect(promise).toBeDefined();
    const id = promise?.id ?? "";
    const jobId = promise?.scheduledQueryId ?? "";
    await rawRun(sql`INSERT INTO data_health_incidents (id, promise_id, status, severity, opened_at, last_event_at, summary)
      VALUES ('inc-ending', ${id}, 'open', 'warning', 1, 1, 'late')`).catch(() => undefined);

    const scheduler = new ScheduledQueryScheduler();
    expect(await scheduler.expireWatchesPass(Date.now())).toBe(0);
    await rawRun(sql`UPDATE data_health_promises SET expires_at = ${Date.now() - 1000} WHERE id = ${id}`);

    expect(await scheduler.expireWatchesPass(Date.now())).toBe(1);
    expect(await rawAll(sql`SELECT id FROM data_health_promises WHERE id = ${id}`)).toEqual([]);
    expect(await rawAll(sql`SELECT id FROM scheduled_queries WHERE id = ${jobId}`)).toEqual([]);
    expect(await rawAll(sql`SELECT id FROM data_health_incidents WHERE promise_id = ${id}`)).toEqual([]);
    // Permanent promises are never touched.
    const permanent = await rawAll(sql`SELECT COUNT(*) AS n FROM data_health_promises WHERE expires_at IS NULL`);
    expect(Number(permanent[0]?.n ?? 0)).toBeGreaterThan(0);
    expect(await scheduler.expireWatchesPass(Date.now())).toBe(0);
  });
});
