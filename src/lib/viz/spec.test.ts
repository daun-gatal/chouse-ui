import { describe, expect, it } from "vitest";

import fixture from "../../../packages/server/src/services/dashboards/spec.fixture.json";
import { appendBelow, overlaps, rowsToPx, shiftDown, sizeLimits, soloSize, vizSpecProblems, vizSpecSchema } from "./spec";

describe("canvas geometry (server: spec.ts and layout.ts)", () => {
  it("converts rows to pixels with 32 px rows and 8 px gaps", () => {
    expect(rowsToPx(1)).toBe(32);
    expect(rowsToPx(9)).toBe(352);
  });

  it("places a new panel under everything", () => {
    expect(appendBelow([{ x: 0, y: 0, w: 12, h: 9 }, { x: 12, y: 4, w: 12, h: 9 }], { w: 30, h: 9 })).toEqual({ x: 0, y: 13, w: 24, h: 9 });
    expect(shiftDown([{ layout: { x: 3, y: 1, w: 4, h: 4 }, k: 1 }], 10)).toEqual([{ layout: { x: 3, y: 11, w: 4, h: 4 }, k: 1 }]);
  });

  it("sizes a lone chart by its role, never under its minimum", () => {
    expect(soloSize("stat")).toEqual({ w: 6, h: 4 });
    expect(soloSize("table")).toEqual({ w: 24, h: 10 });
    expect(soloSize("area")).toEqual({ w: 24, h: 9 });
    expect(soloSize("donut")).toEqual({ w: 12, h: 9 });
    for (const type of ["stat", "table", "line", "pie", "histogram"] as const) {
      const size = soloSize(type);
      const limits = sizeLimits("chart", type);
      expect(size.w >= limits.minW && size.h >= limits.minH).toBe(true);
    }
  });

  it("knows overlap", () => {
    expect(overlaps({ x: 0, y: 0, w: 12, h: 9 }, { x: 12, y: 0, w: 12, h: 9 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 13, h: 9 }, { x: 12, y: 0, w: 12, h: 9 })).toBe(true);
  });
});

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
