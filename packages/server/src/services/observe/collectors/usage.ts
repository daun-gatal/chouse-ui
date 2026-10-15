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

/** query_log rows land a few seconds after a query ends; a window closes this long before now so none are missed. */
export const LOG_FLUSH_LAG_MS = 30_000;
const READS_WINDOW_DAYS = 7;
export const SHAPE_WINDOW_DAYS = 30;
/** No shapes query reads more than this many days of query_log; older history is filled in a step per run. */
export const SHAPE_BACKFILL_STEP_DAYS = 3;
const SHAPE_ROWS_PER_WINDOW = 20_000;
/** Sub-watermarks: the newest and the oldest query_log time folded into the daily rollups. */
const SHAPES_HIGH = "shapes";
const SHAPES_LOW = "shapes_low";

export interface ShapeDay {
  runs: number;
  /** Distinct users that day; across windows of one day the larger count is kept (a lower bound). */
  users: number;
  p95Ms: number;
  readRowsSum: number;
  sample: string | null;
}

/**
 * Fold one more window of a (table, shape, day) into what is stored. Runs and
 * rows add up; p95 is the runs-weighted mean of the windows' p95s; distinct
 * users can't be merged exactly, so the larger count is kept.
 */
export function mergeShapeDay(stored: ShapeDay | undefined, add: ShapeDay): ShapeDay {
  if (!stored || stored.runs <= 0) return add;
  const runs = stored.runs + add.runs;
  return {
    runs,
    users: Math.max(stored.users, add.users),
    p95Ms: runs > 0 ? (stored.p95Ms * stored.runs + add.p95Ms * add.runs) / runs : 0,
    readRowsSum: stored.readRowsSum + add.readRowsSum,
    sample: stored.sample ?? add.sample,
  };
}

export interface ShapePlan {
  /** query_log windows (from, to] to fold in this run, newest first. */
  windows: Array<{ from: number; to: number }>;
  high: number;
  low: number;
  /** The stored rollups no longer join up with the new window and must be cleared first. */
  reset: boolean;
}

/**
 * Which query_log windows the shapes step reads this run. The rollups cover
 * one contiguous range, (low, high]. Each run reads what is new since `high`
 * and, until the range spans 30 days, one older step before `low` — so the
 * first run already has today's shapes and history fills in behind them. No
 * window is longer than SHAPE_BACKFILL_STEP_DAYS: after a gap that long (a
 * first run, or a long pause) the range restarts at the newest step.
 */
export function shapePlan(high: number, low: number, now: number, until: number): ShapePlan {
  const step = SHAPE_BACKFILL_STEP_DAYS * DAY;
  const oldest = now - SHAPE_WINDOW_DAYS * DAY;
  const windows: Array<{ from: number; to: number }> = [];
  let reset = false;
  if (high <= 0 || until - high > step || low <= 0) {
    reset = high > 0;
    high = until;
    low = Math.max(until - step, oldest);
    windows.push({ from: low, to: high });
  } else {
    if (until > high) {
      windows.push({ from: high, to: until });
      high = until;
    }
    if (low > oldest) {
      const from = Math.max(low - step, oldest);
      windows.push({ from, to: low });
      low = from;
    }
  }
  return { windows, high, low, reset };
}

interface ShapeRow { tbl: string; fp: string; day_ms: number; sample: string; runs: number; users: number; p95: number; read_rows_sum: number }

/**
 * Read one window of SELECT shapes from query_log and fold it into the daily
 * rollups. Only rows in the window are read, so the query text of each
 * SELECT is read once, not on every run for 30 days.
 */
async function collectShapes(ctx: CollectorContext, until: number): Promise<void> {
  const connectionId = ctx.connection.id;
  const plan = shapePlan(await ctx.getWatermark(SHAPES_HIGH), await ctx.getWatermark(SHAPES_LOW), ctx.nowMs, until);
  if (plan.reset) await runBatch([sql`DELETE FROM obs_query_shape_days WHERE connection_id = ${connectionId}`]);
  for (const window of plan.windows) {
    const fresh = await selectRows<ShapeRow>(ctx.client, `
      SELECT arrayJoin(arrayFilter(t -> NOT startsWith(t, 'system.') AND position(t, '.') > 0, tables)) AS tbl,
        toString(normalized_query_hash) AS fp, toUnixTimestamp(toStartOfDay(event_time)) * 1000 AS day_ms,
        any(substring(query, 1, 2000)) AS sample, count() AS runs, uniq(user) AS users,
        quantile(0.95)(query_duration_ms) AS p95, sum(read_rows) AS read_rows_sum
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_kind = 'Select'
        AND event_time > fromUnixTimestamp64Milli({from:Int64}) AND event_time <= fromUnixTimestamp64Milli({to:Int64}) AND ${NOT_OBSERVE}
      GROUP BY tbl, fp, day_ms
      ORDER BY runs DESC LIMIT ${SHAPE_ROWS_PER_WINDOW}`, { params: { from: window.from, to: window.to }, maxExecutionTime: 90 });
    await foldShapes(connectionId, fresh);
  }
  await runBatch([sql`DELETE FROM obs_query_shape_days WHERE connection_id = ${connectionId} AND day < ${ctx.nowMs - (SHAPE_WINDOW_DAYS + 1) * DAY}`]);
  // Advance at once: rollups add up, so a window must never be folded in twice.
  await ctx.setWatermark(plan.high, SHAPES_HIGH);
  await ctx.setWatermark(plan.low, SHAPES_LOW);
}

