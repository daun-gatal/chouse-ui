import { describe, expect, it } from "bun:test";

import { assignCriticality, checkVolume, classifyTable, learnCadence, learnVolumeBand, staleAfterSeconds } from "./baselines";

const HOUR = 3600 * 1000;
const MONDAY = Date.UTC(2026, 8, 7, 0, 0, 0); // a Monday, 00:00 UTC

describe("learnCadence", () => {
  it("needs at least five gaps", () => {
    expect(learnCadence([0, 1000, 2000, 3000, 4000])).toBeNull();
    expect(learnCadence([0, 1000, 2000, 3000, 4000, 5000])).not.toBeNull();
  });

  it("ignores ordering and duplicate timestamps", () => {
    const cadence = learnCadence([5000, 0, 1000, 1000, 2000, 3000, 4000, 6000]);
    expect(cadence?.p50Seconds).toBe(1);
    expect(cadence?.samples).toBe(6);
  });
});

describe("learnVolumeBand / checkVolume", () => {
  const samples = Array.from({ length: 4 }, (_, week) => ({ hourStartMs: MONDAY + week * 7 * 24 * HOUR, rows: 1000 + week }));

  it("groups by hour-of-week", () => {
    const band = learnVolumeBand(samples);
    expect(Object.keys(band)).toEqual(["0"]);
    expect(band["0"].n).toBe(4);
  });

  it("flags values well outside the band and tolerates noise", () => {
    const band = learnVolumeBand(samples);
    expect(checkVolume(band, MONDAY + 28 * 24 * HOUR, 1001).outside).toBe(false);
    expect(checkVolume(band, MONDAY + 28 * 24 * HOUR, 600).outside).toBe(true);
    expect(checkVolume(band, MONDAY + 28 * 24 * HOUR, 1600).outside).toBe(true);
  });

  it("does not judge a slot with too few samples", () => {
    const band = learnVolumeBand(samples.slice(0, 2));
    expect(checkVolume(band, MONDAY, 1).outside).toBe(false);
  });
});

describe("classifyTable", () => {
  const cadence = { p50Seconds: 300, p99Seconds: 600, samples: 100 };
  const base = { nowMs: MONDAY + 30 * 24 * HOUR, firstSeenAtMs: MONDAY, lastHour: null, band: {} };

  it("is stale once overdue past the slowest normal gap", () => {
    expect(staleAfterSeconds(cadence)).toBe(1800);
    const stale = classifyTable({ ...base, cadence, lastWriteAtMs: base.nowMs - 31 * 60 * 1000 });
    expect(stale.state).toBe("stale");
    expect(stale.reason).toContain("No writes for 31m");
    expect(classifyTable({ ...base, cadence, lastWriteAtMs: base.nowMs - 29 * 60 * 1000 }).state).toBe("trusted");
  });

  it("is degraded when the last hour leaves the volume band", () => {
    const band = { "0": { median: 1000, mad: 10, n: 4 } };
    const verdict = classifyTable({ ...base, nowMs: MONDAY + 28 * 24 * HOUR + 60_000, cadence, lastWriteAtMs: MONDAY + 28 * 24 * HOUR, band, lastHour: { hourStartMs: MONDAY + 28 * 24 * HOUR, rows: 400 } });
    expect(verdict.state).toBe("degraded");
    expect(verdict.reason).toContain("-60%");
  });

  it("is learning during the first three days without a cadence", () => {
    expect(classifyTable({ ...base, nowMs: MONDAY + HOUR, cadence: null, lastWriteAtMs: MONDAY }).state).toBe("learning");
  });

  it("treats tables without a regular pattern as trusted after learning", () => {
    expect(classifyTable({ ...base, cadence: null, lastWriteAtMs: MONDAY }).state).toBe("trusted");
  });
});

describe("assignCriticality", () => {
  it("ranks by reads and distinct readers; unread tables stay standard", () => {
    const usage = Array.from({ length: 40 }, (_, i) => ({ key: `t${i}`, reads7d: i, readers7d: i % 5 }));
    const result = assignCriticality(usage);
    expect(result.get("t39")).toBe("critical");
    expect(result.get("t0")).toBe("standard");
    const counts = [...result.values()].reduce<Record<string, number>>((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {});
    expect(counts.critical).toBe(2);
    expect(counts.important).toBe(6);
  });
});
