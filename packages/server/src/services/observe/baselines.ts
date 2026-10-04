/**
 * Table baselines (ADR 0016 §5): learned write cadence, hour-of-week volume
 * band, trust state and automatic criticality. Pure functions — the `tables`
 * and `usage` collectors feed them metadata only, never table scans.
 */

import { hourOfWeek, mad, median, quantile, round } from "./stats";

export type TableState = "trusted" | "degraded" | "stale" | "learning";
export type Criticality = "critical" | "important" | "standard";

export interface Cadence {
  p50Seconds: number;
  p99Seconds: number;
  samples: number;
}

/** Minimum gaps before a cadence is trusted. */
export const MIN_CADENCE_SAMPLES = 5;

/** Learn the write cadence from ascending write timestamps (ms). */
export function learnCadence(writeTimesMs: number[]): Cadence | null {
  const times = [...writeTimesMs].filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 1000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length < MIN_CADENCE_SAMPLES) return null;
  const p50 = quantile(gaps, 0.5);
  const p99 = quantile(gaps, 0.99);
  if (p50 === null || p99 === null) return null;
  return { p50Seconds: round(p50, 1), p99Seconds: round(p99, 1), samples: gaps.length };
}

export interface BandSlot {
  median: number;
  mad: number;
  n: number;
}

/** Volume band keyed by hour-of-week slot (0..167). */
export type VolumeBand = Record<string, BandSlot>;

export interface HourlyVolume {
  hourStartMs: number;
  rows: number;
}

/** Build the hour-of-week band from hourly row counts (typically 28 days). */
export function learnVolumeBand(samples: HourlyVolume[]): VolumeBand {
  const bySlot = new Map<number, number[]>();
  for (const sample of samples) {
    const slot = hourOfWeek(sample.hourStartMs);
    const list = bySlot.get(slot) ?? [];
    list.push(sample.rows);
    bySlot.set(slot, list);
  }
  const band: VolumeBand = {};
  for (const [slot, values] of bySlot) {
    const m = median(values);
    const d = mad(values);
    if (m === null || d === null) continue;
    band[String(slot)] = { median: round(m, 2), mad: round(d, 2), n: values.length };
  }
  return band;
}

export interface VolumeVerdict {
  outside: boolean;
  expected: number | null;
  lower: number | null;
  upper: number | null;
  deviation: number | null;
}

/** Is `rows` for the hour starting at `hourStartMs` outside the learned band? */
export function checkVolume(band: VolumeBand, hourStartMs: number, rows: number, minSamples = 3): VolumeVerdict {
  const slot = band[String(hourOfWeek(hourStartMs))];
  if (!slot || slot.n < minSamples) return { outside: false, expected: null, lower: null, upper: null, deviation: null };
  // A floor on the band keeps near-constant series from alerting on noise.
  const width = Math.max(4 * slot.mad, 0.25 * slot.median, 1);
  const lower = Math.max(0, slot.median - width);
  const upper = slot.median + width;
  const deviation = slot.median === 0 ? null : (rows - slot.median) / slot.median;
  return { outside: rows < lower || rows > upper, expected: slot.median, lower, upper, deviation };
}

export interface TableSignals {
  nowMs: number;
  lastWriteAtMs: number | null;
  cadence: Cadence | null;
  /** First observation of the table by the collector; learning lasts ≥ 3 days. */
  firstSeenAtMs: number | null;
  lastHour: HourlyVolume | null;
  band: VolumeBand;
}

export interface TableVerdict {
  state: TableState;
  reason: string;
}

const LEARNING_PERIOD_MS = 3 * 24 * 3600 * 1000;

function human(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 48 * 3600) return `${round(seconds / 3600, 1)}h`;
  return `${round(seconds / 86400, 1)}d`;
}

/** Overdue threshold: well past the slowest normal gap, never below 15 minutes. */
export function staleAfterSeconds(cadence: Cadence): number {
  return Math.max(3 * cadence.p99Seconds, cadence.p99Seconds + 900);
}

export function classifyTable(signals: TableSignals): TableVerdict {
  const { nowMs, lastWriteAtMs, cadence, firstSeenAtMs, lastHour, band } = signals;
  if (cadence === null || lastWriteAtMs === null) {
    if (firstSeenAtMs !== null && nowMs - firstSeenAtMs < LEARNING_PERIOD_MS) {
      return { state: "learning", reason: "Learning the write pattern" };
    }
    return { state: "trusted", reason: lastWriteAtMs === null ? "No writes observed" : "No regular write pattern" };
  }
  const ageSeconds = Math.max(0, (nowMs - lastWriteAtMs) / 1000);
  if (ageSeconds > staleAfterSeconds(cadence)) {
    return {
      state: "stale",
      reason: `No writes for ${human(ageSeconds)} (normally every ${human(cadence.p50Seconds)}, at most ${human(cadence.p99Seconds)})`,
    };
  }
  if (lastHour) {
    const verdict = checkVolume(band, lastHour.hourStartMs, lastHour.rows);
    if (verdict.outside && verdict.expected !== null) {
      const pct = verdict.deviation === null ? "" : ` (${verdict.deviation > 0 ? "+" : ""}${Math.round(verdict.deviation * 100)}%)`;
      return {
        state: "degraded",
        reason: `Last hour wrote ${Math.round(lastHour.rows)} rows, expected about ${Math.round(verdict.expected)}${pct}`,
      };
    }
  }
  if (firstSeenAtMs !== null && nowMs - firstSeenAtMs < LEARNING_PERIOD_MS) {
    return { state: "learning", reason: "Learning the write pattern" };
  }
  return { state: "trusted", reason: `Writes every ${human(cadence.p50Seconds)}` };
}

export interface UsageScore {
  key: string;
  reads7d: number;
  readers7d: number;
}

/**
 * Criticality from real usage: top 5% by score are critical, the next 15%
 * important. Tables nobody reads stay standard however large they are.
 */
export function assignCriticality(usage: UsageScore[]): Map<string, Criticality> {
  const scored = usage
    .map((u) => ({ key: u.key, score: u.reads7d * Math.log2(2 + u.readers7d) }))
    .filter((u) => u.score > 0)
    .sort((a, b) => b.score - a.score);
  const result = new Map<string, Criticality>();
  for (const u of usage) result.set(u.key, "standard");
  const critical = Math.max(1, Math.ceil(scored.length * 0.05));
  const important = Math.ceil(scored.length * 0.2);
  scored.forEach((u, index) => {
    if (index < critical) result.set(u.key, "critical");
    else if (index < important) result.set(u.key, "important");
  });
  return result;
}
