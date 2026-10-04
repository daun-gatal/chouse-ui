import { describe, expect, it } from "vitest";

import type { Pipeline } from "@/api/observe";
import { pipelineSummary } from "./PipelinesTab";

function pipeline(patch: Partial<Pipeline>): Pipeline {
  return {
    id: "p", kind: "queue_engine", engine: "Kafka", name: "p", sourceLabel: null, sourceNode: null, targetNode: null, status: "healthy", statusReason: null,
    statusSince: 0, unsupported: null, attrs: {}, units24h: 0, errors24h: 0, sparkline: [], lagSeconds: null, backlog: null, lastSuccessAt: null, ...patch,
  };
}

describe("pipelineSummary", () => {
  it("sums throughput and errors and finds the worst lag", () => {
    const summary = pipelineSummary([
      pipeline({ name: "orders_raw_queue", units24h: 100, errors24h: 1284, lagSeconds: 8040 }),
      pipeline({ name: "events_rmq", units24h: 50, lagSeconds: 3 }),
      pipeline({ name: "vector", status: "inefficient" }),
    ]);
    expect(summary).toEqual({ units24h: 150, errors24h: 1284, maxLag: 8040, maxLagName: "orders_raw_queue", inefficient: 1 });
  });

  it("handles no lag at all", () => {
    expect(pipelineSummary([pipeline({})]).maxLag).toBeNull();
  });
});