async function foldShapes(connectionId: string, fresh: ShapeRow[]): Promise<void> {
  const days = [...new Set(fresh.map((r) => Number(r.day_ms)))];
  const stored = new Map<string, ShapeDay>();
  for (const day of days) {
    for (const r of await all(sql`
      SELECT database_name, table_name, fingerprint, runs, users, p95_ms, read_rows_sum, sample_query FROM obs_query_shape_days
      WHERE connection_id = ${connectionId} AND day = ${day}`)) {
      stored.set(`${str(r.database_name)}.${str(r.table_name)}|${str(r.fingerprint)}|${day}`, {
        runs: num(r.runs), users: num(r.users), p95Ms: num(r.p95_ms), readRowsSum: num(r.read_rows_sum), sample: r.sample_query === null ? null : str(r.sample_query),
      });
    }
  }
  const statements: SQL[] = [];
  for (const r of fresh) {
    const dot = r.tbl.indexOf(".");
    const day = Number(r.day_ms);
    const merged = mergeShapeDay(stored.get(`${r.tbl}|${r.fp}|${day}`), {
      runs: Number(r.runs), users: Number(r.users), p95Ms: Number(r.p95), readRowsSum: Number(r.read_rows_sum), sample: r.sample || null,
    });
    statements.push(sql`
      INSERT INTO obs_query_shape_days (connection_id, database_name, table_name, fingerprint, day, runs, users, p95_ms, read_rows_sum, sample_query)
      VALUES (${connectionId}, ${r.tbl.slice(0, dot)}, ${r.tbl.slice(dot + 1)}, ${r.fp}, ${day}, ${merged.runs}, ${merged.users}, ${merged.p95Ms}, ${merged.readRowsSum}, ${merged.sample})
      ON CONFLICT (connection_id, database_name, table_name, fingerprint, day) DO UPDATE SET
        runs = ${merged.runs}, users = ${merged.users}, p95_ms = ${merged.p95Ms}, read_rows_sum = ${merged.readRowsSum}, sample_query = ${merged.sample}
    `);
  }
  await runBatch(statements);
}

/** The 30-day shapes per table, summed from the daily rollups (as the old 30-day scan returned them). */
async function storedShapes(connectionId: string, now: number): Promise<Array<{ tbl: string; fp: string; sample: string; runs: number; users: number; p95: number; read_rows: number }>> {
  const rows = await all(sql`
    SELECT database_name, table_name, fingerprint, SUM(runs) AS runs, MAX(users) AS users,
      SUM(p95_ms * runs) AS p95_weighted, SUM(read_rows_sum) AS read_rows_sum, MAX(sample_query) AS sample
    FROM obs_query_shape_days
    WHERE connection_id = ${connectionId} AND day >= ${now - SHAPE_WINDOW_DAYS * DAY}
    GROUP BY database_name, table_name, fingerprint
    HAVING SUM(runs) >= 5
    ORDER BY SUM(runs) DESC
    LIMIT 5000`);
  return rows.map((r) => {
    const runs = num(r.runs);
    return {
      tbl: `${str(r.database_name)}.${str(r.table_name)}`,
      fp: str(r.fingerprint),
      sample: r.sample === null ? "" : str(r.sample),
      runs,
      users: num(r.users),
      p95: runs > 0 ? num(r.p95_weighted) / runs : 0,
      read_rows: runs > 0 ? num(r.read_rows_sum) / runs : 0,
    };
  });
}

export const usageCollector: ConnectionCollector = {
  name: "usage",
  scope: "connection",
  intervalMs: 15 * 60 * 1000,
  requires: ["query_log"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const until = now - LOG_FLUSH_LAG_MS;
    const watermark = await ctx.getWatermark();
    const since = Math.max(watermark, now - READS_WINDOW_DAYS * DAY);
    const rows = since >= until ? [] : await selectRows<{ tbl: string; src: string; job_id: string; pat_id: string; rbac_user_id: string; user: string; client: string; day_ms: number; reads: number; bytes: number }>(ctx.client, `
      SELECT arrayJoin(arrayFilter(t -> NOT startsWith(t, 'system.') AND position(t, '.') > 0, tables)) AS tbl,
        JSONExtractString(log_comment, 'source') AS src, JSONExtractString(log_comment, 'job_id') AS job_id,
        JSONExtractString(log_comment, 'pat_id') AS pat_id, JSONExtractString(log_comment, 'rbac_user_id') AS rbac_user_id,
        user, if(client_name != '', client_name, splitByChar(' ', http_user_agent)[1]) AS client,
        toUnixTimestamp(toStartOfDay(event_time)) * 1000 AS day_ms, count() AS reads, sum(read_bytes) AS bytes
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_kind = 'Select'
        AND event_time > fromUnixTimestamp64Milli({since:Int64}) AND event_time <= fromUnixTimestamp64Milli({until:Int64}) AND ${NOT_OBSERVE}
      GROUP BY tbl, src, job_id, pat_id, rbac_user_id, user, client, day_ms
      LIMIT 200000`, { params: { since, until }, maxExecutionTime: 90 });

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

    await collectShapes(ctx, until);
    const shapeList = await storedShapes(connectionId, now);
    const columnsByTable = new Map<string, string[]>();
    for (const c of await all(sql`SELECT database_name, table_name, column_name FROM obs_catalog_columns WHERE connection_id = ${connectionId}`)) {
      const key = `${str(c.database_name)}.${str(c.table_name)}`;
      columnsByTable.set(key, [...(columnsByTable.get(key) ?? []), str(c.column_name)]);
    }
    const totals = new Map((await all(sql`SELECT database_name, table_name, total_rows FROM obs_catalog_tables WHERE connection_id = ${connectionId}`)).map((r) => [`${str(r.database_name)}.${str(r.table_name)}`, num(r.total_rows)]));
    const filters = new Map<string, Record<string, number>>();
    const patterns = new Map<string, typeof shapeList>();
    for (const s of shapeList) {
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
    await ctx.setWatermark(Math.max(since, until));
  },
};

