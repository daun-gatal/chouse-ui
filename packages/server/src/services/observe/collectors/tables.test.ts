import { describe, expect, it } from "bun:test";

import { CADENCE_DAYS, MAX_WRITE_TIMES, mergeWriteTimes } from "./tables";

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

describe("mergeWriteTimes", () => {
  it("merges overlapping reads without double counting, ascending", () => {
    expect(mergeWriteTimes([NOW - 3000, NOW - 2000], [NOW - 2000, NOW - 1000], NOW)).toEqual([NOW - 3000, NOW - 2000, NOW - 1000]);
  });

  it("drops times older than the cadence window", () => {
    expect(mergeWriteTimes([NOW - CADENCE_DAYS * DAY - 1, NOW - DAY], [], NOW)).toEqual([NOW - DAY]);
  });

  it("keeps the most recent times when there are too many", () => {
    const stored = Array.from({ length: MAX_WRITE_TIMES }, (_, i) => NOW - (MAX_WRITE_TIMES - i) * 1000);
    const merged = mergeWriteTimes(stored, [NOW], NOW);
    expect(merged).toHaveLength(MAX_WRITE_TIMES);
    expect(merged[merged.length - 1]).toBe(NOW);
    expect(merged[0]).toBe(stored[1]);
  });

  it("ignores values that are not times", () => {
    expect(mergeWriteTimes([Number.NaN], [NOW], NOW)).toEqual([NOW]);
  });
});
