import { describe, expect, it } from "bun:test";

import fixture from "./spec.fixture.json";
import { dashboardInputSchema, timeRangeSchema, variableSchema, vizSpecSchema } from "./spec";

const LINE = { version: 1, type: "line", x: "t", y: ["v"], series: null, unit: "ms", decimals: null, thresholds: [], colorScheme: "violet", reduce: null };

function dashboard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Orders",
    description: "",
    timeRange: "6h",
    refreshSeconds: 60,
    connectionScope: { kind: "any" },
    variables: [],
    panels: [{ id: null, title: "Rows", sql: "SELECT 1 AS t, 2 AS v", viz: LINE, width: 6, height: "m", fleet: false }],
    ...overrides,
  };
}

describe("vizSpecSchema (shared fixture)", () => {
  for (const { name, spec } of fixture.valid) {
    it(`accepts ${name}`, () => {
      const result = vizSpecSchema.safeParse(spec);
      expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([]);
    });
  }
  for (const { name, spec } of fixture.invalid) {
    it(`rejects ${name}`, () => {
      expect(vizSpecSchema.safeParse(spec).success).toBe(false);
    });
  }
});

describe("variableSchema", () => {
  it("accepts a string variable with static options", () => {
    expect(variableSchema.safeParse({ name: "user", label: "User", kind: "string", options: { source: "static", values: ["a", "b"] }, default: "a" }).success).toBe(true);
  });

  it("accepts an identifier variable fed by a query", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "identifier", options: { source: "query", sql: "SELECT name FROM system.databases" }, default: "default" }).success).toBe(true);
  });

  it("rejects an identifier default that is not an identifier", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["default"] }, default: "a b" }).success).toBe(false);
  });

  it("rejects identifier options that are not identifiers", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["ok", "drop table x"] }, default: "ok" }).success).toBe(false);
  });

  it("rejects an unknown kind and a bad name", () => {
    expect(variableSchema.safeParse({ name: "db", label: "Database", kind: "connection", options: { source: "static", values: ["a"] }, default: "a" }).success).toBe(false);
    expect(variableSchema.safeParse({ name: "Db", label: "Database", kind: "string", options: { source: "static", values: ["a"] }, default: "a" }).success).toBe(false);
  });
});

describe("timeRangeSchema", () => {
  it("accepts relative and absolute ranges", () => {
    expect(timeRangeSchema.safeParse({ kind: "relative", value: "24h" }).success).toBe(true);
    expect(timeRangeSchema.safeParse({ kind: "absolute", from: 1_700_000_000, to: 1_700_003_600 }).success).toBe(true);
  });

  it("rejects a backwards, an unknown and an over-long range", () => {
    expect(timeRangeSchema.safeParse({ kind: "absolute", from: 10, to: 5 }).success).toBe(false);
    expect(timeRangeSchema.safeParse({ kind: "relative", value: "5h" }).success).toBe(false);
    expect(timeRangeSchema.safeParse({ kind: "absolute", from: 1, to: 1 + 401 * 86_400 }).success).toBe(false);
  });
});

describe("dashboardInputSchema", () => {
  it("accepts a dashboard", () => {
    expect(dashboardInputSchema.safeParse(dashboard()).success).toBe(true);
  });

  it("rejects duplicate variable names and duplicate panel ids", () => {
    const v = { name: "db", label: "DB", kind: "identifier", options: { source: "static", values: ["a"] }, default: "a" };
    expect(dashboardInputSchema.safeParse(dashboard({ variables: [v, v] })).success).toBe(false);
    const id = "4b2c8a7e-3b8f-4a5e-9c1d-0e6f7a8b9c0d";
    const panel = { id, title: "Rows", sql: "SELECT 1", viz: LINE, width: 6, height: "m", fleet: false };
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [panel, panel] })).success).toBe(false);
  });

  it("rejects an unknown width, refresh, range or field", () => {
    const panel = { id: null, title: "Rows", sql: "SELECT 1", viz: LINE, width: 5, height: "m", fleet: false };
    expect(dashboardInputSchema.safeParse(dashboard({ panels: [panel] })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ refreshSeconds: 10 })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ timeRange: "90m" })).success).toBe(false);
    expect(dashboardInputSchema.safeParse(dashboard({ theme: "dark" })).success).toBe(false);
  });

  it("takes all connections or a non-empty list of distinct ones, nothing else", () => {
    const ok = (connectionScope: unknown): boolean => dashboardInputSchema.safeParse(dashboard({ connectionScope })).success;
    expect(ok({ kind: "any" })).toBe(true);
    expect(ok({ kind: "only", connectionIds: ["c1", "c2"] })).toBe(true);
    expect(ok({ kind: "only", connectionIds: [] })).toBe(false);
    expect(ok({ kind: "only", connectionIds: ["c1", "c1"] })).toBe(false);
    expect(ok({ kind: "any", connectionIds: ["c1"] })).toBe(false);
    expect(ok({ kind: "some" })).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
});
