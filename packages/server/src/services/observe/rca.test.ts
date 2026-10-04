import { describe, expect, it } from "bun:test";

import { blastRadius, computeRca, type GraphEdge, type RcaSignal } from "./rca";
import { forecastDisk } from "./forecast";
import { detectRegressions, linkChanges, type FingerprintHour } from "./regressions";

const T0 = 1_800_000_000_000;
const MIN = 60_000;

// topic → queue engine → raw table → cascaded MV → daily table → job / saved query
const edges: GraphEdge[] = [
  { source: "src:topic", target: "table:shop.orders_raw_queue", kind: "queue" },
  { source: "table:shop.orders_raw_queue", target: "table:shop.orders_raw", kind: "mv" },
  { source: "table:shop.orders_raw", target: "view:shop.mv_orders_agg", kind: "mv" },
  { source: "view:shop.mv_orders_agg", target: "table:analytics.orders_daily", kind: "mv" },
  { source: "table:analytics.orders_daily", target: "job:finance_export", kind: "reader_job" },
  { source: "table:analytics.orders_daily", target: "sq:revenue_board", kind: "reader_saved_query" },
];
const labels = new Map(edges.flatMap((e) => [[e.source, e.source.split(":")[1]], [e.target, e.target.split(":")[1]]]));

function signal(partial: Partial<RcaSignal> & Pick<RcaSignal, "layer" | "kind" | "nodeId">): RcaSignal {
  return { onsetAt: T0, summary: partial.kind, evidence: { source: "system.test", detail: "" }, severity: 2, ...partial };
}

describe("computeRca", () => {
  it("traces data → ingestion → transform → engine for a queue engine replaying a batch", () => {
    const result = computeRca({
      incidentNode: "table:analytics.orders_daily",
      incidentOnsetAt: T0 + 26 * MIN,
      edges,
      labels,
      signals: [
        signal({ nodeId: "table:analytics.orders_daily", layer: "data", kind: "stale", onsetAt: T0 + 26 * MIN }),
        signal({ nodeId: "table:shop.orders_raw_queue", layer: "ingestion", kind: "retrying", onsetAt: T0 + 2 * MIN }),
        signal({ nodeId: "view:shop.mv_orders_agg", layer: "transform", kind: "failing", onsetAt: T0 + 2 * MIN }),
        signal({ nodeId: null, layer: "engine", kind: "memory_pressure", onsetAt: T0, severity: 3 }),
        // starts long after the incident: an effect, never a cause
        signal({ nodeId: null, layer: "engine", kind: "disk_full", onsetAt: T0 + 90 * MIN, severity: 3 }),
      ],
    });
    expect(result.rootCause?.kind).toBe("memory_pressure");
    expect(result.chain.map((c) => c.layer)).toEqual(["data", "transform", "ingestion", "engine"]);
    expect(result.signature).toBe("data:stale>transform:failing>ingestion:retrying>engine:memory_pressure");
  });

  it("finds an external root cause (object storage permission error)", () => {
    const s3Edges: GraphEdge[] = [
      { source: "src:s3", target: "table:events.s3queue", kind: "object_storage_queue" },
      { source: "table:events.s3queue", target: "table:events.page_views", kind: "mv" },
    ];
    const result = computeRca({
      incidentNode: "table:events.page_views",
      incidentOnsetAt: T0 + 30 * MIN,
      edges: s3Edges,
      labels: new Map(),
      signals: [
        signal({ nodeId: "table:events.page_views", layer: "data", kind: "stale", onsetAt: T0 + 30 * MIN }),
        signal({ nodeId: "table:events.s3queue", layer: "external", kind: "access_denied", onsetAt: T0 + MIN }),
      ],
    });
    expect(result.rootCause?.layer).toBe("external");
    expect(result.chain).toHaveLength(2);
  });

  it("returns an empty result without upstream evidence", () => {
    expect(computeRca({ incidentNode: "x", incidentOnsetAt: T0, edges, labels, signals: [] })).toEqual({ chain: [], rootCause: null, signature: null });
  });
});

describe("blastRadius", () => {
  it("lists everything downstream, nearest first", () => {
    const items = blastRadius("table:shop.orders_raw", edges, labels, new Map([["job:finance_export", "job"]]));
    expect(items.map((i) => i.nodeId)).toEqual([
      "view:shop.mv_orders_agg",
      "table:analytics.orders_daily",
      "job:finance_export",
      "sq:revenue_board",
    ]);
    expect(items.find((i) => i.nodeId === "job:finance_export")?.kind).toBe("job");
  });
});

describe("forecastDisk", () => {
  it("projects days to the threshold from a robust trend", () => {
    const total = 1000;
    const samples = Array.from({ length: 10 }, (_, i) => ({ sampledAt: T0 + i * 86_400_000, totalBytes: total, freeBytes: total - (500 + i * 10) }));
    const f = forecastDisk(samples)!;
    expect(f.growthBytesPerDay).toBe(10);
    expect(f.usedRatio).toBe(0.59);
    expect(f.daysToThreshold).toBe(26);
  });

  it("has no projection for short or flat histories", () => {
    expect(forecastDisk([{ sampledAt: T0, totalBytes: 10, freeBytes: 5 }])?.daysToThreshold).toBeNull();
    const flat = Array.from({ length: 10 }, (_, i) => ({ sampledAt: T0 + i * 86_400_000, totalBytes: 100, freeBytes: 50 }));
    expect(forecastDisk(flat)?.daysToThreshold).toBeNull();
  });
});

describe("detectRegressions", () => {
  const now = T0 + 20 * 86_400_000;
  const hours: FingerprintHour[] = [];
  for (let h = 0; h < 15 * 24; h++) {
    const hour = now - (15 * 24 - h) * 3_600_000;
    const recent = hour >= now - 24 * 3_600_000;
    hours.push({ hour, runs: 5, p95Ms: recent ? 9800 : 2300, avgReadBytes: 4e9, serverVersion: recent ? "25.3" : "24.11" });
  }

  it("flags p95 at least 1.5x the 14-day baseline", () => {
    const [finding] = detectRegressions(hours, now);
    expect(finding.metric).toBe("p95_ms");
    expect(finding.ratio).toBe(4.26);
  });

  it("ignores too few runs and stable shapes", () => {
    expect(detectRegressions(hours.slice(-3), now)).toEqual([]);
    expect(detectRegressions(hours.map((h) => ({ ...h, p95Ms: 2300 })), now)).toEqual([]);
  });

  it("links node-scoped and object-scoped changes near the onset", () => {
    const changes = [
      { id: "1", kind: "version", occurredAt: now - 25 * 3_600_000, node: "ch-1", objectRef: null, summary: "24.11 → 25.3" },
      { id: "2", kind: "ddl", occurredAt: now - 23 * 3_600_000, node: null, objectRef: "shop.orders_raw", summary: "ALTER" },
      { id: "3", kind: "ddl", occurredAt: now - 23 * 3_600_000, node: null, objectRef: "other.table", summary: "ALTER" },
      { id: "4", kind: "version", occurredAt: now - 23 * 3_600_000, node: "ch-9", objectRef: null, summary: "other node" },
    ];
    expect(linkChanges(now - 24 * 3_600_000, "ch-1", ["shop.orders_raw"], changes).map((c) => c.id).sort()).toEqual(["1", "2"]);
  });
});
