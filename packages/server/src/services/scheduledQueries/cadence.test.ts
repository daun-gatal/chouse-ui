import { describe, it, expect } from "bun:test";

import { cadenceToCron, isValidTimeZone, lastScheduledFireMs, previousFireMs, nextFireTimes, validateCron } from "./cadence";

const job = (over: Partial<Parameters<typeof lastScheduledFireMs>[0]>) => ({
  frequency: "daily" as const,
  hour: 8,
  dayOfWeek: 1,
  dayOfMonth: 1,
  cronExpr: null as string | null,
  timezone: "UTC",
  ...over,
});

describe("cadenceToCron", () => {
  it("compiles presets to 5-field UTC cron patterns", () => {
    expect(cadenceToCron({ frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timezone: "UTC" })).toBe("0 8 * * *");
    expect(cadenceToCron({ frequency: "weekly", hour: 6, dayOfWeek: 3, dayOfMonth: 1, cronExpr: null, timezone: "UTC" })).toBe("0 6 * * 3");
    expect(cadenceToCron({ frequency: "monthly", hour: 0, dayOfWeek: 1, dayOfMonth: 15, cronExpr: null, timezone: "UTC" })).toBe("0 0 15 * *");
  });

  it("returns null for manual and passes through cron", () => {
    expect(cadenceToCron({ frequency: "manual", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timezone: "UTC" })).toBeNull();
    expect(cadenceToCron({ frequency: "cron", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: "*/15 * * * *", timezone: "UTC" })).toBe("*/15 * * * *");
  });
});

describe("lastScheduledFireMs", () => {
  it("returns the most recent daily slot at or before now", () => {
    // 2026-06-20 09:30Z; daily at 08:00 ⇒ most recent slot is 08:00 today.
    const now = Date.parse("2026-06-20T09:30:00Z");
    const fire = lastScheduledFireMs(job({}), now);
    expect(fire).toBe(Date.parse("2026-06-20T08:00:00Z"));
  });

  it("includes a slot landing exactly on now", () => {
    const now = Date.parse("2026-06-20T08:00:00Z");
    expect(lastScheduledFireMs(job({}), now)).toBe(now);
  });

  it("returns null for manual jobs", () => {
    expect(lastScheduledFireMs(job({ frequency: "manual" }), Date.now())).toBeNull();
  });

  it("never returns a burst — only the single most recent slot", () => {
    // every-minute cron, a 10-minute gap: still resolves to one slot.
    const now = Date.parse("2026-06-20T08:10:30Z");
    const fire = lastScheduledFireMs(job({ frequency: "cron", cronExpr: "* * * * *" }), now);
    expect(fire).toBe(Date.parse("2026-06-20T08:10:00Z"));
  });

  it("evaluates wall-clock schedules in an IANA timezone", () => {
    const now = Date.parse("2026-06-20T02:00:00Z");
    expect(lastScheduledFireMs(job({ hour: 8, timezone: "Asia/Jakarta" }), now)).toBe(
      Date.parse("2026-06-20T01:00:00Z"),
    );
  });
});

describe("previousFireMs — window lower bound auto-sizes to cadence", () => {
  it("daily ⇒ t-1d", () => {
    const slot = Date.parse("2026-06-20T08:00:00Z");
    expect(previousFireMs(job({}), slot)).toBe(Date.parse("2026-06-19T08:00:00Z"));
  });
  it("weekly ⇒ t-7d", () => {
    const slot = Date.parse("2026-06-22T06:00:00Z"); // a Monday
    expect(previousFireMs(job({ frequency: "weekly", hour: 6, dayOfWeek: 1 }), slot)).toBe(Date.parse("2026-06-15T06:00:00Z"));
  });
  it("hourly cron ⇒ t-1h", () => {
    const slot = Date.parse("2026-06-20T08:00:00Z");
    expect(previousFireMs(job({ frequency: "cron", cronExpr: "0 * * * *" }), slot)).toBe(Date.parse("2026-06-20T07:00:00Z"));
  });
});

describe("validateCron", () => {
  it("accepts a valid 5-field expression", () => {
    expect(validateCron("*/15 * * * *").valid).toBe(true);
  });
  it("rejects sub-minute (6-field) expressions", () => {
    expect(validateCron("*/30 * * * * *").valid).toBe(false);
  });
  it("rejects garbage", () => {
    expect(validateCron("not a cron").valid).toBe(false);
  });
  it("rejects an invalid IANA timezone", () => {
    expect(validateCron("0 8 * * *", "Mars/Olympus").valid).toBe(false);
  });
});

describe("timezone behavior", () => {
  it("validates IANA timezone identifiers", () => {
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("preserves local fire time across a DST transition", () => {
    const before = Date.parse("2026-03-07T14:00:00Z");
    const first = nextFireTimes(job({ hour: 8, timezone: "America/New_York" }), 2, before);
    expect(first).toEqual([
      Date.parse("2026-03-08T12:00:00Z"),
      Date.parse("2026-03-09T12:00:00Z"),
    ]);
  });
});

describe("nextFireTimes", () => {
  it("returns ascending future fire times", () => {
    const from = Date.parse("2026-06-20T07:59:00Z");
    const times = nextFireTimes({ frequency: "cron", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: "0 * * * *", timezone: "UTC" }, 3, from);
    expect(times.length).toBe(3);
    expect(times[0]).toBe(Date.parse("2026-06-20T08:00:00Z"));
    expect(times[1]).toBeGreaterThan(times[0]);
  });
});
