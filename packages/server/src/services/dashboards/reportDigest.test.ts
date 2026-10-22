import { describe, expect, it } from "bun:test";

import { MAX_DIGEST_CHARS, buildDigest, formatNumber, nextRunAt, reportScheduleSchema, scheduleText, zonedToUtc, type DigestPanel } from "./reportDigest";

const at = (iso: string): number => Date.parse(iso);

describe("nextRunAt", () => {
  it("runs daily at the wall-clock time of its zone", () => {
    const daily = { kind: "daily" as const, dayOfWeek: null, hour: 9, minute: 30, timezone: "Asia/Jakarta" };
    // 09:30 in Jakarta (UTC+7) is 02:30 UTC.
    expect(nextRunAt(daily, at("2026-10-22T01:00:00Z"))).toBe(at("2026-10-22T02:30:00Z"));
    // Exactly at the run time, the next one is tomorrow.
    expect(nextRunAt(daily, at("2026-10-22T02:30:00Z"))).toBe(at("2026-10-23T02:30:00Z"));
  });

  it("runs weekly on its day, in its zone's calendar", () => {
    // Monday 08:00 in New York. 2026-10-22 is a Thursday.
    const weekly = { kind: "weekly" as const, dayOfWeek: 1, hour: 8, minute: 0, timezone: "America/New_York" };
    expect(nextRunAt(weekly, at("2026-10-22T12:00:00Z"))).toBe(at("2026-10-26T12:00:00Z"));
    // Sunday 23:00 UTC is still Sunday evening in New York: Monday 08:00 local is next morning.
    expect(nextRunAt(weekly, at("2026-10-25T23:00:00Z"))).toBe(at("2026-10-26T12:00:00Z"));
  });

  it("keeps the local time across a DST change", () => {
    const daily = { kind: "daily" as const, dayOfWeek: null, hour: 8, minute: 0, timezone: "America/New_York" };
    // EDT (UTC-4) on 31 Oct, EST (UTC-5) from 1 Nov 2026.
    expect(nextRunAt(daily, at("2026-10-31T13:00:00Z"))).toBe(at("2026-11-01T13:00:00Z"));
    expect(nextRunAt(daily, at("2026-10-30T13:00:00Z"))).toBe(at("2026-10-31T12:00:00Z"));
  });

  it("moves a time a DST jump skips to after the jump", () => {
    // 02:30 does not exist in New York on 8 Mar 2026 (02:00 → 03:00).
    expect(zonedToUtc(2026, 3, 8, 2, 30, "America/New_York")).toBe(at("2026-03-08T07:30:00Z"));
  });

  it("takes the first of a repeated time", () => {
    // 01:30 happens twice in New York on 1 Nov 2026: EDT first, then EST.
    expect(zonedToUtc(2026, 11, 1, 1, 30, "America/New_York")).toBe(at("2026-11-01T05:30:00Z"));
  });
});

describe("reportScheduleSchema", () => {
  it("needs a day for weekly, none for daily, and a known zone", () => {
    const base = { kind: "daily", dayOfWeek: null, hour: 9, minute: 0, timezone: "UTC" };
    expect(reportScheduleSchema.safeParse(base).success).toBe(true);
    expect(reportScheduleSchema.safeParse({ ...base, kind: "weekly" }).error?.issues[0]?.message).toBe("A weekly report needs a day of the week");
    expect(reportScheduleSchema.safeParse({ ...base, dayOfWeek: 2 }).error?.issues[0]?.message).toBe("A daily report has no day of the week");
    expect(reportScheduleSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).error?.issues[0]?.message).toBe('Unknown time zone "Mars/Olympus"');
    expect(scheduleText({ kind: "weekly", dayOfWeek: 1, hour: 8, minute: 5, timezone: "UTC" })).toBe("Mondays at 08:05 UTC");
  });
});

