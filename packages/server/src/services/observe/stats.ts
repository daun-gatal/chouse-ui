/** Small, dependency-free statistics used by baselines, forecasts and regressions. */

export function quantile(values: number[], q: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

/** Median absolute deviation, scaled to be comparable with a standard deviation. */
export function mad(values: number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  const deviations = values.filter((v) => Number.isFinite(v)).map((v) => Math.abs(v - m));
  const raw = median(deviations);
  return raw === null ? null : raw * 1.4826;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Theil–Sen estimator: the median of pairwise slopes. Robust to the outliers a
 * disk series gets from merges and TTL drops, unlike least squares.
 */
export function theilSen(points: Point[]): { slope: number; intercept: number } | null {
  const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 2) return null;
  // Cap the O(n²) pair count: evenly subsample long series.
  const step = Math.max(1, Math.floor(clean.length / 200));
  const sample = clean.filter((_, i) => i % step === 0);
  const slopes: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dx = sample[j].x - sample[i].x;
      if (dx !== 0) slopes.push((sample[j].y - sample[i].y) / dx);
    }
  }
  const slope = median(slopes);
  if (slope === null) return null;
  const intercept = median(sample.map((p) => p.y - slope * p.x));
  return intercept === null ? null : { slope, intercept };
}

/** 0..167 slot for an hour-of-week (Monday 00:00 UTC = 0). */
export function hourOfWeek(epochMs: number): number {
  const date = new Date(epochMs);
  const day = (date.getUTCDay() + 6) % 7;
  return day * 24 + date.getUTCHours();
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
