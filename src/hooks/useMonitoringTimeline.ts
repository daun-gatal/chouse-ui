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

function truncFunc(bucket: TimelineBucket): string {
  return bucket === "hour" ? "toStartOfHour(event_time)" : "toStartOfMinute(event_time)";
}

function hoursBackWhere(hoursBack: number): string {
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
  options?: Partial<UseQueryOptions<QueryTimelinePoint[], Error>>
) {
  const { activeConnectionId } = useAuthStore();
  void rbacUserId; // reserved for per-user filtering once query_log carries rbac mapping

  return useQuery({
    queryKey: ["queryTimeline", hoursBack, bucket, activeConnectionId] as const,
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
        WHERE ${hoursBackWhere(hoursBack)}
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
        WHERE ${hoursBackWhere(hoursBack)}
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
