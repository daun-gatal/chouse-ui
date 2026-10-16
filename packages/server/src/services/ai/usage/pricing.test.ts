import { describe, expect, it } from "bun:test";

import { costOf, normalizeTokenUsage, normalizeUsageMetadata, usageFromResult, ZERO_USAGE } from "./pricing";

describe("normalizeUsageMetadata", () => {
  it("reads LangChain usage with cache details (Anthropic shape: input includes cache)", () => {
    // @langchain/anthropic reports input = uncached + cache_creation + cache_read.
    expect(normalizeUsageMetadata({
      input_tokens: 1_000,
      output_tokens: 200,
      total_tokens: 1_200,
      input_token_details: { cache_read: 600, cache_creation: 100 },
    })).toEqual({ input: 1_000, output: 200, cacheRead: 600, cacheWrite: 100 });
  });

  it("bills Google thinking tokens, which only appear in total_tokens", () => {
    expect(normalizeUsageMetadata({ input_tokens: 100, output_tokens: 50, total_tokens: 400 }))
      .toEqual({ input: 100, output: 300, cacheRead: 0, cacheWrite: 0 });
  });

  it("never lowers output below output_tokens when total is smaller", () => {
    expect(normalizeUsageMetadata({ input_tokens: 100, output_tokens: 50, total_tokens: 120 })?.output).toBe(50);
  });

  it("clamps cache counts to the input they are part of", () => {
    expect(normalizeUsageMetadata({
      input_tokens: 100,
      output_tokens: 1,
      input_token_details: { cache_read: 90, cache_creation: 50 },
    })).toEqual({ input: 100, output: 1, cacheRead: 90, cacheWrite: 10 });
  });

  it("returns null when the provider reported nothing usable", () => {
    expect(normalizeUsageMetadata(undefined)).toBeNull();
    expect(normalizeUsageMetadata({})).toBeNull();
    expect(normalizeUsageMetadata({ input_tokens: 10 })).toBeNull();
    expect(normalizeUsageMetadata({ input_tokens: -1, output_tokens: 3 })).toBeNull();
    expect(normalizeUsageMetadata({ input_tokens: Number.NaN, output_tokens: 3 })).toBeNull();
    expect(normalizeUsageMetadata([1, 2])).toBeNull();
  });

  it("accepts a reported zero (a call that really used no tokens)", () => {
    expect(normalizeUsageMetadata({ input_tokens: 0, output_tokens: 0 })).toEqual(ZERO_USAGE);
  });
});

describe("usageFromResult", () => {
  it("prefers the message's usage_metadata", () => {
    const result = {
      generations: [[{ message: { usage_metadata: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } } }]],
      llmOutput: { tokenUsage: { promptTokens: 999, completionTokens: 999 } },
    };
    expect(usageFromResult(result)).toEqual({ input: 5, output: 7, cacheRead: 0, cacheWrite: 0 });
  });

  it("falls back to llmOutput.tokenUsage", () => {
    const result = { generations: [[{ text: "x" }]], llmOutput: { tokenUsage: { promptTokens: 11, completionTokens: 4 } } };
    expect(usageFromResult(result)).toEqual({ input: 11, output: 4, cacheRead: 0, cacheWrite: 0 });
    expect(normalizeTokenUsage({ promptTokens: 1 })).toBeNull();
  });

  it("returns null without generations or usage", () => {
    expect(usageFromResult(null)).toBeNull();
    expect(usageFromResult({ generations: [] })).toBeNull();
    expect(usageFromResult({ generations: [[{ message: {} }]] })).toBeNull();
  });
});

describe("costOf", () => {
  it("is null without a price — unknown, never zero", () => {
    expect(costOf({ input: 1_000, output: 1_000, cacheRead: 0, cacheWrite: 0 }, null)).toBeNull();
  });

  it("charges uncached input, output and cache at their own rates", () => {
    const usage = { input: 1_000_000, output: 500_000, cacheRead: 400_000, cacheWrite: 100_000 };
    // uncached 500k × $3 + read 400k × $0.30 + write 100k × $3.75 + out 500k × $15
    const cost = costOf(usage, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    expect(cost).toBeCloseTo(1.5 + 0.12 + 0.375 + 7.5, 10);
  });

  it("charges cache at the input rate when no cache price is set", () => {
    const usage = { input: 2_000_000, output: 0, cacheRead: 1_000_000, cacheWrite: 0 };
    expect(costOf(usage, { input: 2, output: 8 })).toBeCloseTo(4, 10);
  });

  it("is zero for a free (self-hosted) model", () => {
    expect(costOf({ input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, { input: 0, output: 0 })).toBe(0);
  });
});
