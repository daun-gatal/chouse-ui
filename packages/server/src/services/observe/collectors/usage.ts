/**
 * `usage` collector (ADR 0016 §5, §11): who reads which tables (people, jobs,
 * agents, external clients), which columns they filter on, automatic
 * criticality, and the known-good query patterns the context engine serves.
 */

import { sql, type SQL } from "drizzle-orm";

import { NOT_OBSERVE, selectRows } from "../clickhouse";
import type { CollectorContext, ConnectionCollector } from "../collector";
import { all, num, runBatch, str } from "../db";
import { assignCriticality } from "../baselines";
import { principalOf } from "./lineage";

const DAY = 24 * 3600 * 1000;

/** Columns of `table` that appear in the WHERE / PREWHERE clause of a query. */
export function filterColumns(query: string, columns: string[]): string[] {
  const match = /\b(?:PREWHERE|WHERE)\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|\bHAVING\b|\bSETTINGS\b|\bFORMAT\b|$)/i.exec(query);
  if (!match) return [];
  const clause = match[1];
  return columns.filter((c) => new RegExp(String.raw`(?:^|[^A-Za-z0-9_])\x60?${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\x60?(?:[^A-Za-z0-9_]|$)`).test(clause));
}

export const usageCollector: ConnectionCollector = {
  name: "usage",
  scope: "connection",
  intervalMs: 15 * 60 * 1000,
  requires: ["query_log"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const watermark = await ctx.getWatermark();
    const since = Math.max(watermark, now - 7 * DAY);
    const rows = await selectRows<{ tbl: string; src: string; job_id: string; pat_id: string; rbac_user_id: string; user: string; client: string; day_ms: number; reads: number; bytes: number; last_ms: number }>(ctx.client, `
      SELECT arrayJoin(arrayFilter(t -> NOT startsWith(t, 'system.') AND position(t, '.') > 0, tables)) AS tbl,
        JSONExtractString(log_comment, 'source') AS src, JSONExtractString(log_comment, 'job_id') AS job_id,
        JSONExtractString(log_comment, 'pat_id') AS pat_id, JSONExtractString(log_comment, 'rbac_user_id') AS rbac_user_id,
        user, if(client_name != '', client_name, splitByChar(' ', http_user_agent)[1]) AS client,
        toUnixTimestamp(toStartOfDay(event_time)) * 1000 AS day_ms, count() AS reads, sum(read_bytes) AS bytes,
        toUnixTimestamp64Milli(max(event_time_microseconds)) AS last_ms
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_kind = 'Select' AND event_time > fromUnixTimestamp64Milli({since:Int64}) AND ${NOT_OBSERVE}
      GROUP BY tbl, src, job_id, pat_id, rbac_user_id, user, client, day_ms
      LIMIT 200000`, { params: { since }, maxExecutionTime: 90 });

    const statements: SQL[] = [];
    for (const r of rows) {
      const dot = r.tbl.indexOf(".");
      const principal = principalOf(r);
      statements.push(sql`
        INSERT INTO obs_usage_rollups (connection_id, database_name, table_name, principal_kind, principal_id, day, reads, read_bytes, filter_columns)
        VALUES (${connectionId}, ${r.tbl.slice(0, dot)}, ${r.tbl.slice(dot + 1)}, ${principal.kind}, ${principal.id}, ${r.day_ms}, ${r.reads}, ${r.bytes}, '{}')
        ON CONFLICT (connection_id, database_name, table_name, principal_kind, principal_id, day) DO UPDATE SET
          reads = obs_usage_rollups.reads + ${r.reads}, read_bytes = obs_usage_rollups.read_bytes + ${r.bytes}
      `);
    }

    // Filter columns and known-good patterns from the 30-day query shapes per table.
    const shapes = await selectRows<{ tbl: string; fp: string; sample: string; runs: number; users: number; p95: number; read_rows: number }>(ctx.client, `
      SELECT arrayJoin(arrayFilter(t -> NOT startsWith(t, 'system.') AND position(t, '.') > 0, tables)) AS tbl,
        toString(normalized_query_hash) AS fp, any(substring(query, 1, 2000)) AS sample, count() AS runs, uniqExact(user) AS users,
        quantile(0.95)(query_duration_ms) AS p95, avg(read_rows) AS read_rows
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_kind = 'Select' AND event_time > now() - INTERVAL 30 DAY AND ${NOT_OBSERVE}
      GROUP BY tbl, fp HAVING runs >= 5
      ORDER BY runs DESC LIMIT 5000`, { maxExecutionTime: 90 });
    const columnsByTable = new Map<string, string[]>();
    for (const c of await all(sql`SELECT database_name, table_name, column_name FROM obs_catalog_columns WHERE connection_id = ${connectionId}`)) {
      const key = `${str(c.database_name)}.${str(c.table_name)}`;
      columnsByTable.set(key, [...(columnsByTable.get(key) ?? []), str(c.column_name)]);
    }
    const totals = new Map((await all(sql`SELECT database_name, table_name, total_rows FROM obs_catalog_tables WHERE connection_id = ${connectionId}`)).map((r) => [`${str(r.database_name)}.${str(r.table_name)}`, num(r.total_rows)]));
    const filters = new Map<string, Record<string, number>>();
    const patterns = new Map<string, typeof shapes>();
    for (const s of shapes) {
      const cols = filterColumns(s.sample, columnsByTable.get(s.tbl) ?? []);
      const counts = filters.get(s.tbl) ?? {};
      for (const c of cols) counts[c] = (counts[c] ?? 0) + Number(s.runs);
      filters.set(s.tbl, counts);
      patterns.set(s.tbl, [...(patterns.get(s.tbl) ?? []), s]);
    }
    for (const [tbl, counts] of filters) {
      const dot = tbl.indexOf(".");
      statements.push(sql`
        INSERT INTO obs_usage_rollups (connection_id, database_name, table_name, principal_kind, principal_id, day, reads, read_bytes, filter_columns)
        VALUES (${connectionId}, ${tbl.slice(0, dot)}, ${tbl.slice(dot + 1)}, '_filters', '*', 0, 0, 0, ${JSON.stringify(counts)})
        ON CONFLICT (connection_id, database_name, table_name, principal_kind, principal_id, day) DO UPDATE SET filter_columns = ${JSON.stringify(counts)}
      `);
    }
    statements.push(sql`DELETE FROM ctx_patterns WHERE connection_id = ${connectionId}`);
    for (const [tbl, list] of patterns) {
      const dot = tbl.indexOf(".");
      const total = totals.get(tbl) ?? 0;
      // Known-good: frequent, shared, and reading a small slice of the table.
      const good = list
        .map((s) => ({ ...s, ratio: total > 0 ? Number(s.read_rows) / total : null }))
        .filter((s) => Number(s.runs) >= 20 && (s.ratio === null || s.ratio <= 0.2))
        .sort((a, b) => Number(b.runs) - Number(a.runs))
        .slice(0, 5);
      for (const p of good) {
        statements.push(sql`
          INSERT INTO ctx_patterns (connection_id, database_name, table_name, fingerprint, sample_query, runs, users, p95_ms, read_ratio, updated_at)
          VALUES (${connectionId}, ${tbl.slice(0, dot)}, ${tbl.slice(dot + 1)}, ${p.fp}, ${p.sample}, ${p.runs}, ${p.users}, ${p.p95}, ${p.ratio}, ${now})
        `);
      }
    }
    statements.push(sql`DELETE FROM obs_usage_rollups WHERE connection_id = ${connectionId} AND day > 0 AND day < ${now - 90 * DAY}`);
    await runBatch(statements);

    // Automatic criticality from the last 7 days (owners' pins win).
    const usage = await all(sql`
      SELECT database_name, table_name, SUM(reads) AS reads, COUNT(DISTINCT principal_kind || ':' || principal_id) AS readers
      FROM obs_usage_rollups WHERE connection_id = ${connectionId} AND principal_kind <> '_filters' AND day >= ${now - 7 * DAY}
      GROUP BY database_name, table_name`);
    const scores = usage.map((u) => ({ key: `${str(u.database_name)}.${str(u.table_name)}`, reads7d: num(u.reads), readers7d: num(u.readers) }));
    const criticality = assignCriticality(scores);
    const updates: SQL[] = [];
    for (const s of scores) {
      const dot = s.key.indexOf(".");
      const level = criticality.get(s.key) ?? "standard";
      updates.push(sql`
        UPDATE obs_table_baselines SET readers_7d = ${s.readers7d}, reads_7d = ${s.reads7d},
          criticality = CASE WHEN criticality_pinned = 1 THEN criticality ELSE ${level} END
        WHERE connection_id = ${connectionId} AND database_name = ${s.key.slice(0, dot)} AND table_name = ${s.key.slice(dot + 1)}
      `);
    }
    await runBatch(updates);
    const newest = rows.reduce((m, r) => Math.max(m, Number(r.last_ms) || 0), since);
    await ctx.setWatermark(newest);
  },
};

