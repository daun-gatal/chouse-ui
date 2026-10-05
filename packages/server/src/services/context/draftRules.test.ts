import { describe, expect, it } from "bun:test";

import { clip, normalizeTags, redactQueryLiterals, tableStem, validMetricExpression, validMetrics } from "./draftRules";

const COLUMNS = new Set(["amount", "status", "user_id", "created_at", "order id"]);

describe("context draft guards", () => {
  it("blanks literals in logged queries before they reach the model", () => {
    expect(redactQueryLiterals("SELECT * FROM t WHERE email = 'a@b.co' AND id = 1234567 AND n = 12")).toBe("SELECT * FROM t WHERE email = '?' AND id = ? AND n = 12");
    expect(redactQueryLiterals("x".repeat(1000))).toHaveLength(600);
  });

  it("groups naming variants by stem", () => {
    expect(tableStem("orders_v1")).toBe("orders");
    expect(tableStem("orders_old")).toBe("orders");
    expect(tableStem("Orders_20240101")).toBe("orders");
    expect(tableStem("orders")).toBe("orders");
    expect(tableStem("order_items")).toBe("order_items");
  });

  it("accepts single aggregates over the table's own columns", () => {
    expect(validMetricExpression("sum(amount)", COLUMNS)).toBe(true);
    expect(validMetricExpression("sumIf(amount, status = 'paid')", COLUMNS)).toBe(true);
    expect(validMetricExpression("uniqExact(user_id)", COLUMNS)).toBe(true);
    expect(validMetricExpression("count(`order id`)", COLUMNS)).toBe(true);
    expect(validMetricExpression("countIf(status IN ('a', 'b') AND amount IS NOT NULL)", COLUMNS)).toBe(true);
  });

  it("rejects unknown columns, statements and non-aggregates", () => {
    expect(validMetricExpression("sum(price)", COLUMNS)).toBe(false);
    expect(validMetricExpression("amount", COLUMNS)).toBe(false);
    expect(validMetricExpression("sum(amount); DROP TABLE t", COLUMNS)).toBe(false);
    expect(validMetricExpression("(SELECT max(amount) FROM other)", COLUMNS)).toBe(false);
    expect(validMetricExpression("sum(amount) -- comment", COLUMNS)).toBe(false);
    expect(validMetricExpression("count(`secret`)", COLUMNS)).toBe(false);
    expect(validMetricExpression("", COLUMNS)).toBe(false);
  });

  it("keeps at most three valid, new metrics and counts the rest as dropped", () => {
    const result = validMetrics([
      { name: "gmv", expression: "sum(amount)", description: " Paid value " },
      { name: "gmv", expression: "sum(amount)", description: null },
      { name: "orders", expression: "count()", description: null },
      { name: "bad name", expression: "sum(amount)", description: null },
      { name: "extra", expression: "count()", description: null },
    ], COLUMNS, new Set(["orders"]));
    expect(result.metrics).toEqual([{ name: "gmv", expression: "sum(amount)", description: "Paid value" }]);
    expect(result.dropped).toBe(4);
  });

  it("normalises tags and text fields", () => {
    expect(normalizeTags([" Finance ", "finance", "event stream", "!!", "pii"])).toEqual(["finance", "event-stream", "pii"]);
    expect(clip("  hi  ", 10)).toBe("hi");
    expect(clip("   ", 10)).toBeNull();
    expect(clip(null, 10)).toBeNull();
    expect(clip("abcdef", 3)).toBe("abc");
  });
});
