/**
 * Database-backed rate-limiter store.
 *
 * hono-rate-limiter defaults to an in-process MemoryStore, which counts hits
 * per-pod. Behind multiple replicas that silently multiplies every limit by the
 * replica count — a 10/15min login limit becomes 10×N. This store keeps the
 * counters in the existing RBAC database (SQLite or PostgreSQL) so the limit is
 * enforced across all replicas with no extra infrastructure (no Redis).
 *
 * It is intended for the low-volume, security-sensitive limiters (login / SSO).
 * The high-volume resource guards (query / AI / general API) deliberately keep
 * the in-memory store — a DB write per request there would be a hot-path cost,
 * and per-pod throttling is acceptable for resource protection.
 *
 * Window model: fixed window, identical to MemoryStore. Each row holds the hit
 * count and the window's expiry (`reset_at_ms`, epoch milliseconds). Increment is
 * a single atomic upsert so concurrent requests across pods can't lose updates.
 */
import { sql } from "drizzle-orm";
import type { ClientRateLimitInfo, Store } from "hono-rate-limiter";
import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../rbac/db";
import { logger } from "../utils/logger";

/** Run a statement that returns rows, dialect-agnostically. */
async function selectRows(query: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(query) as Array<Record<string, unknown>>;
  }
  const res = await (db as PostgresDb).execute(query);
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
}

/** Run a statement that returns nothing, dialect-agnostically. */
async function execute(query: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(query);
  } else {
    await (db as PostgresDb).execute(query);
  }
}

/**
 * Delete expired counter rows so the table can't grow unbounded as new client
 * identifiers (e.g. IPs) appear. Safe to call periodically; a no-op if the table
 * does not exist yet (e.g. before migrations have run).
 */
export async function cleanupExpiredRateLimits(nowMs: number = Date.now()): Promise<void> {
  try {
    await execute(sql`DELETE FROM _rbac_rate_limits WHERE reset_at_ms <= ${Math.floor(nowMs)}`);
  } catch (error) {
    logger.warn(
      { module: "RateLimit", err: error instanceof Error ? error.message : String(error) },
      "Failed to clean up expired rate-limit rows"
    );
  }
}

export class DbRateLimitStore implements Store {
  /** Shared store — counters are visible across replicas. */
  localKeys = false;

  // ECMAScript private fields (not TS `private`): they stay invisible to the type
  // system so the class remains structurally assignable to the `Store` type.
  #windowMs: number;
  readonly #prefix: string;

  /**
   * @param prefix Namespaces this limiter's keys so several limiters can share
   *   the table without colliding on the same client identifier.
   * @param windowMs Fallback window; overridden by the value hono-rate-limiter
   *   passes to `init` when the middleware is created.
   */
  constructor(prefix: string, windowMs: number) {
    this.#prefix = prefix;
    this.#windowMs = windowMs;
  }

  init(options: { windowMs: number }): void {
    this.#windowMs = options.windowMs;
  }

  #fullKey(key: string): string {
    return `${this.#prefix}${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now();
    const resetIfNew = now + this.#windowMs;
    const fullKey = this.#fullKey(key);

    // Single atomic upsert: start a fresh window when the stored one has expired,
    // otherwise bump the existing count. Atomicity (row lock on conflict) is what
    // makes this safe under concurrent requests from multiple pods.
    const rows = await selectRows(sql`
      INSERT INTO _rbac_rate_limits (key, hits, reset_at_ms)
      VALUES (${fullKey}, 1, ${resetIfNew})
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN _rbac_rate_limits.reset_at_ms <= ${now}
                    THEN 1 ELSE _rbac_rate_limits.hits + 1 END,
        reset_at_ms = CASE WHEN _rbac_rate_limits.reset_at_ms <= ${now}
                    THEN ${resetIfNew} ELSE _rbac_rate_limits.reset_at_ms END
      RETURNING hits, reset_at_ms
    `);

    const row = rows[0] ?? { hits: 1, reset_at_ms: resetIfNew };
    return {
      totalHits: Number(row.hits),
      resetTime: new Date(Number(row.reset_at_ms)),
    };
  }

  async decrement(key: string): Promise<void> {
    const now = Date.now();
    // Only undo a hit inside the active window; an expired row is irrelevant.
    await execute(sql`
      UPDATE _rbac_rate_limits
      SET hits = CASE WHEN hits > 0 THEN hits - 1 ELSE 0 END
      WHERE key = ${this.#fullKey(key)} AND reset_at_ms > ${now}
    `);
  }

  async resetKey(key: string): Promise<void> {
    await execute(sql`DELETE FROM _rbac_rate_limits WHERE key = ${this.#fullKey(key)}`);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const now = Date.now();
    const rows = await selectRows(sql`
      SELECT hits, reset_at_ms FROM _rbac_rate_limits WHERE key = ${this.#fullKey(key)}
    `);
    const row = rows[0];
    if (!row) return undefined;
    const resetAtMs = Number(row.reset_at_ms);
    // An expired window reads as "no hits yet".
    if (resetAtMs <= now) return undefined;
    return {
      totalHits: Number(row.hits),
      resetTime: new Date(resetAtMs),
    };
  }
}
