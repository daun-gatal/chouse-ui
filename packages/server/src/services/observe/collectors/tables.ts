/**
 * `tables` collector (ADR 0016 §5): learned baselines for every table from
 * metadata only — inserted parts in `system.part_log` give write cadence and
 * hourly volume; the trust state follows from both.
 */

import { sql, type SQL } from "drizzle-orm";

import { hasTable } from "../capabilities";
import { selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, json, num, runBatch, str, strOrNull } from "../db";
import { classifyTable, learnCadence, learnVolumeBand, type HourlyVolume, type ProducerSignal } from "../baselines";

const EXCLUDED = "('system', 'INFORMATION_SCHEMA', 'information_schema')";
const BAND_DAYS = 28;
export const CADENCE_DAYS = 7;
/** Write times kept per table for cadence: the most recent ones. */
export const MAX_WRITE_TIMES = 2000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const CADENCE_STEP = "cadence";
/** Each cadence read starts this far before the last one ended, so part_log rows that landed late are not missed. */
const CADENCE_OVERLAP_MS = 2 * 60 * 1000;

/**
 * The stored write times of a table with newly read ones: deduplicated (the
 * reads overlap), within the cadence window, ascending, the most recent
 * MAX_WRITE_TIMES.
 */
export function mergeWriteTimes(stored: number[], fresh: number[], nowMs: number): number[] {
  const cutoff = nowMs - CADENCE_DAYS * DAY;
  const times = [...new Set([...stored, ...fresh].filter((t) => Number.isFinite(t) && t >= cutoff))].sort((a, b) => a - b);
  return times.slice(-MAX_WRITE_TIMES);
}

/**
 * Insert times per table for write cadence. Only part_log rows newer than the
 * cadence watermark are read (7 days on the first run) and merged into the
 * stored times, instead of re-reading 7 days of part_log every run.
 */
async function writeCadence(ctx: CollectorContext): Promise<{ writeTimes: Map<string, number[]>; lastWrite: Map<string, number> }> {
  const connectionId = ctx.connection.id;
  const now = ctx.nowMs;
  const mark = await ctx.getWatermark(CADENCE_STEP);
  const from = Math.max(mark > 0 ? mark - CADENCE_OVERLAP_MS : 0, now - CADENCE_DAYS * DAY);
  const fresh = await selectRows<{ database: string; table: string; times: number[]; last_ms: number }>(ctx.client, `
    SELECT database, table, arraySlice(arrayReverseSort(groupArray(toUnixTimestamp(event_time) * 1000)), 1, ${MAX_WRITE_TIMES}) AS times,
      toUnixTimestamp(max(event_time)) * 1000 AS last_ms
    FROM system.part_log
    WHERE event_type = 'NewPart' AND event_time >= fromUnixTimestamp({from:UInt32}) AND database NOT IN ${EXCLUDED}
    GROUP BY database, table`, { params: { from: Math.floor(from / 1000) }, maxExecutionTime: 60 });

  const writeTimes = new Map<string, number[]>();
  const lastWrite = new Map<string, number>();
  for (const r of await all(sql`SELECT database_name, table_name, write_times, last_write_at FROM obs_table_write_times WHERE connection_id = ${connectionId}`)) {
    const key = `${str(r.database_name)}.${str(r.table_name)}`;
    writeTimes.set(key, json<number[]>(r.write_times, []).map(Number));
    if (r.last_write_at !== null) lastWrite.set(key, num(r.last_write_at));
  }
  const statements: SQL[] = [];
  for (const f of fresh) {
    const key = `${f.database}.${f.table}`;
    const merged = mergeWriteTimes(writeTimes.get(key) ?? [], (f.times ?? []).map(Number), now);
    const last = Math.max(lastWrite.get(key) ?? 0, Number(f.last_ms) || 0);
    writeTimes.set(key, merged);
    lastWrite.set(key, last);
    statements.push(sql`
      INSERT INTO obs_table_write_times (connection_id, database_name, table_name, write_times, last_write_at, updated_at)
      VALUES (${connectionId}, ${f.database}, ${f.table}, ${JSON.stringify(merged)}, ${last}, ${now})
      ON CONFLICT (connection_id, database_name, table_name) DO UPDATE SET write_times = ${JSON.stringify(merged)}, last_write_at = ${last}, updated_at = ${now}
    `);
  }
  // Times older than the window no longer count; a table with none left is forgotten.
  for (const [key, times] of writeTimes) writeTimes.set(key, mergeWriteTimes(times, [], now));
  statements.push(sql`DELETE FROM obs_table_write_times WHERE connection_id = ${connectionId} AND (last_write_at IS NULL OR last_write_at < ${now - CADENCE_DAYS * DAY})`);
  await runBatch(statements);
  await ctx.setWatermark(now, CADENCE_STEP);
  // A table whose last write is older than the window has no cadence, as before.
  for (const [key, last] of lastWrite) if (last < now - CADENCE_DAYS * DAY) lastWrite.delete(key);
  return { writeTimes, lastWrite };
}

