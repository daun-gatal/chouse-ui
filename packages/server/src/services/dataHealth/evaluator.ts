import type {
  DataHealthCheckDefinition,
  DataHealthEvaluationResult,
  DataHealthMetricEvaluation,
} from "./types";

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export interface RobustBounds {
  lower: number;
  upper: number;
  median: number;
  mad: number;
}

export function robustBounds(values: number[], sensitivity: number, minRelativeBand: number): RobustBounds | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const center = median(finite);
  const mad = median(finite.map((value) => Math.abs(value - center)));
  const statisticalBand = sensitivity * 1.4826 * mad;
  const relativeBand = Math.abs(center) * minRelativeBand;
  const band = Math.max(statisticalBand, relativeBand, Number.EPSILON);
  return { lower: center - band, upper: center + band, median: center, mad };
}

function staticEvaluation(
  check: DataHealthCheckDefinition,
  observedValue: number,
): Pick<DataHealthMetricEvaluation, "outcome" | "expectedLower" | "expectedUpper" | "message"> {
  switch (check.type) {
    case "freshness": {
      const pass = observedValue <= check.config.maxAgeSeconds;
      return { outcome: pass ? "pass" : "breach", expectedLower: null, expectedUpper: check.config.maxAgeSeconds, message: pass ? "Freshness is within the promised delay" : "Data is older than the promised delay" };
    }
    case "row_count": {
      const pass = (check.config.min == null || observedValue >= check.config.min) && (check.config.max == null || observedValue <= check.config.max);
      return { outcome: pass ? "pass" : "breach", expectedLower: check.config.min ?? null, expectedUpper: check.config.max ?? null, message: pass ? "Row volume is within bounds" : "Row volume is outside its configured bounds" };
    }
    case "completeness": {
      const pass = observedValue >= check.config.minRatio;
      return { outcome: pass ? "pass" : "breach", expectedLower: check.config.minRatio, expectedUpper: 1, message: pass ? "Column completeness is within bounds" : "Column completeness is below its minimum" };
    }
    case "uniqueness": {
      const pass = observedValue <= check.config.maxDuplicateRatio;
      return { outcome: pass ? "pass" : "breach", expectedLower: 0, expectedUpper: check.config.maxDuplicateRatio, message: pass ? "Duplicate ratio is within bounds" : "Duplicate ratio exceeds its maximum" };
    }
    case "validity": {
      const pass = observedValue >= check.config.minRatio;
      return { outcome: pass ? "pass" : "breach", expectedLower: check.config.minRatio, expectedUpper: 1, message: pass ? "Valid-row ratio is within bounds" : "Valid-row ratio is below its minimum" };
    }
    case "custom_metric": {
      const upper = check.config.upperThreshold ?? null;
      const pass = check.config.operator === "gt" ? observedValue > check.config.threshold
        : check.config.operator === "gte" ? observedValue >= check.config.threshold
          : check.config.operator === "lt" ? observedValue < check.config.threshold
            : check.config.operator === "lte" ? observedValue <= check.config.threshold
              : check.config.operator === "eq" ? observedValue === check.config.threshold
                : upper != null && observedValue >= check.config.threshold && observedValue <= upper;
      return {
        outcome: pass ? "pass" : "breach",
        expectedLower: ["gt", "gte", "eq", "between"].includes(check.config.operator) ? check.config.threshold : null,
        expectedUpper: ["lt", "lte", "eq"].includes(check.config.operator) ? check.config.threshold : upper,
        message: pass ? "Custom metric satisfies its expectation" : "Custom metric violates its expectation",
      };
    }
    case "schema_contract":
    case "volume_anomaly":
      return { outcome: "not_evaluated", expectedLower: null, expectedUpper: null, message: "Check requires specialized evaluation" };
  }
}

export function evaluateDataHealth(
  checks: DataHealthCheckDefinition[],
  observed: Record<string, unknown>,
  history: Record<string, number[]> = {},
): DataHealthEvaluationResult {
  const evaluations: DataHealthMetricEvaluation[] = [];

  for (const check of checks.filter((item) => item.enabled)) {
    const value = numeric(observed[check.checkKey]);
    if (check.type === "schema_contract") {
      evaluations.push({ checkKey: check.checkKey, type: check.type, severity: check.severity, outcome: "not_evaluated", observedValue: null, expectedLower: null, expectedUpper: null, message: "Schema is evaluated before metric execution" });
      continue;
    }
    if (value == null) {
      evaluations.push({ checkKey: check.checkKey, type: check.type, severity: check.severity, outcome: "not_evaluated", observedValue: null, expectedLower: null, expectedUpper: null, message: "The metric returned no numeric value" });
      continue;
    }

    if (check.type === "volume_anomaly") {
      const values = (history[check.checkKey] ?? []).filter(Number.isFinite);
      const hardBreach = (check.config.hardMin != null && value < check.config.hardMin)
        || (check.config.hardMax != null && value > check.config.hardMax);
      if (values.length < check.config.minSamples) {
        evaluations.push({
          checkKey: check.checkKey,
          type: check.type,
          severity: check.severity,
          outcome: hardBreach ? "breach" : "learning",
          observedValue: value,
          expectedLower: check.config.hardMin ?? null,
          expectedUpper: check.config.hardMax ?? null,
          message: hardBreach ? "Volume violates a hard bound while the baseline is learning" : `Learning baseline (${values.length}/${check.config.minSamples} samples)`,
        });
        continue;
      }
      const bounds = robustBounds(values, check.config.sensitivity, check.config.minRelativeBand);
      const lower = Math.max(0, check.config.hardMin == null ? (bounds?.lower ?? 0) : Math.max(bounds?.lower ?? 0, check.config.hardMin));
      const upper = check.config.hardMax == null ? (bounds?.upper ?? value) : Math.min(bounds?.upper ?? check.config.hardMax, check.config.hardMax);
      const pass = value >= lower && value <= upper;
      evaluations.push({ checkKey: check.checkKey, type: check.type, severity: check.severity, outcome: pass ? "pass" : "breach", observedValue: value, expectedLower: lower, expectedUpper: upper, message: pass ? "Volume is within its learned range" : "Volume is outside its learned range" });
      continue;
    }

    const result = staticEvaluation(check, value);
    evaluations.push({ checkKey: check.checkKey, type: check.type, severity: check.severity, observedValue: value, ...result });
  }

  const breaches = evaluations.filter((check) => check.outcome === "breach");
  const hasEvaluated = evaluations.some((check) => check.outcome === "pass" || check.outcome === "breach");
  const state = breaches.some((check) => check.severity === "critical")
    ? "unhealthy"
    : breaches.length > 0
      ? "degraded"
      : hasEvaluated
        ? "healthy"
        : "unknown";
  return { state, checks: evaluations };
}

