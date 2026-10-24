import { describe, expect, it } from "bun:test";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { AppError } from "../../../types";
import { normalizeTuning } from "../registry/tuning";
import { isTransientError, runtimeMiddleware } from "./middleware";

const names = (tuning: Record<string, unknown>, fallback = false): string[] =>
  runtimeMiddleware({ tuning: normalizeTuning({ stepBudget: 8, ...tuning }), fallback: fallback ? new FakeListChatModel({ responses: ["x"] }) : null }).map((m) => m.name);

describe("isTransientError", () => {
  it("retries network, timeout, overload and rate-limit errors", () => {
    for (const message of ["fetch failed", "Request timed out", "ECONNRESET", "429 Too Many Requests", "Overloaded", "Code: 202. TOO_MANY_SIMULTANEOUS_QUERIES", "503 Service Unavailable"]) {
      expect(isTransientError(new Error(message))).toBe(true);
    }
  });

  it("never retries our own errors, aborts, validation errors or non-errors", () => {
    expect(isTransientError(new AppError("timeout while blocked", "GUARDRAIL_BLOCKED", "validation", 422))).toBe(false);
    const abort = new Error("network aborted");
    abort.name = "AbortError";
    expect(isTransientError(abort)).toBe(false);
    expect(isTransientError(new Error("Unknown column 'x'"))).toBe(false);
    expect(isTransientError("timeout")).toBe(false);
  });
});

describe("runtimeMiddleware", () => {
  it("adds nothing for an agent with default settings", () => {
    expect(names({})).toEqual([]);
  });

  it("puts the fallback outside the retries and adds each configured cap", () => {
    expect(names({ modelRetries: 2, toolRetries: 1, maxModelCalls: 20, maxToolCalls: 30, clearOldToolResults: true }, true)).toEqual([
      "modelFallbackMiddleware",
      "modelRetryMiddleware",
      "ModelCallLimitMiddleware",
      "ToolCallLimitMiddleware",
      "toolRetryMiddleware",
      "ContextEditingMiddleware",
    ]);
  });

  it("skips zero retries", () => {
    expect(names({ modelRetries: 0, toolRetries: 0 })).toEqual([]);
  });

  it("replaces DeepAgents' caching middleware by name when caching is off", () => {
    expect(names({ promptCaching: false })).toEqual(["PromptCachingMiddleware", "CacheBreakpointMiddleware", "BedrockPromptCachingMiddleware"]);
  });
});