/** Worst first: a broken producer explains staleness, then a healthy one, then a paused one. */
const PRODUCER_RANK: Record<string, number> = { retrying: 0, stalled: 0, failing: 0, stopped: 0, healthy: 1, lagging: 1, inefficient: 1, paused: 2 };

/**
 * Clock-driven producers (scheduled jobs, refreshable views) per written table,
 * keyed `db.table`. Pipelines this server cannot judge are left out so the
 * table falls back to its own write pattern.
 */
async function clockProducers(connectionId: string): Promise<Map<string, ProducerSignal>> {
  const rows = await all(sql`
    SELECT kind, name, status, status_reason, target_node, attrs FROM obs_pipelines
    WHERE connection_id = ${connectionId} AND kind IN ('scheduled_job', 'refreshable_view')`);
  const best = new Map<string, ProducerSignal>();
  for (const r of rows) {
    const status = str(r.status);
    if (!(status in PRODUCER_RANK)) continue;
    const attrs = json<Record<string, unknown>>(r.attrs, {});
    const node = typeof attrs.writesTo === "string" ? attrs.writesTo : strOrNull(r.target_node);
    if (!node?.startsWith("table:")) continue;
    const key = node.slice("table:".length);
    const current = best.get(key);
    if (!current || PRODUCER_RANK[status] < PRODUCER_RANK[current.status]) {
      best.set(key, { name: str(r.name), status, reason: strOrNull(r.status_reason) });
    }
  }
  return best;
}

