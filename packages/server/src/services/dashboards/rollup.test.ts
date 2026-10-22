import { describe, expect, it } from "bun:test";

import { analyzeRollup, readsRollup, rollupTarget } from "./rollup";

const BASE = "SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, status, count() AS n, sum(bytes) AS b, uniqExact(user_id) AS u FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} AND env = 'prod' AND shard != 3 GROUP BY t, status ORDER BY t";

describe("analyzeRollup", () => {
  it("reads an eligible panel into a typed plan", () => {
    expect(analyzeRollup(BASE)).toEqual({
      ok: true,
      plan: {
        database: "shop",
        table: "orders",
        timeColumn: "ts",
        bucketAlias: "t",
        groups: [{ column: "status", alias: "status" }],
        aggregates: [{ fn: "count", column: null, alias: "n" }, { fn: "sum", column: "bytes", alias: "b" }, { fn: "uniqExact", column: "user_id", alias: "u" }],
        filters: [{ column: "env", op: "=", value: "prod" }, { column: "shard", op: "!=", value: 3 }],
      },
    });
  });

  it("gives the first reason a panel is not eligible", () => {
    const cases: Array<[string, string]> = [
      ["SELECT ts AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "it has no toStartOfInterval(<time column>, INTERVAL {{interval_s}} SECOND) bucket"],
      ["SELECT toStartOfInterval(ts, INTERVAL 60 SECOND) AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "its bucket must be toStartOfInterval(<time column>, INTERVAL {{interval_s}} SECOND)"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM shop.orders o JOIN shop.users u ON o.uid = u.id WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "it reads more than one table (JOIN)"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "its table must be written as database.table"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, quantile(0.9)(ms) AS p FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "its SQL could not be parsed as one simple SELECT"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, median(ms) AS p FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "median in the select list is not one of count, sum, min, max, avg, uniqExact on a plain column"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} GROUP BY t", "it is not bounded by <time column> >= {{from}} AND <time column> < {{to}}"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} AND x LIKE 'a%' GROUP BY t", "its WHERE uses LIKE; only =, !=, <, <=, > and >= are supported"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} AND (a = 1 OR b = 2) GROUP BY t", "its WHERE uses OR; only conditions joined by AND are supported"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} AND name = {{var.name}} GROUP BY t", "it uses dashboard variables, which a rollup cannot pre-aggregate"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, status, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "its GROUP BY must list the bucket and every plain column it selects"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count(id) AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "count must be count() (count(column) skips NULLs the rollup cannot tell apart)"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, sum(a + b) AS s FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t", "sum must take one plain column"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, count() AS n FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t HAVING n > 1", "it uses HAVING"],
      ["SELECT toStartOfInterval(ts, INTERVAL {{interval_s}} SECOND) AS t, status FROM shop.orders WHERE ts >= {{from}} AND ts < {{to}} GROUP BY t, status", "it computes no aggregates"],
    ];
    for (const [sql, reason] of cases) expect(analyzeRollup(sql)).toEqual({ ok: false, reason });
  });

  it("names the rollup after the plan, and recognises a panel that reads one", () => {
    const a = analyzeRollup(BASE);
    const b = analyzeRollup(BASE.replace("env = 'prod'", "env = 'dev'"));
    if (!a.ok || !b.ok) throw new Error("expected eligible");
    expect(rollupTarget(a.plan)).toMatch(/^chouse_rollup_[0-9a-f]{12}$/);
    expect(rollupTarget(a.plan)).toBe(rollupTarget(a.plan));
    expect(rollupTarget(a.plan)).not.toBe(rollupTarget(b.plan));
    expect(readsRollup(`SELECT 1 FROM shop.${rollupTarget(a.plan)}`)).toBe(true);
    expect(readsRollup("SELECT 1 FROM shop.orders")).toBe(false);
  });
});
