/**
 * Fleet metrics — shared SQL catalogue + executor.
 *
 * Used by BOTH the live HTTP route (routes/fleet.ts) and the background
 * snapshot poller (services/fleetPoller.ts). Centralising the SQL here means
 * the on-demand and the scheduled paths can never drift apart — operators
 * see the same numbers whether the snapshot is fresh or the page just fell
 * back to a live fetch.
 */

import { ClientManager } from "./clientManager";
import { getConnectionWithPassword } from "../rbac/services/connections";
import type { ConnectionConfig } from "../types";
import { AppError } from "../types";

/**
 * Metric registry. Each entry is a read-only SELECT against system.*. Adding
 * a new fleet tile = adding a row here + a hook on the frontend.
 */
export const FLEET_METRICS = {
  /**
   * One-shot card payload: memory pressure, active/long-running query counts,
   * blocked-task summary, replica lag + which replica carries the worst lag.
   * Scalar subqueries so a missing metric on one server returns 0 instead of
   * dropping the whole row.
   */
  summary: `
    SELECT
      -- Memory ceiling with a fallback chain so cgroup-limited / containerised
      -- nodes (which don't expose OSMemoryTotal) still get a real denominator
      -- instead of degrading to 0 (a phantom "X / 0 Bytes → 0%"):
      --   1. OSMemoryTotal       — host RAM (bare-metal / VM).
      --   2. CGroupMemoryTotal   — the cgroup limit, BUT skip the ~2^63
      --      "no limit set" sentinel: value < 2^50 (1 PiB) rejects it while
      --      still admitting any realistic limit.
      --   3. max_server_memory_usage — the CH process ceiling (same sentinel
      --      guard; 0 = "auto", which isn't a usable number, so > 0 too).
      -- 0 only if none is available; the frontend renders that as "X / —".
      coalesce(
        (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1),
        (SELECT value FROM system.asynchronous_metrics
           WHERE metric = 'CGroupMemoryTotal' AND value > 0 AND value < pow(2, 50) LIMIT 1),
        (SELECT toFloat64(toUInt64OrZero(value)) FROM system.server_settings
           WHERE name = 'max_server_memory_usage'
             AND toUInt64OrZero(value) > 0 AND toUInt64OrZero(value) < pow(2, 50) LIMIT 1),
        0
      ) AS server_memory_total_bytes,
      (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' LIMIT 1) AS server_memory_used_bytes,
      -- System-wide CPU usage %. Built from the *Normalized async metrics
      -- (already divided by core count) so it's 0..100 regardless of node
      -- size and comparable across the fleet. coalesce()'d so a node missing
      -- any component degrades to 0 instead of nulling the whole summary row.
      -- Verified ≈ (1 - OSIdleTimeNormalized) on CH 24.11.
      least(100, greatest(0, round((
          coalesce((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSUserTimeNormalized'   LIMIT 1), 0)
        + coalesce((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSSystemTimeNormalized' LIMIT 1), 0)
        + coalesce((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSNiceTimeNormalized'   LIMIT 1), 0)
      ) * 100, 2))) AS server_cpu_percent,
      (SELECT count() FROM system.processes) AS active_queries,
      (SELECT count() FROM system.processes WHERE elapsed > 60) AS long_running_queries,
      (SELECT count() FROM system.merges WHERE elapsed > 300) AS long_running_merges,
      (SELECT count() FROM system.mutations WHERE is_done = 0) AS open_mutations,
      (SELECT count() FROM system.replicas WHERE absolute_delay > 60 OR is_readonly = 1) AS sick_replicas,
      (SELECT coalesce(toFloat64(max(absolute_delay)), 0) FROM system.replicas) AS max_replica_lag_seconds,
      (SELECT concat(database, '.', table, '.', replica_name) FROM system.replicas ORDER BY absolute_delay DESC LIMIT 1) AS max_lag_replica,
      uptime() AS uptime_seconds,
      version() AS server_version
  `,

  /**
   * Top 1 currently-executing query by elapsed time. Excludes our own polling
   * so the card doesn't keep showing "the longest query is the fleet poller".
   */
  longest_query: `
    SELECT
      query_id,
      user,
      substring(query, 1, 200) AS query_preview,
      toFloat64(elapsed) AS elapsed_seconds,
      memory_usage
    FROM system.processes
    WHERE query NOT LIKE '%FLEET_POLLER_MARKER%'
      AND query NOT LIKE '%system.processes%'
    ORDER BY elapsed DESC
    LIMIT 1
  `,

  /**
   * Top currently-executing queries by memory. Same shape as longest_query but
   * ordered by memory_usage — feeds the "high-memory query" alert rule. Returns
   * the top 20 (not just 1) so the client can raise a separate breach for EVERY
   * query over the threshold, not only the single greediest one.
   */
  top_memory_query: `
    SELECT
      query_id,
      user,
      substring(query, 1, 200) AS query_preview,
      toFloat64(elapsed) AS elapsed_seconds,
      memory_usage
    FROM system.processes
    WHERE query NOT LIKE '%FLEET_POLLER_MARKER%'
      AND query NOT LIKE '%system.processes%'
    ORDER BY memory_usage DESC
    LIMIT 20
  `,

  /**
   * One-row schema census for the node: how many databases, tables,
   * views, rows, and bytes it holds. Uses a subquery against system.databases
   * so empty databases (no tables yet) are still counted. All engines and
   * databases are included — no system/information_schema exclusion — so the
   * numbers match the Home and Metrics pages exactly.
   * Views = engine containing "View" (View + MaterializedView); everything
   * else is a table. Metadata only — total_rows is a cached column, no scan.
   */
  schema_totals: `
    SELECT
      (SELECT count() FROM system.databases) AS databases,
      countIf(engine NOT LIKE '%View%') AS tables,
      countIf(engine LIKE '%View%') AS views,
      coalesce(sum(total_rows), 0) AS rows,
      coalesce(sum(total_bytes), 0) AS bytes
    FROM system.tables
  `,

  /**
   * Recent ClickHouse exceptions in the past hour. The fleet card shows
   * row[0] (the latest); the fleet-wide exceptions feed merges all rows
   * across nodes. LIMIT 10 keeps the snapshot payload small while giving
   * the feed enough to be useful.
   */
  last_exception: `
    SELECT
      formatDateTime(event_time, '%Y-%m-%d %H:%i:%S') AS event_time_str,
      exception_code,
      substring(exception, 1, 500) AS exception_preview,
      user,
      query_id
    FROM system.query_log
    WHERE event_time >= now() - INTERVAL 1 HOUR
      AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
      AND exception != ''
    ORDER BY event_time DESC
    LIMIT 10
  `,

  /**
   * Per-table parts pressure — the data behind the "too many parts" failure
   * mode. For each table we report the live part count, the worst single
   * partition's part count (the value ClickHouse actually compares against
   * parts_to_throw_insert), and the insert-vs-merge race over the last 10
   * minutes. net_parts_per_min > 0 means parts are accumulating faster than
   * merges clear them; eta_minutes then projects when the worst partition
   * crosses the threshold (-1 = converging / not approaching the wall).
   *
   * Rates are approximate by design: insert rate = NewPart events/min, merge
   * rate = MergeParts events/min from system.part_log. The threshold is the
   * table's effective parts_to_throw_insert: a per-table SETTINGS override
   * (parsed from create_table_query) when present, otherwise the server-global
   * default from system.merge_tree_settings, falling back to 300 when neither
   * is available. LIMIT 20 (worst partitions first) keeps the payload small.
   */
  parts_pressure: `
    WITH
      (SELECT toFloat64OrZero(value) FROM system.merge_tree_settings WHERE name = 'parts_to_throw_insert') AS global_threshold_raw,
      if(global_threshold_raw > 0, global_threshold_raw, 300) AS global_threshold,
      parts_agg AS (
        SELECT
          database,
          table,
          sum(part_count) AS active_parts,
          max(part_count) AS max_parts_in_partition,
          sum(part_rows) AS rows,
          sum(part_bytes) AS bytes
        FROM (
          SELECT
            database,
            table,
            partition_id,
            count() AS part_count,
            sum(rows) AS part_rows,
            sum(bytes_on_disk) AS part_bytes
          FROM system.parts
          WHERE active
            AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
          GROUP BY database, table, partition_id
        )
        GROUP BY database, table
      ),
      merges_agg AS (
        SELECT database, table, count() AS merges_running
        FROM system.merges
        GROUP BY database, table
      ),
      log_agg AS (
        SELECT
          database,
          table,
          countIf(event_type = 'NewPart') / 10.0 AS insert_parts_per_min,
          countIf(event_type = 'MergeParts') / 10.0 AS merge_parts_per_min
        FROM system.part_log
        WHERE event_time >= now() - INTERVAL 10 MINUTE
        GROUP BY database, table
      ),
      settings_agg AS (
        SELECT
          database,
          name AS table,
          toFloat64OrZero(extract(create_table_query, 'parts_to_throw_insert\\\\s*=\\\\s*(\\\\d+)')) AS table_threshold
        FROM system.tables
        WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      )
    SELECT
      p.database AS database,
      p.table AS table,
      p.active_parts AS active_parts,
      p.max_parts_in_partition AS max_parts_in_partition,
      p.rows AS rows,
      p.bytes AS bytes,
      coalesce(m.merges_running, 0) AS merges_running,
      coalesce(l.insert_parts_per_min, 0) AS insert_parts_per_min,
      coalesce(l.merge_parts_per_min, 0) AS merge_parts_per_min,
      if(s.table_threshold > 0, s.table_threshold, global_threshold) AS parts_threshold,
      (coalesce(l.insert_parts_per_min, 0) - coalesce(l.merge_parts_per_min, 0)) AS net_parts_per_min,
      if(
        net_parts_per_min > 0,
        (parts_threshold - p.max_parts_in_partition) / net_parts_per_min,
        -1
      ) AS eta_minutes
    FROM parts_agg p
    LEFT JOIN merges_agg m ON p.database = m.database AND p.table = m.table
    LEFT JOIN log_agg l ON p.database = l.database AND p.table = l.table
    LEFT JOIN settings_agg s ON p.database = s.database AND p.table = s.table
    ORDER BY max_parts_in_partition DESC
    LIMIT 20
  `,
} as const;

