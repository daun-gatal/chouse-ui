import { z } from "zod";

export const DATA_HEALTH_CHECK_TYPES = [
  "freshness",
  "row_count",
  "volume_anomaly",
  "completeness",
  "uniqueness",
  "validity",
  "schema_contract",
  "custom_metric",
] as const;

export const DATA_HEALTH_SEVERITIES = ["warning", "critical"] as const;
export const DATA_HEALTH_PROMISE_STATES = ["healthy", "degraded", "unhealthy", "unknown", "paused"] as const;
export const DATA_HEALTH_CHECK_OUTCOMES = ["pass", "breach", "learning", "not_evaluated"] as const;
export const DATA_HEALTH_EVENT_TIME_ENCODINGS = [
  "auto",
  "native",
  "unix_seconds",
  "unix_milliseconds",
  "unix_microseconds",
  "unix_nanoseconds",
  "string",
] as const;
export const DATA_HEALTH_EVENT_TIME_FORMATS = ["best_effort"] as const;

export type DataHealthCheckType = (typeof DATA_HEALTH_CHECK_TYPES)[number];
export type DataHealthSeverity = (typeof DATA_HEALTH_SEVERITIES)[number];
export type DataHealthPromiseState = (typeof DATA_HEALTH_PROMISE_STATES)[number];
export type DataHealthCheckOutcome = (typeof DATA_HEALTH_CHECK_OUTCOMES)[number];
export type DataHealthEventTimeEncoding = (typeof DATA_HEALTH_EVENT_TIME_ENCODINGS)[number];
export type DataHealthEventTimeFormat = (typeof DATA_HEALTH_EVENT_TIME_FORMATS)[number];

const checkBase = {
  checkKey: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(200),
  severity: z.enum(DATA_HEALTH_SEVERITIES).default("warning"),
  enabled: z.boolean().default(true),
};

const boundedRange = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
}).refine((value) => value.min != null || value.max != null, "At least one bound is required")
  .refine((value) => value.min == null || value.max == null || value.min <= value.max, "Minimum cannot exceed maximum");

export const dataHealthCheckDefinitionSchema = z.discriminatedUnion("type", [
  z.object({
    ...checkBase,
    type: z.literal("freshness"),
    config: z.object({
      eventTimeColumn: z.string().trim().min(1).max(64),
      maxAgeSeconds: z.number().int().min(60).max(365 * 24 * 60 * 60),
    }),
  }),
  z.object({ ...checkBase, type: z.literal("row_count"), config: boundedRange }),
  z.object({
    ...checkBase,
    type: z.literal("volume_anomaly"),
    config: z.object({
      minSamples: z.number().int().min(3).max(100).default(7),
      sensitivity: z.number().min(1).max(10).default(3),
      minRelativeBand: z.number().min(0).max(1).default(0.1),
      hardMin: z.number().finite().optional(),
      hardMax: z.number().finite().optional(),
    }).refine((value) => value.hardMin == null || value.hardMax == null || value.hardMin <= value.hardMax, "Hard minimum cannot exceed hard maximum"),
  }),
  z.object({
    ...checkBase,
    type: z.literal("completeness"),
    config: z.object({ column: z.string().trim().min(1).max(64), minRatio: z.number().min(0).max(1) }),
  }),
  z.object({
    ...checkBase,
    type: z.literal("uniqueness"),
    config: z.object({
      columns: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
      maxDuplicateRatio: z.number().min(0).max(1).default(0),
    }),
  }),
  z.object({
    ...checkBase,
    type: z.literal("validity"),
    config: z.object({ predicate: z.string().trim().min(1).max(2000), minRatio: z.number().min(0).max(1) }),
  }),
  z.object({
    ...checkBase,
    type: z.literal("schema_contract"),
    config: z.object({
      expectedColumns: z.array(z.object({ name: z.string().min(1), type: z.string().min(1) })).max(1000),
      allowAdditionalColumns: z.boolean().default(true),
    }),
  }),
  z.object({
    ...checkBase,
    type: z.literal("custom_metric"),
    config: z.object({
      expression: z.string().trim().min(1).max(2000),
      operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between"]),
      threshold: z.number().finite(),
      upperThreshold: z.number().finite().optional(),
    }).refine((value) => value.operator !== "between" || value.upperThreshold != null, "Between requires an upper threshold")
      .refine((value) => value.operator !== "between" || value.upperThreshold == null || value.threshold <= value.upperThreshold, "Lower threshold cannot exceed upper threshold"),
  }),
]);

