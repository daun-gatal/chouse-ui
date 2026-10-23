import { describe, expect, it } from "bun:test";

import { cacheSavings } from "./queries";

describe("cacheSavings", () => {
  it("prices cached reads at the difference between input and cache-read rates", () => {
    expect(cacheSavings([
      { cache_read: 2_000_000, pricing: JSON.stringify({ input: 3, output: 15, cacheRead: 0.3 }) },
      { cache_read: 1_000_000, pricing: { input: 1, output: 2, cacheRead: 0.1 } },
    ])).toBeCloseTo(2 * 2.7 + 0.9, 6);
  });

  it("is null when no model with cached reads has a cache-read price", () => {
    expect(cacheSavings([])).toBeNull();
    expect(cacheSavings([{ cache_read: 100, pricing: JSON.stringify({ input: 3, output: 15 }) }, { cache_read: 100, pricing: null }, { cache_read: 5, pricing: "{bad" }])).toBeNull();
  });

  it("never counts a cache-read price above the input price as negative savings", () => {
    expect(cacheSavings([{ cache_read: 1_000_000, pricing: { input: 1, output: 1, cacheRead: 2 } }])).toBe(0);
  });
});
