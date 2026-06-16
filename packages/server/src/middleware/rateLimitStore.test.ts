/**
 * DbRateLimitStore tests — run against BOTH SQLite and PostgreSQL (Docker required
 * for the Postgres leg, same as the migration tests). The store's correctness under
 * concurrency only matters on Postgres (multi-replica), but the SQL must behave
 * identically on both dialects, so both are exercised.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { DbRateLimitStore, cleanupExpiredRateLimits } from "./rateLimitStore";

const DIALECTS: h.Dialect[] = ["sqlite", "postgres"];

let pg: h.PostgresContainer | undefined;

beforeAll(async () => {
  pg = await h.startPostgresContainer();
}, 180_000);

afterAll(async () => {
  await closeDatabase();
  pg?.stop();
}, 30_000);

/** Force a key's window to have already expired, deterministically. */
async function expire(key: string): Promise<void> {
  await h.rawRun(sql`UPDATE _rbac_rate_limits SET reset_at_ms = 1 WHERE key = ${key}`);
}

for (const dialect of DIALECTS) {
  describe(`DbRateLimitStore [${dialect}]`, () => {
    beforeAll(async () => {
      await h.freshDatabase(dialect, pg);
      await runMigrations({ skipSeed: true });
    }, 60_000);

    it("increments a key's hit count within the window", async () => {
      const store = new DbRateLimitStore("inc:", 60_000);
      const a = await store.increment("1.1.1.1");
      const b = await store.increment("1.1.1.1");
      const c = await store.increment("1.1.1.1");
      expect(a.totalHits).toBe(1);
      expect(b.totalHits).toBe(2);
      expect(c.totalHits).toBe(3);
      // resetTime is the window expiry, in the future.
      expect(c.resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it("tracks distinct keys independently", async () => {
      const store = new DbRateLimitStore("distinct:", 60_000);
      await store.increment("a");
      await store.increment("a");
      const b = await store.increment("b");
      expect(b.totalHits).toBe(1);
    });

    it("isolates keys by limiter prefix", async () => {
      const login = new DbRateLimitStore("p-login:", 60_000);
      const sso = new DbRateLimitStore("p-sso:", 60_000);
      await login.increment("9.9.9.9");
      await login.increment("9.9.9.9");
      const ssoHit = await sso.increment("9.9.9.9"); // same client id, different limiter
      expect(ssoHit.totalHits).toBe(1);
    });

    it("starts a fresh window once the previous one has expired", async () => {
      const store = new DbRateLimitStore("expire:", 60_000);
      await store.increment("ip");
      const second = await store.increment("ip");
      expect(second.totalHits).toBe(2);

      await expire("expire:ip");

      const afterExpiry = await store.increment("ip");
      expect(afterExpiry.totalHits).toBe(1); // counter reset
      expect(afterExpiry.resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it("decrement undoes a hit but never goes below zero", async () => {
      const store = new DbRateLimitStore("dec:", 60_000);
      await store.increment("ip");
      await store.increment("ip");
      await store.decrement("ip");
      const after = await store.get("ip");
      expect(after?.totalHits).toBe(1);

      await store.decrement("ip");
      await store.decrement("ip"); // already at 0 — must clamp
      const floored = await store.get("ip");
      expect(floored?.totalHits).toBe(0);
    });

    it("resetKey clears a key", async () => {
      const store = new DbRateLimitStore("reset:", 60_000);
      await store.increment("ip");
      await store.resetKey("ip");
      expect(await store.get("ip")).toBeUndefined();
    });

    it("get returns undefined for an unknown or expired key", async () => {
      const store = new DbRateLimitStore("get:", 60_000);
      expect(await store.get("never")).toBeUndefined();
      await store.increment("ip");
      await expire("get:ip");
      expect(await store.get("ip")).toBeUndefined();
    });

    it("cleanup removes only expired rows", async () => {
      const store = new DbRateLimitStore("clean:", 60_000);
      await store.increment("live");
      await store.increment("dead");
      await expire("clean:dead");

      await cleanupExpiredRateLimits();

      // The live window survives; the expired one is gone.
      expect((await store.get("live"))?.totalHits).toBe(1);
      const rows = await h.rawAll(sql`SELECT key FROM _rbac_rate_limits WHERE key = ${"clean:dead"}`);
      expect(rows).toHaveLength(0);
    });

    it("does not lose updates under concurrent increments", async () => {
      const store = new DbRateLimitStore("concurrent:", 60_000);
      const N = 25;
      const results = await Promise.all(
        Array.from({ length: N }, () => store.increment("ip"))
      );
      const hits = results.map((r) => r.totalHits).sort((a, b) => a - b);
      // Every increment must have produced a distinct count 1..N — no two requests
      // saw the same value (which would mean a lost update).
      expect(hits).toEqual(Array.from({ length: N }, (_, i) => i + 1));
      expect((await store.get("ip"))?.totalHits).toBe(N);
    }, 30_000);
  });
}