export const tablesCollector: ConnectionCollector = {
  name: "tables",
  scope: "connection",
  intervalMs: 5 * 60 * 1000,
  requires: ["part_log", "parts"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const watermark = await ctx.getWatermark();
    // Re-read the current (incomplete) hour every run; history only once.
    const from = Math.max(Math.floor((watermark || now - BAND_DAYS * 24 * HOUR) / HOUR) * HOUR, now - BAND_DAYS * 24 * HOUR);
    const partLog = hasTable(ctx.capabilities, "part_log");
    const statements: SQL[] = [];

    let writeTimes = new Map<string, number[]>();
    let lastWrite = new Map<string, number>();
    if (partLog) {
      const hourly = await selectRows<{ database: string; table: string; hour_ms: number; rows: number; bytes: number; parts: number }>(ctx.client, `
        SELECT database, table, toUnixTimestamp(toStartOfHour(event_time)) * 1000 AS hour_ms, sum(rows) AS rows, sum(size_in_bytes) AS bytes, count() AS parts
        FROM system.part_log
        WHERE event_type = 'NewPart' AND event_time >= fromUnixTimestamp({from:UInt32}) AND database NOT IN ${EXCLUDED}
        GROUP BY database, table, hour_ms`, { params: { from: Math.floor(from / 1000) }, maxExecutionTime: 60 });
      for (const h of hourly) {
        statements.push(sql`
          INSERT INTO obs_table_samples (connection_id, database_name, table_name, granularity, sampled_at, rows_added, bytes_added, parts_added)
          VALUES (${connectionId}, ${h.database}, ${h.table}, 'hour', ${h.hour_ms}, ${h.rows}, ${h.bytes}, ${h.parts})
          ON CONFLICT (connection_id, database_name, table_name, granularity, sampled_at) DO UPDATE SET rows_added = ${h.rows}, bytes_added = ${h.bytes}, parts_added = ${h.parts}
        `);
      }
      ({ writeTimes, lastWrite } = await writeCadence(ctx));
    }
    // Totals (and a last-write fallback when part_log is disabled) from active parts.
    const totals = await selectRows<{ database: string; table: string; rows: number; bytes: number; modified_ms: number }>(ctx.client, `
      SELECT database, table, sum(rows) AS rows, sum(bytes_on_disk) AS bytes, toUnixTimestamp(max(modification_time)) * 1000 AS modified_ms
      FROM system.parts WHERE active AND database NOT IN ${EXCLUDED} GROUP BY database, table`, { maxExecutionTime: 60 });
    await runBatch(statements);
    // Tables that never received data have no active parts but still need a
    // baseline: they are what sits downstream of a pipeline that never delivered.
    const withParts = new Set(totals.map((t) => `${t.database}.${t.table}`));
    for (const c of await all(sql`SELECT database_name, table_name FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND engine LIKE '%MergeTree'`)) {
      const key = `${str(c.database_name)}.${str(c.table_name)}`;
      if (!withParts.has(key)) totals.push({ database: str(c.database_name), table: str(c.table_name), rows: 0, bytes: 0, modified_ms: 0 });
    }

    const existing = new Map((await all(sql`SELECT database_name, table_name, criticality, criticality_pinned FROM obs_table_baselines WHERE connection_id = ${connectionId}`)).map((r) => [`${str(r.database_name)}.${str(r.table_name)}`, r]));
    const firstSeen = new Map((await all(sql`
      SELECT database_name, table_name, MIN(sampled_at) AS first_at FROM obs_table_samples
      WHERE connection_id = ${connectionId} AND granularity = 'hour' GROUP BY database_name, table_name`)).map((r) => [`${str(r.database_name)}.${str(r.table_name)}`, num(r.first_at)]));
    const bandRows = await all(sql`
      SELECT database_name, table_name, sampled_at, rows_added FROM obs_table_samples
      WHERE connection_id = ${connectionId} AND granularity = 'hour' AND sampled_at >= ${now - BAND_DAYS * 24 * HOUR}`);
    const hourlyByTable = new Map<string, HourlyVolume[]>();
    for (const r of bandRows) {
      const key = `${str(r.database_name)}.${str(r.table_name)}`;
      const list = hourlyByTable.get(key) ?? [];
      list.push({ hourStartMs: num(r.sampled_at), rows: num(r.rows_added) });
      hourlyByTable.set(key, list);
    }

    const producers = await clockProducers(connectionId);
    const updates: SQL[] = [];
    const lastCompleteHour = Math.floor(now / HOUR) * HOUR - HOUR;
    for (const t of totals) {
      const key = `${t.database}.${t.table}`;
      const hours = hourlyByTable.get(key) ?? [];
      // Fill zero hours between the first sample and now so quiet hours count.
      const known = new Map(hours.map((h) => [h.hourStartMs, h.rows]));
      const first = firstSeen.get(key) ?? lastCompleteHour;
      const dense: HourlyVolume[] = [];
      for (let h = Math.max(first, now - BAND_DAYS * 24 * HOUR); h <= lastCompleteHour; h += HOUR) dense.push({ hourStartMs: h, rows: known.get(h) ?? 0 });
      const baselineHours = dense.filter((h) => h.hourStartMs < lastCompleteHour);
      const band = learnVolumeBand(baselineHours);
      const cadence = learnCadence(writeTimes.get(key) ?? []);
      const lastWriteAt = lastWrite.get(key) ?? (partLog ? null : Number(t.modified_ms) || null);
      const verdict = classifyTable({
        nowMs: now,
        lastWriteAtMs: lastWriteAt,
        cadence,
        firstSeenAtMs: firstSeen.get(key) ?? now,
        lastHour: dense.find((h) => h.hourStartMs === lastCompleteHour) ?? null,
        band,
        producer: producers.get(key) ?? null,
      });
      const reason = partLog ? verdict.reason : `${verdict.reason} (system.part_log is disabled; freshness from part modification times)`;
      const prev = existing.get(key);
      const criticality = prev ? str(prev.criticality) : "standard";
      const pinned = prev ? num(prev.criticality_pinned) : 0;
      updates.push(sql`
        INSERT INTO obs_table_baselines (connection_id, database_name, table_name, state, state_reason, cadence_p50_s, cadence_p99_s, last_write_at, volume_band, criticality, criticality_pinned, total_rows, total_bytes, updated_at)
        VALUES (${connectionId}, ${t.database}, ${t.table}, ${verdict.state}, ${reason}, ${cadence?.p50Seconds ?? null}, ${cadence?.p99Seconds ?? null}, ${lastWriteAt}, ${JSON.stringify(band)}, ${criticality}, ${pinned}, ${t.rows}, ${t.bytes}, ${now})
        ON CONFLICT (connection_id, database_name, table_name) DO UPDATE SET
          state = ${verdict.state}, state_reason = ${reason}, cadence_p50_s = ${cadence?.p50Seconds ?? null}, cadence_p99_s = ${cadence?.p99Seconds ?? null},
          last_write_at = ${lastWriteAt}, volume_band = ${JSON.stringify(band)}, total_rows = ${t.rows}, total_bytes = ${t.bytes}, updated_at = ${now}
      `);
    }
    updates.push(sql`DELETE FROM obs_table_baselines WHERE connection_id = ${connectionId} AND updated_at < ${now}`);
    updates.push(sql`DELETE FROM obs_table_samples WHERE connection_id = ${connectionId} AND sampled_at < ${now - 90 * 24 * HOUR}`);
    await runBatch(updates);
    await ctx.setWatermark(Math.floor(now / HOUR) * HOUR);
  },
};

