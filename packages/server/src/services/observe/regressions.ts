/**
 * Query regression detection (ADR 0016 §9). Each fingerprint × replica keeps
 * hourly rollups; a regression is p95 latency or read bytes ≥ 1.5× the 14-day
 * baseline over at least 20 recent runs. Changes in the onset window are linked
 * as likely causes, and a replica-version split exposes upgrade regressions.
 */

import { median, round } from "./stats";

export interface FingerprintHour {
  hour: number; // ms epoch, start of hour
  runs: number;
  p95Ms: number | null;
  avgReadBytes: number | null;
  serverVersion: string | null;
}

export type RegressionMetric = "p95_ms" | "read_bytes";

export interface RegressionFinding {
  metric: RegressionMetric;
  baselineValue: number;
  currentValue: number;
  ratio: number;
  runs: number;
  onsetAt: number;
}

export const REGRESSION_RATIO = 1.5;
export const REGRESSION_MIN_RUNS = 20;
const DAY_MS = 24 * 3600 * 1000;

/** Weighted median of hourly values by run count (approximates the run-level median). */
function weightedMedian(hours: FingerprintHour[], pick: (h: FingerprintHour) => number | null): number | null {
  const values: number[] = [];
  for (const h of hours) {
    const v = pick(h);
    if (v === null || !Number.isFinite(v)) continue;
    const weight = Math.min(50, Math.max(1, h.runs));
    for (let i = 0; i < weight; i++) values.push(v);
  }
  return median(values);
}

/**
 * Compare the most recent `recentHours` against the 14 days before them.
 * Returns findings sorted by ratio, worst first.
 */
export function detectRegressions(hoursIn: FingerprintHour[], nowMs: number, recentHours = 24): RegressionFinding[] {
  const hours = [...hoursIn].sort((a, b) => a.hour - b.hour);
  const recentStart = nowMs - recentHours * 3600 * 1000;
  const baselineStart = recentStart - 14 * DAY_MS;
  const baseline = hours.filter((h) => h.hour >= baselineStart && h.hour < recentStart);
  const recent = hours.filter((h) => h.hour >= recentStart);
  const recentRuns = recent.reduce((sum, h) => sum + h.runs, 0);
  const baselineRuns = baseline.reduce((sum, h) => sum + h.runs, 0);
  if (recentRuns < REGRESSION_MIN_RUNS || baselineRuns < REGRESSION_MIN_RUNS) return [];

  const findings: RegressionFinding[] = [];
  const metrics: Array<{ metric: RegressionMetric; pick: (h: FingerprintHour) => number | null; floor: number }> = [
    // Floors stop sub-millisecond and tiny-read queries from flapping.
    { metric: "p95_ms", pick: (h) => h.p95Ms, floor: 20 },
    { metric: "read_bytes", pick: (h) => h.avgReadBytes, floor: 1024 * 1024 },
  ];
  for (const { metric, pick, floor } of metrics) {
    const before = weightedMedian(baseline, pick);
    const after = weightedMedian(recent, pick);
    if (before === null || after === null || after < floor) continue;
    const ratio = after / Math.max(before, 1e-9);
    if (ratio < REGRESSION_RATIO) continue;
    // Onset: first recent hour whose value crossed the threshold.
    const onset = recent.find((h) => {
      const v = pick(h);
      return v !== null && v >= before * REGRESSION_RATIO;
    });
    findings.push({
      metric,
      baselineValue: round(before, 2),
      currentValue: round(after, 2),
      ratio: round(ratio, 2),
      runs: recentRuns,
      onsetAt: onset?.hour ?? recentStart,
    });
  }
  return findings.sort((a, b) => b.ratio - a.ratio);
}

export interface ChangeEvent {
  id: string;
  kind: string;
  occurredAt: number;
  node: string | null;
  objectRef: string | null;
  summary: string;
}

/**
 * Changes plausibly behind a regression: within 24h before onset (or 1h after,
 * for clock skew), on the same replica when the change is node-scoped, and on a
 * touched table when the change is object-scoped.
 */
export function linkChanges(onsetAt: number, replica: string, tables: string[], changes: ChangeEvent[]): ChangeEvent[] {
  const from = onsetAt - DAY_MS;
  const to = onsetAt + 3600 * 1000;
  return changes
    .filter((c) => c.occurredAt >= from && c.occurredAt <= to)
    .filter((c) => (c.node ? c.node === replica : true))
    .filter((c) => (c.objectRef && c.kind === "ddl" ? tables.includes(c.objectRef) : true))
    .sort((a, b) => Math.abs(onsetAt - a.occurredAt) - Math.abs(onsetAt - b.occurredAt))
    .slice(0, 5);
}
