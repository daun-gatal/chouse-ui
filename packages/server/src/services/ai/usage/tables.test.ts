import { describe, expect, it } from "bun:test";

import { tablesOf } from "./tables";

describe("tablesOf", () => {
  it.each([
    ["SELECT name, type FROM system.columns WHERE database = 'x' AND table = 'y'", "db", ["system.columns"]],
    ["SELECT * FROM t1 JOIN db2.t2 USING id JOIN t1 x USING id", "db1", ["db1.t1", "db2.t2"]],
    ["SELECT a.id FROM t1 AS a INNER JOIN db2.t2 AS b ON a.id = b.id", "d", ["d.t1", "db2.t2"]],
    ["SELECT count() FROM `my-db`.`events` WHERE dt > now() - INTERVAL 1 DAY", null, ["my-db.events"]],
    ['SELECT 1 FROM "Quoted"."Name"', null, ["Quoted.Name"]],
    ["WITH x AS (SELECT * FROM db.a), y AS (SELECT 1) SELECT * FROM x JOIN y ON 1", null, ["db.a"]],
    ["SELECT * FROM numbers(10)", "d", []],
    ["SELECT * FROM (SELECT id FROM db.inner_t) AS s", null, ["db.inner_t"]],
    ["SELECT extract(DAY FROM created_at), trim(BOTH ' ' FROM name) FROM db.users", null, ["db.users"]],
    ["SELECT tag FROM db.events ARRAY JOIN tags AS tag", null, ["db.events"]],
    ["SELECT 'FROM fake' AS s FROM real_t -- FROM commented\n/* JOIN other */", "d", ["d.real_t"]],
    ["DESCRIBE TABLE db.t", null, ["db.t"]],
    ["SHOW CREATE TABLE events", "analytics", ["analytics.events"]],
    ["SELECT version()", "d", []],
    ["SELECT * FROM t1", null, ["default.t1"]],
    ["SELECT * FROM t WHERE id IN (SELECT id FROM db.other)", "d", ["d.t", "db.other"]],
  ])("%s", (sql, db, expected) => {
    expect(tablesOf(sql, db)).toEqual(expected);
  });

  it("never throws on garbage", () => {
    expect(tablesOf("this is not sql ((", "db")).toEqual([]);
    expect(tablesOf("", null)).toEqual([]);
    expect(tablesOf("SELECT * FROM", null)).toEqual([]);
  });
});