export type DataHealthCheckDefinition = z.infer<typeof dataHealthCheckDefinitionSchema>;

export interface DataHealthMetricEvaluation {
  checkKey: string;
  type: DataHealthCheckType;
  severity: DataHealthSeverity;
  outcome: DataHealthCheckOutcome;
  observedValue: number | null;
  expectedLower: number | null;
  expectedUpper: number | null;
  message: string;
}

export interface DataHealthEvaluationResult {
  state: Exclude<DataHealthPromiseState, "paused">;
  checks: DataHealthMetricEvaluation[];
}

export interface DataHealthCompileSource {
  sourceType: "table" | "query";
  databaseName?: string;
  tableName?: string;
  sourceQuery?: string;
  eventTimeColumn?: string;
  eventTimeType?: string;
  eventTimeEncoding?: DataHealthEventTimeEncoding;
  eventTimeTimezone?: string;
  eventTimeFormat?: DataHealthEventTimeFormat;
  rowFilter?: string;
}

export interface CompiledDataHealthQuery {
  sql: string;
  metricCheckKeys: string[];
  schemaCheckKeys: string[];
}

export type DataHealthCriticality = "standard" | "important" | "critical";

export interface DataHealthPromiseRow {
  id: string;
  scheduledQueryId: string;
  name: string;
  description: string | null;
  connectionId: string;
  sourceType: "table" | "query";
  databaseName: string | null;
  tableName: string | null;
  sourceQuery: string | null;
  eventTimeColumn: string | null;
  eventTimeType: string | null;
  eventTimeEncoding: DataHealthEventTimeEncoding;
  eventTimeTimezone: string | null;
  eventTimeFormat: DataHealthEventTimeFormat;
  rowFilter: string | null;
  ownerId: string | null;
  ownerDisplayName: string | null;
  criticality: DataHealthCriticality;
  timezone: string;
  runbookUrl: string | null;
  enabled: boolean;
  status: DataHealthPromiseState;
  graceSecs: number;
  breachAfter: number;
  recoverAfter: number;
  retentionDays: number;
  schemaSnapshot: Array<{ name: string; type: string }> | null;
  lastEvaluatedAt: number | null;
  lastHealthyAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataHealthSampleRow {
  id: string;
  promiseId: string;
  checkId: string;
  checkKey: string;
  runId: string | null;
  origin: "live" | "backtest";
  outcome: DataHealthCheckOutcome;
  observedValue: number | null;
  expectedLower: number | null;
  expectedUpper: number | null;
  evidence: Record<string, unknown> | null;
  slotAt: number;
  createdAt: number;
}

export type DataHealthIncidentStatus = "open" | "acknowledged" | "snoozed" | "recovered";
export type DataHealthIncidentKind = "data" | "execution";

export interface DataHealthIncidentRow {
  id: string;
  promiseId: string;
  status: DataHealthIncidentStatus;
  severity: DataHealthSeverity;
  kind: DataHealthIncidentKind;
  summary: string;
  openedAt: number;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
  snoozedUntil: number | null;
  recoveredAt: number | null;
  lastEventAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface DataHealthIncidentEventRow {
  id: string;
  incidentId: string;
  type: string;
  actorId: string | null;
  runId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: number;
}

export interface DataHealthIncidentTransition {
  type: "none" | "opened" | "escalated" | "recovered";
  incident: DataHealthIncidentRow | null;
}