export type FleetMetric = keyof typeof FLEET_METRICS;
export const FLEET_METRIC_KEYS = Object.keys(FLEET_METRICS) as FleetMetric[];

export interface FleetMetricResult {
  meta: { name: string; type: string }[];
  data: Record<string, unknown>[];
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
  rows: number;
}

/**
 * Build a pooled ClickHouse client for a connection by id. Decrypts the
 * password the same way /connections/:id/connect does, then hands the config
 * to ClientManager so the connection stays warm across polls.
 *
 * Throws AppError on missing / inactive / decrypt-failure so the caller can
 * surface a structured error to the API caller or log it from the poller.
 */
export async function buildFleetConfig(
  connectionId: string,
): Promise<ConnectionConfig> {
  const connection = await getConnectionWithPassword(connectionId);
  if (!connection) {
    throw AppError.notFound(`Connection ${connectionId} not found`);
  }
  if (!connection.isActive) {
    throw AppError.badRequest(`Connection ${connectionId} is not active`);
  }
  const protocol = connection.sslEnabled ? "https" : "http";
  return {
    url: `${protocol}://${connection.host}:${connection.port}`,
    username: connection.username,
    password: connection.password || "",
    database: connection.database || undefined,
  };
}

/**
 * Run a single fleet metric SQL against a connection. Used by:
 *   - routes/fleet.ts (live, on-demand)
 *   - services/fleetPoller.ts (scheduled, persisted to fleet_snapshots)
 *
 * Returns the same shape as routes/query.ts's QueryResult so frontend hooks
 * don't need to know which path the data came from.
 */
export async function runFleetMetric(
  connectionId: string,
  metric: FleetMetric,
): Promise<FleetMetricResult> {
  const config = await buildFleetConfig(connectionId);
  const client = ClientManager.getInstance().getClient(config);
  const result = await client.query({
    query: FLEET_METRICS[metric],
    format: "JSON",
  });
  const json = (await result.json()) as {
    meta?: { name: string; type: string }[];
    data?: Record<string, unknown>[];
    statistics?: { elapsed: number; rows_read: number; bytes_read: number };
    rows?: number;
  };
  return {
    meta: json.meta ?? [],
    data: json.data ?? [],
    statistics: json.statistics ?? { elapsed: 0, rows_read: 0, bytes_read: 0 },
    rows: json.rows ?? (json.data?.length ?? 0),
  };
}
