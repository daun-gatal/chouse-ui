/**
 * FleetPoller — singleton worker that polls every active ClickHouse
 * connection on a schedule and writes the result to fleet_snapshots.
 *
 * Why this exists:
 *   M1's /api/fleet/query is on-demand — each browser opens N HTTP calls
 *   every poll interval × M cards. 4 operators × 6 clusters × 30s polling
 *   already saturates the cluster side. This worker centralises the polling:
 *   one HTTP→ClickHouse round-trip per (cluster, metric, interval) regardless
 *   of how many browsers are open.
 *
 * Lifecycle:
 *   - Starts on server boot from index.ts ONLY when FLEET_POLLER_ENABLED is
 *     truthy. Opt-in so legacy chouse-ui installs absorb this code without
 *     surprise background load.
 *   - Stops on graceful shutdown via stop().
 *
 * Multi-instance safety: NOT handled in this iteration. If two backend
 * containers run against the same SQLite DB they'll both poll and double-
 * write. Deferred to a future milestone once we have a real user with that
 * topology. Single-container deploy is the chouse-ui happy path.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../rbac/db";
import { listConnections } from "../rbac/services/connections";
import {
  FLEET_METRIC_KEYS,
  runFleetMetric,
  type FleetMetric,
} from "./fleetMetrics";
import { logger } from "../utils/logger";
import { processTick } from "./fleetAlerter";

// ============================================
// Env-driven configuration with safe defaults
// ============================================

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name: string): boolean {
  const v = (process.env[name] ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const POLL_INTERVAL_MS = envInt("FLEET_POLL_INTERVAL_SECONDS", 30) * 1000;
const PRUNE_INTERVAL_MS = envInt("FLEET_PRUNE_INTERVAL_MINUTES", 5) * 60 * 1000;
const RETENTION_HOURS = envInt("FLEET_RETENTION_HOURS", 24);
// Per-poll timeout per (connection, metric) — long enough for a slow cluster
// but short enough that one stuck cluster doesn't stall the whole tick.
const PER_METRIC_TIMEOUT_MS = envInt("FLEET_METRIC_TIMEOUT_SECONDS", 15) * 1000;
// Advisory lease so only one backend instance polls when several replicas run
// against a shared DB. TTL is a few poll intervals: the active holder renews
// every tick, and a dead holder's lease expires so a standby can take over.
const LEASE_TTL_SECONDS = Math.max(
  90,
  Math.floor((POLL_INTERVAL_MS / 1000) * 3),
);

// ============================================
// Snapshot insertion
// ============================================

interface SnapshotRow {
  connectionId: string;
  capturedAt: number;        // unix epoch seconds
  metric: FleetMetric;
  payload: string;           // JSON-encoded row(s) or empty string on error
  error: string | null;
}

// Max rows per INSERT statement. Each row binds 5 params; 200 rows = 1000
// params, comfortably under SQLite's 32766 and Postgres' 65535 ceilings.
// Chunking keeps the poller correct no matter how large the fleet grows.
const INSERT_CHUNK_SIZE = 200;

async function insertSnapshots(rows: SnapshotRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDatabase();
  const dbType = getDatabaseType();

  // One multi-row INSERT per chunk instead of one INSERT per row. On embedded
  // SQLite the difference is small, but on a remote Postgres each statement is
  // a network round-trip — at 20 nodes × 3 metrics that's 60 round-trips/tick
  // collapsed into 1. drizzle's sql.join builds the parameterized VALUES list
  // identically for both dialects.
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const tuples = chunk.map(
      (r) =>
        sql`(${r.connectionId}, ${r.capturedAt}, ${r.metric}, ${r.payload}, ${r.error})`,
    );
    const stmt = sql`
      INSERT INTO fleet_snapshots (connection_id, captured_at, metric, payload, error)
      VALUES ${sql.join(tuples, sql`, `)}
    `;
    if (dbType === "sqlite") {
      (db as SqliteDb).run(stmt);
    } else {
      await (db as PostgresDb).execute(stmt);
    }
  }
}

// ============================================
// Multi-instance lease
// ============================================

/**
 * Try to acquire or renew the single-row poller lease. Returns true if THIS
 * instance now holds the lease (and should poll), false if another live
 * instance holds it (and we should stand by).
 *
 * The claim is one atomic UPDATE: it succeeds only when the lease is already
 * ours or has expired. On SQLite writes are globally serialized; on Postgres
 * (READ COMMITTED) the UPDATE takes a row lock and re-evaluates its WHERE
 * against the committed row, so two racing instances can't both win. We then
 * read the row back to learn who holds it.
 */
