import { describe, expect, it } from "vitest";

import { bucketIndex, isTimeType, nearestIndex, toUtcMs, zoneOfColumn } from "./time";

describe("zoneOfColumn", () => {
  it("prefers the zone in the type, else the run's", () => {
    expect(zoneOfColumn("DateTime('Asia/Jakarta')", "UTC")).toBe("Asia/Jakarta");
    expect(zoneOfColumn("DateTime64(3, 'Europe/Berlin')", "UTC")).toBe("Europe/Berlin");
    expect(zoneOfColumn("Nullable(DateTime('UTC'))", "Asia/Tokyo")).toBe("UTC");
    expect(zoneOfColumn("DateTime", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(zoneOfColumn("Date", null)).toBeNull();
  });

  it("knows date and time types", () => {
    expect(isTimeType("LowCardinality(Nullable(DateTime64(3)))")).toBe(true);
    expect(isTimeType("String")).toBe(false);
  });
});

describe("toUtcMs", () => {
  it("reads date-times in their zone", () => {
    expect(toUtcMs("2026-10-22 12:00:00", "UTC")).toBe(Date.UTC(2026, 9, 22, 12));
    expect(toUtcMs("2026-10-22 19:00:00", "Asia/Jakarta")).toBe(Date.UTC(2026, 9, 22, 12));
    expect(toUtcMs("2026-10-22 12:00:00.250", "UTC")).toBe(Date.UTC(2026, 9, 22, 12) + 250);
    expect(toUtcMs("2026-10-22", "UTC")).toBe(Date.UTC(2026, 9, 22));
    expect(toUtcMs("2026-10-22T05:30:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 22, 0));
  });

  it("gets the offset right across a DST change", () => {
    // Berlin: CEST (UTC+2) until 2026-10-25 03:00, then CET (UTC+1).
    expect(toUtcMs("2026-10-24 12:00:00", "Europe/Berlin")).toBe(Date.UTC(2026, 9, 24, 10));
    expect(toUtcMs("2026-10-26 12:00:00", "Europe/Berlin")).toBe(Date.UTC(2026, 9, 26, 11));
  });

  it("returns null for what is not a ClickHouse date", () => {
    expect(toUtcMs("yesterday", "UTC")).toBeNull();
    expect(toUtcMs(12, "UTC")).toBeNull();
    expect(toUtcMs("2026-10-22 12:00:00", "Not/AZone")).toBeNull();
  });
});

describe("bucketIndex and nearestIndex", () => {
  const xs = [0, 60_000, 120_000, null, 240_000];

  it("finds the bucket holding a time, or none outside the chart", () => {
    expect(bucketIndex(xs, 90_000, 60_000)).toBe(1);
    expect(bucketIndex(xs, 0, 60_000)).toBe(0);
    expect(bucketIndex(xs, 270_000, 60_000)).toBe(4);
    expect(bucketIndex(xs, 300_000, 60_000)).toBeNull();
    expect(bucketIndex(xs, -1, 60_000)).toBeNull();
    // 180 000 falls in a gap after bucket 120 000 (one interval long).
    expect(bucketIndex(xs, 185_000, 60_000)).toBeNull();
  });

  it("matches a shifted bucket to the nearest within half an interval", () => {
    expect(nearestIndex(xs, 61_000, 60_000)).toBe(1);
    expect(nearestIndex(xs, 90_000, 60_000)).toBe(1);
    expect(nearestIndex(xs, 180_000, 60_000)).toBeNull();
  });
});
