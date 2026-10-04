/**
 * `queries` collector (ADR 0016 §9): hourly rollups per query shape
 * (`normalized_query_hash`) and replica, bounded to the top
 * OBSERVE_MAX_FINGERPRINTS shapes by total time, plus regression detection
 * against each shape's own 14-day baseline with linked change events.
 */

import { randomUUID } from "crypto";

import { sql, type SQL } from "drizzle-orm";

import { NOT_OBSERVE, selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, json, num, numOrNull, runBatch, str, strOrNull } from "../db";
import { detectRegressions, linkChanges, type ChangeEvent, type FingerprintHour } from "../regressions";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MAX_FINGERPRINTS = Number(process.env.OBSERVE_MAX_FINGERPRINTS ?? 5000);

export const queriesCollector: ConnectionCollector = {
  name: "queries",
  scope: "connection",
  intervalMs: 15 * 60 * 1000,
  requires: ["query_log"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const watermark = await ctx.getWatermark();
    // Re-aggregate from the start of the last processed hour so partial hours complete.
    const from = Math.max(Math.floor((watermark || now - 15 * DAY) / HOUR) * HOUR, now - 15 * DAY);
    const [version] = await selectRows<{ v: string }>(ctx.client, "SELECT version() AS v");
    const rows = await selectRows<{ fp: string; replica: string; hour_ms: number; runs: number; errors: number; p50: number; p95: number; rb: number; mem: number; sample: string; kind: string; usr: string; tbls: string[]; total_ms: number }>(ctx.client, `
      WITH top AS (
        SELECT normalized_query_hash FROM system.query_log
        WHERE event_time >= fromUnixTimestamp({from:UInt32}) AND type != 'QueryStart' AND ${NOT_OBSERVE}
        GROUP BY normalized_query_hash ORDER BY sum(query_duration_ms) DESC LIMIT ${MAX_FINGERPRINTS}
      )
      SELECT toString(normalized_query_hash) AS fp, hostname AS replica,
        toUnixTimestamp(toStartOfHour(event_time)) * 1000 AS hour_ms,
        countIf(type = 'QueryFinish') AS runs, countIf(type != 'QueryFinish') AS errors,
        quantileIf(0.5)(query_duration_ms, type = 'QueryFinish') AS p50, quantileIf(0.95)(query_duration_ms, type = 'QueryFinish') AS p95,
        avgIf(read_bytes, type = 'QueryFinish') AS rb, avgIf(memory_usage, type = 'QueryFinish') AS mem,
        any(substring(query, 1, 2000)) AS sample, any(toString(query_kind)) AS kind, any(user) AS usr,
        arrayDistinct(arrayFlatten(groupArray(arrayFilter(t -> NOT startsWith(t, 'system.'), tables)))) AS tbls,
        sum(query_duration_ms) AS total_ms
      FROM system.query_log
      WHERE event_time >= fromUnixTimestamp({from:UInt32}) AND type != 'QueryStart' AND ${NOT_OBSERVE}
        AND normalized_query_hash IN (SELECT normalized_query_hash FROM top)
      GROUP BY fp, replica, hour_ms`, { params: { from: Math.floor(from / 1000) }, maxExecutionTime: 120 });

    const statements: SQL[] = [];
    for (const r of rows) {
      statements.push(sql`
        INSERT INTO obs_fingerprint_rollups (connection_id, fingerprint, replica, hour, runs, errors, p50_ms, p95_ms, avg_read_bytes, avg_memory, server_version)
        VALUES (${connectionId}, ${r.fp}, ${r.replica}, ${r.hour_ms}, ${r.runs}, ${r.errors}, ${r.p50}, ${r.p95}, ${r.rb}, ${r.mem}, ${version?.v ?? null})
        ON CONFLICT (connection_id, fingerprint, replica, hour) DO UPDATE SET runs = ${r.runs}, errors = ${r.errors}, p50_ms = ${r.p50}, p95_ms = ${r.p95},
          avg_read_bytes = ${r.rb}, avg_memory = ${r.mem}, server_version = ${version?.v ?? null}
      `);
      statements.push(sql`
        INSERT INTO obs_query_fingerprints (connection_id, fingerprint, replica, sample_query, query_kind, user_name, tables, first_seen_at, last_seen_at, total_ms)
        VALUES (${connectionId}, ${r.fp}, ${r.replica}, ${r.sample}, ${r.kind}, ${r.usr}, ${JSON.stringify(r.tbls ?? [])}, ${r.hour_ms}, ${r.hour_ms}, ${r.total_ms})
        ON CONFLICT (connection_id, fingerprint, replica) DO UPDATE SET sample_query = ${r.sample}, tables = ${JSON.stringify(r.tbls ?? [])},
          last_seen_at = CASE WHEN obs_query_fingerprints.last_seen_at > ${r.hour_ms} THEN obs_query_fingerprints.last_seen_at ELSE ${r.hour_ms} END,
          first_seen_at = CASE WHEN obs_query_fingerprints.first_seen_at < ${r.hour_ms} THEN obs_query_fingerprints.first_seen_at ELSE ${r.hour_ms} END,
          total_ms = ${r.total_ms}
      `);
    }
    statements.push(sql`DELETE FROM obs_fingerprint_rollups WHERE connection_id = ${connectionId} AND hour < ${now - 30 * DAY}`);
    statements.push(sql`DELETE FROM obs_query_fingerprints WHERE connection_id = ${connectionId} AND last_seen_at < ${now - 30 * DAY}`);
    await runBatch(statements);

    // Regression detection for shapes active in the last 24h.
    const active = await all(sql`
      SELECT DISTINCT fingerprint, replica FROM obs_fingerprint_rollups WHERE connection_id = ${connectionId} AND hour >= ${now - DAY}`);
    const changes: ChangeEvent[] = (await all(sql`SELECT * FROM obs_change_events WHERE connection_id = ${connectionId} AND occurred_at >= ${now - 16 * DAY}`)).map((c) => ({
      id: str(c.id), kind: str(c.kind), occurredAt: num(c.occurred_at), node: strOrNull(c.node), objectRef: strOrNull(c.object_ref), summary: str(c.summary),
    }));
    const open = new Map((await all(sql`SELECT id, fingerprint, replica, metric FROM obs_regressions WHERE connection_id = ${connectionId} AND status = 'open'`)).map((r) => [`${str(r.fingerprint)}|${str(r.replica)}|${str(r.metric)}`, str(r.id)]));
    const stillOpen = new Set<string>();
    const regressionStatements: SQL[] = [];
    for (const a of active) {
      const fp = str(a.fingerprint);
      const replica = str(a.replica);
      const hours: FingerprintHour[] = (await all(sql`
        SELECT hour, runs, p95_ms, avg_read_bytes, server_version FROM obs_fingerprint_rollups
        WHERE connection_id = ${connectionId} AND fingerprint = ${fp} AND replica = ${replica} AND hour >= ${now - 15 * DAY}`)).map((h) => ({
        hour: num(h.hour), runs: num(h.runs), p95Ms: numOrNull(h.p95_ms), avgReadBytes: numOrNull(h.avg_read_bytes), serverVersion: strOrNull(h.server_version),
      }));
      const findings = detectRegressions(hours, now);
      if (findings.length === 0) continue;
      const meta = await all(sql`SELECT sample_query, tables FROM obs_query_fingerprints WHERE connection_id = ${connectionId} AND fingerprint = ${fp} AND replica = ${replica}`);
      const tables = json<string[]>(meta[0]?.tables, []);
      for (const f of findings) {
        const key = `${fp}|${replica}|${f.metric}`;
        stillOpen.add(key);
        const linked = linkChanges(f.onsetAt, replica, tables, changes);
        const existingId = open.get(key);
        if (existingId) {
          regressionStatements.push(sql`UPDATE obs_regressions SET current_value = ${f.currentValue}, ratio = ${f.ratio}, runs = ${f.runs}, linked_changes = ${JSON.stringify(linked)} WHERE id = ${existingId}`);
        } else {
          regressionStatements.push(sql`
            INSERT INTO obs_regressions (id, connection_id, fingerprint, replica, metric, baseline_value, current_value, ratio, runs, onset_at, status, linked_changes, sample_query, detected_at)
            VALUES (${randomUUID()}, ${connectionId}, ${fp}, ${replica}, ${f.metric}, ${f.baselineValue}, ${f.currentValue}, ${f.ratio}, ${f.runs}, ${f.onsetAt}, 'open', ${JSON.stringify(linked)}, ${str(meta[0]?.sample_query)}, ${now})
          `);
        }
      }
    }
    for (const [key, id] of open) {
      if (!stillOpen.has(key)) regressionStatements.push(sql`UPDATE obs_regressions SET status = 'resolved', resolved_at = ${now} WHERE id = ${id}`);
    }
    await runBatch(regressionStatements);
    await ctx.setWatermark(Math.floor(now / HOUR) * HOUR);
  },
};
