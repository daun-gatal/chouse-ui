/**
 * Persistence for the fleet alerter's breach latches (ADR 0010).
 *
 * The alerter fires only on the healthy → breach edge, which makes the latch map
 * request-authoritative: it is the sole record of "we already told you about
 * this". Held in process memory, it was lost whenever the poller lease moved —
 * a rollout, an eviction, a crash — and the next holder, starting from empty,
 * re-fired every condition that was still breaching. An alert storm on every
 * upgrade, precisely when operators are already paying attention to something
 * else.
 *
 * Only the lease holder ticks, so there is no write contention here; this is
 * about surviving failover, not coordinating concurrent writers.
 */
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { rawAll, rawRun, toNumber } from "../rbac/db/raw";

/** Latches older than this are dropped on load — the underlying node or query is long gone. */
const LATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Load the persisted latch state. Returns an empty map if the table is unavailable. */
export async function loadLatches(now: number = Date.now()): Promise<Map<string, boolean>> {
  try {
    await rawRun(sql`DELETE FROM fleet_alert_latches WHERE updated_at < ${now - LATCH_MAX_AGE_MS}`);
    const rows = await rawAll(sql`SELECT latch_key, armed FROM fleet_alert_latches`);
    const latches = new Map<string, boolean>();
    for (const row of rows) {
      latches.set(String(row.latch_key), toNumber(row.armed) === 1);
    }
    return latches;
  } catch (error) {
    logger.error(
      { module: "FleetAlerter", err: error instanceof Error ? error.message : String(error) },
      "Failed to load alert latches — this tick may re-fire already-notified breaches"
    );
    return new Map();
  }
}

/**
 * Write back only what changed this tick.
 *
 * Persisting is best-effort: a failure here must not abort the tick, because
 * the alerts have already been delivered. The cost of losing a write is one
 * duplicate alert after a failover, which is what this whole module is
 * reducing — not a correctness break.
 */
export async function persistLatches(
  changed: Map<string, boolean>,
  removed: Set<string>,
  now: number = Date.now()
): Promise<void> {
  try {
    for (const [key, armed] of changed) {
      const flag = armed ? 1 : 0;
      await rawRun(sql`
        INSERT INTO fleet_alert_latches (latch_key, armed, updated_at)
        VALUES (${key}, ${flag}, ${now})
        ON CONFLICT (latch_key) DO UPDATE SET armed = ${flag}, updated_at = ${now}
      `);
    }
    for (const key of removed) {
      await rawRun(sql`DELETE FROM fleet_alert_latches WHERE latch_key = ${key}`);
    }
  } catch (error) {
    logger.error(
      { module: "FleetAlerter", err: error instanceof Error ? error.message : String(error) },
      "Failed to persist alert latches"
    );
  }
}

/** Epoch ms of the last autonomous RCA scan, shared across replicas. */
export async function getLastAutoRcaAt(): Promise<number> {
  try {
    const rows = await rawAll(sql`SELECT last_auto_rca_at FROM fleet_alerter_runtime WHERE id = 1`);
    return rows.length > 0 ? toNumber(rows[0].last_auto_rca_at) : 0;
  } catch {
    // Fail closed for a cooldown: pretend a scan just happened rather than
    // risk a scan storm when the table is unreachable.
    return Date.now();
  }
}

export async function setLastAutoRcaAt(at: number): Promise<void> {
  try {
    await rawRun(sql`UPDATE fleet_alerter_runtime SET last_auto_rca_at = ${at} WHERE id = 1`);
  } catch (error) {
    logger.warn(
      { module: "FleetAlerter", err: error instanceof Error ? error.message : String(error) },
      "Failed to persist auto-RCA cooldown"
    );
  }
}
