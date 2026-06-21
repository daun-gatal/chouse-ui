/**
 * Cadence math for Scheduled Queries — a single source of truth (croner, UTC)
 * for BOTH the firing schedule (`lastScheduledFireMs`) and the templated window
 * lower bound (`previousFireMs` → `{{slot_start}}`), so the two can never
 * disagree. See ADR 0002 (D5, D5a, D3a #2, D3b).
 *
 * Fixed presets (daily/weekly/monthly) are compiled to a 5-field cron pattern
 * and evaluated through the same engine as custom `cron` jobs. All evaluation is
 * in UTC (sidesteps DST ambiguity); `manual` never fires.
 */

import { Cron } from "croner";

import type { ScheduledQueryRow, SqFrequency } from "./types";

export interface CadenceSpec {
  frequency: SqFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string | null;
}

/** A digit (no list/range) field-only guard used while validating presets. */
function clampInt(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

/**
 * Compile a cadence to a 5-field cron pattern, or `null` for `manual`. Presets
 * pin minute 0 and the configured hour; `cron` returns the stored expression.
 */
export function cadenceToCron(spec: CadenceSpec): string | null {
  switch (spec.frequency) {
    case "manual":
      return null;
    case "cron":
      return spec.cronExpr && spec.cronExpr.trim().length > 0 ? spec.cronExpr.trim() : null;
    case "daily": {
      const h = clampInt(spec.hour, 0, 23, 8);
      return `0 ${h} * * *`;
    }
    case "weekly": {
      const h = clampInt(spec.hour, 0, 23, 8);
      const dow = clampInt(spec.dayOfWeek, 0, 6, 1);
      return `0 ${h} * * ${dow}`;
    }
    case "monthly": {
      const h = clampInt(spec.hour, 0, 23, 8);
      const dom = clampInt(spec.dayOfMonth, 1, 28, 1);
      return `0 ${h} ${dom} * *`;
    }
    default:
      return null;
  }
}

function specOf(job: Pick<ScheduledQueryRow, "frequency" | "hour" | "dayOfWeek" | "dayOfMonth" | "cronExpr">): CadenceSpec {
  return {
    frequency: job.frequency,
    hour: job.hour,
    dayOfWeek: job.dayOfWeek,
    dayOfMonth: job.dayOfMonth,
    cronExpr: job.cronExpr,
  };
}

/** Build a UTC croner instance for a cadence, or `null` if it never fires. */
function cronOf(spec: CadenceSpec): Cron | null {
  const pattern = cadenceToCron(spec);
  if (!pattern) return null;
  try {
    return new Cron(pattern, { timezone: "UTC" });
  } catch {
    return null;
  }
}

/**
 * Most recent scheduled fire-time ≤ `nowMs`, in ms, or `null` if none is due.
 * Fires are at second boundaries (ms = 0); `+1` makes a fire exactly at `now`
 * count as due. Only the single most-recent slot is returned — never a burst —
 * which is the no-backfill contract (D3a #6).
 */
export function lastScheduledFireMs(
  job: Pick<ScheduledQueryRow, "frequency" | "hour" | "dayOfWeek" | "dayOfMonth" | "cronExpr">,
  nowMs: number,
): number | null {
  const cron = cronOf(specOf(job));
  if (!cron) return null;
  // croner evaluates at second granularity, so probe ~1s past `now` to include a
  // fire landing exactly on `now`, then reject any candidate that is genuinely in
  // the future (a fire due within the next second) by falling back to the one
  // before it. Either way only the single most-recent slot is returned (D3a #6).
  const probe = cron.previousRuns(1, new Date(nowMs + 1000));
  let fire = probe.length > 0 ? probe[0].getTime() : null;
  if (fire != null && fire > nowMs) {
    const earlier = cron.previousRuns(1, new Date(fire));
    fire = earlier.length > 0 ? earlier[0].getTime() : null;
  }
  return fire;
}

/**
 * The scheduled occurrence immediately before `slotAtMs` (exclusive) — the
 * inclusive lower bound of the run's window (`{{slot_start}}`, D3b). Independent
 * of run history, so a retry of the same slot yields the same window.
 */
export function previousFireMs(
  job: Pick<ScheduledQueryRow, "frequency" | "hour" | "dayOfWeek" | "dayOfMonth" | "cronExpr">,
  slotAtMs: number,
): number | null {
  const cron = cronOf(specOf(job));
  if (!cron) return null;
  const prev = cron.previousRuns(1, new Date(slotAtMs));
  return prev.length > 0 ? prev[0].getTime() : null;
}

/** The next N fire-times after `fromMs` (preview for the builder). */
export function nextFireTimes(spec: CadenceSpec, count: number, fromMs: number = Date.now()): number[] {
  const cron = cronOf(spec);
  if (!cron) return [];
  const out: number[] = [];
  let cursor = new Date(fromMs);
  for (let i = 0; i < count; i++) {
    const next = cron.nextRun(cursor);
    if (!next) break;
    out.push(next.getTime());
    cursor = next;
  }
  return out;
}

export interface CronValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * Validate a custom cron expression: parseable under croner, exactly 5 fields
 * (sub-minute / seconds fields rejected — the tick is 60s, D5a), and produces a
 * future occurrence. Returns the trimmed expression as the normalized form.
 */
export function validateCron(expr: string): CronValidationResult {
  const trimmed = expr.trim();
  if (!trimmed) return { valid: false, error: "Cron expression is required" };
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: "Expected a 5-field cron expression (minute hour day month weekday); sub-minute schedules are not supported" };
  }
  try {
    const cron = new Cron(trimmed, { timezone: "UTC" });
    const next = cron.nextRun();
    if (!next) return { valid: false, error: "Cron expression never fires" };
    return { valid: true, normalized: trimmed };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Invalid cron expression" };
  }
}
