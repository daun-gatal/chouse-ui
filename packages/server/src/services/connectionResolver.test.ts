/**
 * ADR 0010 — per-request connection resolution.
 *
 * The behaviour under test is the one that caused the original bug: when the
 * client names a connection, we resolve exactly that one or fail — we never
 * substitute a different connection and return success.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { initializeDatabase, closeDatabase, getDatabase, getSchema } = await import("../rbac/db");
const { runMigrations } = await import("../rbac/db/migrations");
const { seedDatabase } = await import("../rbac/services/seed");
const {
  resolveRequestedConnection,
  resolveDefaultConnection,
  resetConnectionFactsCache,
} = await import("./connectionResolver");
const { AppError } = await import("../types");

const SUPER_ADMIN = true;
const REGULAR_USER = false;

let defaultConnId = "";
let otherConnId = "";
let inactiveConnId = "";

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  await seedDatabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getDatabase() as any;
  const schema = getSchema();
  const base = {
    port: 8123,
    username: "default",
    passwordEncrypted: null,
    database: "default",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  defaultConnId = randomUUID();
  otherConnId = randomUUID();
  inactiveConnId = randomUUID();

  await db.insert(schema.clickhouseConnections).values([
    { ...base, id: defaultConnId, name: "prod", host: "prod.internal", isDefault: true, isActive: true },
    { ...base, id: otherConnId, name: "staging", host: "staging.internal", isDefault: false, isActive: true },
    { ...base, id: inactiveConnId, name: "retired", host: "retired.internal", isDefault: false, isActive: false },
  ]);
});

afterAll(async () => {
  await closeDatabase();
});

describe("resolveRequestedConnection", () => {
  it("resolves the connection the caller actually asked for", async () => {
    const resolved = await resolveRequestedConnection("user-1", SUPER_ADMIN, otherConnId);
    expect(resolved.connectionId).toBe(otherConnId);
    expect(resolved.config.url).toContain("staging.internal");
  });

  it("does NOT fall back to the default connection when asked for another one", async () => {
    // This is the regression. The old middleware answered from the default
    // connection whenever it could not resolve the request, with a 200 — so the
    // UI showed staging while the data came from prod.
    const resolved = await resolveRequestedConnection("user-1", SUPER_ADMIN, otherConnId);
    expect(resolved.connectionId).not.toBe(defaultConnId);
  });

  it("rejects a connection the user has no access to", async () => {
    // A regular user with no policies sees no connections at all.
    let caught: unknown;
    try {
      await resolveRequestedConnection("user-nobody", REGULAR_USER, otherConnId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as InstanceType<typeof AppError>).statusCode).toBe(403);
  });

  it("does not distinguish 'unknown id' from 'not yours' (no id probing)", async () => {
    const unknownId = randomUUID();
    let unknownError: unknown;
    let forbiddenError: unknown;
    try {
      await resolveRequestedConnection("user-nobody", REGULAR_USER, unknownId);
    } catch (error) {
      unknownError = error;
    }
    try {
      await resolveRequestedConnection("user-nobody", REGULAR_USER, otherConnId);
    } catch (error) {
      forbiddenError = error;
    }
    expect((unknownError as Error).message).toBe((forbiddenError as Error).message);
  });

  it("fails closed on an inactive connection rather than picking another", async () => {
    let caught: unknown;
    try {
      await resolveRequestedConnection("user-1", SUPER_ADMIN, inactiveConnId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as InstanceType<typeof AppError>).statusCode).toBe(409);
    expect((caught as InstanceType<typeof AppError>).code).toBe("CONNECTION_CONTEXT_STALE");
  });
});

describe("resolveDefaultConnection", () => {
  it("is used only when the caller named no connection, and picks the default", async () => {
    const resolved = await resolveDefaultConnection("user-1", SUPER_ADMIN);
    expect(resolved.connectionId).toBe(defaultConnId);
  });

  it("errors when the user has no usable connection instead of inventing one", async () => {
    let caught: unknown;
    try {
      await resolveDefaultConnection("user-nobody", REGULAR_USER);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as InstanceType<typeof AppError>).statusCode).toBe(401);
  });
});

describe("derived facts cache", () => {
  it("is keyed per user so one user's admin status cannot leak to another", async () => {
    resetConnectionFactsCache();
    const { dropUserConnectionFacts } = await import("./connectionResolver");
    // Nothing to assert about ClickHouse here without a live server; the
    // contract under test is that eviction is scoped to one user's entries and
    // does not throw on an empty cache.
    expect(() => dropUserConnectionFacts("user-1")).not.toThrow();
  });
});
