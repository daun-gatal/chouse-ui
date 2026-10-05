import { z } from "zod";

import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import * as healthStore from "../../dataHealth/store";
import { dataHealthCheckDefinitionSchema, type DataHealthCheckDefinition } from "../../dataHealth/types";
import { fireTimesBetween } from "../../scheduledQueries/cadence";
import { clientForConnection } from "../../scheduledQueries/chClient";
import { buildLineage } from "../../observe/jobLineage";
import * as scheduledStore from "../../scheduledQueries/store";
import type { ScheduledQueryRow } from "../../scheduledQueries/types";
import {
  buildDataHealthEvidence,
  buildScheduledQueryEvidence,
  evidenceFingerprint,
  getDataOpsAiCache,
  setDataOpsAiCache,
  type DataHealthEvidence,
  type EvidenceReference,
  type ScheduledQueryEvidence,
} from "../dataOpsEvidence";
import type { AgentRunContext, StructuredCapability } from "../types";

const evidenceReferenceSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.enum(["definition", "run", "query_log", "sample", "incident", "lineage", "history"]),
  observedAt: z.number(),
  detail: z.string(),
});

const actionSchema = z.object({
  label: z.string(),
  kind: z.enum(["none", "edit", "retry", "backfill", "investigate", "tune", "acknowledge"]),
  rationale: z.string(),
  risk: z.enum(["low", "medium", "high"]),
});

export const OperationalBriefSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  health: z.enum(["healthy", "attention", "unknown"]),
  facts: z.array(z.object({ label: z.string(), value: z.string(), status: z.enum(["good", "warning", "bad", "neutral"]) })).max(8),
  changes: z.array(z.string()).max(6),
  suggestedAction: actionSchema.nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(evidenceReferenceSchema).max(20),
  generatedAt: z.number(),
  fingerprint: z.string(),
  model: z.string(),
});

export type OperationalBrief = z.infer<typeof OperationalBriefSchema>;
const OperationalBriefParsedSchema = OperationalBriefSchema.omit({ evidence: true, generatedAt: true, fingerprint: true, model: true });

export const InvestigationSchema = z.object({
  summary: z.string(),
  likelyCause: z.string(),
  confidence: z.number().min(0).max(1),
  observedFacts: z.array(z.string()).max(10),
  hypotheses: z.array(z.object({ cause: z.string(), confidence: z.number().min(0).max(1), evidenceIds: z.array(z.string()).max(10) })).max(5),
  impact: z.array(z.string()).max(8),
  actions: z.array(actionSchema).max(6),
  evidence: z.array(evidenceReferenceSchema).max(25),
  generatedAt: z.number(),
  model: z.string(),
});

export type Investigation = z.infer<typeof InvestigationSchema>;
const InvestigationParsedSchema = InvestigationSchema.omit({ evidence: true, generatedAt: true, model: true });

const AssessmentSchema = z.object({
  readiness: z.enum(["ready", "warning", "blocked"]),
  summary: z.string(),
  blockers: z.array(z.string()).max(10),
  warnings: z.array(z.string()).max(10),
  recommendations: z.array(z.string()).max(10),
  confidence: z.number().min(0).max(1),
});

const ScheduledDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000),
  query: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "monthly", "cron", "manual"]),
  hour: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(28),
  cronExpr: z.string().nullable(),
  timezone: z.string(),
  outputMode: z.enum(["none", "append", "replace", "upsert"]),
  destDatabase: z.string().nullable(),
  destTable: z.string().nullable(),
  maxRows: z.number().int().min(1).max(10000),
  timeoutSecs: z.number().int().min(1).max(3600),
  maxAttempts: z.number().int().min(1).max(10),
  assumptions: z.array(z.string()).max(10),
});

const HealthRecommendationSchema = z.object({
  summary: z.string(),
  eventTimeColumn: z.string().nullable(),
  checks: z.array(dataHealthCheckDefinitionSchema).min(1).max(20),
  breachAfter: z.coerce.number().int().min(1).max(20),
  recoverAfter: z.coerce.number().int().min(1).max(20),
  graceSecs: z.coerce.number().int().min(0),
  rationale: z.array(z.string()).max(20),
  confidence: z.number().min(0).max(1),
});

