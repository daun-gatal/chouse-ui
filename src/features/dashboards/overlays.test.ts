import { describe, expect, it } from "vitest";

import type { AnnotationEvent } from "@/api/dashboards";

import { BAND_HI, BAND_LO, chartTime, compareKey, markersFor, mergeBand, mergeCompare } from "./overlays";

const COLUMNS = [{ name: "t", type: "DateTime" }, { name: "v", type: "UInt64" }];
const ROWS = [{ t: "2026-10-22 07:00:00", v: 1 }, { t: "2026-10-22 08:00:00", v: 2 }, { t: "2026-10-22 09:00:00", v: 3 }];
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 22, 0); // 07:00 in Asia/Jakarta

function time(): Extract<ReturnType<typeof chartTime>, { ok: true }> {
  const t = chartTime(ROWS, COLUMNS, "t", "Asia/Jakarta", 3600);
  if (!t.ok) throw new Error(t.reason);
  return t;
}

const event = (id: string, at: number, source: AnnotationEvent["source"] = "ddl"): AnnotationEvent => ({ id, source, at, title: `Event ${id}`, detail: null, objectRef: null });

describe("chartTime", () => {
  it("reads x in the run's zone, or says why it cannot", () => {
    expect(time().xsMs).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(chartTime(ROWS, [{ name: "t", type: "String" }], "t", "UTC", 60)).toEqual({ ok: false, reason: "t is not a date or time" });
    expect(chartTime(ROWS, COLUMNS, "t", null, 60)).toEqual({ ok: false, reason: "ClickHouse did not report its time zone" });
  });
});

describe("markersFor", () => {
  it("puts each event at the bucket holding it, in its source's color, and leaves out events off the chart", () => {
    const markers = markersFor([event("a", T0 + 90 * 60_000), event("b", T0 - 1, "alerts"), event("c", T0 + 3 * HOUR + 1)], ROWS, "t", time());
    expect(markers.map((m) => [m.id, m.x, m.color])).toEqual([["a", "2026-10-22 08:00:00", "#60A5FA"]]);
  });
});

describe("mergeCompare", () => {
  it("lands each earlier bucket on the matching current one and leaves gaps empty", () => {
    const earlier = { columns: COLUMNS, rows: [{ t: "2026-10-15 07:00:00", v: "10" }, { t: "2026-10-15 09:00:00", v: null }], timezone: "Asia/Jakarta" };
    const merged = mergeCompare(ROWS, time(), earlier, "t", ["v"], 604_800, "1 week ago");
    const key = compareKey("v", "1 week ago");
    expect(merged.keys).toEqual([{ key, label: key }]);
    expect(merged.rows.map((r) => r[key])).toEqual([10, undefined, null]);
    expect(ROWS[0]).not.toHaveProperty(key);
  });

  it("adds nothing when the earlier run's times cannot be read", () => {
    const merged = mergeCompare(ROWS, time(), { columns: COLUMNS, rows: [{ t: "2026-10-15 07:00:00", v: 1 }], timezone: null }, "t", ["v"], 604_800, "x");
    expect(merged.rows.every((r) => !(compareKey("v", "x") in r))).toBe(true);
  });
});

describe("mergeBand", () => {
  it("adds the expected range to the buckets the band has", () => {
    const rows = mergeBand(ROWS, "t", [{ x: "2026-10-22 08:00:00", lo: 1, hi: 3, median: 2 }]);
    expect(rows[1]).toMatchObject({ [BAND_LO]: 1, [BAND_HI]: 3 });
    expect(rows[0]).not.toHaveProperty(BAND_LO);
  });
});