describe("buildDigest", () => {
  const cols = (...names: string[]): Array<{ name: string }> => names.map((name) => ({ name }));
  const stat: DigestPanel = { title: "Lag", type: "stat", unit: "count", x: null, y: ["lag"], series: null, reduce: "last", ok: true, connections: [{ name: null, data: { columns: cols("lag"), rows: [{ lag: 10 }, { lag: 1234 }] } }], failed: [] };
  const series: DigestPanel = { title: "Rate", type: "line", unit: "per_s", x: "t", y: ["v"], series: null, reduce: null, ok: true, connections: [{ name: null, data: { columns: cols("t", "v"), rows: [{ t: "a", v: 2 }, { t: "b", v: "4" }, { t: "c", v: 6 }] } }], failed: [] };
  const table: DigestPanel = { title: "Top", type: "table", unit: "none", x: null, y: [], series: null, reduce: null, ok: true, connections: [{ name: null, data: { columns: cols("db", "rows"), rows: Array.from({ length: 7 }, (_, i) => ({ db: `d${i}`, rows: i })) } }], failed: [] };
  const broken: DigestPanel = { title: "Disk", ok: false, error: "Access denied to system.disks" };
  const input = { reportName: "Daily ops", dashboardTitle: "Shop", from: 1_800_000_000, to: 1_800_086_400, timezone: "UTC", firedAlerts: ["Slow inserts"], link: "https://chouse.example/dashboards/d1?from=1800000000&to=1800086400" };

  it("summarises stat, series and table panels, errors, alerts and the link", () => {
    const { title, text } = buildDigest({ ...input, panels: [stat, series, table, broken] });
    expect(title).toBe("📊 Daily ops");
    expect(text).toContain("*Lag*: 1,234");
    expect(text).toContain("v: min 2/s · avg 4/s · max 6/s · last 6/s");
    expect(text).toContain("db=d0, rows=0");
    expect(text).toContain("… 2 more rows");
    expect(text).not.toContain("db=d5");
    expect(text).toContain("*Disk* — error: Access denied to system.disks");
    expect(text).toContain("Alerts fired: Slow inserts");
    expect(text.endsWith(`Open: ${input.link}`)).toBe(true);
  });

  it("names connections on a fleet panel and lists those that failed", () => {
    const fleet: DigestPanel = { ...stat, connections: [{ name: "alpha", data: { columns: cols("lag"), rows: [{ lag: 1 }] } }, { name: "beta", data: { columns: cols("lag"), rows: [{ lag: 2 }] } }], failed: [{ name: "gamma", error: "timeout" }] };
    const { text } = buildDigest({ ...input, firedAlerts: [], panels: [fleet] });
    expect(text).toContain("*Lag*\n  alpha: 1\n  beta: 2\n  gamma: error — timeout");
    expect(text).toContain("No panel alerts fired.");
  });

  it("stays under the limit, says how many panels it left out, and always keeps the link", () => {
    const many = Array.from({ length: 200 }, (_, i): DigestPanel => ({ ...table, title: `Panel ${i}` }));
    const { text } = buildDigest({ ...input, panels: many });
    expect(text.length).toBeLessThanOrEqual(MAX_DIGEST_CHARS);
    expect(text).toMatch(/… \d+ more panels — open the dashboard for them\./);
    expect(text.endsWith(`Open: ${input.link}`)).toBe(true);
  });

  it("shows a stat panel's value with its reduce, as the dashboard does", () => {
    const peak: DigestPanel = { ...stat, title: "Peak lag", reduce: "max", connections: [{ name: null, data: { columns: cols("lag"), rows: [{ lag: 900 }, { lag: 12 }] } }] };
    expect(buildDigest({ ...input, panels: [peak] }).text).toContain("*Peak lag*: 900");
  });

  it("summarises each series of a split chart on its own", () => {
    const split: DigestPanel = {
      ...series, series: "table",
      connections: [{ name: null, data: { columns: cols("t", "table", "v"), rows: [{ t: "a", table: "orders", v: 1 }, { t: "a", table: "items", v: 100 }, { t: "b", table: "orders", v: 3 }, { t: "b", table: "items", v: 300 }] } }],
    };
    const { text } = buildDigest({ ...input, panels: [split] });
    expect(text).toContain("v table=orders: min 1/s · avg 2/s · max 3/s · last 3/s");
    expect(text).toContain("v table=items: min 100/s · avg 200/s · max 300/s · last 300/s");
  });

  it("formats units", () => {
    expect(formatNumber(1536, "bytes")).toBe("1.5 KiB");
    expect(formatNumber(12.345, "ms")).toBe("12.35 ms");
    expect(formatNumber(99.5, "percent")).toBe("99.5%");
  });
});
