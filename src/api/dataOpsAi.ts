import { invokeAI } from "./ai";
import { api } from "./client";
import type { DataHealthCheck, DataHealthCriticality } from "./dataHealth";
import type { ScheduledQueryInput, SqFrequency, SqOutputMode } from "./scheduledQueries";

export interface AiEvidenceReference {
  id: string;
  label: string;
  source: "definition" | "run" | "query_log" | "sample" | "incident" | "lineage" | "history";
  observedAt: number;
  detail: string;
}

export interface AiSuggestedAction {
  label: string;
  kind: "none" | "edit" | "retry" | "backfill" | "investigate" | "tune" | "acknowledge";
  rationale: string;
  risk: "low" | "medium" | "high";
}

export interface OperationalBrief {
  headline: string;
  summary: string;
  health: "healthy" | "attention" | "unknown";
  facts: Array<{ label: string; value: string; status: "good" | "warning" | "bad" | "neutral" }>;
  changes: string[];
  suggestedAction: AiSuggestedAction | null;
  confidence: number;
  evidence: AiEvidenceReference[];
  generatedAt: number;
  fingerprint: string;
  model: string;
}

export interface DataOpsInvestigation {
  summary: string;
  likelyCause: string;
  confidence: number;
  observedFacts: string[];
  hypotheses: Array<{ cause: string; confidence: number; evidenceIds: string[] }>;
  impact: string[];
  actions: AiSuggestedAction[];
  evidence: AiEvidenceReference[];
  generatedAt: number;
  model: string;
}

export interface ScheduledQueryAssessment {
  readiness: "ready" | "warning" | "blocked";
  summary: string;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
  confidence: number;
}

export interface ScheduledQueryDraft {
  name: string;
  description: string;
  query: string;
  frequency: SqFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string | null;
  timezone: string;
  outputMode: SqOutputMode;
  destDatabase: string | null;
  destTable: string | null;
  maxRows: number;
  timeoutSecs: number;
  maxAttempts: number;
  assumptions: string[];
}

export interface HealthPromiseRecommendation {
  summary: string;
  eventTimeColumn: string | null;
  checks: DataHealthCheck[];
  breachAfter: number;
  recoverAfter: number;
  graceSecs: number;
  rationale: string[];
  confidence: number;
}

export interface HealthPromiseTuning {
  summary: string;
  recommendations: Array<{
    field: "threshold" | "cadence" | "graceSecs" | "breachAfter" | "recoverAfter" | "severity" | "no_change";
    checkKey: string | null;
    currentValue: string;
    proposedValue: string;
    rationale: string;
    expectedEffect: string;
    confidence: number;
  }>;
}

export interface HealthIncidentCorrelation {
  summary: string;
  groups: Array<{
    title: string;
    likelySharedCause: string;
    confidence: number;
    incidentIds: string[];
    evidence: string[];
  }>;
}

export interface RecoveryAssessment extends ScheduledQueryAssessment {
  slots: number[];
  estimatedRuns: number;
}

export function summarizeScheduledQuery(jobId: string): Promise<OperationalBrief> {
  return invokeAI("summarize-scheduled-query", { jobId });
}

export function summarizeDataHealth(promiseId: string): Promise<OperationalBrief> {
  return invokeAI("summarize-data-health", { promiseId });
}

export function diagnoseScheduledRun(jobId: string, runId: string): Promise<DataOpsInvestigation> {
  return invokeAI("diagnose-scheduled-run", { jobId, runId });
}

export function diagnoseHealthIncident(promiseId: string, incidentId?: string): Promise<DataOpsInvestigation> {
  return invokeAI("diagnose-health-incident", { promiseId, incidentId });
}

export function draftScheduledQuery(input: { intent: string; connectionId: string; timezone: string; database?: string }): Promise<ScheduledQueryDraft> {
  return invokeAI("draft-scheduled-query", input);
}

export function assessScheduledQuery(input: Pick<ScheduledQueryInput, "name" | "connectionId" | "query" | "frequency" | "timezone" | "outputMode" | "destDatabase" | "destTable" | "timeoutSecs" | "maxAttempts">): Promise<ScheduledQueryAssessment> {
  return invokeAI("assess-scheduled-query", input);
}

export function recommendHealthPromise(input: { connectionId: string; database: string; table: string; criticality: DataHealthCriticality; existingChecks: DataHealthCheck[] }): Promise<HealthPromiseRecommendation> {
  return invokeAI("recommend-health-promise", input);
}

export function tuneHealthPromise(promiseId: string): Promise<HealthPromiseTuning> {
  return invokeAI("tune-health-promise", { promiseId });
}

export function correlateHealthIncidents(promiseId: string): Promise<HealthIncidentCorrelation> {
  return invokeAI("correlate-health-incidents", { promiseId });
}

export function planScheduledRecovery(jobId: string, from: number, to: number): Promise<RecoveryAssessment> {
  return invokeAI("plan-scheduled-recovery", { jobId, from, to });
}

export async function submitDataOpsAiFeedback(input: { capability: string; objectType: "scheduled_query" | "scheduled_run" | "data_health_promise" | "data_health_incident"; objectId: string; rating: "useful" | "not_useful" | "accepted" | "edited" | "rejected"; comment?: string }): Promise<void> {
  await api.post<{ recorded: boolean }>("/ai/feedback", input);
}
