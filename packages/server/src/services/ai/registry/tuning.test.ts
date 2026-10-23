import { describe, expect, it } from "bun:test";

import { DEFAULT_STEP_BUDGET, normalizeTuning } from "./tuning";

describe("normalizeTuning", () => {
  it("gives rows written before ADR 0024 the runtime defaults", () => {
    expect(normalizeTuning({ stepBudget: 8, recursionLimit: null, timeoutMs: 60_000, maxOutputTokens: null })).toEqual({
      stepBudget: 8,
      recursionLimit: null,
      timeoutMs: 60_000,
      maxOutputTokens: null,
      fallbackModelConfigId: null,
      modelRetries: null,
      toolRetries: null,
      maxModelCalls: null,
      maxToolCalls: null,
      promptCaching: true,
      clearOldToolResults: false,
      forkedSubagents: [],
      memory: false,
    });
  });

  it("keeps runtime settings and drops values of the wrong type", () => {
    const t = normalizeTuning({
      stepBudget: -1,
      fallbackModelConfigId: "  ",
      modelRetries: 2,
      toolRetries: "3",
      maxToolCalls: 40,
      promptCaching: false,
      clearOldToolResults: true,
      forkedSubagents: ["a", 7, "a", "b"],
    });
    expect(t.stepBudget).toBe(DEFAULT_STEP_BUDGET);
    expect(t.fallbackModelConfigId).toBeNull();
    expect(t.modelRetries).toBe(2);
    expect(t.toolRetries).toBeNull();
    expect(t.maxToolCalls).toBe(40);
    expect(t.promptCaching).toBe(false);
    expect(t.clearOldToolResults).toBe(true);
    expect(t.forkedSubagents).toEqual(["a", "b"]);
  });

  it("turns memory on only when it is exactly true", () => {
    expect(normalizeTuning({ stepBudget: 5, memory: true }).memory).toBe(true);
    expect(normalizeTuning({ stepBudget: 5, memory: "yes" }).memory).toBe(false);
    expect(normalizeTuning({ stepBudget: 5 }).memory).toBe(false);
  });
});
