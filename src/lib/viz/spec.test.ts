import { describe, expect, it } from "vitest";

import fixture from "../../../packages/server/src/services/dashboards/spec.fixture.json";
import { vizSpecProblems, vizSpecSchema } from "./spec";

describe("vizSpecSchema (shared fixture with the server)", () => {
  for (const { name, spec } of fixture.valid) {
    it(`accepts ${name}`, () => {
      expect(vizSpecProblems(spec)).toEqual([]);
    });
  }
  for (const { name, spec } of fixture.invalid) {
    it(`rejects ${name}`, () => {
      expect(vizSpecSchema.safeParse(spec).success).toBe(false);
    });
  }
});

describe("vizSpecProblems", () => {
  it("prefixes field errors with their path and keeps shape errors plain", () => {
    const problems = vizSpecProblems({ version: 2, type: "stat", x: null, y: ["v"], series: null, unit: "kb", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null });
    expect(problems.some((p) => p.startsWith("unit:"))).toBe(true);
  });

  it("reports why a stat panel cannot be drawn", () => {
    expect(vizSpecProblems({ version: 2, type: "stat", x: null, y: ["v"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null }))
      .toEqual(["a stat panel needs a reduce (last, max, min, avg or sum)"]);
  });
});
