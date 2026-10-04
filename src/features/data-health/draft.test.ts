import { describe, expect, it } from "vitest";

import { draftToFormPatch } from "./draft";

describe("draftToFormPatch", () => {
  it("keeps the scheduled-query handoff as an event-triggered promise", () => {
    expect(draftToFormPatch({ databaseName: "shop", tableName: "orders", upstreamJobId: "job-1" })).toEqual({
      name: "shop.orders is healthy",
      databaseName: "shop",
      tableName: "orders",
      frequency: "event",
      upstreamJobId: "job-1",
    });
  });

  it("maps an hourly suggestion to an hourly cron with exactly its checks", () => {
    const patch = draftToFormPatch({
      databaseName: "marketing",
      tableName: "campaign_spend",
      name: "campaign_spend stays fresh",
      criticality: "critical",
      frequency: "hourly",
      checks: [{ checkKey: "freshness", type: "freshness", config: { eventTimeColumn: "spend_date", maxAgeSeconds: 93_600 } }],
    });
    expect(patch).toMatchObject({
      name: "campaign_spend stays fresh",
      criticality: "critical",
      frequency: "cron",
      cronExpr: "0 * * * *",
      eventTimeColumn: "spend_date",
      freshness: true,
      freshnessMinutes: 1560,
      rowCount: false,
      anomaly: false,
      schemaContract: false,
    });
  });

  it("maps every rule type and the new distribution check", () => {
    const patch = draftToFormPatch({
      databaseName: "events",
      tableName: "page_views",
      frequency: "daily",
      checks: [
        { checkKey: "rows", type: "row_count", config: { min: 10 } },
        { checkKey: "vol", type: "volume_anomaly", config: {} },
        { checkKey: "schema", type: "schema_contract", config: { allowAdditionalColumns: false } },
        { checkKey: "c1", type: "completeness", config: { column: "country", minRatio: 0.995 } },
        { checkKey: "u1", type: "uniqueness", config: { columns: ["id", 3], maxDuplicateRatio: 0.01 } },
        { checkKey: "v1", type: "validity", name: "Positive price", config: { predicate: "price >= 0", minRatio: 0.9 } },
        { checkKey: "m1", type: "custom_metric", name: "Paid", config: { expression: "countIf(paid)", operator: "between", threshold: 1, upperThreshold: 9 } },
        { checkKey: "d1", type: "distribution", config: { column: "price_usd", statistic: "p50", tolerance: 3, minSamples: 7 } },
        { checkKey: "x", type: "not_a_check", config: {} },
      ],
    });
    expect(patch.frequency).toBe("daily");
    expect(patch.rowCount).toBe(true);
    expect(patch.rowCountMin).toBe("10");
    expect(patch.anomaly).toBe(true);
    expect(patch.allowAdditionalColumns).toBe(false);
    expect(patch.completenessRules).toEqual([{ checkKey: "c1", column: "country", minPercent: 99.5 }]);
    expect(patch.uniquenessRules).toEqual([{ checkKey: "u1", columns: ["id"], maxDuplicatePercent: 1 }]);
    expect(patch.validityRules?.[0]).toMatchObject({ name: "Positive price", minPercent: 90 });
    expect(patch.customMetricRules?.[0]).toMatchObject({ operator: "between", threshold: 1, upperThreshold: 9 });
    expect(patch.distributionRules).toEqual([{ checkKey: "d1", column: "price_usd", statistic: "p50", topValue: "", tolerance: 3, minSamples: 7 }]);
  });

  it("falls back to safe defaults for malformed values", () => {
    const patch = draftToFormPatch({
      databaseName: "a",
      tableName: "b",
      checks: [
        { type: "custom_metric", config: { operator: "nope" } },
        { type: "distribution", config: { statistic: "mode" } },
      ],
    });
    expect(patch.customMetricRules?.[0]).toMatchObject({ checkKey: "custom_metric", operator: "gte", name: "Custom metric" });
    expect(patch.distributionRules?.[0]).toMatchObject({ statistic: "p50", tolerance: 3, minSamples: 7 });
  });
});
