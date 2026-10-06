import { describe, expect, it } from "bun:test";

import { assignCriticality, bandExpectsWrites, checkVolume, classifyTable, learnCadence, learnVolumeBand, staleAfterSeconds } from "./baselines";

const HOUR = 3600 * 1000;
const MONDAY = Date.UTC(2026, 8, 7, 0, 0, 0); // a Monday, 00:00 UTC

describe("learnCadence", () => {
  const MIN = 60_000;

  it("needs at least five gaps", () => {
    expect(learnCadence([0, 5, 10, 15, 20].map((m) => m * MIN))).toBeNull();
    expect(learnCadence([0, 5, 10, 15, 20, 25].map((m) => m * MIN))).not.toBeNull();
  });

  it("ignores ordering and duplicate timestamps", () => {
    const cadence = learnCadence([25, 0, 5, 5, 10, 15, 20, 30].map((m) => m * MIN));
    expect(cadence?.p50Seconds).toBe(300);
    expect(cadence?.samples).toBe(6);
  });

  it("counts the parts of one insert as one write", () => {
    // A daily load writing three partitions seconds apart, for a week.
    const times = Array.from({ length: 7 }, (_, day) => day * 24 * HOUR).flatMap((t) => [t, t + 2000, t + 5000]);
    const cadence = learnCadence(times);
    expect(cadence?.p50Seconds).toBe(86_400);
    expect(cadence?.samples).toBe(6);
  });

  it("keeps a long INSERT … SELECT emitting a part every 39s as one write", () => {
    // Hourly job; each run writes ten parts 39s apart over ~6 minutes.
    const times = Array.from({ length: 8 }, (_, run) => run * HOUR).flatMap((t) => Array.from({ length: 10 }, (_, p) => t + p * 39_000));
    const cadence = learnCadence(times);
    expect(cadence?.p50Seconds).toBe(3600);
    expect(cadence?.samples).toBe(7);
  });

  it("records the longest lull", () => {
    const times = [0, 1, 2, 3, 4, 5, 65].map((h) => h * HOUR);
    expect(learnCadence(times)?.maxSeconds).toBe(60 * 3600);
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
  const cadence = { p50Seconds: 300, p99Seconds: 600, maxSeconds: 600, samples: 100 };
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

  it("is not stale through a lull it has seen this week", () => {
    // Writes every 5 minutes on weekdays, nothing overnight (12h lull).
    const nightly = { ...cadence, maxSeconds: 12 * 3600 };
    const verdict = classifyTable({ ...base, cadence: nightly, lastWriteAtMs: base.nowMs - 3 * HOUR });
    expect(verdict.state).toBe("trusted");
    expect(verdict.reason).toContain("normal lull");
    expect(classifyTable({ ...base, cadence: nightly, lastWriteAtMs: base.nowMs - 19 * HOUR }).state).toBe("stale");
  });

  it("is stale in a lull when the hour-of-week pattern expected writes", () => {
    const nightly = { ...cadence, maxSeconds: 12 * 3600 };
    const nowMs = MONDAY + 28 * 24 * HOUR + 10 * HOUR;
    const band = Object.fromEntries([8, 9].map((h) => [String(h), { median: 500, mad: 10, n: 4 }]));
    expect(classifyTable({ ...base, nowMs, band, cadence: nightly, lastWriteAtMs: nowMs - 3 * HOUR }).state).toBe("stale");
  });

  describe("with a clock-driven producer", () => {
    const old = { ...base, cadence, lastWriteAtMs: base.nowMs - 3 * 24 * HOUR };

    it("trusts a table whose job ran fine, however long ago it last wrote", () => {
      const verdict = classifyTable({ ...old, producer: { name: "nightly load", status: "healthy", reason: "Last run succeeded" } });
      expect(verdict.state).toBe("trusted");
      expect(verdict.reason).toBe("Written by nightly load: Last run succeeded");
    });

    it("never calls a paused job's table stale", () => {
      expect(classifyTable({ ...old, producer: { name: "nightly load", status: "paused", reason: "The job is disabled" } }).state).toBe("trusted");
    });

    it("blames the producer when it is broken", () => {
      const verdict = classifyTable({ ...old, producer: { name: "nightly load", status: "failing", reason: "Last run failed: boom" } });
      expect(verdict.state).toBe("stale");
      expect(verdict.reason).toContain("nightly load is failing: Last run failed: boom");
    });
  });
});

describe("bandExpectsWrites", () => {
  const band = { "8": { median: 500, mad: 10, n: 4 }, "9": { median: 0, mad: 0, n: 4 } };

  it("is unknown when the hours since have not been learned", () => {
    expect(bandExpectsWrites(band, MONDAY + 20 * HOUR, MONDAY + 23 * HOUR)).toBeNull();
  });

  it("is false over learned quiet hours and true once a busy hour passed", () => {
    expect(bandExpectsWrites(band, MONDAY + 8 * HOUR + 1, MONDAY + 10 * HOUR + 5)).toBe(false);
    expect(bandExpectsWrites(band, MONDAY + 7 * HOUR, MONDAY + 10 * HOUR)).toBe(true);
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
