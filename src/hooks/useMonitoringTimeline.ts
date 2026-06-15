/**
 * Monitoring timeline hooks
 *
 * Read-only system.query_log / system.part_log aggregates for the
 * Monitoring → Logs (Query timeline) and Monitoring → Parts views.
 */

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { queryApi } from "@/api";
import { useAuthStore } from "@/stores";

export type TimelineBucket = "minute" | "hour" | "day";

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
  if (bucket === "day") return `toStartOfDay(${col})`;
  if (bucket === "hour") return `toStartOfHour(${col})`;
  return `toStartOfMinute(${col})`;
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

export interface ResourceTimelinePoint {
  time: string;
  memory_bytes: number;       // sum(memory_usage) — total query memory in bucket
  peak_memory_bytes: number;  // max(memory_usage) — heaviest single query in bucket
  cpu_seconds: number;        // sum(OSCPUVirtualTimeMicroseconds) / 1e6
  read_bytes: number;         // sum(read_bytes) — bytes scanned in bucket
}

/**
 * Resource consumption of the query workload per time bucket — total memory,
 * peak memory, CPU seconds, and bytes read — from system.query_log. Powers
 * the Resource timeline chart on Monitoring → Query logs, answering "how
 * much memory / CPU did queries burn per hour/day" alongside the count-based
 * Query timeline.
 */
