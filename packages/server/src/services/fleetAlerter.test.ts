import { describe, it, expect } from "bun:test";
import { evaluateNode } from "./fleetAlerter";

// Minimal rules object; only partsEtaMin matters for these cases (others off).
const rules = (partsEtaMin: number) => ({
  memoryPercent: 0,
  queryMemoryGb: 0,
  longQueryMin: 0,
  partsEtaMin,
});

const partsRow = (over: Partial<Record<string, number | string>> = {}) => ({
  database: "default",
  table: "events",
  active_parts: 240,
  max_parts_in_partition: 240,
  rows: 1_000_000,
  bytes: 5_000_000,
  merges_running: 0,
  insert_parts_per_min: 24,
  merge_parts_per_min: 0,
  parts_threshold: 300,
  net_parts_per_min: 24,
  eta_minutes: 2.5,
  ...over,
});

describe("fleetAlerter evaluateNode — parts pressure", () => {
  it("does not emit a parts rule when partsEtaMin is 0 (off)", () => {
    const out = evaluateNode({ parts_pressure: [partsRow()] }, rules(0));
    expect(out.find((r) => r.ruleKey === "partspressure")).toBeUndefined();
  });

  it("breaches when a diverging table's ETA is under the threshold", () => {
    const out = evaluateNode({ parts_pressure: [partsRow({ eta_minutes: 2.5 })] }, rules(60));
    const r = out.find((r) => r.ruleKey === "partspressure");
    expect(r).toBeDefined();
    expect(r?.breaching).toBe(true);
    expect(r?.clearing).toBe(false);
    expect(r?.instanceId).toBe("default.events");
    expect(r?.metric).toBe("parts pressure");
  });

  it("clears when the table is converging (net rate <= 0)", () => {
    const out = evaluateNode(
      { parts_pressure: [partsRow({ net_parts_per_min: -5, eta_minutes: -1 })] },
      rules(60),
    );
    const r = out.find((r) => r.ruleKey === "partspressure");
    expect(r?.breaching).toBe(false);
    expect(r?.clearing).toBe(true);
  });

  it("holds the latch inside the hysteresis band (between threshold and 1.25x)", () => {
    // partsEtaMin=60 → ETA 70 is above threshold but below the 75 clear point.
    const out = evaluateNode({ parts_pressure: [partsRow({ eta_minutes: 70 })] }, rules(60));
    const r = out.find((r) => r.ruleKey === "partspressure");
    expect(r?.breaching).toBe(false);
    expect(r?.clearing).toBe(false);
  });

  it("clears once ETA climbs past the 1.25x hysteresis point", () => {
    const out = evaluateNode({ parts_pressure: [partsRow({ eta_minutes: 90 })] }, rules(60));
    const r = out.find((r) => r.ruleKey === "partspressure");
    expect(r?.breaching).toBe(false);
    expect(r?.clearing).toBe(true);
  });

  it("latches each table independently via instanceId", () => {
    const out = evaluateNode(
      {
        parts_pressure: [
          partsRow({ eta_minutes: 2 }),
          { ...partsRow(), table: "logs", eta_minutes: 1000, net_parts_per_min: 24 },
        ],
      },
      rules(60),
    );
    const parts = out.filter((r) => r.ruleKey === "partspressure");
    expect(parts).toHaveLength(2);
    expect(parts.map((r) => r.instanceId).sort()).toEqual(["default.events", "default.logs"]);
    expect(parts.find((r) => r.instanceId === "default.events")?.breaching).toBe(true);
    expect(parts.find((r) => r.instanceId === "default.logs")?.breaching).toBe(false);
  });
});
