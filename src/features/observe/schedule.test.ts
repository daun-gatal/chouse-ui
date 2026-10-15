import { describe, expect, it } from "vitest";

import type { CollectorScheduleRow } from "@/api/observe";
import { inheritedInterval, inheritedPaused, initialDrafts, intervalChoices, runsPerDay, scheduleDirty, schedulePayload, scheduleSummary } from "./schedule";

function row(overrides: Partial<CollectorScheduleRow> = {}): CollectorScheduleRow {
  return {
    name: "usage", label: "Usage", description: "", reads: "system.query_log", slower: "", minSeconds: 300, maxSeconds: 86_400,
    global: false, pausable: true, builtInSeconds: 900, defaults: {}, override: {},
    effective: { intervalSeconds: 900, intervalSource: "built-in", paused: false, pausedSource: "built-in" },
    status: null, projectedBytesPerDay: null, overriddenOn: 0, pausedOn: 0,
    ...overrides,
  };
}

describe("collection schedule helpers", () => {
  it("offers presets within the collector's limits, plus stored custom values", () => {
    const choices = intervalChoices(row(), [4000, null, undefined]);
    expect(choices[0]).toBe(300);
    expect(choices[choices.length - 1]).toBe(86_400);
    expect(choices).toContain(4000);
    expect(choices).not.toContain(60);
    expect([...choices].sort((a, b) => a - b)).toEqual(choices);
  });

  it("counts runs per day", () => {
    expect(runsPerDay(900)).toBe(96);
    expect(runsPerDay(0)).toBe(0);
  });

  it("says what a connection inherits: the default, else the built-in", () => {
    expect(inheritedInterval(row(), "connection")).toEqual({ seconds: 900, from: "built-in" });
    expect(inheritedInterval(row({ defaults: { intervalSeconds: 3600 } }), "connection")).toEqual({ seconds: 3600, from: "default" });
    expect(inheritedInterval(row({ defaults: { intervalSeconds: 3600 } }), "defaults")).toEqual({ seconds: 900, from: "built-in" });
    expect(inheritedPaused(row({ defaults: { paused: true } }), "connection")).toBe(true);
    expect(inheritedPaused(row({ defaults: { paused: true } }), "defaults")).toBe(false);
  });

  it("starts drafts from what the scope stores and tracks changes", () => {
    const rows = [row({ override: { intervalSeconds: 600 } }), row({ name: "catalog", override: null })];
    const drafts = initialDrafts(rows, "connection");
    expect(drafts).toEqual({ usage: { intervalSeconds: 600 }, catalog: {} });
    expect(scheduleDirty(rows, "connection", drafts)).toBe(false);
    expect(scheduleDirty(rows, "connection", { ...drafts, catalog: { paused: true } })).toBe(true);
    // Clearing a field back to inherit is not a change when nothing was stored.
    expect(scheduleDirty(rows, "connection", { ...drafts, catalog: { intervalSeconds: null, paused: null } })).toBe(false);
  });

  it("sends only what is set", () => {
    expect(schedulePayload({ usage: { intervalSeconds: 600, paused: null }, catalog: { intervalSeconds: null, paused: null }, profiles: { paused: false } }))
      .toEqual({ usage: { intervalSeconds: 600 }, profiles: { paused: false } });
  });

  it("summarizes a connection's schedule in one line", () => {
    const paused = { intervalSeconds: 900, intervalSource: "built-in" as const, paused: true, pausedSource: "connection" as const };
    expect(scheduleSummary([
      row({ override: { intervalSeconds: 3600 }, projectedBytesPerDay: 1000 }),
      row({ name: "profiles", override: { paused: true }, effective: paused, projectedBytesPerDay: 0 }),
      row({ name: "catalog", override: {}, projectedBytesPerDay: null }),
      row({ name: "fleet", override: null, projectedBytesPerDay: null }),
    ])).toEqual({ ownSettings: 2, paused: 1, bytesPerDay: 1000 });
    expect(scheduleSummary([row({ projectedBytesPerDay: null })])).toEqual({ ownSettings: 0, paused: 0, bytesPerDay: null });
  });
});
