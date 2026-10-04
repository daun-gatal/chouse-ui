import { describe, expect, it } from "vitest";

import { formatAgo, formatBytes, formatCount, formatDuration, formatPercent, humanize, nodeKind, nodeLabel, PIPELINE_STATUS, relativeChange, severityTone, TRUST_TONE } from "./lib";

describe("observe formatting", () => {
  it("formats bytes in binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1.21 * 1024 ** 4)).toBe("1.2 TiB");
    expect(formatBytes(-2048)).toBe("−2.0 KiB");
    expect(formatBytes(null)).toBe("—");
  });

  it("abbreviates counts", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(41_200)).toBe("41.2k");
    expect(formatCount(1_900_000)).toBe("1.9M");
    expect(formatCount(84_100_000_000)).toBe("84B");
    expect(formatCount(undefined)).toBe("—");
  });

  it("formats durations and relative time", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(8040)).toBe("2h 14m");
    expect(formatDuration(90_000)).toBe("1d 1h");
    expect(formatAgo(null)).toBe("never");
    expect(formatAgo(1_000, 11_000)).toBe("just now");
    expect(formatAgo(0 + 1, 3_600_001)).toBe("1h ago");
    expect(formatAgo(10_000, 0)).toBe("in 10s");
  });

  it("formats ratios and changes", () => {
    expect(formatPercent(0.986, 1)).toBe("98.6%");
    expect(formatPercent(null)).toBe("—");
    expect(relativeChange(62, 100)).toBeCloseTo(-0.38);
    expect(relativeChange(5, 0)).toBeNull();
  });

  it("splits lineage node ids", () => {
    expect(nodeLabel("table:shop.orders")).toBe("shop.orders");
    expect(nodeKind("kafka_topic:orders.v2")).toBe("kafka_topic");
    expect(nodeLabel(null)).toBe("—");
    expect(nodeKind("plain")).toBe("");
  });

  it("maps vocabularies to tones", () => {
    expect(TRUST_TONE.stale).toBe("bad");
    expect(PIPELINE_STATUS.retrying.tone).toBe("bad");
    expect(PIPELINE_STATUS.unsupported_on_version.label).toBe("Not on this version");
    expect(severityTone("critical")).toBe("bad");
    expect(severityTone("warning")).toBe("warn");
    expect(humanize("schema_contract")).toBe("Schema contract");
  });
});

describe("columnDrift", () => {
  it("flags a statistic that moved beyond the tolerance against the earlier median", async () => {
    const { columnDrift } = await import("./lib");
    const rows = columnDrift({
      price_usd: [
        { at: 1, nullRatio: 0.001, distinct: 100, p50: 12.4, p95: 40, },
        { at: 2, nullRatio: 0.001, distinct: 110, p50: 12.5, p95: 41 },
        { at: 3, nullRatio: 0.001, distinct: 105, p50: 1240, p95: 4100 },
      ],
      country: [
        { at: 1, nullRatio: 0.0008, distinct: 200, p50: null, p95: null },
        { at: 2, nullRatio: 0.09, distinct: 201, p50: null, p95: null },
      ],
    });
    const p50 = rows.find((r) => r.column === "price_usd" && r.metric === "p50");
    expect(p50).toMatchObject({ baseline: 12.45, current: 1240, drifted: true });
    expect(rows.find((r) => r.column === "country" && r.metric === "null ratio")?.drifted).toBe(true);
    expect(rows.find((r) => r.column === "country" && r.metric === "distinct")?.drifted).toBe(false);
    expect(rows[0].drifted).toBe(true);
  });

  it("does not judge a column with no history", async () => {
    const { columnDrift } = await import("./lib");
    const rows = columnDrift({ id: [{ at: 1, nullRatio: 0, distinct: 5, p50: 3, p95: 4 }] });
    expect(rows.every((r) => !r.drifted && r.baseline === null)).toBe(true);
  });
});