const TuningSchema = z.object({
  summary: z.string(),
  recommendations: z.array(z.object({
    field: z.enum(["threshold", "cadence", "graceSecs", "breachAfter", "recoverAfter", "severity", "no_change"]),
    checkKey: z.string().nullable(),
    currentValue: z.string(),
    proposedValue: z.string(),
    rationale: z.string(),
    expectedEffect: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(15),
});

const CorrelationSchema = z.object({
  summary: z.string(),
  groups: z.array(z.object({
    title: z.string(),
    likelySharedCause: z.string(),
    confidence: z.number().min(0).max(1),
    incidentIds: z.array(z.string()),
    evidence: z.array(z.string()),
  })).max(10),
});

function requirePermission(ctx: AgentRunContext, permission: string): void {
  if (!ctx.isAdmin && !ctx.permissions?.includes(permission)) throw AppError.forbidden(`Permission '${permission}' required for this action`);
}

function visibleScheduledJob(ctx: AgentRunContext, job: ScheduledQueryRow): boolean {
  return Boolean(ctx.isAdmin || ctx.permissions?.includes(PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL) || job.createdBy === ctx.userId);
}

async function scheduledEvidence(ctx: AgentRunContext, jobId: string): Promise<ScheduledQueryEvidence> {
  requirePermission(ctx, PERMISSIONS.SCHEDULED_QUERIES_VIEW);
  const job = await scheduledStore.getJob(jobId);
  if (!job || job.kind !== "sql_query" || !visibleScheduledJob(ctx, job)) throw AppError.notFound("Scheduled query not found");
  const runs = await scheduledStore.listRuns({ queryId: job.id, limit: 50, offset: 0 });
  const evidence = buildScheduledQueryEvidence(job, runs);
  try {
    const visibleJobs = await scheduledStore.listJobs(ctx.isAdmin || ctx.permissions?.includes(PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL) ? null : ctx.userId ?? "__none__");
    const lineage = await buildLineage(job, visibleJobs, 14);
    for (const node of lineage.nodes.slice(0, 30)) {
      evidence.references.push({
        id: `lineage:${node.id}`,
        label: node.label,
        source: "lineage",
        observedAt: lineage.observedAt,
        detail: node.kind === "table" ? `${node.produced ? "produced" : "read"} table; ${node.columns.length} observed columns` : `${node.runCount} observed runs; output ${node.outputMode}`,
      });
    }
    evidence.fingerprint = evidenceFingerprint({ base: evidence.fingerprint, lineage: { nodes: lineage.nodes, edges: lineage.edges } });
  } catch {
    // Retained run evidence remains useful when query_log lineage is unavailable.
  }
  return evidence;
}

async function healthEvidence(ctx: AgentRunContext, promiseId: string): Promise<DataHealthEvidence> {
  requirePermission(ctx, PERMISSIONS.DATA_HEALTH_VIEW);
  const promise = await healthStore.getPromise(promiseId);
  const canSee = promise && (ctx.isAdmin || ctx.permissions?.includes(PERMISSIONS.DATA_HEALTH_VIEW_ALL) || promise.ownerId === ctx.userId || promise.createdBy === ctx.userId);
  if (!promise || !canSee) throw AppError.notFound("Data Health promise not found");
  const [checks, samples, incidents, runs] = await Promise.all([
    healthStore.getChecks(promise.id),
    healthStore.listSamples(promise.id, 100, 0),
    healthStore.listIncidents(promise.id, 50, 0),
    scheduledStore.listRuns({ queryId: promise.scheduledQueryId, limit: 50, offset: 0 }),
  ]);
  const evidence = buildDataHealthEvidence(promise, checks, samples, incidents, runs);
  try {
    const job = await scheduledStore.getJob(promise.scheduledQueryId);
    if (job) {
      const visibleJobs = await scheduledStore.listJobs(ctx.isAdmin || ctx.permissions?.includes(PERMISSIONS.SCHEDULED_QUERIES_VIEW_ALL) ? null : ctx.userId ?? "__none__");
      const lineage = await buildLineage(job, [job, ...visibleJobs], 14);
      for (const node of lineage.nodes.slice(0, 30)) {
        evidence.references.push({
          id: `lineage:${node.id}`,
          label: node.label,
          source: "lineage",
          observedAt: lineage.observedAt,
          detail: node.kind === "table" ? `${node.produced ? "produced" : "read"} table; ${node.columns.length} observed columns` : `${node.runCount} observed runs`,
        });
      }
      evidence.fingerprint = evidenceFingerprint({ base: evidence.fingerprint, lineage: { nodes: lineage.nodes, edges: lineage.edges } });
    }
  } catch {
    // Health samples and incidents remain available without query_log access.
  }
  return evidence;
}

// The scope names the bound agent revision, so editing the agent never serves
// a result its previous revision produced.
function cacheKey(capability: string, fingerprint: string, scope: string): string {
  return `${capability}:${fingerprint}:${scope}`;
}

function cached<T>(capability: string, fingerprint: string, scope: string): T | undefined {
  return getDataOpsAiCache<T>(cacheKey(capability, fingerprint, scope));
}

function putCached(capability: string, fingerprint: string, output: unknown, scope: string): void {
  setDataOpsAiCache(cacheKey(capability, fingerprint, scope), output);
}

/** The evidence the bound agent's task template wraps in <evidence> tags. */
function evidenceVariables(value: unknown): Record<string, string> {
  return { evidence: JSON.stringify(value) };
}

function summaryEvidence(evidence: ScheduledQueryEvidence | DataHealthEvidence): EvidenceReference[] {
  return evidence.references.slice(0, 20);
}

export const summarizeScheduledQueryCapability: StructuredCapability<{ jobId: string }, ScheduledQueryEvidence, z.infer<typeof OperationalBriefParsedSchema>, OperationalBrief> = {
  id: "summarize-scheduled-query",
  title: "Scheduled query brief",
  description: "Scheduled Queries › AI brief: purpose, health, meaningful change and whether action is needed.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ jobId: z.string().uuid() }),
  outputSchema: OperationalBriefParsedSchema,
  prepare: (input, ctx) => scheduledEvidence(ctx, input.jobId),
  cachedResult: (prepared, _ctx, scope) => cached("summarize-scheduled-query", prepared.fingerprint, scope),
  templateVariables: (prepared) => evidenceVariables({ ...prepared, job: { ...prepared.job, query: prepared.job.query.slice(0, 20000) } }),
  finalize: (parsed, prepared, _ctx, meta) => ({ ...parsed, evidence: summaryEvidence(prepared), generatedAt: Date.now(), fingerprint: prepared.fingerprint, model: meta.modelLabel }),
  cacheResult: (output, prepared, _ctx, scope) => putCached("summarize-scheduled-query", prepared.fingerprint, output, scope),
};

export const summarizeDataHealthCapability: StructuredCapability<{ promiseId: string }, DataHealthEvidence, z.infer<typeof OperationalBriefParsedSchema>, OperationalBrief> = {
  id: "summarize-data-health",
  title: "Data health brief",
  description: "Data Health › AI brief for one protected dataset.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ promiseId: z.string().uuid() }),
  outputSchema: OperationalBriefParsedSchema,
  prepare: (input, ctx) => healthEvidence(ctx, input.promiseId),
  cachedResult: (prepared, _ctx, scope) => cached("summarize-data-health", prepared.fingerprint, scope),
  templateVariables: evidenceVariables,
  finalize: (parsed, prepared, _ctx, meta) => ({ ...parsed, evidence: summaryEvidence(prepared), generatedAt: Date.now(), fingerprint: prepared.fingerprint, model: meta.modelLabel }),
  cacheResult: (output, prepared, _ctx, scope) => putCached("summarize-data-health", prepared.fingerprint, output, scope),
};

interface RunLogEvidence {
  durationMs: number | null;
  readRows: number | null;
  readBytes: number | null;
  memoryUsage: number | null;
  exceptionCode: number | null;
  exception: string | null;
  tables: string[];
  columns: string[];
}

async function fetchRunLog(connectionId: string, runId: string): Promise<RunLogEvidence | null> {
  try {
    const client = await clientForConnection(connectionId, JSON.stringify({ source: "dataops_ai_evidence", run_id: runId }));
    const result = await client.query({
      query: `SELECT query_duration_ms, read_rows, read_bytes, memory_usage, exception_code, exception, tables, columns
              FROM system.query_log
              WHERE query_id = {runId:String} AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
              ORDER BY event_time DESC LIMIT 1`,
      query_params: { runId },
      format: "JSON",
      clickhouse_settings: { readonly: "1", max_execution_time: 10, max_result_rows: "1" },
    });
    const json = (await result.json()) as { data?: Array<Record<string, unknown>> };
    const row = json.data?.[0];
    if (!row) return null;
    const nullableNumber = (value: unknown): number | null => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.map(String).slice(0, 100) : [];
    return {
      durationMs: nullableNumber(row.query_duration_ms),
      readRows: nullableNumber(row.read_rows),
      readBytes: nullableNumber(row.read_bytes),
      memoryUsage: nullableNumber(row.memory_usage),
      exceptionCode: nullableNumber(row.exception_code),
      exception: typeof row.exception === "string" && row.exception ? row.exception.slice(0, 4000) : null,
      tables: stringArray(row.tables),
      columns: stringArray(row.columns),
    };
  } catch {
    return null;
  }
}

interface RunPrepared { evidence: ScheduledQueryEvidence; runId: string; run: ScheduledQueryEvidence["runs"][number]; queryLog: RunLogEvidence | null }

export const diagnoseScheduledRunCapability: StructuredCapability<{ jobId: string; runId: string }, RunPrepared, z.infer<typeof InvestigationParsedSchema>, Investigation> = {
  id: "diagnose-scheduled-run",
  title: "Diagnose a scheduled run",
  description: "Scheduled Queries › Run › Diagnose: ranks causes of one failed or slow run.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ jobId: z.string().uuid(), runId: z.string().uuid() }),
  outputSchema: InvestigationParsedSchema,
  async prepare(input, ctx) {
    const evidence = await scheduledEvidence(ctx, input.jobId);
    const run = evidence.runs.find((item) => item.id === input.runId);
    if (!run) throw AppError.notFound("Scheduled query run not found");
    const queryLog = await fetchRunLog(evidence.job.connectionId, input.runId);
    if (queryLog) evidence.references.push({
      id: `query-log:${input.runId}`,
      label: "Correlated ClickHouse query log",
      source: "query_log",
      observedAt: run.finishedAt ?? run.startedAt,
      detail: `${queryLog.durationMs ?? "unknown"}ms; ${queryLog.readRows ?? "unknown"} rows read; ${queryLog.memoryUsage ?? "unknown"} bytes peak memory; exception ${queryLog.exceptionCode ?? "none"}`,
    });
    return { evidence, runId: input.runId, run, queryLog };
  },
  cachedResult: (prepared, _ctx, scope) => cached("diagnose-scheduled-run", `${prepared.evidence.fingerprint}:${prepared.runId}`, scope),
  templateVariables: evidenceVariables,
  finalize: (parsed, prepared, _ctx, meta) => ({ ...parsed, evidence: prepared.evidence.references.slice(0, 25), generatedAt: Date.now(), model: meta.modelLabel }),
  cacheResult: (output, prepared, _ctx, scope) => putCached("diagnose-scheduled-run", `${prepared.evidence.fingerprint}:${prepared.runId}`, output, scope),
};

interface HealthIncidentPrepared { evidence: DataHealthEvidence; incidentId?: string }

export const diagnoseHealthIncidentCapability: StructuredCapability<{ promiseId: string; incidentId?: string }, HealthIncidentPrepared, z.infer<typeof InvestigationParsedSchema>, Investigation> = {
  id: "diagnose-health-incident",
  title: "Diagnose a data health incident",
  description: "Data Health › Incident › Diagnose: monitor failure or bad data, likely impact, safe next actions.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ promiseId: z.string().uuid(), incidentId: z.string().uuid().optional() }),
  outputSchema: InvestigationParsedSchema,
  async prepare(input, ctx) {
    const evidence = await healthEvidence(ctx, input.promiseId);
    if (input.incidentId && !evidence.incidents.some((incident) => incident.id === input.incidentId)) throw AppError.notFound("Data Health incident not found");
    return { evidence, incidentId: input.incidentId };
  },
  cachedResult: (prepared, _ctx, scope) => cached("diagnose-health-incident", `${prepared.evidence.fingerprint}:${prepared.incidentId ?? "current"}`, scope),
  templateVariables: evidenceVariables,
  finalize: (parsed, prepared, _ctx, meta) => ({ ...parsed, evidence: prepared.evidence.references.slice(0, 25), generatedAt: Date.now(), model: meta.modelLabel }),
  cacheResult: (output, prepared, _ctx, scope) => putCached("diagnose-health-incident", `${prepared.evidence.fingerprint}:${prepared.incidentId ?? "current"}`, output, scope),
};

const draftInputSchema = z.object({
  intent: z.string().trim().min(8).max(4000),
  connectionId: z.string().min(1),
  timezone: z.string().default("UTC"),
  database: z.string().optional(),
});

type DraftInput = z.infer<typeof draftInputSchema>;

export const draftScheduledQueryCapability: StructuredCapability<DraftInput, DraftInput, z.infer<typeof ScheduledDraftSchema>, z.infer<typeof ScheduledDraftSchema>> = {
  id: "draft-scheduled-query",
  title: "Draft a scheduled query",
  description: "Scheduled Queries › New with AI: turns intent into an editable draft.",
  surface: "dataops",
  contexts: ["session"],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: draftInputSchema,
  outputSchema: ScheduledDraftSchema,
  prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.SCHEDULED_QUERIES_EDIT);
    if (ctx.connectionId !== input.connectionId) throw AppError.badRequest("Select the target connection before drafting a scheduled query");
    return input;
  },
  templateVariables: (prepared) => evidenceVariables(prepared),
  finalize: (parsed) => parsed,
};

const assessmentInputSchema = z.object({
  name: z.string().max(200),
  connectionId: z.string().min(1),
  query: z.string().min(1).max(100000),
  frequency: z.enum(["daily", "weekly", "monthly", "cron", "manual"]),
  timezone: z.string(),
  outputMode: z.enum(["none", "append", "replace", "upsert"]),
  destDatabase: z.string().nullable().optional(),
  destTable: z.string().nullable().optional(),
  timeoutSecs: z.number().int(),
  maxAttempts: z.number().int(),
});

type AssessmentInput = z.infer<typeof assessmentInputSchema>;

export const assessScheduledQueryCapability: StructuredCapability<AssessmentInput, AssessmentInput, z.infer<typeof AssessmentSchema>, z.infer<typeof AssessmentSchema>> = {
  id: "assess-scheduled-query",
  title: "Scheduled query preflight",
  description: "Scheduled Queries › Editor › AI preflight: risks and improvements before saving.",
  surface: "dataops",
  contexts: ["session"],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: assessmentInputSchema,
  outputSchema: AssessmentSchema,
  prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.SCHEDULED_QUERIES_EDIT);
    // Schema/explain tools run on the session's connection — refuse to assess a
    // job pinned to a different one rather than reason over the wrong cluster.
    if (ctx.connectionId !== input.connectionId) throw AppError.badRequest("Select the job's connection before requesting an AI preflight");
    return input;
  },
  templateVariables: evidenceVariables,
  finalize: (parsed) => parsed,
};

const recommendInputSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1),
  table: z.string().min(1),
  criticality: z.enum(["standard", "important", "critical"]).default("standard"),
  existingChecks: z.array(dataHealthCheckDefinitionSchema).default([]),
});

type RecommendInput = z.infer<typeof recommendInputSchema>;

export const recommendHealthPromiseCapability: StructuredCapability<RecommendInput, RecommendInput, z.infer<typeof HealthRecommendationSchema>, z.infer<typeof HealthRecommendationSchema>> = {
  id: "recommend-health-promise",
  title: "Recommend health checks",
  description: "Data Health › New with AI: recommends checks for one table from bounded aggregates.",
  surface: "dataops",
  contexts: ["session"],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: recommendInputSchema,
  outputSchema: HealthRecommendationSchema,
  prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.DATA_HEALTH_EDIT);
    if (ctx.connectionId !== input.connectionId) throw AppError.badRequest("Select the dataset connection before requesting recommendations");
    return input;
  },
  templateVariables: evidenceVariables,
  finalize: (parsed) => parsed,
};

export const tuneHealthPromiseCapability: StructuredCapability<{ promiseId: string }, DataHealthEvidence, z.infer<typeof TuningSchema>, z.infer<typeof TuningSchema>> = {
  id: "tune-health-promise",
  title: "Tune health checks",
  description: "Data Health › Tune: recommends threshold and cadence changes from history.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ promiseId: z.string().uuid() }),
  outputSchema: TuningSchema,
  prepare: (input, ctx) => healthEvidence(ctx, input.promiseId),
  cachedResult: (prepared, _ctx, scope) => cached("tune-health-promise", prepared.fingerprint, scope),
  templateVariables: evidenceVariables,
  finalize: (parsed) => parsed,
  cacheResult: (output, prepared, _ctx, scope) => putCached("tune-health-promise", prepared.fingerprint, output, scope),
};

