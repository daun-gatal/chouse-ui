/**
 * Agent tuning: step budget and limits (ADR 0019) plus the runtime settings of
 * ADR 0024 (fallback model, retries, call caps, prompt caching, context
 * editing, forked subagents, memory). Stored as one JSON column; every reader goes
 * through `normalizeTuning`, so rows written before ADR 0024 get the defaults.
 */

import type { AgentTuning } from "./types";

export const DEFAULT_STEP_BUDGET = 10;

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeTuning(value: Record<string, unknown>): AgentTuning {
  const stepBudget = typeof value.stepBudget === "number" && value.stepBudget > 0 ? value.stepBudget : DEFAULT_STEP_BUDGET;
  const forked = Array.isArray(value.forkedSubagents) ? value.forkedSubagents.filter((id): id is string => typeof id === "string") : [];
  return {
    stepBudget,
    recursionLimit: optionalNumber(value.recursionLimit),
    timeoutMs: optionalNumber(value.timeoutMs),
    maxOutputTokens: optionalNumber(value.maxOutputTokens),
    fallbackModelConfigId: optionalString(value.fallbackModelConfigId),
    modelRetries: optionalNumber(value.modelRetries),
    toolRetries: optionalNumber(value.toolRetries),
    maxModelCalls: optionalNumber(value.maxModelCalls),
    maxToolCalls: optionalNumber(value.maxToolCalls),
    promptCaching: value.promptCaching !== false,
    clearOldToolResults: value.clearOldToolResults === true,
    forkedSubagents: [...new Set(forked)],
    memory: value.memory === true,
  };
}
