import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import {
  acknowledgeObserveIncident,
  checkPrivileges,
  dismissSuggestion,
  getCapacity,
  getCollectorStatus,
  getCoverage,
  getDataset,
  getFingerprintSeries,
  getImpact,
  getIncident,
  getLineage,
  getOverview,
  getPerformance,
  getPipelineSamples,
  getPrivileges,
  explainFingerprint,
  explainIncident,
  listDatasets,
  listIncidents,
  listPipelines,
  parseTableNode,
  isSystemDatabase,
  pinCriticality,
  preflightDdl,
  recomputeRca,
  setCostRates,
  startCodecTrial,
  tableNode,
} from "./observe";

interface Seen {
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
}

/** Echo every /api/observe request so each wrapper's wire shape is asserted. */
function capture(data: unknown): Seen[] {
  const seen: Seen[] = [];
  server.use(
    http.all("/api/observe/*", async ({ request }) => {
      const url = new URL(request.url);
      const text = request.method === "GET" ? "" : await request.text();
      seen.push({ method: request.method, path: url.pathname, params: Object.fromEntries(url.searchParams), body: text ? JSON.parse(text) : undefined });
      return HttpResponse.json({ success: true, data });
    }),
  );
  return seen;
}

describe("observe API", () => {
  it("scopes reads to the requested connection", async () => {
    const seen = capture({ collectors: [], datasets: [], pipelines: [], incidents: [], samples: [], series: [] });
    await getCollectorStatus("c1");
    await getOverview("c1");
    await getCoverage("c1");
    await getPerformance("c1");
    await getCapacity("c1");
    await getPrivileges("c1");
    expect(seen.map((s) => `${s.path}?${s.params.connectionId}`)).toEqual([
      "/api/observe/status?c1",
      "/api/observe/overview?c1",
      "/api/observe/coverage?c1",
      "/api/observe/performance?c1",
      "/api/observe/capacity?c1",
      "/api/observe/privileges?c1",
    ]);
  });

  it("unwraps list envelopes and drops empty filters", async () => {
    const seen = capture({ datasets: [{ database: "shop", table: "orders" }], pipelines: [{ id: "p1" }], incidents: [{ id: "i1" }] });
    expect(await listDatasets({ connectionId: "c1", q: "ord", state: "" })).toEqual([{ database: "shop", table: "orders" }]);
    expect(await listPipelines({ kind: "queue_engine" })).toEqual([{ id: "p1" }]);
    expect(await listIncidents({ status: "all" })).toEqual([{ id: "i1" }]);
    expect(seen[0].params).toEqual({ connectionId: "c1", q: "ord" });
    expect(seen[1].params).toEqual({ kind: "queue_engine" });
    expect(seen[2].params).toEqual({ status: "all" });
  });

  it("encodes path segments for datasets, pipelines and fingerprints", async () => {
    const seen = capture({ samples: [{ at: 1 }], series: [{ hour: 1 }] });
    await getDataset("my db", "t/1");
    expect(await getPipelineSamples("mv:shop.a")).toEqual([{ at: 1 }]);
    expect(await getFingerprintSeries("ab12")).toEqual([{ hour: 1 }]);
    expect(seen.map((s) => s.path)).toEqual([
      "/api/observe/datasets/my%20db/t%2F1",
      "/api/observe/pipelines/mv%3Ashop.a/samples",
      "/api/observe/performance/fingerprints/ab12",
    ]);
  });

  it("passes lineage focus, depth and direction", async () => {
    const seen = capture({ nodes: [], edges: [], truncated: false, totalNodes: 0, impacted: [] });
    await getLineage({ node: "table:shop.orders", depth: 2, direction: "up" });
    await getImpact("table:shop.orders", "c2");
    expect(seen[0].params).toEqual({ node: "table:shop.orders", depth: "2", direction: "up" });
    expect(seen[1].params).toEqual({ connectionId: "c2", node: "table:shop.orders" });
  });

  it("sends writes with their bodies", async () => {
    const seen = capture({ ok: true });
    await pinCriticality("shop", "orders", "critical");
    await dismissSuggestion("freshness:shop.orders");
    await setCostRates({ currency: "USD", perTibRead: 5, perCpuHour: 0.1 });
    await startCodecTrial({ database: "shop", table: "orders", column: "payload", candidateCodec: "ZSTD(3)" });
    await preflightDdl("ALTER TABLE shop.orders DROP COLUMN c");
    await explainFingerprint("ab12", "c9");
    await checkPrivileges();
    expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
      ["PUT", "/api/observe/datasets/shop/orders/criticality", { criticality: "critical" }],
      ["POST", "/api/observe/suggestions/dismiss", { key: "freshness:shop.orders" }],
      ["PUT", "/api/observe/cost-rates", { currency: "USD", perTibRead: 5, perCpuHour: 0.1 }],
      ["POST", "/api/observe/codec-trials", { database: "shop", table: "orders", column: "payload", candidateCodec: "ZSTD(3)" }],
      ["POST", "/api/observe/preflight", { sql: "ALTER TABLE shop.orders DROP COLUMN c" }],
      ["POST", "/api/observe/performance/explain", { fingerprint: "ab12", compareConnectionId: "c9" }],
      ["POST", "/api/observe/privileges/check", undefined],
    ]);
  });

  it("reads incidents and recomputes RCA by source", async () => {
    const seen = capture({ id: "i1", rca: null });
    await getIncident("data_health", "i1");
    await recomputeRca("observe", "o1");
    await acknowledgeObserveIncident("o1");
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/observe/incidents/data_health/i1",
      "POST /api/observe/incidents/observe/o1/rca",
      "POST /api/observe/incidents/observe/o1/acknowledge",
    ]);
  });

  it("surfaces API errors", async () => {
    server.use(http.get("/api/observe/overview", () => HttpResponse.json({ success: false, error: { code: "FORBIDDEN", message: "nope" } }, { status: 403 })));
    await expect(getOverview()).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });
});

describe("Chouse AI incident explanation", () => {
  it("invokes the explain-incident capability with the chosen model", async () => {
    let body: unknown;
    server.use(
      http.post("/api/ai/invoke", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { summary: "s", facts: [], interpretation: [], confidence: "high", actionDrafts: [], droppedDrafts: 0, model: "m", generatedAt: 1 } });
      }),
    );
    expect((await explainIncident("observe", "o1", { modelId: "m1" })).confidence).toBe("high");
    expect(body).toEqual({ capability: "explain-incident", input: { source: "observe", incidentId: "o1" }, modelId: "m1" });
  });
});

describe("isSystemDatabase", () => {
  it("recognises ClickHouse's own databases in any case", () => {
    expect(isSystemDatabase("system")).toBe(true);
    expect(isSystemDatabase("INFORMATION_SCHEMA")).toBe(true);
    expect(isSystemDatabase("information_schema")).toBe(true);
    expect(isSystemDatabase("shop")).toBe(false);
    expect(isSystemDatabase("system_logs")).toBe(false);
    expect(isSystemDatabase(null)).toBe(false);
  });
});

describe("lineage node ids", () => {
  it("round-trips table nodes", () => {
    expect(tableNode("shop", "orders")).toBe("table:shop.orders");
    expect(parseTableNode("table:shop.orders.v2")).toEqual({ database: "shop", table: "orders.v2" });
  });

  it("returns null for non-table or malformed nodes", () => {
    expect(parseTableNode("kafka_topic:orders")).toBeNull();
    expect(parseTableNode("table:noDot")).toBeNull();
    expect(parseTableNode(null)).toBeNull();
  });
});
