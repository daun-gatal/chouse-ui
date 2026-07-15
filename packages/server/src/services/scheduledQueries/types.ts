/**
 * Scheduled Queries — shared types, enums, and Zod (v3) schemas.
 *
 * The job row is the scheduler lease (`last_run_at`); runs are immutable history.
 * Booleans persist as INTEGER 0/1 and timestamps as millisecond integers in both
 * dialects (mirrors the alerting tables). See ADR 0002 (D1–D7).
 */

import { z } from "zod";

// --- enums ------------------------------------------------------------------

export type SqKind = "sql_query" | "data_health_check";
/** `event` runs are started by a successful upstream materialize run (ADR 0006). */
export type SqTrigger = "scheduled" | "manual" | "event";
/**
 * Run status. Alerting is failure-based: a run is `error` when it fails to
 * execute, else `success`. (`failed` is retained only to read any legacy rows.)
 */
export type SqStatus = "running" | "success" | "failed" | "error";
/** `event` never fires from the clock — only Data Health backing jobs use it (ADR 0006). */
export type SqFrequency = "daily" | "weekly" | "monthly" | "cron" | "manual" | "event";
export type SqOutputMode = "none" | "append" | "replace" | "upsert";
/** Outbox delivery kinds — failure alert + its recovery note. */
export type SqOutboxKind = "alert" | "recovery";
export type SqOutboxStatus = "pending" | "sending" | "sent";

/** Cadences a user can put on a plain scheduled query — excludes `event`. */
export const SQ_FREQUENCIES: readonly SqFrequency[] = ["daily", "weekly", "monthly", "cron", "manual"];
/** Cadences a Data Health promise accepts — adds the upstream-chained `event`. */
export const DATA_HEALTH_FREQUENCIES: readonly SqFrequency[] = [...SQ_FREQUENCIES, "event"];
export const SQ_OUTPUT_MODES: readonly SqOutputMode[] = ["none", "append", "replace", "upsert"];

// --- output / materialize (output_config JSON) ------------------------------

export const expectedColumnSchema = z.object({ name: z.string(), type: z.string() });
export type ExpectedColumn = z.infer<typeof expectedColumnSchema>;

export const outputConfigSchema = z.object({
  /** Partition expression for `replace`, e.g. `toYYYYMMDD({{slot_end}})`. */
  partitionExpr: z.string().optional(),
  /** Create the destination table on first write when it does not exist. */
  createIfMissing: z.boolean().optional(),
  /** Engine for create-if-missing, e.g. `MergeTree`. */
  engine: z.string().optional(),
  /** ORDER BY clause for create-if-missing. */
  orderBy: z.string().optional(),
  /** PARTITION BY clause for create-if-missing. */
  partitionBy: z.string().optional(),
  /** Staging table name (replace mode); defaults to `<dest>__sq_staging`. */
  staging: z.string().optional(),
  /** Pinned source-SELECT schema captured at create/edit (D4c). */
  expectedSchema: z.array(expectedColumnSchema).optional(),
});

export type OutputConfig = z.infer<typeof outputConfigSchema>;

// --- row shapes (camelCase service view of the snake_case DB rows) ----------

export interface ScheduledQueryRow {
  id: string;
  name: string;
  description: string | null;
  kind: SqKind;
  connectionId: string;
  query: string;
  enabled: boolean;
  frequency: SqFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string | null;
  timezone: string;
  outputMode: SqOutputMode;
  destDatabase: string | null;
  destTable: string | null;
  outputConfig: OutputConfig | null;
  maxRows: number;
  timeoutSecs: number;
  useFinal: boolean;
  seqConsistency: boolean;
  lastRunAt: number;
  lastRunBy: string | null;
  maxAttempts: number;
  retentionDays: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledQueryRunRow {
  id: string;
  queryId: string;
  trigger: SqTrigger;
  status: SqStatus;
  slotAt: number;
  attempt: number;
  runnerId: string | null;
  deadline: number | null;
  rowCount: number | null;
  truncated: boolean;
  writtenRows: number | null;
  resultJson: string | null;
  conditionValue: string | null;
  conditionMet: boolean | null;
  durationMs: number | null;
  message: string | null;
  notified: boolean;
  startedAt: number;
  finishedAt: number | null;
}

export interface ScheduledQueryOutboxRow {
  id: string;
  runId: string;
  queryId: string;
  kind: SqOutboxKind;
  dedupKey: string;
  payload: string;
  status: SqOutboxStatus;
  lockedBy: string | null;
  lockedAt: number | null;
  attempts: number;
  createdAt: number;
  sentAt: number | null;
}

// --- type guards ------------------------------------------------------------

export function isFrequency(v: unknown): v is SqFrequency {
  // Checked against ALL frequencies (incl. `event`) — this guards row READS, and
  // mapping a stored `event` job to the "daily" fallback would put it on a cron.
  return typeof v === "string" && (DATA_HEALTH_FREQUENCIES as readonly string[]).includes(v);
}
export function isOutputMode(v: unknown): v is SqOutputMode {
  return typeof v === "string" && (SQ_OUTPUT_MODES as readonly string[]).includes(v);
}