export function useQueryResourceTimeline(
  hoursBack: number = 6,
  bucket: TimelineBucket = "minute",
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<ResourceTimelinePoint[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: [
      "queryResourceTimeline",
      hoursBack,
      bucket,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          formatDateTime(${truncFunc(bucket)}, '%Y-%m-%d %H:%i:%S') AS time,
          sum(memory_usage) AS memory_bytes,
          max(memory_usage) AS peak_memory_bytes,
          sum(ProfileEvents['OSCPUVirtualTimeMicroseconds']) / 1000000 AS cpu_seconds,
          sum(read_bytes) AS read_bytes
        FROM system.query_log
        WHERE ${timeWindowWhere(hoursBack, customRange)}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
        GROUP BY time
        ORDER BY time ASC
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        time: String(row.time ?? ""),
        memory_bytes: num(row.memory_bytes),
        peak_memory_bytes: num(row.peak_memory_bytes),
        cpu_seconds: num(row.cpu_seconds),
        read_bytes: num(row.read_bytes),
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

export interface ByRedashRow {
  redash_query_id: string;        // numeric id pulled from /* … query_id: N … */
  redash_username: string;        // pulled from /* … Username: … */, anyLast
  executions: number;
  min_duration_ms: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  total_duration_ms: number;
  min_memory: number;
  avg_memory: number;
  max_memory: number;
  total_read_rows: number;
  total_read_bytes: number;
  sample_query_id: string;        // ClickHouse query_id (for drill-down)
}

export type ByRedashSort =
  | "total_duration_ms"
  | "executions"
  | "min_duration_ms"
  | "avg_duration_ms"
  | "max_duration_ms"
  | "min_memory"
  | "max_memory"
  | "total_read_rows"
  | "total_read_bytes";

/**
 * Aggregate queries by the Redash query_id embedded in the SQL leading
 * comment. Redash submits queries with
 *   /* Username: ..., query_id: NNNN, Queue: ..., Job ID: ... *\/
 * so we can roll up every execution of the same saved Redash query
 * (across schedules, ad-hoc reruns, snapshot fetches) into one row.
 * Filters out queries with no matching comment so the result is purely
 * "things Redash sent".
 */
export function useQueryByRedashId(
  hoursBack: number = 6,
  sortBy: ByRedashSort = "total_duration_ms",
  limit: number = 500,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<ByRedashRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: [
      "queryByRedashId",
      hoursBack,
      sortBy,
      limit,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      // Aliases use _str suffix where they shadow source columns — same
      // alias-shadow trap we hit on Mutations / Replication earlier on
      // ClickHouse 24.11 (NO_COMMON_TYPE String vs DateTime).
      const sql = `
        SELECT
          extract(query, 'query_id:\\\\s*(\\\\d+)') AS redash_query_id,
          anyLast(trim(extract(query, 'Username:\\\\s*([^,]+)'))) AS redash_username,
          count() AS executions,
          min(query_duration_ms) AS min_duration_ms,
          avg(query_duration_ms) AS avg_duration_ms,
          max(query_duration_ms) AS max_duration_ms,
          sum(query_duration_ms) AS total_duration_ms,
          min(memory_usage) AS min_memory,
          avg(memory_usage) AS avg_memory,
          max(memory_usage) AS max_memory,
          sum(read_rows) AS total_read_rows,
          sum(read_bytes) AS total_read_bytes,
          anyLast(query_id) AS sample_query_id
        FROM system.query_log
        WHERE ${timeWindowWhere(hoursBack, customRange)}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
          AND query LIKE '%query_id:%'
        GROUP BY redash_query_id
        HAVING redash_query_id != ''
        ORDER BY ${sortBy} DESC
        LIMIT ${limit}
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        redash_query_id: String(row.redash_query_id ?? ""),
        redash_username: String(row.redash_username ?? ""),
        executions: num(row.executions),
        min_duration_ms: num(row.min_duration_ms),
        avg_duration_ms: num(row.avg_duration_ms),
        max_duration_ms: num(row.max_duration_ms),
        total_duration_ms: num(row.total_duration_ms),
        min_memory: num(row.min_memory),
        avg_memory: num(row.avg_memory),
        max_memory: num(row.max_memory),
        total_read_rows: num(row.total_read_rows),
        total_read_bytes: num(row.total_read_bytes),
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

export interface ViewLogRow {
  view_name: string;
  view_type: string;
  status: string;
  view_duration_ms: number;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  peak_memory_usage: number;
  exception: string;
}

/**
 * Materialized / normal views fired as part of a given query. system.
 * query_views_log is partitioned on event_date and indexed on
 * initial_query_id, so the lookup is cheap once we know which query we are
 * drilling into.
 */
export function useQueryViewsLog(
  queryId: string | null,
  options?: Partial<UseQueryOptions<ViewLogRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["queryViewsLog", queryId, activeConnectionId] as const,
    enabled: !!queryId,
    // Server-level opt-in: many clusters ship with <query_views_log> disabled,
    // so the table doesn't exist. Don't retry that — it's not transient.
    retry: false,
    queryFn: async () => {
      const sql = `
        SELECT
          view_name,
          view_type,
          status,
          view_duration_ms,
          read_rows,
          read_bytes,
          written_rows,
          written_bytes,
          peak_memory_usage,
          substring(exception, 1, 2000) AS exception
        FROM system.query_views_log
        WHERE initial_query_id = '${queryId}'
          AND event_date >= today() - 2
        ORDER BY view_duration_ms DESC
        LIMIT 200
      `;
      try {
        const result = await queryApi.executeQuery(sql);
        return (result.data as Array<Record<string, unknown>>).map((row) => ({
          view_name: String(row.view_name ?? ""),
          view_type: String(row.view_type ?? ""),
          status: String(row.status ?? ""),
          view_duration_ms: num(row.view_duration_ms),
          read_rows: num(row.read_rows),
          read_bytes: num(row.read_bytes),
          written_rows: num(row.written_rows),
          written_bytes: num(row.written_bytes),
          peak_memory_usage: num(row.peak_memory_usage),
          exception: String(row.exception ?? ""),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Table not configured on this cluster — treat as "no views" so the
        // expanded panel hides the section instead of showing a scary error.
        if (
          /query_views_log/i.test(msg) &&
          /Unknown table|UNKNOWN_TABLE|doesn'?t exist/i.test(msg)
        ) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export interface ByTableRow {
  table_qualified: string;
  queries: number;
  selects: number;
  inserts: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  total_read_rows: number;
  total_read_bytes: number;
  total_written_rows: number;
  max_memory: number;
}

export type ByTableSort =
  | "total_duration_ms"
  | "queries"
  | "total_read_rows"
  | "total_read_bytes"
  | "max_memory";

/**
 * Aggregate queries grouped by the tables they touched. Uses
 * arrayJoin(tables) to explode the per-query touched-tables list, then rolls
 * up per-table cost. Surfaces hot tables that dominate read/write traffic.
 */
export function useQueryByTable(
  hoursBack: number = 6,
  sortBy: ByTableSort = "total_duration_ms",
  limit: number = 500,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<ByTableRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: [
      "queryByTable",
      hoursBack,
      sortBy,
      limit,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      // Filter system schemas INSIDE the arrayFilter so the subsequent
      // arrayJoin amplifies way fewer rows on busy clusters — 100K+ query_log
      // rows × 5 system tables touched each = half a million extra rows
      // exploded if we post-filter. The outer `length(user_tables) > 0` drops
      // queries that only touched metadata so they don't take up read budget.
      const sql = `
        SELECT
          arrayJoin(user_tables) AS table_qualified,
          count() AS queries,
          countIf(query_kind = 'Select') AS selects,
          countIf(query_kind IN ('Insert', 'AsyncInsertFlush')) AS inserts,
          sum(query_duration_ms) AS total_duration_ms,
          avg(query_duration_ms) AS avg_duration_ms,
          sum(read_rows) AS total_read_rows,
          sum(read_bytes) AS total_read_bytes,
          sum(written_rows) AS total_written_rows,
          max(memory_usage) AS max_memory
        FROM (
          SELECT
            arrayFilter(
              t ->
                t NOT LIKE 'system.%'
                AND t NOT LIKE 'INFORMATION_SCHEMA.%'
                AND t NOT LIKE 'information_schema.%'
                AND t != '',
              tables
            ) AS user_tables,
            query_kind,
            query_duration_ms,
            read_rows,
            read_bytes,
            written_rows,
            memory_usage
          FROM system.query_log
          WHERE ${timeWindowWhere(hoursBack, customRange)}
            AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
            AND length(tables) > 0
        )
        WHERE length(user_tables) > 0
        GROUP BY table_qualified
        ORDER BY ${sortBy} DESC
        LIMIT ${limit}
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        table_qualified: String(row.table_qualified ?? ""),
        queries: num(row.queries),
        selects: num(row.selects),
        inserts: num(row.inserts),
        total_duration_ms: num(row.total_duration_ms),
        avg_duration_ms: num(row.avg_duration_ms),
        total_read_rows: num(row.total_read_rows),
        total_read_bytes: num(row.total_read_bytes),
        total_written_rows: num(row.total_written_rows),
        max_memory: num(row.max_memory),
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export type HistogramMetric = "duration" | "memory" | "read_rows" | "read_bytes";

interface HistogramSpec {
  field: string;
  /** Bucket upper bounds. Final bucket catches everything ≥ last bound. */
  boundaries: number[];
  labels: string[];
}

export const HISTOGRAM_SPECS: Record<HistogramMetric, HistogramSpec> = {
  duration: {
    field: "query_duration_ms",
    boundaries: [50, 200, 1000, 5000, 30000, 120000],
    labels: ["< 50ms", "50–200ms", "200ms–1s", "1–5s", "5–30s", "30s–2min", "> 2min"],
  },
  memory: {
    field: "memory_usage",
    boundaries: [1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000],
    labels: ["< 1MB", "1–10MB", "10–100MB", "100MB–1GB", "1–10GB", "10–100GB", "> 100GB"],
  },
  read_rows: {
    field: "read_rows",
    boundaries: [1_000, 100_000, 1_000_000, 100_000_000, 1_000_000_000],
    labels: ["< 1K", "1K–100K", "100K–1M", "1M–100M", "100M–1B", "> 1B"],
  },
  read_bytes: {
    field: "read_bytes",
    boundaries: [1_000_000, 100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000],
    labels: ["< 1MB", "1–100MB", "100MB–1GB", "1–10GB", "10–100GB", "> 100GB"],
  },
};

export interface HistogramBucket {
  bucket: number;
  label: string;
  count: number;
}

/**
 * Distribution histogram of one metric (duration / memory / read rows /
 * read bytes) across the active time window. Lets users see the shape of
 * the workload — e.g. long-tail vs bimodal — rather than just an average.
 */
export function useQueryHistogram(
  metric: HistogramMetric,
  hoursBack: number = 6,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<HistogramBucket[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  const spec = HISTOGRAM_SPECS[metric];

  return useQuery({
    queryKey: [
      "queryHistogram",
      metric,
      hoursBack,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      const multiIfArgs = spec.boundaries
        .map((b, i) => `${spec.field} < ${b}, ${i}`)
        .join(",\n            ");
      const lastIdx = spec.boundaries.length;
      const sql = `
        SELECT
          bucket_idx AS bucket,
          count() AS count
        FROM (
          SELECT multiIf(
            ${multiIfArgs},
            ${lastIdx}
          ) AS bucket_idx
          FROM system.query_log
          WHERE ${timeWindowWhere(hoursBack, customRange)}
            AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
        )
        GROUP BY bucket
        ORDER BY bucket ASC
      `;
      const result = await queryApi.executeQuery(sql);
      const raw = result.data as Array<Record<string, unknown>>;
      const seen = new Map(raw.map((r) => [num(r.bucket), num(r.count)]));
      // Ensure every bucket label has a row, even if zero — keeps the chart
      // axis stable as the time window changes.
      return spec.labels.map((label, idx) => ({
        bucket: idx,
        label,
        count: seen.get(idx) ?? 0,
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export interface QueryPercentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/**
 * p50 / p95 / p99 / max of the chosen metric for the active time window.
 * Lets operators eyeball tail latency / memory / scan size without doing
 * the math themselves — complements the histogram, which only shows shape.
 */
export function useQueryPercentiles(
  metric: HistogramMetric,
  hoursBack: number = 6,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<QueryPercentiles, Error>>
) {
  const { activeConnectionId } = useAuthStore();
  const spec = HISTOGRAM_SPECS[metric];

  return useQuery({
    queryKey: [
      "queryPercentiles",
      metric,
      hoursBack,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          quantile(0.50)(${spec.field}) AS p50,
          quantile(0.95)(${spec.field}) AS p95,
          quantile(0.99)(${spec.field}) AS p99,
          max(${spec.field}) AS mx
        FROM system.query_log
        WHERE ${timeWindowWhere(hoursBack, customRange)}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
      `;
      const result = await queryApi.executeQuery(sql);
      const row = (result.data as Array<Record<string, unknown>>)[0] ?? {};
      return {
        p50: num(row.p50),
        p95: num(row.p95),
        p99: num(row.p99),
        max: num(row.mx),
      };
    },
    staleTime: 30_000,
    ...options,
  });
}

export interface MutationRow {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  parts_to_do: number;
  /** Table's current active-part count — progress denominator (0 if unknown). */
  total_parts: number;
  is_done: number;
  /** 1 once the mutation has been KILLed. */
  is_killed: number;
  latest_failed_part: string;
  latest_fail_reason: string;
  latest_fail_time: string;
}

/**
 * ALTER … UPDATE/DELETE mutations from system.mutations. Anything still in
 * flight or finished in the last 7 days. Surfaces stuck mutations (high
 * parts_to_do, latest_fail_reason set) that are otherwise invisible to the
 * BI users running the SQL.
 */
export function useMutations(
  options?: Partial<UseQueryOptions<MutationRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["mutations", activeConnectionId] as const,
    queryFn: async () => {
      // Aliases use a `_str` suffix so they don't shadow the original
      // DateTime columns used in WHERE / ORDER BY. ClickHouse 24.11 fails
      // with NO_COMMON_TYPE (String vs DateTime) when an alias collides
      // with the column it was derived from in the same SELECT.
      // total_parts joins the table's current active-part count so the UI can
      // render approximate progress (1 − parts_to_do / total_parts).
      const sql = `
        WITH active_parts AS (
          SELECT database, table, count() AS total_parts
          FROM system.parts
          WHERE active
          GROUP BY database, table
        )
        SELECT
          m.database AS database,
          m.table AS table,
          m.mutation_id AS mutation_id,
          m.command AS command,
          formatDateTime(m.create_time, '%Y-%m-%d %H:%i:%S') AS create_time_str,
          m.parts_to_do AS parts_to_do,
          coalesce(a.total_parts, 0) AS total_parts,
          m.is_done AS is_done,
          m.is_killed AS is_killed,
          m.latest_failed_part AS latest_failed_part,
          m.latest_fail_reason AS latest_fail_reason,
          formatDateTime(m.latest_fail_time, '%Y-%m-%d %H:%i:%S') AS latest_fail_time_str
        FROM system.mutations m
        LEFT JOIN active_parts a ON m.database = a.database AND m.table = a.table
        WHERE m.is_done = 0 OR m.create_time >= now() - INTERVAL 7 DAY
        ORDER BY m.is_done ASC, m.create_time DESC
        LIMIT 500
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        mutation_id: String(row.mutation_id ?? ""),
        command: String(row.command ?? ""),
        create_time: String(row.create_time_str ?? ""),
        parts_to_do: num(row.parts_to_do),
        total_parts: num(row.total_parts),
        is_done: num(row.is_done),
        is_killed: num(row.is_killed),
        latest_failed_part: String(row.latest_failed_part ?? ""),
        latest_fail_reason: String(row.latest_fail_reason ?? ""),
        latest_fail_time: String(row.latest_fail_time_str ?? ""),
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export interface ReplicationQueueRow {
  database: string;
  table: string;
  replica_name: string;
  type: string;
  source_replica: string;
  new_part_name: string;
  parts_to_merge: number;
  last_attempt_time: string;
  num_tries: number;
  last_exception: string;
  create_time: string;
}

/**
 * Pending replication tasks per replica. Long-running entries with rising
 * num_tries usually mean a sick replica or partition that needs intervention.
 */
export function useReplicationQueue(
  options?: Partial<UseQueryOptions<ReplicationQueueRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["replicationQueue", activeConnectionId] as const,
    queryFn: async () => {
      // Same alias-shadowing trap as useMutations — DateTime aliases get a
      // `_str` suffix so WHERE / ORDER BY keep the original DateTime column.
      const sql = `
        SELECT
          database,
          table,
          replica_name,
          type,
          source_replica,
          new_part_name,
          length(parts_to_merge) AS parts_to_merge,
          formatDateTime(last_attempt_time, '%Y-%m-%d %H:%i:%S') AS last_attempt_time_str,
          num_tries,
          last_exception,
          formatDateTime(create_time, '%Y-%m-%d %H:%i:%S') AS create_time_str
        FROM system.replication_queue
        ORDER BY num_tries DESC, create_time DESC
        LIMIT 500
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        replica_name: String(row.replica_name ?? ""),
        type: String(row.type ?? ""),
        source_replica: String(row.source_replica ?? ""),
        new_part_name: String(row.new_part_name ?? ""),
        parts_to_merge: num(row.parts_to_merge),
        last_attempt_time: String(row.last_attempt_time_str ?? ""),
        num_tries: num(row.num_tries),
        last_exception: String(row.last_exception ?? ""),
        create_time: String(row.create_time_str ?? ""),
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export interface ReplicaStatusRow {
  database: string;
  table: string;
  replica_name: string;
  absolute_delay: number;       // seconds behind leader
  queue_size: number;           // length(log_max_index - log_pointer)
  is_readonly: number;
  is_session_expired: number;
}

/**
 * Per-replica lag and pending work from system.replicas. A non-zero
 * absolute_delay or rising queue_size on a single replica is the canonical
 * "this replica is behind / stuck" signal.
 */
export function useReplicaStatus(
  options?: Partial<UseQueryOptions<ReplicaStatusRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["replicaStatus", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          replica_name,
          absolute_delay,
          (log_max_index - log_pointer) AS queue_size,
          is_readonly,
          is_session_expired
        FROM system.replicas
        ORDER BY absolute_delay DESC, queue_size DESC
        LIMIT 200
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        replica_name: String(row.replica_name ?? ""),
        absolute_delay: num(row.absolute_delay),
        queue_size: num(row.queue_size),
        is_readonly: num(row.is_readonly),
        is_session_expired: num(row.is_session_expired),
      }));
    },
    staleTime: 15_000,
    ...options,
  });
}

export interface BlockedTaskSummary {
  long_running_queries: number;  // system.processes elapsed > 60s
  long_running_merges: number;   // system.merges elapsed > 300s
  open_mutations: number;        // system.mutations is_done = 0
  sick_replicas: number;         // system.replicas absolute_delay > 60 OR is_readonly
  max_replica_lag_seconds: number;
  server_memory_used_bytes: number;   // system.asynchronous_metrics MemoryResident
  server_memory_total_bytes: number;  // system.asynchronous_metrics OSMemoryTotal
}

/**
 * Roll-up of "this thing is blocked / stuck" signals across the cluster +
 * server-wide memory pressure (resident / total). One SQL call so the
 * indicator strip stays cheap to poll.
 */
export function useBlockedTaskSummary(
  options?: Partial<UseQueryOptions<BlockedTaskSummary, Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["blockedTaskSummary", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          (SELECT count() FROM system.processes WHERE elapsed > 60) AS long_running_queries,
          (SELECT count() FROM system.merges WHERE elapsed > 300) AS long_running_merges,
          (SELECT count() FROM system.mutations WHERE is_done = 0) AS open_mutations,
          (SELECT count() FROM system.replicas WHERE absolute_delay > 60 OR is_readonly = 1) AS sick_replicas,
          (SELECT max(absolute_delay) FROM system.replicas) AS max_replica_lag_seconds,
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' LIMIT 1) AS server_memory_used_bytes,
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1) AS server_memory_total_bytes
      `;
      const result = await queryApi.executeQuery(sql);
      const row = (result.data as Array<Record<string, unknown>>)[0] ?? {};
      return {
        long_running_queries: num(row.long_running_queries),
        long_running_merges: num(row.long_running_merges),
        open_mutations: num(row.open_mutations),
        sick_replicas: num(row.sick_replicas),
        max_replica_lag_seconds: num(row.max_replica_lag_seconds),
        server_memory_used_bytes: num(row.server_memory_used_bytes),
        server_memory_total_bytes: num(row.server_memory_total_bytes),
      };
    },
    staleTime: 15_000,
    ...options,
  });
}

export interface ServerMemoryBreakdown {
  total_bytes: number;            // OSMemoryTotal — physical RAM on the box
  available_bytes: number;        // OSMemoryAvailable — free + cacheable
  clickhouse_rss_bytes: number;   // MemoryResident — actual ClickHouse RSS
  active_queries_bytes: number;   // SUM(memory_usage) FROM system.processes
  merges_mutations_bytes: number; // CurrentMetric_MergesMutationsMemoryTracking
  mark_cache_bytes: number;       // CurrentMetric_MarkCacheBytes
  uncompressed_cache_bytes: number; // CurrentMetric_UncompressedCacheBytes
  primary_key_bytes: number;      // TotalPrimaryKeyBytesInMemoryAllocated
  index_granularity_bytes: number;// TotalIndexGranularityBytesInMemoryAllocated
}

/**
 * One-shot snapshot of the "where did the RAM go?" question. Surfaces the
 * RSS that ClickHouse actually holds, the slices we can attribute (caches,
 * merges, in-flight queries, index data structures), and the OS-level
 * total/free numbers so the page can show "X of Y used, here's why".
 *
 * Every component is read from a separate scalar subquery so the call
 * gracefully reports 0 for any metric the server build doesn't expose,
 * instead of dropping the whole row.
 */
export function useServerMemoryBreakdown(
  options?: Partial<UseQueryOptions<ServerMemoryBreakdown, Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["serverMemoryBreakdown", activeConnectionId] as const,
    queryFn: async () => {
      // Scalar subqueries individually — each returns NULL if the metric or
      // table is absent, and num(NULL) → 0 keeps the math sane.
      const sql = `
        SELECT
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1) AS total_bytes,
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryAvailable' LIMIT 1) AS available_bytes,
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' LIMIT 1) AS clickhouse_rss_bytes,
          (SELECT sum(memory_usage) FROM system.processes) AS active_queries_bytes,
          (SELECT value FROM system.metrics WHERE metric = 'MergesMutationsMemoryTracking' LIMIT 1) AS merges_mutations_bytes,
          (SELECT value FROM system.metrics WHERE metric = 'MarkCacheBytes' LIMIT 1) AS mark_cache_bytes,
          (SELECT value FROM system.metrics WHERE metric = 'UncompressedCacheBytes' LIMIT 1) AS uncompressed_cache_bytes,
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'TotalPrimaryKeyBytesInMemoryAllocated' LIMIT 1) AS primary_key_bytes,
          (SELECT value FROM system.asynchronous_metrics WHERE metric = 'TotalIndexGranularityBytesInMemoryAllocated' LIMIT 1) AS index_granularity_bytes
      `;
      const result = await queryApi.executeQuery(sql);
      const row = (result.data as Array<Record<string, unknown>>)[0] ?? {};
      return {
        total_bytes: num(row.total_bytes),
        available_bytes: num(row.available_bytes),
        clickhouse_rss_bytes: num(row.clickhouse_rss_bytes),
        active_queries_bytes: num(row.active_queries_bytes),
        merges_mutations_bytes: num(row.merges_mutations_bytes),
        mark_cache_bytes: num(row.mark_cache_bytes),
        uncompressed_cache_bytes: num(row.uncompressed_cache_bytes),
        primary_key_bytes: num(row.primary_key_bytes),
        index_granularity_bytes: num(row.index_granularity_bytes),
      };
    },
    staleTime: 15_000,
    ...options,
  });
}

export interface SchemaLintRow {
  database: string;
  table: string;
  column: string;
  type: string;
  total_rows: number;
  compressed_bytes: number;
  uncompressed_bytes: number;
}

export interface TopResourceQueryRow {
  query_id: string;
  user: string;
  query: string;
  event_time: string;
  query_duration_ms: number;
  memory_usage: number;        // peak memory_usage from system.query_log
  cpu_microseconds: number;    // ProfileEvents['OSCPUVirtualTimeMicroseconds']
  read_rows: number;
  read_bytes: number;
  thread_count: number;
  type: string;                // QueryFinish / Exception*
}

type TopResourceMetric = "memory_usage" | "cpu_microseconds";

/**
 * Heaviest queries by a chosen resource (memory or CPU) over the window.
 * Read from system.query_log so the result is historical, not just live —
 * which is what an operator wants when chasing "what blew up the box at
 * 03:00 last night". Limit kept tight; the table is a quick scan, not a
 * paginated dataset.
 */
function useTopResourceQueries(
  metric: TopResourceMetric,
  hoursBack: number = 1,
  limit: number = 10,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<TopResourceQueryRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: [
      "topResourceQueries",
      metric,
      hoursBack,
      limit,
      customRange?.start ?? null,
      customRange?.end ?? null,
      activeConnectionId,
    ] as const,
    queryFn: async () => {
      const orderExpr =
        metric === "cpu_microseconds"
          ? "ProfileEvents['OSCPUVirtualTimeMicroseconds']"
          : "memory_usage";
      // *_str suffix on aliased columns so they don't shadow the source
      // DateTime/String columns referenced in WHERE / ORDER BY — ClickHouse
      // 24.11 fails with NO_COMMON_TYPE on alias-column collisions.
      const sql = `
        SELECT
          query_id,
          user,
          substring(query, 1, 200) AS query_preview,
          formatDateTime(event_time, '%Y-%m-%d %H:%i:%S') AS event_time_str,
          query_duration_ms,
          memory_usage,
          ProfileEvents['OSCPUVirtualTimeMicroseconds'] AS cpu_microseconds,
          read_rows,
          read_bytes,
          length(thread_ids) AS thread_count,
          type
        FROM system.query_log
        WHERE ${timeWindowWhere(hoursBack, customRange)}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
        ORDER BY ${orderExpr} DESC
        LIMIT ${limit}
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        query_id: String(row.query_id ?? ""),
        user: String(row.user ?? ""),
        query: String(row.query_preview ?? ""),
        event_time: String(row.event_time_str ?? ""),
        query_duration_ms: num(row.query_duration_ms),
        memory_usage: num(row.memory_usage),
        cpu_microseconds: num(row.cpu_microseconds),
        read_rows: num(row.read_rows),
        read_bytes: num(row.read_bytes),
        thread_count: num(row.thread_count),
        type: String(row.type ?? ""),
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export function useTopMemoryQueries(
  hoursBack: number = 1,
  limit: number = 10,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<TopResourceQueryRow[], Error>>
) {
  return useTopResourceQueries("memory_usage", hoursBack, limit, customRange, options);
}

export function useTopCpuQueries(
  hoursBack: number = 1,
  limit: number = 10,
  customRange?: AbsoluteRange,
  options?: Partial<UseQueryOptions<TopResourceQueryRow[], Error>>
) {
  return useTopResourceQueries("cpu_microseconds", hoursBack, limit, customRange, options);
}

const SCHEMA_SYSTEM_EXCLUDE =
  "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')";

/**
 * Columns declared Nullable(T) — Nullable carries a per-row null-bitmap byte
 * even when no rows are actually null, so on huge tables it's worth checking
 * whether the column actually needs the wrapper.
 */
export function useSchemaNullables(
  options?: Partial<UseQueryOptions<SchemaLintRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["schemaNullables", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          column,
          type,
          sum(rows) AS total_rows,
          sum(column_data_compressed_bytes) AS compressed_bytes,
          sum(column_data_uncompressed_bytes) AS uncompressed_bytes
        FROM system.parts_columns
        WHERE active = 1
          AND type LIKE 'Nullable(%)'
          AND ${SCHEMA_SYSTEM_EXCLUDE}
        GROUP BY database, table, column, type
        ORDER BY compressed_bytes DESC
        LIMIT 500
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        column: String(row.column ?? ""),
        type: String(row.type ?? ""),
        total_rows: num(row.total_rows),
        compressed_bytes: num(row.compressed_bytes),
        uncompressed_bytes: num(row.uncompressed_bytes),
      }));
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

/**
 * Wide integer columns (Int64/UInt64/Int128/…) — frequently end up that way
 * out of habit but, if the actual value range fits a smaller width, the bigger
 * type costs 2-8× compressed bytes for nothing.
 */
export function useSchemaOversized(
  options?: Partial<UseQueryOptions<SchemaLintRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["schemaOversized", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          column,
          type,
          sum(rows) AS total_rows,
          sum(column_data_compressed_bytes) AS compressed_bytes,
          sum(column_data_uncompressed_bytes) AS uncompressed_bytes
        FROM system.parts_columns
        WHERE active = 1
          AND ${SCHEMA_SYSTEM_EXCLUDE}
          AND (
            type IN ('Int64', 'UInt64', 'Int128', 'UInt128', 'Int256', 'UInt256')
            OR type LIKE 'Nullable(Int64)%'
            OR type LIKE 'Nullable(UInt64)%'
            OR type LIKE 'Nullable(Int128)%'
            OR type LIKE 'Nullable(UInt128)%'
          )
        GROUP BY database, table, column, type
        ORDER BY compressed_bytes DESC
        LIMIT 500
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        column: String(row.column ?? ""),
        type: String(row.type ?? ""),
        total_rows: num(row.total_rows),
        compressed_bytes: num(row.compressed_bytes),
        uncompressed_bytes: num(row.uncompressed_bytes),
      }));
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

/**
 * Per-column on-disk vs uncompressed size, biggest columns first. The schema
 * doctor's storage angle: a large column whose compressed size is close to its
 * uncompressed size (ratio near 1×) is barely compressing and is usually
 * fixable with a better codec (Delta/DoubleDelta/Gorilla for sequences &
 * timestamps, a higher ZSTD level, or LowCardinality for repetitive strings).
 * Reuses SchemaLintRow — it already carries compressed + uncompressed bytes.
 */
export function useSchemaCompression(
  options?: Partial<UseQueryOptions<SchemaLintRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["schemaCompression", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          column,
          type,
          sum(rows) AS total_rows,
          sum(column_data_compressed_bytes) AS compressed_bytes,
          sum(column_data_uncompressed_bytes) AS uncompressed_bytes
        FROM system.parts_columns
        WHERE active = 1
          AND ${SCHEMA_SYSTEM_EXCLUDE}
        GROUP BY database, table, column, type
        HAVING compressed_bytes > 0
        ORDER BY compressed_bytes DESC
        LIMIT 500
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        column: String(row.column ?? ""),
        type: String(row.type ?? ""),
        total_rows: num(row.total_rows),
        compressed_bytes: num(row.compressed_bytes),
        uncompressed_bytes: num(row.uncompressed_bytes),
      }));
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

// ============================================
// MergeTree acceleration structures — projections & skip indexes
// ============================================

export interface ProjectionRow {
  database: string;
  table: string;
  name: string;
  type: string; // "Normal" (reordering) or "Aggregate" (pre-aggregation)
  sorting_key: string;
  query: string;
}

/**
 * Projections defined on MergeTree tables (system.projections). A projection
 * is a precomputed reordering or aggregation stored inside the table's parts —
 * it can turn a full scan into a targeted read. Gracefully empty on builds
 * without the table.
 */
export function useProjections(
  options?: Partial<UseQueryOptions<ProjectionRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["projections", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          name,
          type,
          arrayStringConcat(sorting_key, ', ') AS sorting_key,
          query
        FROM system.projections
        ORDER BY database, table, name
      `;
      try {
        const result = await queryApi.executeQuery(sql);
        return (result.data as Array<Record<string, unknown>>).map((row) => ({
          database: String(row.database ?? ""),
          table: String(row.table ?? ""),
          name: String(row.name ?? ""),
          type: String(row.type ?? ""),
          sorting_key: String(row.sorting_key ?? ""),
          query: String(row.query ?? ""),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/projections/i.test(msg) && /Unknown table|UNKNOWN_TABLE|doesn'?t exist/i.test(msg)) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export interface SkipIndexRow {
  database: string;
  table: string;
  name: string;
  type_full: string; // e.g. "set(100)", "minmax", "bloom_filter(0.01)"
  expr: string;
  granularity: number;
  compressed_bytes: number;
  uncompressed_bytes: number;
}

/**
 * Data-skipping (secondary) indexes (system.data_skipping_indices). Each lets
 * ClickHouse skip granules that can't match a predicate. Sorted by on-disk
 * size so the heaviest indexes — which carry their own read/maintenance cost —
 * surface first.
 */
export function useDataSkippingIndices(
  options?: Partial<UseQueryOptions<SkipIndexRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["dataSkippingIndices", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          name,
          type_full,
          expr,
          granularity,
          data_compressed_bytes AS compressed_bytes,
          data_uncompressed_bytes AS uncompressed_bytes
        FROM system.data_skipping_indices
        ORDER BY data_compressed_bytes DESC
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        name: String(row.name ?? ""),
        type_full: String(row.type_full ?? ""),
        expr: String(row.expr ?? ""),
        granularity: num(row.granularity),
        compressed_bytes: num(row.compressed_bytes),
        uncompressed_bytes: num(row.uncompressed_bytes),
      }));
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

// ============================================
// Schema inventory — tables vs views per database
// ============================================

export interface SchemaInventoryRow {
  database: string;
  tables: number;
  views: number;
  bytes: number;
  rows: number;
}

/**
 * Per-database object inventory, split into tables vs views.
 *
 * Views are everything whose engine name contains "View" (View +
 * MaterializedView + Live/WindowView); everything else (MergeTree family,
 * Distributed/StorageProxy, Dictionary, Memory, Log…) counts as a table.
 * total_bytes / total_rows are Nullable for view-like and proxy engines, so
 * the sums are coalesced to 0 to keep the row numeric.
 */
export function useSchemaInventory(
  options?: Partial<UseQueryOptions<SchemaInventoryRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["schemaInventory", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          countIf(engine NOT LIKE '%View%') AS tables,
          countIf(engine LIKE '%View%') AS views,
          coalesce(sum(total_bytes), 0) AS bytes,
          coalesce(sum(total_rows), 0) AS rows
        FROM system.tables
        WHERE ${SCHEMA_SYSTEM_EXCLUDE}
        GROUP BY database
        ORDER BY (tables + views) DESC, database ASC
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        tables: num(row.tables),
        views: num(row.views),
        bytes: num(row.bytes),
        rows: num(row.rows),
      }));
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export interface DatabaseObjectRow {
  name: string;
  engine: string;
  isView: boolean;
  rows: number;
  bytes: number;
}

/**
 * Object list for ONE database — the drill-down behind a row in the schema
 * inventory. Only fetched when a database is expanded (pass enabled). Returns
 * every table/view with its engine, row count, and on-disk size; the UI
 * splits them into a Tables section and a Views section.
 */
export function useDatabaseObjects(
  database: string | null,
  options?: Partial<UseQueryOptions<DatabaseObjectRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["databaseObjects", database, activeConnectionId] as const,
    enabled: !!database,
    queryFn: async () => {
      // Escape the identifier as a ClickHouse string literal — backslash then
      // single-quote — so an exotic database name can't break out of the WHERE.
      const esc = (database ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const sql = `
        SELECT
          name,
          engine,
          engine LIKE '%View%' AS is_view,
          coalesce(total_rows, 0) AS rows,
          coalesce(total_bytes, 0) AS bytes
        FROM system.tables
        WHERE database = '${esc}'
        ORDER BY is_view ASC, bytes DESC, name ASC
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        name: String(row.name ?? ""),
        engine: String(row.engine ?? ""),
        isView: num(row.is_view) === 1,
        rows: num(row.rows),
        bytes: num(row.bytes),
      }));
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

/**
 * The CREATE statement (DDL) for a single object, read from
 * system.tables.create_table_query — the same source the table info tab uses,
 * and populated for views/materialized views too. Lazy: only fetched when a
 * row's DDL is opened, so the drill-down list stays light even for
 * view-heavy databases.
 */
export function useTableDDL(
  database: string | null,
  name: string | null,
  options?: Partial<UseQueryOptions<string, Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["tableDDL", database, name, activeConnectionId] as const,
    enabled: !!database && !!name,
    queryFn: async () => {
      const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const sql = `
        SELECT create_table_query
        FROM system.tables
        WHERE database = '${esc(database ?? "")}' AND name = '${esc(name ?? "")}'
        LIMIT 1
      `;
      const result = await queryApi.executeQuery(sql);
      const row = result.data[0] as Record<string, unknown> | undefined;
      return String(row?.create_table_query ?? "");
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

// ============================================
// Connection breakdown — what makes up the "connections" count
// ============================================

export interface ConnectionBreakdownRow {
  /** Friendly protocol label, e.g. "TCP", "HTTP". */
  protocol: string;
  count: number;
}

const CONNECTION_METRICS: { metric: string; protocol: string }[] = [
  { metric: "TCPConnection", protocol: "TCP" },
  { metric: "HTTPConnection", protocol: "HTTP" },
  { metric: "MySQLConnection", protocol: "MySQL" },
  { metric: "PostgreSQLConnection", protocol: "PostgreSQL" },
  { metric: "InterserverConnection", protocol: "Interserver" },
];

/**
 * The "connections" tile is a single number — sum of the per-protocol
 * connection gauges. ClickHouse has no table of individual connections, so
 * this breakdown (the per-protocol counts that compose that number) is the
 * deepest honest drill-down available. Returns every protocol, including
 * zero-count ones, in a stable order so the panel layout doesn't jump.
 */
export function useConnectionBreakdown(
  options?: Partial<UseQueryOptions<ConnectionBreakdownRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();

  return useQuery({
    queryKey: ["connectionBreakdown", activeConnectionId] as const,
    queryFn: async () => {
      const list = CONNECTION_METRICS.map((m) => `'${m.metric}'`).join(", ");
      const sql = `
        SELECT metric, value
        FROM system.metrics
        WHERE metric IN (${list})
      `;
      const result = await queryApi.executeQuery(sql);
      const byMetric = new Map<string, number>();
      for (const row of result.data as Array<Record<string, unknown>>) {
        byMetric.set(String(row.metric ?? ""), num(row.value));
      }
      // Map to friendly labels in our fixed order; default missing to 0.
      return CONNECTION_METRICS.map((m) => ({
        protocol: m.protocol,
        count: byMetric.get(m.metric) ?? 0,
      }));
    },
    staleTime: 10_000,
    ...options,
  });
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

// ============================================
// Errors & crashes (Monitoring → Errors tab)
// ============================================

export interface ServerErrorRow {
  code: number;
  name: string;
  count: number;            // cumulative since server start (system.errors.value)
  last_error_time: string;
  last_error_message: string;
  remote: number;
}

/**
 * Cumulative error counters from system.errors. This is the canonical "what
 * is this server erroring on" table — every error code with its hit count,
 * last occurrence, and last message. Always present.
 */
export function useServerErrors(
  options?: Partial<UseQueryOptions<ServerErrorRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["serverErrors", activeConnectionId] as const,
    queryFn: async () => {
      // _str suffix on the DateTime alias — CH 24.11 NO_COMMON_TYPE trap.
      const sql = `
        SELECT
          code,
          name,
          value AS count,
          formatDateTime(last_error_time, '%Y-%m-%d %H:%i:%S') AS last_error_time_str,
          substring(last_error_message, 1, 600) AS last_error_message,
          remote
        FROM system.errors
        WHERE value > 0
        ORDER BY value DESC
        LIMIT 300
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        code: num(row.code),
        name: String(row.name ?? ""),
        count: num(row.count),
        last_error_time: String(row.last_error_time_str ?? ""),
        last_error_message: String(row.last_error_message ?? ""),
        remote: num(row.remote),
      }));
    },
    staleTime: 15_000,
    ...options,
  });
}

export interface CrashLogRow {
  event_time: string;
  signal: number;
  thread_id: number;
  query_id: string;
  version: string;
  trace: string;
}

/**
 * Recent crashes from system.crash_log. Usually empty (which is good).
 * Server-level opt-in table — gracefully returns [] when it doesn't exist on
 * the build, same as useQueryViewsLog.
 */
export function useCrashLog(
  options?: Partial<UseQueryOptions<CrashLogRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["crashLog", activeConnectionId] as const,
    retry: false,
    queryFn: async () => {
      // crash_log is build-dependent (absent unless crash logging is compiled
      // in / enabled). Querying it directly on a server that lacks it surfaces
      // a raw Code 60 (UNKNOWN_TABLE) to the user. Gate on system.tables —
      // which always exists — so the failing query is never sent at all. The
      // regex catch below stays as a backstop for the drop-between-checks race.
      const existsRes = await queryApi.executeQuery(
        "SELECT count() AS c FROM system.tables WHERE database = 'system' AND name = 'crash_log'"
      );
      const exists = num((existsRes.data as Array<{ c: unknown }>)[0]?.c) > 0;
      if (!exists) return [];

      const sql = `
        SELECT
          formatDateTime(event_time, '%Y-%m-%d %H:%i:%S') AS event_time_str,
          signal,
          thread_id,
          query_id,
          version,
          substring(arrayStringConcat(trace_full, '\\n'), 1, 4000) AS trace
        FROM system.crash_log
        ORDER BY event_time DESC
        LIMIT 50
      `;
      try {
        const result = await queryApi.executeQuery(sql);
        return (result.data as Array<Record<string, unknown>>).map((row) => ({
          event_time: String(row.event_time_str ?? ""),
          signal: num(row.signal),
          thread_id: num(row.thread_id),
          query_id: String(row.query_id ?? ""),
          version: String(row.version ?? ""),
          trace: String(row.trace ?? ""),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/crash_log/i.test(msg) && /Unknown table|UNKNOWN_TABLE|doesn'?t exist/i.test(msg)) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 30_000,
    ...options,
  });
}

// ============================================
// Distributed / cluster (Monitoring → Distributed tab)
// ============================================

export interface ClusterTopologyRow {
  cluster: string;
  shard_num: number;
  replica_num: number;
  host_name: string;
  host_address: string;
  port: number;
  is_local: number;
  errors_count: number;
  slowdowns_count: number;
  estimated_recovery_time: number;  // seconds until a failed host is retried
}

/**
 * Cluster topology + per-host health from system.clusters. errors_count and
 * slowdowns_count per (cluster, shard, replica) are the canonical "is a node
 * in this distributed cluster flaky" signal; estimated_recovery_time > 0
 * means ClickHouse has temporarily benched that host.
 */
export function useClusterTopology(
  options?: Partial<UseQueryOptions<ClusterTopologyRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["clusterTopology", activeConnectionId] as const,
    queryFn: async () => {
      const sql = `
        SELECT
          cluster,
          shard_num,
          replica_num,
          host_name,
          host_address,
          port,
          is_local,
          errors_count,
          slowdowns_count,
          estimated_recovery_time
        FROM system.clusters
        ORDER BY cluster, shard_num, replica_num
        LIMIT 2000
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        cluster: String(row.cluster ?? ""),
        shard_num: num(row.shard_num),
        replica_num: num(row.replica_num),
        host_name: String(row.host_name ?? ""),
        host_address: String(row.host_address ?? ""),
        port: num(row.port),
        is_local: num(row.is_local),
        errors_count: num(row.errors_count),
        slowdowns_count: num(row.slowdowns_count),
        estimated_recovery_time: num(row.estimated_recovery_time),
      }));
    },
    staleTime: 30_000,
    ...options,
  });
}

export interface DistributionQueueRow {
  database: string;
  table: string;
  is_blocked: number;
  error_count: number;
  data_files: number;
  data_compressed_bytes: number;
  broken_data_files: number;
  last_exception: string;
}

/**
 * Pending async distributed-insert backlog from system.distribution_queue.
 * A growing data_files / non-zero error_count means inserts to a Distributed
 * table aren't draining to the shards. Graceful when the table is absent.
 */
export function useDistributionQueue(
  options?: Partial<UseQueryOptions<DistributionQueueRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["distributionQueue", activeConnectionId] as const,
    retry: false,
    queryFn: async () => {
      const sql = `
        SELECT
          database,
          table,
          is_blocked,
          error_count,
          data_files,
          data_compressed_bytes,
          broken_data_files,
          last_exception
        FROM system.distribution_queue
        ORDER BY error_count DESC, data_files DESC
        LIMIT 500
      `;
      try {
        const result = await queryApi.executeQuery(sql);
        return (result.data as Array<Record<string, unknown>>).map((row) => ({
          database: String(row.database ?? ""),
          table: String(row.table ?? ""),
          is_blocked: num(row.is_blocked),
          error_count: num(row.error_count),
          data_files: num(row.data_files),
          data_compressed_bytes: num(row.data_compressed_bytes),
          broken_data_files: num(row.broken_data_files),
          last_exception: String(row.last_exception ?? ""),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/distribution_queue/i.test(msg) && /Unknown table|UNKNOWN_TABLE|doesn'?t exist/i.test(msg)) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 15_000,
    ...options,
  });
}

export interface DistributedDDLRow {
  entry: string;
  host_name: string;
  status: string;
  cluster: string;
  query_preview: string;
  exception_code: number;
  exception_text: string;
  query_start_time: string;
  query_duration_ms: number;
}

/**
 * Distributed DDL queue (ON CLUSTER operations) from
 * system.distributed_ddl_queue over the last day. Stuck or failed entries
 * (status != 'Finished', non-zero exception_code) flag DDL that didn't
 * propagate to every node. Graceful when the table is absent.
 */
export function useDistributedDDLQueue(
  options?: Partial<UseQueryOptions<DistributedDDLRow[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  return useQuery({
    queryKey: ["distributedDDLQueue", activeConnectionId] as const,
    retry: false,
    queryFn: async () => {
      // Column names per CH 24.11: the per-host column is `host` (not
      // host_name) and the timestamp is `query_create_time`. Alias to our
      // field names with a fresh name (no shadow of a source column).
      const sql = `
        SELECT
          entry,
          host AS host_name,
          status,
          cluster,
          substring(query, 1, 200) AS query_preview,
          exception_code,
          substring(exception_text, 1, 400) AS exception_text,
          formatDateTime(query_create_time, '%Y-%m-%d %H:%i:%S') AS query_start_time_str,
          query_duration_ms
        FROM system.distributed_ddl_queue
        WHERE query_create_time >= now() - INTERVAL 1 DAY
        ORDER BY query_create_time DESC
        LIMIT 300
      `;
      try {
        const result = await queryApi.executeQuery(sql);
        return (result.data as Array<Record<string, unknown>>).map((row) => ({
          entry: String(row.entry ?? ""),
          host_name: String(row.host_name ?? ""),
          status: String(row.status ?? ""),
          cluster: String(row.cluster ?? ""),
          query_preview: String(row.query_preview ?? ""),
          exception_code: num(row.exception_code),
          exception_text: String(row.exception_text ?? ""),
          query_start_time: String(row.query_start_time_str ?? ""),
          query_duration_ms: num(row.query_duration_ms),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Treat "table absent" AND "no ZooKeeper/Keeper configured" as an empty
        // queue: a standalone server with no ZK can't have an ON CLUSTER DDL
        // queue, so there's genuinely nothing to show — not an error worth a
        // scary red banner.
        const tableAbsent =
          /distributed_ddl_queue/i.test(msg) &&
          /Unknown table|UNKNOWN_TABLE|doesn'?t exist/i.test(msg);
        const noZooKeeper = /zookeeper|keeper/i.test(msg) && /no .*configuration|NO_ZOOKEEPER|not configured/i.test(msg);
        // system.distributed_ddl_queue is the one system table whose columns
        // churn across versions (we target the 24.x names: host, query_create_time).
        // If a future major renames them, the query hits an identifier/column
        // error — degrade to an empty queue rather than a red banner, since this
        // catch is scoped to that one query so any such error is a schema drift.
        const schemaDrift =
          /Unknown identifier|UNKNOWN_IDENTIFIER|Missing columns|NO_SUCH_COLUMN|There'?s no column|There is no column|Not found column/i.test(
            msg
          );
        if (tableAbsent || noZooKeeper || schemaDrift) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 30_000,
    ...options,
  });
}
