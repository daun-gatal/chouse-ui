import { describe, expect, it } from "bun:test";

import { classifySqlChange } from "./data";

const tierOf = (sql: string): string => {
  const change = classifySqlChange(sql);
  return "error" in change ? "refused" : `${change.tier} ${change.route}`;
};

describe("SQL changes are tiered by statement type (ADR 0025)", () => {
  it("asks once for creating and inserting", () => {
    expect(tierOf("INSERT INTO db.t VALUES (1)")).toBe("t2 /api/query/table/insert");
    expect(tierOf("CREATE TABLE db.t (a UInt8) ENGINE = MergeTree ORDER BY a")).toBe("t2 /api/query/table/create");
    expect(tierOf("CREATE DATABASE db")).toBe("t2 /api/query/database/create");
  });

  it("needs a second approver for anything that alters, removes or replaces", () => {
    expect(tierOf("ALTER TABLE db.t DELETE WHERE 1")).toBe("t3 /api/query/table/alter");
    expect(tierOf("DROP TABLE db.t")).toBe("t3 /api/query/table/drop");
    expect(tierOf("DROP DATABASE db")).toBe("t3 /api/query/database/drop");
    expect(tierOf("TRUNCATE TABLE db.t")).toBe("t3 /api/query/table/truncate");
    expect(tierOf("CREATE OR REPLACE TABLE db.t (a UInt8) ENGINE = Memory")).toBe("t3 /api/query/table/create");
  });

  it("refuses several statements, reads and anything it does not recognise", () => {
    expect(tierOf("INSERT INTO a VALUES (1); DROP TABLE b")).toBe("refused");
    expect(tierOf("SELECT 1")).toBe("refused");
    expect(tierOf("GRANT ALL ON *.* TO x")).toBe("refused");
    expect(tierOf("CREATE FUNCTION f AS x -> x")).toBe("refused");
    expect(tierOf("")).toBe("refused");
  });
});
