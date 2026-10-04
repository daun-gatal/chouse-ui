import { describe, expect, it } from "bun:test";

import { DEFAULT_AGENT_POLICY, decideBudget, formatBytes, type BudgetInput } from "./budget";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

const base: BudgetInput = {
  policy: DEFAULT_AGENT_POLICY,
  estimates: [{ table: "shop.orders", estimatedBytes: 2 * GiB, markRatio: 0.1, totalBytes: 40 * GiB }],
  usedTodayBytes: 0,
  health: [],
  paused: false,
};

describe("decideBudget", () => {
  it("allows when no limits apply", () => {
    expect(decideBudget(base)).toEqual({ decision: "allow", estimatedBytes: 2 * GiB, reasons: [], notices: [] });
  });

  it("blocks over the per-query and daily limits", () => {
    const perQuery = decideBudget({ ...base, policy: { ...base.policy, maxBytesPerQuery: GiB } });
    expect(perQuery.decision).toBe("block");
    expect(perQuery.reasons[0]).toContain("per-query limit of 1.0 GiB");
    const daily = decideBudget({ ...base, usedTodayBytes: 499 * GiB, policy: { ...base.policy, dailyBytes: 500 * GiB } });
    expect(daily.decision).toBe("block");
    expect(daily.reasons[0]).toContain("Daily budget");
  });

  it("requires a partition filter on large tables", () => {
    const fullScan = { ...base, estimates: [{ table: "events.page_views", estimatedBytes: 1.2 * TiB, markRatio: 1, totalBytes: 1.2 * TiB }] };
    expect(decideBudget({ ...fullScan, policy: { ...base.policy, partitionFilterBytes: TiB } }).decision).toBe("block");
    expect(decideBudget({ ...fullScan, policy: { ...base.policy, partitionFilterBytes: 2 * TiB } }).decision).toBe("allow");
  });

  it("warns (or blocks, per policy) on tables with open critical incidents and attaches notices", () => {
    const incident = { ...base, health: [{ table: "analytics.orders_daily", state: "stale" as const, reason: "No writes for 1.8h", openIncident: { id: "INC-1", severity: "critical" as const, summary: "orders_daily is stale" } }] };
    const warned = decideBudget(incident);
    expect(warned.decision).toBe("warn");
    expect(warned.notices[0].message).toContain("say so in the answer");
    expect(decideBudget({ ...incident, policy: { ...base.policy, incidentMode: "block" } }).decision).toBe("block");
    expect(decideBudget({ ...incident, policy: { ...base.policy, incidentMode: "off" } }).decision).toBe("warn");
  });

  it("blocks everything while access is paused", () => {
    expect(decideBudget({ ...base, paused: true }).decision).toBe("block");
  });
});

describe("formatBytes", () => {
  it("formats binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1.5 * GiB)).toBe("1.5 GiB");
    expect(formatBytes(200 * GiB)).toBe("200 GiB");
  });
});
