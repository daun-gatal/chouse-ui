/**
 * Monitoring timeline hooks
 *
 * Read-only system.query_log / system.part_log aggregates for the
 * Monitoring → Logs (Query timeline) and Monitoring → Parts views.
 */

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { queryApi } from "@/api";
import { useAuthStore } from "@/stores";

export type TimelineBucket = "minute" | "hour";

/**
 * Absolute time window — when present, replaces hoursBack on the SQL.
 * Strings are 'YYYY-MM-DD HH:mm:ss' literals that ClickHouse parses as DateTime.
 */
export interface AbsoluteRange {
  start: string;
  end: string;
}

export interface QueryTimelinePoint {
  time: string;
  Select: number;
  Insert: number;
  Delete: number;
  Other: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function truncFunc(bucket: TimelineBucket, table?: string): string {
  const col = table ? `${table}.event_time` : "event_time";
  return bucket === "hour" ? `toStartOfHour(${col})` : `toStartOfMinute(${col})`;
}

/**
 * Build the time-window WHERE clause. Custom range wins when provided;
 * otherwise falls back to the relative `now() - INTERVAL X HOUR` form.
 */
function timeWindowWhere(hoursBack: number, range?: AbsoluteRange): string {
  if (range) {
    return `event_time >= toDateTime('${range.start}') AND event_time <= toDateTime('${range.end}')`;
  }
  return `event_time >= now() - INTERVAL ${hoursBack} HOUR`;
}

/**
 * Query timeline — count per bucket grouped by query_kind.
 * Used as the chart above the Monitoring → Logs table.
 */
export function useQueryTimeline(
  hoursBack: number = 6,
  bucket: TimelineBucket = "minute",
  rbacUserId?: string,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<QueryTimelinePoint[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  void rbacUserId; // reserved for per-user filtering once query_log carries rbac mapping

  return useQuery({
    queryKey: [
      "queryTimeline",
      hoursBack,
      bucket,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      // Categorize purely off query_kind (cheap enum compare). The previous LIKE
      // fallback on the raw query text ran string ops over potentially huge
      // SQL bodies for every row in the window — empty query_kind rows are
      // rare enough to bucket as Other.
      const sql = `
        SELECT
          formatDateTime(${truncFunc(bucket)}, '%Y-%m-%d %H:%i:%S') AS time,
          countIf(query_kind = 'Select') AS \`Select\`,
          countIf(query_kind IN ('Insert', 'AsyncInsertFlush')) AS \`Insert\`,
          countIf(query_kind = 'Delete') AS \`Delete\`,
          countIf(query_kind NOT IN ('Select', 'Insert', 'AsyncInsertFlush', 'Delete')) AS \`Other\`
        FROM system.query_log
        WHERE ${timeWindowWhere(hoursBack, customRange)}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
        GROUP BY time
        ORDER BY time ASC
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        time: String(row.time ?? ""),
        Select: num(row.Select),
        Insert: num(row.Insert),
        Delete: num(row.Delete),
        Other: num(row.Other),
      }));
    },
    staleTime: 15_000,
    ...options,
  });
}

export type PartEventType =
  | "NewPart"
  | "MergeParts"
  | "DownloadPart"
  | "RemovePart"
  | "MutatePart"
  | "Other";

export interface PartLogTimelinePoint {
  time: string;
  NewPart: number;
  MergeParts: number;
  DownloadPart: number;
  RemovePart: number;
  MutatePart: number;
  Other: number;
}

/**
 * system.part_log aggregated per bucket and grouped by event_type.
 * Drives the stacked area chart on Monitoring → Parts.
 */
export function usePartLogTimeline(
  hoursBack: number = 6,
  bucket: TimelineBucket = "minute",
  options?: Partial<UseQueryOptions<PartLogTimelinePoint[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["partLogTimeline", hoursBack, bucket, activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          formatDateTime(${truncFunc(bucket)}, '%Y-%m-%d %H:%i:%S') AS time,
          countIf(event_type = 'NewPart') AS NewPart,
          countIf(event_type = 'MergeParts') AS MergeParts,
          countIf(event_type = 'DownloadPart') AS DownloadPart,
          countIf(event_type = 'RemovePart') AS RemovePart,
          countIf(event_type = 'MutatePart') AS MutatePart,
          countIf(event_type NOT IN ('NewPart', 'MergeParts', 'DownloadPart', 'RemovePart', 'MutatePart')) AS \`Other\`
        FROM system.part_log
        WHERE ${timeWindowWhere(hoursBack)}
        GROUP BY time
        ORDER BY time ASC
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        time: String(row.time ?? ""),
        NewPart: num(row.NewPart),
        MergeParts: num(row.MergeParts),
        DownloadPart: num(row.DownloadPart),
        RemovePart: num(row.RemovePart),
        MutatePart: num(row.MutatePart),
        Other: num(row.Other),
      }));
    },
    staleTime: 15_000,
    ...options,
  });
}

export interface QueryPattern {
  pattern: string;
  executions: number;
  avg_duration_ms: number;
  total_duration_ms: number;
  max_duration_ms: number;
  avg_memory: number;
  max_memory: number;
  total_read_rows: number;
  total_read_bytes: number;
  sample_user: string;
  sample_query_id: string;
}

export type QueryPatternSort =
  | "total_duration_ms"
  | "executions"
  | "avg_duration_ms"
  | "max_duration_ms"
  | "max_memory"
  | "total_read_rows"
  | "total_read_bytes";

/**
 * Aggregate queries by normalized pattern. normalizeQuery() replaces
 * literals/placeholders so SELECT a FROM b WHERE id=42 and id=43 fold into
 * one row — surfaces hot query shapes for ETL/Redash workloads where the
 * same template runs thousands of times.
 */
export function useQueryPatterns(
  hoursBack: number = 6,
  sortBy: QueryPatternSort = "total_duration_ms",
  limit: number = 200,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<QueryPattern[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: [
      "queryPatterns",
      hoursBack,
      sortBy,
      limit,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          normalizeQuery(query) AS pattern,
          count() AS executions,
          avg(query_duration_ms) AS avg_duration_ms,
          sum(query_duration_ms) AS total_duration_ms,
          max(query_duration_ms) AS max_duration_ms,
          avg(memory_usage) AS avg_memory,
          max(memory_usage) AS max_memory,
          sum(read_rows) AS total_read_rows,
          sum(read_bytes) AS total_read_bytes,
          anyLast(user) AS sample_user,
          anyLast(query_id) AS sample_query_id
        FROM system.query_log
        WHERE ${timeWindowWhere(hoursBack, customRange)}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
          AND query != ''
        GROUP BY pattern
        ORDER BY ${sortBy} DESC
        LIMIT ${limit}
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        pattern: String(row.pattern ?? ""),
        executions: num(row.executions),
        avg_duration_ms: num(row.avg_duration_ms),
        total_duration_ms: num(row.total_duration_ms),
        max_duration_ms: num(row.max_duration_ms),
        avg_memory: num(row.avg_memory),
        max_memory: num(row.max_memory),
        total_read_rows: num(row.total_read_rows),
        total_read_bytes: num(row.total_read_bytes),
        sample_user: String(row.sample_user ?? ""),
        sample_query_id: String(row.sample_query_id ?? ""),
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export interface ProfileEventEntry {
  name: string;
  value: number;
}

/**
 * Lazy-fetch the ProfileEvents map for a single query. Only invoked when a
 * row in Monitoring → Logs is expanded — keeps the list fetch slim.
 */
export function useQueryProfileEvents(
  queryId: string | null,
  options?: Partial<UseQueryOptions<ProfileEventEntry[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["queryProfileEvents", queryId, activeConnectionId] as const,
    enabled: !!queryId,
    queryFn: async () => {
      const sql = `
        SELECT ProfileEvents
        FROM system.query_log
        WHERE query_id = '${queryId}'
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
          AND event_date >= today() - 2
        ORDER BY event_time DESC
        LIMIT 1
      `;
      const result = await queryApi.executeQuery(sql);
      const row = (result.data as Array<{ ProfileEvents?: Record<string, unknown> }>)[0];
      if (!row?.ProfileEvents) return [];
      return Object.entries(row.ProfileEvents)
        .map(([name, value]) => ({ name, value: num(value) }))
        .filter((e) => e.value > 0)
        .sort((a, b) => b.value - a.value);
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

/**
 * Total OS RAM reported by ClickHouse, used to flag memory-heavy queries on
 * the Logs page. Cached for 5 min; survives connection changes via the key.
 */
export function useClusterMemoryTotal(
  options?: Partial<UseQueryOptions<number, Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["clusterMemoryTotal", activeConnectionId] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(
        `SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1`
      );
      const row = (result.data as Array<{ value: unknown }>)[0];
      return num(row?.value);
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export interface PartLogEntry {
  event_time: string;
  event_type: string;
  database: string;
  table: string;
  part_name: string;
  partition_id: string;
  duration_ms: number;
  rows: number;
  size_in_bytes: number;
}

/**
 * Recent rows from system.part_log. Powers the table below the chart on
 * Monitoring → Parts.
 */
export function usePartLog(
  limit: number = 200,
  hoursBack: number = 6,
  options?: Partial<UseQueryOptions<PartLogEntry[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["partLog", limit, hoursBack, activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          formatDateTime(pl.event_time, '%Y-%m-%d %H:%i:%S') AS event_time,
          pl.event_type AS event_type,
          pl.database AS database,
          pl.table AS table,
          pl.part_name AS part_name,
          pl.partition_id AS partition_id,
          pl.duration_ms AS duration_ms,
          pl.rows AS rows,
          pl.size_in_bytes AS size_in_bytes
        FROM system.part_log AS pl
        WHERE pl.event_time >= now() - INTERVAL ${hoursBack} HOUR
        ORDER BY pl.event_time DESC
        LIMIT ${limit}
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        event_time: String(row.event_time ?? ""),
        event_type: String(row.event_type ?? ""),
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        part_name: String(row.part_name ?? ""),
        partition_id: String(row.partition_id ?? ""),
        duration_ms: num(row.duration_ms),
        rows: num(row.rows),
        size_in_bytes: num(row.size_in_bytes),
      }));
    },
    staleTime: 15_000,
    ...options,
  });
}