interface RecoveryPrepared { evidence: ScheduledQueryEvidence; from: number; to: number; slots: number[]; warnings: string[] }

export const planScheduledRecoveryCapability: StructuredCapability<{ jobId: string; from: number; to: number }, RecoveryPrepared, z.infer<typeof AssessmentSchema>, z.infer<typeof AssessmentSchema> & { slots: number[]; estimatedRuns: number }> = {
  id: "plan-scheduled-recovery",
  title: "Assess a recovery plan",
  description: "Scheduled Queries › Recover: assesses a bounded backfill before it runs.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ jobId: z.string().uuid(), from: z.number().int(), to: z.number().int() }).refine((value) => value.from <= value.to, "Start must precede end"),
  outputSchema: AssessmentSchema,
  async prepare(input, ctx) {
    requirePermission(ctx, PERMISSIONS.SCHEDULED_QUERIES_RUN);
    const evidence = await scheduledEvidence(ctx, input.jobId);
    const slots = fireTimesBetween(evidence.job, input.from, input.to, 100);
    const warnings = [
      ...(slots.length === 100 ? ["Range reached the 100-slot safety limit"] : []),
      ...(evidence.job.outputMode === "upsert" ? ["Upsert deduplication is eventual until merges complete"] : []),
      ...(evidence.job.outputMode === "append" ? ["Append recovery relies on ClickHouse deduplication configuration"] : []),
    ];
    return { evidence, from: input.from, to: input.to, slots, warnings };
  },
  templateVariables: evidenceVariables,
  finalize: (parsed, prepared) => ({ ...parsed, slots: prepared.slots, estimatedRuns: prepared.slots.length }),
};

