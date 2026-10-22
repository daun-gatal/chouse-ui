import { describe, expect, it } from "bun:test";

import { bandOutcome } from "./alerts";
import { computeBand, pastWindow, toSeries, type TimeSeries } from "./baseline";

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const T0 = Date.UTC(2026, 9, 22, 0);

/** Hourly buckets from T0 (or T0 - k weeks) with the given values. */
function series(values: Array<number | null>, weeksBack = 0): TimeSeries {
  const xsMs = values.map((_, i) => T0 - weeksBack * WEEK + i * HOUR);
  return { xs: xsMs.map((ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ")), xsMs, values };
}

describe("computeBand", () => {
  it("gives each bucket median ± 3 × 1.4826 × MAD over the weeks that have it", () => {
    const current = series([10, 10, 10]);
    const band = computeBand(current, [series([8, 10, 12], 1), series([12, 10, 8], 2), series([10, 10, 10], 3)], HOUR, 3);
    expect(band.state).toBe("ready");
    // Bucket 0: 8, 12, 10 → median 10, MAD 2 → ± 8.8956.
    expect(band.points[0].median).toBe(10);
    expect(band.points[0].hi - 10).toBeCloseTo(3 * 1.4826 * 2, 6);
  });

  it("keeps a floor of 5% of the median, so a flat history is not a zero-width band", () => {
    const band = computeBand(series([100]), [series([100], 1), series([100], 2)], HOUR, 2);
    expect(band.points[0]).toMatchObject({ lo: 95, hi: 105 });
  });

  it("gives no band to a bucket fewer than 2 weeks have, and says it is learning when under half are banded", () => {
    const band = computeBand(series([1, 2, 3, 4]), [series([1, 2, null, null], 1), series([1, null, null, null], 2)], HOUR, 2);
    expect(band.state).toBe("learning");
    expect(band.points.map((p) => p.x)).toEqual([series([1]).xs[0]]);
    expect(band.state === "learning" && band.reason).toBe("Only 1 of 4 buckets have at least 2 earlier weeks of data");
  });

  it("says so when fewer than 2 weeks returned anything", () => {
    const band = computeBand(series([1, 2]), [series([1, 2], 1), series([], 2)], HOUR, 2);
    expect(band.state === "learning" && band.reason).toBe("Only 1 of the past 2 weeks returned data; a band needs at least 2");
  });

  it("matches a bucket a DST hour off to the nearest current bucket", () => {
    const shifted = { ...series([5, 5], 1), xsMs: series([5, 5], 1).xsMs.map((ms) => ms + 20 * 60_000) };
    expect(computeBand(series([5, 5]), [shifted, series([5, 5], 2)], HOUR, 2).points).toHaveLength(2);
  });
});

describe("pastWindow", () => {
  it("moves back whole weeks, aligned to 15 minutes, keeping the bucket size", () => {
    expect(pastWindow({ from: 1_000_100, to: 1_021_700, intervalSeconds: 300 }, 1)).toEqual({ from: 999_900 - 604_800, to: 1_022_400 - 604_800, intervalSeconds: 300 });
  });
});

describe("toSeries", () => {
  const data = (type: string, timezone: string | null) => ({ columns: [{ name: "t", type }, { name: "v", type: "UInt64" }], rows: [{ t: "2026-10-22 07:00:00", v: "3" }, { t: "2026-10-22 08:00:00", v: null }], elapsedMs: 0, readRows: 0, readBytes: 0, ranAt: 0, timezone });

  it("reads x in its zone and y as numbers, a NULL as a gap", () => {
    const s = toSeries(data("DateTime", "Asia/Jakarta"), "t", "v");
    expect(s.xsMs[0]).toBe(T0);
    expect(s.values).toEqual([3, null]);
  });

  it("refuses when no zone is known, rather than assume one", () => {
    expect(() => toSeries(data("DateTime", null), "t", "v")).toThrow("ClickHouse did not report its time zone");
    expect(toSeries(data("DateTime('UTC')", null), "t", "v").xsMs[0]).toBe(T0 + 7 * HOUR);
  });
});

describe("bandOutcome", () => {
  const ready = (points: Array<{ x: string; lo: number; hi: number }>) => ({ state: "ready" as const, weeks: 2, points: points.map((p) => ({ ...p, median: (p.lo + p.hi) / 2 })) });

  it("reads the second-newest bucket, since the newest is still filling", () => {
    const current = series([50, 5, 999]);
    const outcome = bandOutcome(current, ready([{ x: current.xs[1], lo: 10, hi: 20 }, { x: current.xs[2], lo: 0, hi: 2000 }]));
    expect(outcome).toEqual({ kind: "value", value: 5, breached: true, band: { lo: 10, hi: 20 } });
    expect(bandOutcome(current, ready([{ x: current.xs[1], lo: 0, hi: 20 }]))).toMatchObject({ breached: false });
  });

  it("is no data while learning, with too few buckets, or with no band for the bucket — never a fixed threshold", () => {
    const current = series([1, 2, 3]);
    expect(bandOutcome(current, { state: "learning", weeks: 2, points: [], reason: "x" })).toEqual({ kind: "no_data", reason: "The expected range is still learning: x" });
    expect(bandOutcome(series([1]), ready([]))).toEqual({ kind: "no_data", reason: "The panel has no complete bucket yet" });
    expect(bandOutcome(current, ready([])).kind).toBe("no_data");
  });
});
