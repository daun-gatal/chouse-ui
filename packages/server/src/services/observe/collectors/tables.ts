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
const CADENCE_DAYS = 7;
const HOUR = 3600 * 1000;

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

    const writeTimes = new Map<string, number[]>();
    const lastWrite = new Map<string, number>();
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
      const times = await selectRows<{ database: string; table: string; times: number[]; last_ms: number }>(ctx.client, `
        SELECT database, table, groupArray(2000)(toUnixTimestamp(event_time) * 1000) AS times, toUnixTimestamp(max(event_time)) * 1000 AS last_ms
        FROM system.part_log
        WHERE event_type = 'NewPart' AND event_time >= now() - INTERVAL ${CADENCE_DAYS} DAY AND database NOT IN ${EXCLUDED}
        GROUP BY database, table`, { maxExecutionTime: 60 });
      for (const t of times) {
        writeTimes.set(`${t.database}.${t.table}`, (t.times ?? []).map(Number));
        lastWrite.set(`${t.database}.${t.table}`, Number(t.last_ms));
      }
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

