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

export interface MutationRow {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  parts_to_do: number;
  is_done: number;
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
      const sql = `
        SELECT
          database,
          table,
          mutation_id,
          command,
          formatDateTime(create_time, '%Y-%m-%d %H:%i:%S') AS create_time,
          parts_to_do,
          is_done,
          latest_failed_part,
          latest_fail_reason,
          formatDateTime(latest_fail_time, '%Y-%m-%d %H:%i:%S') AS latest_fail_time
        FROM system.mutations
        WHERE is_done = 0 OR create_time >= now() - INTERVAL 7 DAY
        ORDER BY is_done ASC, create_time DESC
        LIMIT 500
      `;
      const result = await queryApi.executeQuery(sql);
      return (result.data as Array<Record<string, unknown>>).map((row) => ({
        database: String(row.database ?? ""),
        table: String(row.table ?? ""),
        mutation_id: String(row.mutation_id ?? ""),
        command: String(row.command ?? ""),
        create_time: String(row.create_time ?? ""),
        parts_to_do: num(row.parts_to_do),
        is_done: num(row.is_done),
        latest_failed_part: String(row.latest_failed_part ?? ""),
        latest_fail_reason: String(row.latest_fail_reason ?? ""),
        latest_fail_time: String(row.latest_fail_time ?? ""),
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
      const sql = `
        SELECT
          database,
          table,
          replica_name,
          type,
          source_replica,
          new_part_name,
          length(parts_to_merge) AS parts_to_merge,
          formatDateTime(last_attempt_time, '%Y-%m-%d %H:%i:%S') AS last_attempt_time,
          num_tries,
          last_exception,
          formatDateTime(create_time, '%Y-%m-%d %H:%i:%S') AS create_time
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
        last_attempt_time: String(row.last_attempt_time ?? ""),
        num_tries: num(row.num_tries),
        last_exception: String(row.last_exception ?? ""),
        create_time: String(row.create_time ?? ""),
      }));
    },
    staleTime: 30_000,
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
