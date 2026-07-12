import { createHash } from "node:crypto";

import type { DataHealthCheckDefinition, DataHealthIncidentRow, DataHealthPromiseRow, DataHealthSampleRow } from "../dataHealth/types";
import type { ScheduledQueryRow, ScheduledQueryRunRow } from "../scheduledQueries/types";

export interface EvidenceReference {
  id: string;
  label: string;
  source: "definition" | "run" | "query_log" | "sample" | "incident" | "lineage" | "history";
  observedAt: number;
  detail: string;
}

export interface ScheduledQueryEvidence {
  fingerprint: string;
  generatedAt: number;
  job: ScheduledQueryRow;
  runs: ScheduledQueryRunRow[];
  successRate: number | null;
  averageDurationMs: number | null;
  durationChangePercent: number | null;
  failureStreak: number;
  latestRun: ScheduledQueryRunRow | null;
  previousSuccess: ScheduledQueryRunRow | null;
  references: EvidenceReference[];
}

export interface DataHealthEvidence {
  fingerprint: string;
  generatedAt: number;
  promise: DataHealthPromiseRow;
  checks: DataHealthCheckDefinition[];
  samples: DataHealthSampleRow[];
  incidents: DataHealthIncidentRow[];
  runs: ScheduledQueryRunRow[];
  breachedChecks: string[];
  learningChecks: string[];
  references: EvidenceReference[];
}

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

export function evidenceFingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex").slice(0, 24);
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function terminal(run: ScheduledQueryRunRow): boolean {
  return run.status !== "running";
}

export function buildScheduledQueryEvidence(
  job: ScheduledQueryRow,
  runs: ScheduledQueryRunRow[],
  now = Date.now(),
): ScheduledQueryEvidence {
  const terminalRuns = runs.filter(terminal);
  const successes = terminalRuns.filter((run) => run.status === "success");
  const durations = terminalRuns.flatMap((run) => run.durationMs == null ? [] : [run.durationMs]);
  const recentDurations = durations.slice(0, 5);
  const olderDurations = durations.slice(5, 10);
  const recentAverage = average(recentDurations);
  const olderAverage = average(olderDurations);
  const durationChangePercent = recentAverage != null && olderAverage != null && olderAverage > 0
    ? ((recentAverage - olderAverage) / olderAverage) * 100
    : null;
  let failureStreak = 0;
  for (const run of terminalRuns) {
    if (run.status === "success") break;
    failureStreak += 1;
  }
  const latestRun = runs[0] ?? null;
  const previousSuccess = successes[0] ?? null;
  const references: EvidenceReference[] = [
    {
      id: `job:${job.id}`,
      label: "Current job definition",
      source: "definition",
      observedAt: job.updatedAt,
      detail: `${job.frequency} in ${job.timezone}; output ${job.outputMode}`,
    },
    ...runs.slice(0, 10).map((run) => ({
      id: `run:${run.id}`,
      label: `Run ${run.id.slice(0, 8)}`,
      source: "run" as const,
      observedAt: run.finishedAt ?? run.startedAt,
      detail: `${run.status}; ${run.durationMs ?? "unknown"}ms; ${run.message ?? "no error"}`,
    })),
  ];
  const fingerprint = evidenceFingerprint({
    job: { ...job, query: job.query.trim() },
    runs: runs.slice(0, 20),
  });
  return {
    fingerprint,
    generatedAt: now,
    job,
    runs,
    successRate: terminalRuns.length > 0 ? successes.length / terminalRuns.length : null,
    averageDurationMs: average(durations),
    durationChangePercent,
    failureStreak,
    latestRun,
    previousSuccess,
    references,
  };
}

export function buildDataHealthEvidence(
  promise: DataHealthPromiseRow,
  checks: DataHealthCheckDefinition[],
  samples: DataHealthSampleRow[],
  incidents: DataHealthIncidentRow[],
  runs: ScheduledQueryRunRow[],
  now = Date.now(),
): DataHealthEvidence {
  const latestByCheck = new Map<string, DataHealthSampleRow>();
  for (const sample of samples) {
    if (!latestByCheck.has(sample.checkKey)) latestByCheck.set(sample.checkKey, sample);
  }
  const breachedChecks = [...latestByCheck.values()].filter((sample) => sample.outcome === "breach").map((sample) => sample.checkKey);
  const learningChecks = [...latestByCheck.values()].filter((sample) => sample.outcome === "learning").map((sample) => sample.checkKey);
  const references: EvidenceReference[] = [
    {
      id: `promise:${promise.id}`,
      label: "Current promise definition",
      source: "definition",
      observedAt: promise.updatedAt,
      detail: `${promise.status}; ${checks.length} checks; ${promise.criticality}`,
    },
    ...samples.slice(0, 20).map((sample) => ({
      id: `sample:${sample.id}`,
      label: sample.checkKey,
      source: "sample" as const,
      observedAt: sample.slotAt,
      detail: `${sample.outcome}; observed ${sample.observedValue ?? "none"}; expected ${sample.expectedLower ?? "-∞"}..${sample.expectedUpper ?? "∞"}`,
    })),
    ...incidents.slice(0, 10).map((incident) => ({
      id: `incident:${incident.id}`,
      label: `${incident.severity} ${incident.kind} incident`,
      source: "incident" as const,
      observedAt: incident.lastEventAt,
      detail: `${incident.status}; ${incident.summary}`,
    })),
  ];
  const fingerprint = evidenceFingerprint({ promise, checks, samples: samples.slice(0, 50), incidents: incidents.slice(0, 20), runs: runs.slice(0, 20) });
  return {
    fingerprint,
    generatedAt: now,
    promise,
    checks,
    samples,
    incidents,
    runs,
    breachedChecks,
    learningChecks,
    references,
  };
}

const CACHE_MAX = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const resultCache = new Map<string, { value: unknown; storedAt: number }>();

export function getDataOpsAiCache<T>(key: string): T | undefined {
  const cached = resultCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.storedAt > CACHE_TTL_MS) {
    resultCache.delete(key);
    return undefined;
  }
  return cached.value as T;
}

export function setDataOpsAiCache(key: string, value: unknown): void {
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (typeof oldest === "string") resultCache.delete(oldest);
  }
  resultCache.set(key, { value, storedAt: Date.now() });
}

export function clearDataOpsAiCache(): void {
  resultCache.clear();
}