interface CorrelationPrepared { focus: DataHealthEvidence; related: Array<{ promiseId: string; name: string; incidents: DataHealthEvidence["incidents"] }> }

export const correlateHealthIncidentsCapability: StructuredCapability<{ promiseId: string }, CorrelationPrepared, z.infer<typeof CorrelationSchema>, z.infer<typeof CorrelationSchema>> = {
  id: "correlate-health-incidents",
  title: "Correlate incidents",
  description: "Data Health › Correlate: groups incidents that share a credible cause.",
  surface: "dataops",
  contexts: [],
  variables: { evidence: { type: "json", description: "The evidence object the feature assembled (JSON)." } },
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ promiseId: z.string().uuid() }),
  outputSchema: CorrelationSchema,
  async prepare(input, ctx) {
    const focus = await healthEvidence(ctx, input.promiseId);
    const promises = await healthStore.listPromises(ctx.isAdmin || ctx.permissions?.includes(PERMISSIONS.DATA_HEALTH_VIEW_ALL) ? null : ctx.userId ?? "__none__");
    const related = await Promise.all(promises.filter((promise) => promise.id !== input.promiseId).slice(0, 50).map(async (promise) => ({
      promiseId: promise.id,
      name: promise.name,
      incidents: await healthStore.listIncidents(promise.id, 10, 0),
    })));
    return { focus, related };
  },
  templateVariables: evidenceVariables,
  finalize: (parsed) => parsed,
};

export type ScheduledQueryDraft = z.infer<typeof ScheduledDraftSchema>;
export type ScheduledQueryAssessment = z.infer<typeof AssessmentSchema>;
export type HealthPromiseRecommendation = z.infer<typeof HealthRecommendationSchema>;
export type HealthPromiseTuning = z.infer<typeof TuningSchema>;
export type HealthIncidentCorrelation = z.infer<typeof CorrelationSchema>;

export function recommendationChecks(value: z.infer<typeof HealthRecommendationSchema>): DataHealthCheckDefinition[] {
  return value.checks;
}
