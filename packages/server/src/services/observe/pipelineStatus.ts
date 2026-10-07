/**
 * One status vocabulary for every pipeline kind (ADR 0016 §4). Adapters only
 * produce normalized samples; this classifier turns a window of them into a
 * status, so Kafka, S3Queue, refreshable views and writers are judged alike.
 */

import type { ErrorClass } from "./errorClass";

export const PIPELINE_STATUSES = [
  "healthy",
  "lagging",
  "stalled",
  "retrying",
  "failing",
  "stopped",
  "inefficient",
  "paused",
  "unsupported_on_version",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Status severity order, worst first; used to pick the headline per pipeline. */
export const STATUS_SEVERITY: Record<PipelineStatus, number> = {
  retrying: 7,
  stalled: 6,
  failing: 5,
  stopped: 4,
  lagging: 3,
  inefficient: 2,
  paused: 1,
  unsupported_on_version: 1,
  healthy: 0,
};

export interface PipelineSample {
  sampledAt: number;
  unitsIn: number | null;
  bytesIn: number | null;
  lastSuccessAt: number | null;
  lagSeconds: number | null;
  backlog: number | null;
  backlogUnit: string | null;
  errors: number | null;
  errorSample: string | null;
  errorClass: ErrorClass | null;
  /** Forward progress in the sample window; null when the source cannot tell. */
  progressing: boolean | null;
  /** Adapter-detected inefficiency, e.g. "avg 14 rows per insert". */
  inefficiency?: string | null;
  /** The latest discrete run failed (a job, say); stays set until a run succeeds. */
  lastRunFailure?: string | null;
}

/** Statuses that are calm by design: never an incident, never "needs attention". */
export const QUIET_STATUSES: PipelineStatus[] = ["healthy", "paused", "unsupported_on_version"];

export function isQuietStatus(status: string): boolean {
  return QUIET_STATUSES.some((quiet) => quiet === status);
}

export interface StatusContext {
  nowMs: number;
  /**
   * Expected gap between successes, seconds: a declared schedule or a learned
   * p50. Null when unknown — and then "stopped" is never inferred, because a
   * one-off or irregular source going quiet is not an outage.
   */
  cadenceSeconds: number | null;
  unsupported?: string | null;
  /** Set when the pipeline is switched off on purpose (disabled job, stopped view). */
  paused?: string | null;
  /**
   * False when nothing promises another success (a manual, event-chained or
   * disabled scheduled job), so a quiet spell is not "stopped".
   */
  expectsRecurring?: boolean;
}

export interface StatusVerdict {
  status: PipelineStatus;
  reason: string;
}

const CONSECUTIVE = 3;

function tail<T>(items: T[], n: number): T[] {
  return items.slice(Math.max(0, items.length - n));
}

function fmtSeconds(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)}s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** "stopped" only when a known cadence says another success is overdue. */
function stoppedVerdict(latest: PipelineSample, ctx: StatusContext): StatusVerdict | null {
  if (latest.lastSuccessAt === null || ctx.expectsRecurring === false || ctx.cadenceSeconds === null) return null;
  const age = (ctx.nowMs - latest.lastSuccessAt) / 1000;
  const limit = Math.max(3 * ctx.cadenceSeconds, 600);
  return age > limit ? { status: "stopped", reason: `Nothing succeeded for ${fmtSeconds(age)}` } : null;
}

function stoppedOrHealthy(latest: PipelineSample, ctx: StatusContext): StatusVerdict {
  const stopped = stoppedVerdict(latest, ctx);
  if (stopped) return stopped;
  return latest.lastSuccessAt === null ? { status: "healthy", reason: "No completed run observed yet" } : { status: "healthy", reason: "Last run succeeded" };
}

export function classifyPipeline(samplesIn: PipelineSample[], ctx: StatusContext): StatusVerdict {
  if (ctx.unsupported) return { status: "unsupported_on_version", reason: ctx.unsupported };
  if (ctx.paused) return { status: "paused", reason: ctx.paused };
  const samples = [...samplesIn].sort((a, b) => a.sampledAt - b.sampledAt);
  if (samples.length === 0) return { status: "healthy", reason: "No activity sampled yet" };
  const latest = samples[samples.length - 1];
  // Discrete runs (scheduled jobs) are judged by the latest run alone; an
  // earlier failure that a later run fixed is history, not a status.
  if (latest.lastRunFailure !== undefined) {
    if (latest.lastRunFailure) return { status: "failing", reason: `Last run failed: ${latest.lastRunFailure}` };
    return stoppedOrHealthy(latest, ctx);
  }
  const recent = tail(samples, CONSECUTIVE);
  const enough = recent.length >= CONSECUTIVE;
  const noProgress = enough && recent.every((s) => s.progressing === false);
  const erroring = recent.filter((s) => (s.errors ?? 0) > 0);

  if (noProgress && erroring.length === recent.length) {
    const sample = latest.errorSample ?? erroring[erroring.length - 1]?.errorSample ?? "repeated errors";
    return { status: "retrying", reason: `Retrying without progress: ${sample}` };
  }
  if (noProgress && recent.some((s) => (s.backlog ?? 0) > 0)) {
    const backlog = latest.backlog ?? recent.find((s) => s.backlog)?.backlog ?? 0;
    return { status: "stalled", reason: `No progress with ${Math.round(backlog)} ${latest.backlogUnit ?? "units"} pending` };
  }
  if (erroring.length > 0 && recent.some((s) => s.progressing !== false)) {
    const total = erroring.reduce((sum, s) => sum + (s.errors ?? 0), 0);
    return { status: "failing", reason: `${Math.round(total)} errors in the last ${recent.length} samples: ${latest.errorSample ?? erroring[0].errorSample ?? ""}`.trim() };
  }
  const stopped = stoppedVerdict(latest, ctx);
  if (stopped) return stopped;
  const lagLimit = Math.max(300, 3 * (ctx.cadenceSeconds ?? 0));
  if (latest.lagSeconds !== null && latest.lagSeconds > lagLimit) {
    return { status: "lagging", reason: `${fmtSeconds(latest.lagSeconds)} behind` };
  }
  if (enough && recent.every((s, i) => i === 0 || (s.backlog ?? 0) > (recent[i - 1].backlog ?? 0)) && (latest.backlog ?? 0) > 0) {
    return { status: "lagging", reason: `Backlog growing: ${Math.round(latest.backlog ?? 0)} ${latest.backlogUnit ?? "units"}` };
  }
  if (latest.inefficiency) return { status: "inefficient", reason: latest.inefficiency };
  if (latest.lastSuccessAt === null && latest.progressing === null) return { status: "healthy", reason: "No completed run observed yet" };
  return { status: "healthy", reason: "Making progress" };
}
