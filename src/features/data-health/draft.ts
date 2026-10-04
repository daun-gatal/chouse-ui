/**
 * Pre-filled PromiseWizard drafts. Three sources open the wizard with a draft
 * instead of a blank form: the Scheduled Query "protect the output table"
 * handoff (ADR 0006), accepted monitoring suggestions and compiled
 * plain-language watchers (ADR 0016 §5, §11). Every draft stays editable; the
 * wizard still validates and previews before activation.
 */

import type { DataHealthCriticality, DataHealthDistributionStatistic, DataHealthFrequency } from "@/api/dataHealth";
import type { CompletenessRule, CustomMetricRule, DistributionRule, UniquenessRule, ValidityRule } from "./RuleEditors";

export interface PromiseWizardDraft {
  databaseName: string;
  tableName: string;
  /** Event-triggered: evaluate after this scheduled query succeeds. */
  upstreamJobId?: string;
  name?: string;
  criticality?: DataHealthCriticality;
  frequency?: "hourly" | "daily";
  eventTimeColumn?: string;
  /** Check definitions in the server shape (suggestions, watchers). */
  checks?: Array<Record<string, unknown>>;
}

/** The wizard form fields a draft may set (names match the wizard's FormState). */
export interface DraftFormPatch {
  name: string;
  databaseName: string;
  tableName: string;
  criticality?: DataHealthCriticality;
  frequency?: DataHealthFrequency;
  cronExpr?: string;
  upstreamJobId?: string;
  eventTimeColumn?: string;
  freshness?: boolean;
  freshnessMinutes?: number;
  rowCount?: boolean;
  rowCountMin?: string;
  rowCountMax?: string;
  anomaly?: boolean;
  schemaContract?: boolean;
  allowAdditionalColumns?: boolean;
  completenessRules?: CompletenessRule[];
  uniquenessRules?: UniquenessRule[];
  validityRules?: ValidityRule[];
  customMetricRules?: CustomMetricRule[];
  distributionRules?: DistributionRule[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const OPERATORS: ReadonlyArray<CustomMetricRule["operator"]> = ["gt", "gte", "lt", "lte", "eq", "between"];
const STATISTICS: ReadonlyArray<DataHealthDistributionStatistic> = ["p50", "p95", "null_ratio", "distinct_ratio", "top_share"];

function operatorOf(value: unknown): CustomMetricRule["operator"] {
  return OPERATORS.find((operator) => operator === value) ?? "gte";
}

function statisticOf(value: unknown): DataHealthDistributionStatistic {
  return STATISTICS.find((statistic) => statistic === value) ?? "p50";
}

/** Maps a draft onto wizard form fields. Unknown check types are skipped. */
export function draftToFormPatch(draft: PromiseWizardDraft): DraftFormPatch {
  const patch: DraftFormPatch = {
    name: draft.name ?? `${draft.databaseName}.${draft.tableName} is healthy`,
    databaseName: draft.databaseName,
    tableName: draft.tableName,
  };
  if (draft.criticality) patch.criticality = draft.criticality;
  if (draft.upstreamJobId) {
    patch.frequency = "event";
    patch.upstreamJobId = draft.upstreamJobId;
  } else if (draft.frequency === "hourly") {
    patch.frequency = "cron";
    patch.cronExpr = "0 * * * *";
  } else if (draft.frequency === "daily") {
    patch.frequency = "daily";
  }
  if (draft.eventTimeColumn) patch.eventTimeColumn = draft.eventTimeColumn;
  if (!draft.checks) return patch;

  // A draft with checks replaces the wizard's default toggles with exactly its checks.
  Object.assign(patch, {
    freshness: false,
    rowCount: false,
    anomaly: false,
    schemaContract: false,
    completenessRules: [],
    uniquenessRules: [],
    validityRules: [],
    customMetricRules: [],
    distributionRules: [],
  });
  for (const raw of draft.checks) {
    const check = record(raw);
    const config = record(check.config);
    const key = text(check.checkKey) || text(check.type);
    switch (check.type) {
      case "freshness":
        patch.freshness = true;
        patch.freshnessMinutes = Math.max(1, Math.round(numberOr(config.maxAgeSeconds, 3600) / 60));
        if (!patch.eventTimeColumn && text(config.eventTimeColumn)) patch.eventTimeColumn = text(config.eventTimeColumn);
        break;
      case "row_count":
        patch.rowCount = true;
        patch.rowCountMin = typeof config.min === "number" ? String(config.min) : "";
        patch.rowCountMax = typeof config.max === "number" ? String(config.max) : "";
        break;
      case "volume_anomaly":
        patch.anomaly = true;
        break;
      case "schema_contract":
        patch.schemaContract = true;
        patch.allowAdditionalColumns = config.allowAdditionalColumns !== false;
        break;
      case "completeness":
        patch.completenessRules?.push({ checkKey: key, column: text(config.column), minPercent: numberOr(config.minRatio, 0.999) * 100 });
        break;
      case "uniqueness":
        patch.uniquenessRules?.push({ checkKey: key, columns: Array.isArray(config.columns) ? config.columns.filter((c): c is string => typeof c === "string") : [], maxDuplicatePercent: numberOr(config.maxDuplicateRatio, 0) * 100 });
        break;
      case "validity":
        patch.validityRules?.push({ checkKey: key, name: text(check.name) || "Business-rule validity", predicate: text(config.predicate), minPercent: numberOr(config.minRatio, 0.99) * 100 });
        break;
      case "custom_metric":
        patch.customMetricRules?.push({ checkKey: key, name: text(check.name) || "Custom metric", expression: text(config.expression), operator: operatorOf(config.operator), threshold: numberOr(config.threshold, 0), upperThreshold: numberOr(config.upperThreshold, 0) });
        break;
      case "distribution":
        patch.distributionRules?.push({ checkKey: key, column: text(config.column), statistic: statisticOf(config.statistic), topValue: text(config.topValue), tolerance: numberOr(config.tolerance, 3), minSamples: numberOr(config.minSamples, 7) });
        break;
      default:
        break;
    }
  }
  return patch;
}
