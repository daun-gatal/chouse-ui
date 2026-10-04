/**
 * `fleet` collector — the former FleetPoller, now one collector of the
 * observability service (ADR 0016 §1, §15).
 *
 * Output contract is unchanged: one `fleet_snapshots` row per (connection,
 * metric, tick) with the JSON payload or the error, pruned after
 * FLEET_RETENTION_HOURS, and alert rules evaluated on every tick.
 */

import { logger } from "../../../utils/logger";
import { processTick } from "../../fleetAlerter";
import { FLEET_METRIC_KEYS, runFleetMetric, type FleetMetric } from "../../fleetMetrics";
import type { ConnectionRef, GlobalCollector } from "../collector";
import { isSqlite, run, sql } from "../db";

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** OBSERVE_FLEET_INTERVAL wins; the pre-0016 FLEET_POLL_INTERVAL_SECONDS still works. */
export const FLEET_INTERVAL_MS = envInt("OBSERVE_FLEET_INTERVAL", envInt("FLEET_POLL_INTERVAL_SECONDS", 30)) * 1000;
const PRUNE_INTERVAL_MS = envInt("FLEET_PRUNE_INTERVAL_MINUTES", 5) * 60 * 1000;
const RETENTION_HOURS = envInt("FLEET_RETENTION_HOURS", 24);
const PER_METRIC_TIMEOUT_MS = envInt("FLEET_METRIC_TIMEOUT_SECONDS", 15) * 1000;
const INSERT_CHUNK_SIZE = 200;

export interface SnapshotRow {
  connectionId: string;
  capturedAt: number; // unix seconds
  metric: FleetMetric;
  payload: string;
  error: string | null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pollConnection(connectionId: string, capturedAt: number): Promise<SnapshotRow[]> {
  const results = await Promise.allSettled(
    FLEET_METRIC_KEYS.map(async (metric) => {
      const res = await withTimeout(runFleetMetric(connectionId, metric), PER_METRIC_TIMEOUT_MS, `${connectionId}/${metric}`);
      return { metric, data: res.data };
    }),
  );
  return results.map((r, i): SnapshotRow => {
    const metric = FLEET_METRIC_KEYS[i];
    if (r.status === "fulfilled") return { connectionId, capturedAt, metric, payload: JSON.stringify(r.value.data), error: null };
    const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return { connectionId, capturedAt, metric, payload: "", error: message.slice(0, 1000) };
  });
}

export async function insertSnapshots(rows: SnapshotRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const tuples = chunk.map((r) => sql`(${r.connectionId}, ${r.capturedAt}, ${r.metric}, ${r.payload}, ${r.error})`);
    await run(sql`INSERT INTO fleet_snapshots (connection_id, captured_at, metric, payload, error) VALUES ${sql.join(tuples, sql`, `)}`);
  }
}

let lastPruneAt = 0;

async function pruneSnapshots(nowMs: number): Promise<void> {
  if (nowMs - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = nowMs;
  const cutoff = Math.floor(nowMs / 1000) - RETENTION_HOURS * 3600;
  await run(sql`DELETE FROM fleet_snapshots WHERE captured_at < ${cutoff}`);
  logger.debug({ module: "Observe", collector: "fleet", cutoff, sqlite: isSqlite() }, "Fleet snapshot prune complete");
}

export const fleetCollector: GlobalCollector = {
  name: "fleet",
  scope: "global",
  intervalMs: FLEET_INTERVAL_MS,
  async run(connections: ConnectionRef[], nowMs: number): Promise<void> {
    await pruneSnapshots(nowMs).catch((error) => {
      logger.error({ module: "Observe", collector: "fleet", err: error instanceof Error ? error.message : String(error) }, "Fleet snapshot prune failed");
    });
    if (connections.length === 0) return;
    const capturedAt = Math.floor(nowMs / 1000);
    const perConnection = await Promise.allSettled(connections.map((c) => pollConnection(c.id, capturedAt)));
    const allRows: SnapshotRow[] = [];
    perConnection.forEach((r, i) => {
      if (r.status === "fulfilled") {
        allRows.push(...r.value);
        return;
      }
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      for (const metric of FLEET_METRIC_KEYS) {
        allRows.push({ connectionId: connections[i].id, capturedAt, metric, payload: "", error: message.slice(0, 1000) });
      }
    });
    await insertSnapshots(allRows);
    // Alert evaluation never throws and must not block collection.
    void processTick(connections.map((c) => ({ id: c.id, name: c.name })) as Parameters<typeof processTick>[0], allRows);
    logger.info({ module: "Observe", collector: "fleet", connections: connections.length, rowsWritten: allRows.length, errored: allRows.filter((r) => r.error).length }, "Fleet collection complete");
  },
};
