import { describe, expect, it } from "bun:test";

import { compileSql, intervalFor, RELATIVE_ALIGN_SECONDS, resolveWindow, scanMacros, referencedVariables } from "./macros";
import type { Variable } from "./spec";

const WINDOW = { from: 1_700_000_000, to: 1_700_021_600, intervalSeconds: 300 };
const DB: Variable = { name: "db", label: "Database", kind: "identifier", options: { source: "static", values: ["default", "orders"] }, default: "default" };
const USER: Variable = { name: "user", label: "User", kind: "string", options: { source: "static", values: ["etl"] }, default: "etl" };

describe("scanMacros", () => {
  it("finds macros in order", () => {
    const scan = scanMacros("SELECT {{interval_s}} FROM t WHERE ts >= {{from}} AND u = {{ var.user }}");
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.tokens.map((t) => t.macro)).toEqual([{ kind: "interval" }, { kind: "from" }, { kind: "var", name: "user" }]);
    expect(referencedVariables(scan.tokens)).toEqual(["user"]);
  });

  it("rejects macros inside strings, quoted identifiers and comments", () => {
    expect(scanMacros("SELECT '{{from}}'")).toEqual({ ok: false, error: expect.stringContaining("quoted string") });
    expect(scanMacros("SELECT `{{from}}`")).toEqual({ ok: false, error: expect.stringContaining("quoted identifier") });
    expect(scanMacros("SELECT 1 -- {{from}}")).toEqual({ ok: false, error: expect.stringContaining("comment") });
    expect(scanMacros("SELECT 1 /* {{from}} */")).toEqual({ ok: false, error: expect.stringContaining("comment") });
  });

  it("allows braces and escaped quotes in strings", () => {
    expect(scanMacros("SELECT '{a}', 'it''s', 'x\\'y', {{to}}").ok).toBe(true);
  });

  it("rejects unknown, unclosed and malformed macros", () => {
    expect(scanMacros("SELECT {{slot_start}}")).toEqual({ ok: false, error: expect.stringContaining("Unknown macro") });
    expect(scanMacros("SELECT {{var.Bad}}")).toEqual({ ok: false, error: expect.stringContaining("Unknown macro") });
    expect(scanMacros("SELECT {{from")).toEqual({ ok: false, error: expect.stringContaining("not closed") });
    expect(scanMacros("SELECT 'open")).toEqual({ ok: false, error: expect.stringContaining("not closed") });
    expect(scanMacros("SELECT 1 /* open")).toEqual({ ok: false, error: expect.stringContaining("not closed") });
  });
});

describe("compileSql", () => {
  it("compiles to native parameters, never concatenation", () => {
    const result = compileSql(
      "SELECT count() FROM {{var.db}}.events WHERE ts >= {{from}} AND ts < {{to}} AND user = {{var.user}} GROUP BY toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND)",
      [DB, USER],
      { db: "orders", user: "x' OR 1=1 --" },
      WINDOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.sql).toBe(
      "SELECT count() FROM {v_db:Identifier}.events WHERE ts >= {chouse_from:DateTime} AND ts < {chouse_to:DateTime} AND user = {v_user:String} GROUP BY toStartOfInterval(ts, INTERVAL {chouse_interval_s:UInt32} SECOND)",
    );
    expect(result.compiled.params).toEqual({ v_db: "orders", chouse_from: WINDOW.from, chouse_to: WINDOW.to, v_user: "x' OR 1=1 --", chouse_interval_s: 300 });
    expect(result.compiled.validationSql).toBe(
      "SELECT count() FROM `orders`.events WHERE ts >= now() AND ts < now() AND user = '' GROUP BY toStartOfInterval(ts, INTERVAL 300 SECOND)",
    );
  });

  it("refuses an identifier value that is not an identifier", () => {
    const result = compileSql("SELECT * FROM {{var.db}}.t", [DB], { db: "orders; DROP TABLE x" }, WINDOW);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("must be an identifier") });
  });

  it("refuses undeclared variables and missing values", () => {
    expect(compileSql("SELECT {{var.nope}}", [DB], {}, WINDOW)).toEqual({ ok: false, error: expect.stringContaining("is not a variable") });
    expect(compileSql("SELECT * FROM {{var.db}}.t", [DB], {}, WINDOW)).toEqual({ ok: false, error: expect.stringContaining("has no value") });
  });

  it("passes SQL without macros through", () => {
    expect(compileSql("SELECT 1", [], {}, WINDOW)).toEqual({ ok: true, compiled: { sql: "SELECT 1", params: {}, validationSql: "SELECT 1" } });
  });
});

describe("windows", () => {
  it("picks about 120 buckets from the step list", () => {
    expect(intervalFor(900)).toBe(10);
    expect(intervalFor(21_600)).toBe(300);
    expect(intervalFor(2_592_000)).toBe(21_600);
    expect(intervalFor(400 * 86_400)).toBe(86_400);
  });

  it("aligns relative ranges so viewers in one window share a query", () => {
    const a = resolveWindow({ kind: "relative", value: "6h" }, 1_700_000_010_000);
    const b = resolveWindow({ kind: "relative", value: "6h" }, 1_700_000_025_000);
    expect(a).toEqual(b);
    expect(a.to % RELATIVE_ALIGN_SECONDS).toBe(0);
    expect(a.to - a.from).toBe(21_600);
  });

  it("keeps absolute ranges exact", () => {
    expect(resolveWindow({ kind: "absolute", from: 100, to: 3_700 }, 0)).toEqual({ from: 100, to: 3_700, intervalSeconds: 30 });
  });
});
