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
  /** Longest gap in the learning window: the nightly or weekend lull. */
  maxSeconds: number;
  samples: number;
}

/** Minimum gaps before a cadence is trusted. */
export const MIN_CADENCE_SAMPLES = 5;

/**
 * Parts landing within this of the previous part belong to the same write. A
 * single INSERT creates a part per partition and per block — a long
 * INSERT … SELECT keeps emitting them for minutes — and counting those as
 * separate writes would teach a daily load an "every few seconds" cadence.
 */
export const WRITE_BURST_SECONDS = 60;

/** Learn the write cadence from write timestamps (ms), bursts collapsed. */
export function learnCadence(writeTimesMs: number[]): Cadence | null {
  const times = [...writeTimesMs].filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  let burstStart = times[0];
  for (let i = 1; i < times.length; i++) {
    if ((times[i] - times[i - 1]) / 1000 <= WRITE_BURST_SECONDS) continue;
    gaps.push((times[i] - burstStart) / 1000);
    burstStart = times[i];
  }
  if (gaps.length < MIN_CADENCE_SAMPLES) return null;
  const p50 = quantile(gaps, 0.5);
  const p99 = quantile(gaps, 0.99);
  if (p50 === null || p99 === null) return null;
  return { p50Seconds: round(p50, 1), p99Seconds: round(p99, 1), maxSeconds: round(Math.max(...gaps), 1), samples: gaps.length };
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

/** The clock-driven pipeline (scheduled job, refreshable view) that writes a table. */
export interface ProducerSignal {
  name: string;
  status: string;
  reason: string | null;
}

export interface TableSignals {
  nowMs: number;
  lastWriteAtMs: number | null;
  cadence: Cadence | null;
  /** First observation of the table by the collector; learning lasts ≥ 3 days. */
  firstSeenAtMs: number | null;
  lastHour: HourlyVolume | null;
  band: VolumeBand;
  /** Set when a scheduled job or refreshable view writes the table. */
  producer?: ProducerSignal | null;
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
export function staleAfterSeconds(cadence: Pick<Cadence, "p99Seconds">): number {
  return Math.max(3 * cadence.p99Seconds, cadence.p99Seconds + 900);
}

const PRODUCER_BAD = new Set(["retrying", "stalled", "failing", "stopped"]);

/**
 * Does the learned hour-of-week band expect writes in the complete hours since
 * the last write? Null when those hours have not been learned yet.
 */
export function bandExpectsWrites(band: VolumeBand, lastWriteAtMs: number, nowMs: number, minSamples = 3): boolean | null {
  const HOUR_MS = 3600 * 1000;
  let known = false;
  for (let h = Math.floor(lastWriteAtMs / HOUR_MS) * HOUR_MS + HOUR_MS; h + HOUR_MS <= nowMs; h += HOUR_MS) {
    const slot = band[String(hourOfWeek(h))];
    if (!slot || slot.n < minSamples) continue;
    known = true;
    if (slot.median > 0) return true;
    // A week of hours is every slot once; looking further adds nothing.
    if (h - lastWriteAtMs > 7 * 24 * HOUR_MS) break;
  }
  return known ? false : null;
}

export function classifyTable(signals: TableSignals): TableVerdict {
  const { nowMs, lastWriteAtMs, cadence, firstSeenAtMs, lastHour, band, producer } = signals;
  // A table written on a clock is as fresh as the job that writes it: a job
  // that ran fine but had nothing new to write leaves the data current, and a
  // paused job sets no freshness expectation at all.
  if (producer) {
    if (producer.status === "paused") {
      return { state: "trusted", reason: `Written by ${producer.name}, which is paused${producer.reason ? ` (${producer.reason})` : ""}` };
    }
    if (PRODUCER_BAD.has(producer.status)) {
      const age = lastWriteAtMs === null ? null : Math.max(0, (nowMs - lastWriteAtMs) / 1000);
      return {
        state: "stale",
        reason: `${producer.name} is ${producer.status}${producer.reason ? `: ${producer.reason}` : ""}${age === null ? "" : `; last write ${human(age)} ago`}`,
      };
    }
    return { state: "trusted", reason: `Written by ${producer.name}${producer.reason ? `: ${producer.reason}` : ""}` };
  }
  if (cadence === null || lastWriteAtMs === null) {
    if (firstSeenAtMs !== null && nowMs - firstSeenAtMs < LEARNING_PERIOD_MS) {
      return { state: "learning", reason: "Learning the write pattern" };
    }
    return { state: "trusted", reason: lastWriteAtMs === null ? "No writes observed" : "No regular write pattern" };
  }
  const ageSeconds = Math.max(0, (nowMs - lastWriteAtMs) / 1000);
  if (ageSeconds > staleAfterSeconds(cadence)) {
    // Overdue against the typical gap, but nights and weekends are quiet for
    // many tables. Stale only when the hour-of-week pattern expected writes
    // since, or the silence is longer than any lull seen this week.
    const unusual = ageSeconds > 1.5 * cadence.maxSeconds;
    if (unusual || bandExpectsWrites(band, lastWriteAtMs, nowMs) === true) {
      return {
        state: "stale",
        reason: `No writes for ${human(ageSeconds)} (normally every ${human(cadence.p50Seconds)}, at most ${human(cadence.p99Seconds)})`,
      };
    }
    return { state: "trusted", reason: `Quiet for ${human(ageSeconds)}, a normal lull (gaps up to ${human(cadence.maxSeconds)} seen this week)` };
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