async function acquireLease(holderId: string): Promise<boolean> {
  const db = getDatabase();
  const dbType = getDatabaseType();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + LEASE_TTL_SECONDS;

  const claim = sql`
    UPDATE fleet_poller_lease
    SET holder = ${holderId}, acquired_at = ${now}, expires_at = ${expires}
    WHERE id = 1 AND (holder = ${holderId} OR expires_at < ${now})
  `;
  const read = sql`SELECT holder FROM fleet_poller_lease WHERE id = 1`;

  if (dbType === "sqlite") {
    (db as SqliteDb).run(claim);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (db as SqliteDb).all(read) as any[];
    return rows[0]?.holder === holderId;
  }
  await (db as PostgresDb).execute(claim);
  const res = await (db as PostgresDb).execute(read);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  const rows = Array.isArray(anyRes) ? anyRes : (anyRes.rows ?? []);
  return rows[0]?.holder === holderId;
}

// ============================================
// Tick implementation
// ============================================

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`)),
      timeoutMs,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Poll one connection — runs every metric in parallel and returns rows ready
 * for insertion. Per-metric failure does NOT fail the whole connection;
 * each metric carries its own error column.
 */
async function pollConnection(
  connectionId: string,
  capturedAt: number,
): Promise<SnapshotRow[]> {
  const results = await Promise.allSettled(
    FLEET_METRIC_KEYS.map(async (metric) => {
      const res = await runWithTimeout(
        runFleetMetric(connectionId, metric),
        PER_METRIC_TIMEOUT_MS,
        `${connectionId}/${metric}`,
      );
      return { metric, data: res.data };
    }),
  );

  return results.map((r, i): SnapshotRow => {
    const metric = FLEET_METRIC_KEYS[i];
    if (r.status === "fulfilled") {
      return {
        connectionId,
        capturedAt,
        metric,
        payload: JSON.stringify(r.value.data),
        error: null,
      };
    }
    const message =
      r.reason instanceof Error ? r.reason.message : String(r.reason);
    return {
      connectionId,
      capturedAt,
      metric,
      payload: "",
      error: message.slice(0, 1000), // cap so a multi-MB CH error doesn't bloat the table
    };
  });
}

// ============================================
// Singleton class
// ============================================

class FleetPoller {
  private static instance: FleetPoller | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private isPruning = false;
  private wasHolder = false; // tracks lease ownership across ticks for logging
  private readonly runId = randomUUID();

  static getInstance(): FleetPoller {
    if (!FleetPoller.instance) {
      FleetPoller.instance = new FleetPoller();
    }
    return FleetPoller.instance;
  }

  /**
   * Start the worker. No-op if the FLEET_POLLER_ENABLED env is not set, so
   * importers can call this unconditionally from index.ts.
   */
  start(): void {
    if (!envBool("FLEET_POLLER_ENABLED")) {
      logger.info(
        { module: "FleetPoller" },
        "Fleet poller is disabled (set FLEET_POLLER_ENABLED=true to enable)",
      );
      return;
    }
    if (this.pollTimer) {
      logger.warn({ module: "FleetPoller" }, "Fleet poller already running");
      return;
    }

    logger.info(
      {
        module: "FleetPoller",
        runId: this.runId,
        intervalMs: POLL_INTERVAL_MS,
        pruneMs: PRUNE_INTERVAL_MS,
        retentionHours: RETENTION_HOURS,
        timeoutMs: PER_METRIC_TIMEOUT_MS,
      },
      "Fleet poller starting",
    );

    // Kick off the first tick immediately so the page has data within a
    // second of server boot, not after a full interval.
    void this.pollTick();
    this.pollTimer = setInterval(() => void this.pollTick(), POLL_INTERVAL_MS);
    this.pruneTimer = setInterval(
      () => void this.pruneTick(),
      PRUNE_INTERVAL_MS,
    );

    // Don't keep the process alive just for the poller — graceful shutdown
    // hooks in index.ts call stop() explicitly.
    this.pollTimer.unref?.();
    this.pruneTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    // Wait briefly for any in-flight tick to finish writing.
    let waited = 0;
    while ((this.isPolling || this.isPruning) && waited < 5000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }

    // Release the lease if we held it, so a standby takes over immediately
    // instead of waiting out the TTL. Best-effort — ignore failures on shutdown.
    if (this.wasHolder) {
      try {
        const db = getDatabase();
        const release = sql`
          UPDATE fleet_poller_lease SET holder = '', acquired_at = 0, expires_at = 0
          WHERE id = 1 AND holder = ${this.runId}
        `;
        if (getDatabaseType() === "sqlite") {
          (db as SqliteDb).run(release);
        } else {
          await (db as PostgresDb).execute(release);
        }
      } catch {
        // ignore — TTL expiry covers it
      }
    }

    logger.info({ module: "FleetPoller", runId: this.runId }, "Fleet poller stopped");
  }

  /**
   * One poll round: list active connections, poll each in parallel, persist.
   * Skips if a previous tick is still running so we don't pile up writes.
   */
  private async pollTick(): Promise<void> {
    if (this.isPolling) {
      logger.debug(
        { module: "FleetPoller" },
        "Previous tick still running; skipping this round",
      );
      return;
    }
    this.isPolling = true;
    const startedAt = Date.now();

    try {
      // Only the lease holder polls. Standby instances bail out here — they
      // keep ticking so they can take over if the holder dies.
      const isHolder = await acquireLease(this.runId);
      if (!isHolder) {
        if (this.wasHolder) {
          logger.info({ module: "FleetPoller", runId: this.runId }, "Lost/yielded poller lease; standing by");
        }
        this.wasHolder = false;
        return;
      }
      if (!this.wasHolder) {
        logger.info({ module: "FleetPoller", runId: this.runId }, "Acquired poller lease; this instance is polling");
      }
      this.wasHolder = true;

      const { connections } = await listConnections({ activeOnly: true });
      if (connections.length === 0) {
        logger.debug(
          { module: "FleetPoller" },
          "No active connections; nothing to poll",
        );
        return;
      }

      const capturedAt = Math.floor(Date.now() / 1000);
      const perConnection = await Promise.allSettled(
        connections.map((c) => pollConnection(c.id, capturedAt)),
      );

      const allRows: SnapshotRow[] = [];
      for (let i = 0; i < perConnection.length; i++) {
        const r = perConnection[i];
        if (r.status === "fulfilled") {
          allRows.push(...r.value);
        } else {
          // Whole-connection failure (decryption / not found etc) —
          // write one error row per metric so the page knows the cluster
          // is unreachable rather than "no data yet".
          const message =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
          for (const metric of FLEET_METRIC_KEYS) {
            allRows.push({
              connectionId: connections[i].id,
              capturedAt,
              metric,
              payload: "",
              error: message.slice(0, 1000),
            });
          }
        }
      }

      await insertSnapshots(allRows);

      // Evaluate alert rules on the fresh snapshots and deliver any new
      // breaches (Slack / email). Fire-and-forget — it never throws and must
      // not block or fail the poll loop.
      void processTick(connections, allRows);

      const errored = allRows.filter((r) => r.error).length;
      logger.info(
        {
          module: "FleetPoller",
          connections: connections.length,
          rowsWritten: allRows.length,
          errored,
          tookMs: Date.now() - startedAt,
        },
        "Fleet poll tick complete",
      );
    } catch (err) {
      logger.error(
        {
          module: "FleetPoller",
          err: err instanceof Error ? err.message : String(err),
        },
        "Fleet poll tick failed",
      );
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Delete snapshots older than the retention window. Cheap with the
   * captured_at index — index range scan + sequential delete.
   */
  private async pruneTick(): Promise<void> {
    if (this.isPruning) return;
    this.isPruning = true;
    try {
      const db = getDatabase();
      const dbType = getDatabaseType();
      const cutoff = Math.floor(Date.now() / 1000) - RETENTION_HOURS * 3600;
      if (dbType === "sqlite") {
        (db as SqliteDb).run(
          sql`DELETE FROM fleet_snapshots WHERE captured_at < ${cutoff}`,
        );
      } else {
        await (db as PostgresDb).execute(
          sql`DELETE FROM fleet_snapshots WHERE captured_at < ${cutoff}`,
        );
      }
      logger.debug(
        { module: "FleetPoller", cutoff, retentionHours: RETENTION_HOURS },
        "Fleet snapshot prune complete",
      );
    } catch (err) {
      logger.error(
        {
          module: "FleetPoller",
          err: err instanceof Error ? err.message : String(err),
        },
        "Fleet snapshot prune failed",
      );
    } finally {
      this.isPruning = false;
    }
  }
}

export { FleetPoller };
