/**
 * Capacity forecasting (ADR 0016 §9): robust linear fit of used bytes per
 * node and disk, projected to a threshold (85% by default).
 */

import { round, theilSen } from "./stats";

export interface DiskSample {
  sampledAt: number;
  totalBytes: number;
  freeBytes: number;
}

export interface DiskForecast {
  usedRatio: number;
  growthBytesPerDay: number | null;
  /** Null when usage is flat or shrinking, or there is too little history. */
  daysToThreshold: number | null;
  threshold: number;
}

const DAY_MS = 24 * 3600 * 1000;
/** Fewer points than this, or less than a day of history, gives no projection. */
const MIN_POINTS = 6;

export function forecastDisk(samplesIn: DiskSample[], threshold = 0.85): DiskForecast | null {
  const samples = samplesIn.filter((s) => s.totalBytes > 0).sort((a, b) => a.sampledAt - b.sampledAt);
  if (samples.length === 0) return null;
  const latest = samples[samples.length - 1];
  const used = latest.totalBytes - latest.freeBytes;
  const usedRatio = round(used / latest.totalBytes, 4);
  const span = latest.sampledAt - samples[0].sampledAt;
  if (samples.length < MIN_POINTS || span < DAY_MS) {
    return { usedRatio, growthBytesPerDay: null, daysToThreshold: null, threshold };
  }
  const fit = theilSen(samples.map((s) => ({ x: s.sampledAt / DAY_MS, y: s.totalBytes - s.freeBytes })));
  if (!fit) return { usedRatio, growthBytesPerDay: null, daysToThreshold: null, threshold };
  const growth = fit.slope;
  const limit = latest.totalBytes * threshold;
  let daysToThreshold: number | null = null;
  if (used >= limit) daysToThreshold = 0;
  else if (growth > 0) daysToThreshold = round((limit - used) / growth, 1);
  return { usedRatio, growthBytesPerDay: round(growth, 0), daysToThreshold, threshold };
}
