import { describe, expect, it } from "vitest";

import { buildPricing, EMPTY_PRICING_DRAFT, pricingDraftFrom, pricingSummary } from "./pricing";

describe("buildPricing", () => {
  it("treats an all-empty form as no price", () => {
    expect(buildPricing(EMPTY_PRICING_DRAFT)).toEqual({ pricing: null });
    expect(buildPricing({ input: " ", output: "", cacheRead: "", cacheWrite: "" })).toEqual({ pricing: null });
  });

  it("builds a price, leaving empty cache prices out so they fall back to input", () => {
    expect(buildPricing({ input: "3", output: "15", cacheRead: "0.3", cacheWrite: "" })).toEqual({ pricing: { input: 3, output: 15, cacheRead: 0.3 } });
  });

  it("accepts a free model", () => {
    expect(buildPricing({ input: "0", output: "0", cacheRead: "", cacheWrite: "" })).toEqual({ pricing: { input: 0, output: 0 } });
  });

  it("needs both input and output once any price is set", () => {
    expect(buildPricing({ input: "3", output: "", cacheRead: "", cacheWrite: "" })).toEqual({ error: expect.stringContaining("both") });
    expect(buildPricing({ input: "", output: "", cacheRead: "1", cacheWrite: "" })).toEqual({ error: expect.stringContaining("both") });
  });

  it("rejects negative, non-numeric and implausible prices", () => {
    expect(buildPricing({ input: "-1", output: "1", cacheRead: "", cacheWrite: "" })).toEqual({ error: expect.stringContaining("Input") });
    expect(buildPricing({ input: "1", output: "abc", cacheRead: "", cacheWrite: "" })).toEqual({ error: expect.stringContaining("Output") });
    expect(buildPricing({ input: "1", output: "1", cacheRead: "", cacheWrite: "20000" })).toEqual({ error: expect.stringContaining("too high") });
  });
});

describe("pricingDraftFrom / pricingSummary", () => {
  it("round-trips a stored price", () => {
    const pricing = { input: 2.5, output: 10, cacheWrite: 3.125 };
    expect(buildPricing(pricingDraftFrom(pricing))).toEqual({ pricing });
    expect(pricingDraftFrom(null)).toEqual(EMPTY_PRICING_DRAFT);
  });

  it("summarizes input and output prices", () => {
    expect(pricingSummary({ input: 3, output: 15 })).toBe("$3 / $15");
    expect(pricingSummary({ input: 2.5, output: 10 })).toBe("$2.5 / $10");
    expect(pricingSummary({ input: 0.15, output: 0.6 })).toBe("$0.15 / $0.6");
    expect(pricingSummary(null)).toBeNull();
  });
});
