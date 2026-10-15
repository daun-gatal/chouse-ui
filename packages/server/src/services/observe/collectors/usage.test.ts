import { describe, expect, it } from "bun:test";

import { LOG_FLUSH_LAG_MS, mergeShapeDay, SHAPE_BACKFILL_STEP_DAYS, SHAPE_WINDOW_DAYS, shapePlan } from "./usage";

const DAY = 24 * 3600 * 1000;
const STEP = SHAPE_BACKFILL_STEP_DAYS * DAY;
const NOW = 1_800_000_000_000;
const UNTIL = NOW - LOG_FLUSH_LAG_MS;
const RUN = 15 * 60 * 1000;

describe("usage shapes plan", () => {
  it("starts with the newest days on the first run", () => {
    expect(shapePlan(0, 0, NOW, UNTIL)).toEqual({ windows: [{ from: UNTIL - STEP, to: UNTIL }], high: UNTIL, low: UNTIL - STEP, reset: false });
  });

  it("then reads what is new and fills in one older step per run until it spans 30 days", () => {
    let { high, low } = shapePlan(0, 0, NOW, UNTIL);
    const covered: Array<{ from: number; to: number }> = [{ from: low, to: high }];
    let now = NOW;
    for (let run = 0; run < 20; run++) {
      now += RUN;
      const plan = shapePlan(high, low, now, now - LOG_FLUSH_LAG_MS);
      expect(plan.reset).toBe(false);
      for (const w of plan.windows) expect(w.to - w.from).toBeLessThanOrEqual(STEP);
      covered.push(...plan.windows);
      ({ high, low } = plan);
    }
    expect(high).toBe(now - LOG_FLUSH_LAG_MS);
    // Ten 3-day steps in: the rollups span the full 30 days.
    expect(low).toBeLessThanOrEqual(now - SHAPE_WINDOW_DAYS * DAY);
    // The windows never overlap (rollups add up) and leave no gap.
    const sorted = [...covered].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].from).toBe(sorted[i - 1].to);
  });

  it("only reads new rows once 30 days are covered", () => {
    const low = NOW - SHAPE_WINDOW_DAYS * DAY;
    const plan = shapePlan(UNTIL - RUN, low, NOW, UNTIL);
    expect(plan.windows).toEqual([{ from: UNTIL - RUN, to: UNTIL }]);
    expect(plan.low).toBe(low);
  });

  it("restarts from the newest step after a pause longer than a step, instead of one long read", () => {
    const plan = shapePlan(UNTIL - 10 * DAY, UNTIL - 40 * DAY, NOW, UNTIL);
    expect(plan).toEqual({ windows: [{ from: UNTIL - STEP, to: UNTIL }], high: UNTIL, low: UNTIL - STEP, reset: true });
  });

  it("reads nothing new when run again within the flush lag", () => {
    const plan = shapePlan(UNTIL, NOW - SHAPE_WINDOW_DAYS * DAY, NOW, UNTIL);
    expect(plan.windows).toEqual([]);
  });
});

describe("mergeShapeDay", () => {
  it("adds runs and rows, keeps the larger user count and the first sample", () => {
    const merged = mergeShapeDay(
      { runs: 30, users: 4, p95Ms: 100, readRowsSum: 3000, sample: "SELECT a" },
      { runs: 10, users: 6, p95Ms: 300, readRowsSum: 500, sample: "SELECT b" },
    );
    expect(merged).toEqual({ runs: 40, users: 6, p95Ms: 150, readRowsSum: 3500, sample: "SELECT a" });
  });

  it("takes the new window as is when nothing is stored", () => {
    const add = { runs: 5, users: 1, p95Ms: 12, readRowsSum: 50, sample: null };
    expect(mergeShapeDay(undefined, add)).toEqual(add);
    expect(mergeShapeDay({ runs: 0, users: 0, p95Ms: 0, readRowsSum: 0, sample: null }, add)).toEqual(add);
  });

  it("fills a missing sample from the new window", () => {
    expect(mergeShapeDay({ runs: 1, users: 1, p95Ms: 1, readRowsSum: 1, sample: null }, { runs: 1, users: 1, p95Ms: 1, readRowsSum: 1, sample: "SELECT x" }).sample).toBe("SELECT x");
  });
});
