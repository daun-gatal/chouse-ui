import { describe, expect, it } from "vitest";

import type { DataHealthSchedule } from "@/api/dataHealth";
import { detectEventTimeColumn, eventTimeSupport, formatSchedule, isDateOnlyColumnType, isTemporalColumnType, suggestEventTimeEncoding } from "./lib";

const SCHEDULE: DataHealthSchedule = {
  frequency: "daily",
  hour: 8,
  dayOfWeek: 1,
  dayOfMonth: 1,
  cronExpr: null,
  timeoutSecs: 60,
};

describe("formatSchedule", () => {
  it("shows the cron expression instead of the preset hour", () => {
    expect(formatSchedule({ ...SCHEDULE, frequency: "cron", cronExpr: "*/5 * * * *" }, "Asia/Jakarta"))
      .toBe("cron · */5 * * * * Asia/Jakarta");
  });

  it("formats preset and manual schedules", () => {
    expect(formatSchedule(SCHEDULE, "Asia/Jakarta")).toBe("daily · 08:00 Asia/Jakarta");
    expect(formatSchedule({ ...SCHEDULE, frequency: "weekly", dayOfWeek: 3 }, "UTC")).toBe("weekly · Wed 08:00 UTC");
    expect(formatSchedule({ ...SCHEDULE, frequency: "monthly", dayOfMonth: 15 }, "UTC")).toBe("monthly · day 15 08:00 UTC");
    expect(formatSchedule({ ...SCHEDULE, frequency: "manual" }, "UTC")).toBe("Manual");
    expect(formatSchedule({ ...SCHEDULE, frequency: "event" }, "UTC")).toBe("After upstream run");
  });
});

describe("event-time column detection", () => {
  it("recognizes wrapped ClickHouse Date and DateTime types", () => {
    expect(isTemporalColumnType("Date")).toBe(true);
    expect(isTemporalColumnType("Date32")).toBe(true);
    expect(isTemporalColumnType("Nullable(DateTime('Asia/Jakarta'))")).toBe(true);
    expect(isTemporalColumnType("DateTime64(3, 'UTC')")).toBe(true);
    expect(isTemporalColumnType("String")).toBe(false);
    expect(isDateOnlyColumnType("Nullable(Date32)")).toBe(true);
    expect(isDateOnlyColumnType("DateTime('Asia/Jakarta')")).toBe(false);
  });

  it("prefers a conventional event-time name and otherwise the most precise type", () => {
    expect(detectEventTimeColumn([
      { name: "partition_date", type: "Date" },
      { name: "created_at", type: "DateTime" },
      { name: "ingested_at", type: "DateTime64(3)" },
    ])).toBe("created_at");
    expect(detectEventTimeColumn([
      { name: "partition_date", type: "Date" },
      { name: "ingested_at", type: "DateTime64(3)" },
    ])).toBe("ingested_at");
  });

  it("supports named Unix and string timestamps without guessing arbitrary fields", () => {
    expect(eventTimeSupport("UInt64")).toBe("unix");
    expect(eventTimeSupport("Nullable(String)")).toBe("string");
    expect(eventTimeSupport("UUID")).toBe("unsupported");
    expect(detectEventTimeColumn([{ name: "created_at", type: "UInt64" }])).toBe("created_at");
    expect(detectEventTimeColumn([{ name: "ts", type: "String" }])).toBe("ts");
    expect(detectEventTimeColumn([{ name: "description", type: "String" }, { name: "id", type: "UInt64" }])).toBe("");
    expect(suggestEventTimeEncoding({ name: "event_time_ms", type: "UInt64" })).toBe("unix_milliseconds");
    expect(suggestEventTimeEncoding({ name: "event_time", type: "String" })).toBe("string");
  });
});
