import { describe, it, expect } from "bun:test";

import {
  validateReadOnlySelect,
  extractTokenNames,
  buildExecutableQuery,
  toDateTime64Param,
} from "./validation";

describe("validateReadOnlySelect", () => {
  it("accepts a plain SELECT", () => {
    expect(validateReadOnlySelect("SELECT count() FROM events").ok).toBe(true);
  });

  it("accepts a SELECT that references known window tokens", () => {
    const res = validateReadOnlySelect(
      "SELECT count() FROM events WHERE t >= {{slot_start}} AND t < {{slot_end}}",
    );
    expect(res.ok).toBe(true);
    expect(res.tokens.sort()).toEqual(["slot_end", "slot_start"]);
  });

  it("rejects writes", () => {
    expect(validateReadOnlySelect("INSERT INTO t VALUES (1)").ok).toBe(false);
    expect(validateReadOnlySelect("ALTER TABLE t ADD COLUMN x Int32").ok).toBe(false);
    expect(validateReadOnlySelect("DROP TABLE t").ok).toBe(false);
  });

  it("rejects multiple statements", () => {
    expect(validateReadOnlySelect("SELECT 1; SELECT 2").ok).toBe(false);
  });

  it("fails closed on an unknown token", () => {
    const res = validateReadOnlySelect("SELECT 1 WHERE x = {{evil_token}}");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("evil_token");
  });

  it("rejects empty input", () => {
    expect(validateReadOnlySelect("   ").ok).toBe(false);
  });
});

describe("extractTokenNames", () => {
  it("returns distinct token names", () => {
    expect(extractTokenNames("a {{slot_start}} b {{slot_start}} {{slot_end}}").sort()).toEqual([
      "slot_end",
      "slot_start",
    ]);
  });
});

describe("buildExecutableQuery", () => {
  it("rewrites tokens to native DateTime64 params and reports them", () => {
    const { sql, params } = buildExecutableQuery(
      "SELECT 1 WHERE t >= {{slot_start}} AND t < {{slot_end}}",
    );
    expect(sql).toContain("{sq_slot_start:DateTime64(3, 'UTC')}");
    expect(sql).toContain("{sq_slot_end:DateTime64(3, 'UTC')}");
    expect(sql).not.toContain("{{");
    expect(params.sort()).toEqual(["sq_slot_end", "sq_slot_start"]);
  });

  it("leaves a token-free query unchanged", () => {
    const { sql, params } = buildExecutableQuery("SELECT 1");
    expect(sql).toBe("SELECT 1");
    expect(params).toEqual([]);
  });
});

describe("toDateTime64Param", () => {
  it("renders a UTC millisecond instant ClickHouse can parse", () => {
    expect(toDateTime64Param(Date.parse("2026-06-20T08:00:00.000Z"))).toBe("2026-06-20 08:00:00.000");
  });
});
