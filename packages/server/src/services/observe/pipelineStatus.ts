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
}

export interface StatusContext {
  nowMs: number;
  /** Learned p50 gap between successes, seconds; null if unknown. */
  cadenceSeconds: number | null;
  unsupported?: string | null;
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

export function classifyPipeline(samplesIn: PipelineSample[], ctx: StatusContext): StatusVerdict {
  if (ctx.unsupported) return { status: "unsupported_on_version", reason: ctx.unsupported };
  const samples = [...samplesIn].sort((a, b) => a.sampledAt - b.sampledAt);
  if (samples.length === 0) return { status: "healthy", reason: "No activity sampled yet" };
  const latest = samples[samples.length - 1];
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
  if (latest.lastSuccessAt !== null) {
    const age = (ctx.nowMs - latest.lastSuccessAt) / 1000;
    const limit = ctx.cadenceSeconds === null ? 3600 : Math.max(3 * ctx.cadenceSeconds, 600);
    if (age > limit) return { status: "stopped", reason: `Nothing succeeded for ${fmtSeconds(age)}` };
  }
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
