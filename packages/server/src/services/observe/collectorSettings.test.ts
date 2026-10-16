import { describe, expect, it } from "bun:test";

import { COLLECTOR_INFO, effectiveSchedule, MAX_INTERVAL_SECONDS, scheduleProblems, type CollectorSettings } from "./collectorSettings";
import { ALL_COLLECTORS } from "./index";

const BUILT_IN = 15 * 60 * 1000;

describe("collector schedule rules", () => {
  it("knows every registered collector, and only those", () => {
    expect(COLLECTOR_INFO.map((c) => c.name).sort()).toEqual(ALL_COLLECTORS.map((c) => c.name).sort());
    for (const info of COLLECTOR_INFO) {
      const collector = ALL_COLLECTORS.find((c) => c.name === info.name)!;
      // The built-in interval is always allowed, and the global flag matches the collector.
      expect(collector.intervalMs / 1000).toBeGreaterThanOrEqual(info.minSeconds);
      expect(info.global).toBe(collector.scope === "global");
    }
  });

  it("resolves connection override, then default, then built-in", () => {
    const settings: CollectorSettings = {
      defaults: { usage: { intervalSeconds: 3600, paused: true } },
      connections: { a: { usage: { intervalSeconds: 600 } }, b: { usage: { paused: false } } },
    };
    expect(effectiveSchedule(settings, "usage", BUILT_IN, "a")).toEqual({ intervalMs: 600_000, intervalSource: "connection", paused: true, pausedSource: "default" });
    expect(effectiveSchedule(settings, "usage", BUILT_IN, "b")).toEqual({ intervalMs: 3_600_000, intervalSource: "default", paused: false, pausedSource: "connection" });
    expect(effectiveSchedule(settings, "usage", BUILT_IN, "c")).toEqual({ intervalMs: 3_600_000, intervalSource: "default", paused: true, pausedSource: "default" });
    expect(effectiveSchedule({ defaults: {}, connections: {} }, "usage", BUILT_IN, "a")).toEqual({ intervalMs: BUILT_IN, intervalSource: "built-in", paused: false, pausedSource: "built-in" });
  });

  it("ignores per-connection settings and pauses for fleet", () => {
    const settings: CollectorSettings = { defaults: { fleet: { intervalSeconds: 60, paused: true } }, connections: { a: { fleet: { intervalSeconds: 10 } } } };
    expect(effectiveSchedule(settings, "fleet", 30_000, "a")).toEqual({ intervalMs: 60_000, intervalSource: "default", paused: false, pausedSource: "built-in" });
  });

  it("clamps a stored interval into the limits", () => {
    const settings: CollectorSettings = { defaults: { usage: { intervalSeconds: 5 } }, connections: { a: { usage: { intervalSeconds: 10 * MAX_INTERVAL_SECONDS } } } };
    expect(effectiveSchedule(settings, "usage", BUILT_IN, null).intervalMs).toBe(300_000);
    expect(effectiveSchedule(settings, "usage", BUILT_IN, "a").intervalMs).toBe(MAX_INTERVAL_SECONDS * 1000);
  });

  it("reports what can't be saved", () => {
    expect(scheduleProblems({ usage: { intervalSeconds: 900 }, profiles: { paused: true } }, "defaults")).toEqual([]);
    expect(scheduleProblems({ usage: { intervalSeconds: 60 } }, "defaults")).toEqual(["Usage must run every 300–86400 seconds"]);
    expect(scheduleProblems({ ghost: {} }, "defaults")).toEqual(["Unknown collector 'ghost'"]);
    expect(scheduleProblems({ fleet: { paused: true } }, "defaults")).toEqual(["Fleet health can't be paused"]);
    expect(scheduleProblems({ fleet: { intervalSeconds: 60 } }, "connection")).toEqual(["Fleet health runs once for every connection; set it in the defaults"]);
    // Inheriting fields are fine anywhere.
    expect(scheduleProblems({ fleet: { intervalSeconds: null, paused: null } }, "connection")).toEqual([]);
  });
});
