import { describe, expect, it } from "bun:test";

import { evaluateDataHealth, robustBounds } from "./evaluator";
import type { DataHealthCheckDefinition } from "./types";

const rowCount = (severity: "warning" | "critical" = "warning"): DataHealthCheckDefinition => ({
  checkKey: "rows",
  name: "Rows",
  type: "row_count",
  severity,
  enabled: true,
  config: { min: 100, max: 200 },
});

describe("robustBounds", () => {
  it("uses a visible minimum relative band when historical values are constant", () => {
    expect(robustBounds([100, 100, 100], 3, 0.1)).toEqual({ lower: 90, upper: 110, median: 100, mad: 0 });
  });
});

describe("evaluateDataHealth", () => {
  it("derives degraded and unhealthy from check severity", () => {
    expect(evaluateDataHealth([rowCount()], { rows: 50 }).state).toBe("degraded");
    expect(evaluateDataHealth([rowCount("critical")], { rows: 50 }).state).toBe("unhealthy");
  });

  it("keeps missing numeric results separate from a breach", () => {
    const result = evaluateDataHealth([rowCount()], { rows: null });
    expect(result.state).toBe("unknown");
    expect(result.checks[0].outcome).toBe("not_evaluated");
  });

  it("learns an anomaly baseline before declaring dynamic breaches", () => {
    const check: DataHealthCheckDefinition = {
      checkKey: "volume",
      name: "Volume",
      type: "volume_anomaly",
      severity: "warning",
      enabled: true,
      config: { minSamples: 3, sensitivity: 3, minRelativeBand: 0.1 },
    };
    expect(evaluateDataHealth([check], { volume: 50 }, { volume: [100, 100] }).checks[0].outcome).toBe("learning");
    expect(evaluateDataHealth([check], { volume: 50 }, { volume: [100, 100, 100] }).checks[0].outcome).toBe("breach");
  });

  it("enforces a hard bound while an anomaly baseline is learning", () => {
    const check: DataHealthCheckDefinition = {
      checkKey: "volume",
      name: "Volume",
      type: "volume_anomaly",
      severity: "critical",
      enabled: true,
      config: { minSamples: 7, sensitivity: 3, minRelativeBand: 0.1, hardMin: 80 },
    };
    expect(evaluateDataHealth([check], { volume: 50 }).checks[0].outcome).toBe("breach");
  });

  it("evaluates repeated checks independently", () => {
    const checks: DataHealthCheckDefinition[] = [
      { checkKey: "complete_customer", name: "Customer", type: "completeness", severity: "warning", enabled: true, config: { column: "customer_id", minRatio: 0.99 } },
      { checkKey: "complete_email", name: "Email", type: "completeness", severity: "critical", enabled: true, config: { column: "email", minRatio: 0.9 } },
      { checkKey: "valid_amount", name: "Amount", type: "validity", severity: "warning", enabled: true, config: { predicate: "amount >= 0", minRatio: 1 } },
      { checkKey: "refunds", name: "Refunds", type: "custom_metric", severity: "warning", enabled: true, config: { expression: "countIf(refunded)", operator: "lte", threshold: 5 } },
    ];
    const result = evaluateDataHealth(checks, {
      complete_customer: 1,
      complete_email: 0.8,
      valid_amount: 1,
      refunds: 2,
    });

    expect(result.checks.map((check) => [check.checkKey, check.outcome])).toEqual([
      ["complete_customer", "pass"],
      ["complete_email", "breach"],
      ["valid_amount", "pass"],
      ["refunds", "pass"],
    ]);
    expect(result.state).toBe("unhealthy");
  });
});
