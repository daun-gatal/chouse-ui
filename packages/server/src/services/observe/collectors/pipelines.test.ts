import { describe, expect, it } from "bun:test";

import type { CadenceSpec } from "../../scheduledQueries/cadence";
import { INCIDENT_HOLD_MS, incidentAction, learnedCadenceSeconds, schedulePeriodSeconds } from "./pipelines";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const DAY = 86_400;

function spec(overrides: Partial<CadenceSpec>): CadenceSpec {
  return { frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timezone: "UTC", ...overrides };
}

describe("schedulePeriodSeconds", () => {
  it("uses the schedule for presets", () => {
    expect(schedulePeriodSeconds(spec({}), NOW)).toBe(DAY);
    expect(schedulePeriodSeconds(spec({ frequency: "weekly" }), NOW)).toBe(7 * DAY);
  });

  it("takes the longest gap of an irregular cron", () => {
    // Weekdays at 09:00: the Friday → Monday gap is three days.
    expect(schedulePeriodSeconds(spec({ frequency: "cron", cronExpr: "0 9 * * 1-5" }), NOW)).toBe(3 * DAY);
  });

  it("is null when the clock never fires the job", () => {
    expect(schedulePeriodSeconds(spec({ frequency: "manual" }), NOW)).toBeNull();
    expect(schedulePeriodSeconds(spec({ frequency: "event" }), NOW)).toBeNull();
  });
});

describe("learnedCadenceSeconds", () => {
  it("prefers a job's schedule over a burst of manual runs", () => {
    const burst = [0, 1, 2, 3, 4, 5].map((m) => ({
      sampledAt: NOW, unitsIn: 1, bytesIn: null, lastSuccessAt: NOW - m * 60_000, lagSeconds: null,
      backlog: null, backlogUnit: null, errors: 0, errorSample: null, errorClass: null, progressing: true,
    }));
    const def = { id: "scheduled_job:j", kind: "scheduled_job", engine: "", name: "j", sourceLabel: null, sourceNode: null, targetNode: null };
    expect(learnedCadenceSeconds(burst, { ...def, attrs: { periodSeconds: DAY } })).toBe(DAY);
    expect(learnedCadenceSeconds(burst, { ...def, attrs: { periodSeconds: null } })).toBe(60);
    expect(learnedCadenceSeconds(burst.slice(0, 4), { ...def, attrs: { periodSeconds: null } })).toBeNull();
  });
});

describe("incidentAction", () => {
  const MIN = 60_000;
  type Prev = { status: "healthy" | "failing" | "stopped"; reason: string; updatedAt: number };
  const prev = (status: Prev["status"]): Prev => ({ status, reason: "r", updatedAt: NOW - MIN });

  it("waits out the hold before opening", () => {
    expect(incidentAction({ status: "failing", since: NOW, nowMs: NOW, previous: prev("healthy"), reason: "r" })).not.toBe("open");
    expect(incidentAction({ status: "failing", since: NOW - 3 * MIN, nowMs: NOW, previous: prev("failing"), reason: "r" })).toBe("none");
  });

  it("opens once, on the run where the hold is crossed", () => {
    const since = NOW - INCIDENT_HOLD_MS;
    expect(incidentAction({ status: "failing", since, nowMs: NOW, previous: prev("failing"), reason: "r" })).toBe("open");
    expect(incidentAction({ status: "failing", since, nowMs: NOW + MIN, previous: { status: "failing", reason: "r", updatedAt: NOW }, reason: "r" })).toBe("none");
  });

  it("keeps an open incident's summary current", () => {
    expect(incidentAction({ status: "stopped", since: NOW - 60 * MIN, nowMs: NOW, previous: { status: "stopped", reason: "Nothing succeeded for 59m", updatedAt: NOW - MIN }, reason: "Nothing succeeded for 1h" })).toBe("update");
  });

  it("recovers when the pipeline leaves the bad statuses", () => {
    expect(incidentAction({ status: "healthy", since: NOW, nowMs: NOW, previous: prev("failing"), reason: "ok" })).toBe("recover");
    expect(incidentAction({ status: "paused", since: NOW, nowMs: NOW, previous: prev("stopped"), reason: "off" })).toBe("recover");
    expect(incidentAction({ status: "healthy", since: NOW, nowMs: NOW, previous: prev("healthy"), reason: "ok" })).toBe("none");
  });
});
