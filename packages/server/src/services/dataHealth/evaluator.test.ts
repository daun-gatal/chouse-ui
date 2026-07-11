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
});

