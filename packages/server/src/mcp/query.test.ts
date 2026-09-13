import { describe, expect, it } from "bun:test";
import { classifyReadSql } from "./tools/query";

describe("classifyReadSql", () => {
  it("allows SELECT statements", () => {
    expect(classifyReadSql("SELECT * FROM t")).toEqual({ allowed: true });
  });

  it("allows WITH CTEs", () => {
    expect(classifyReadSql("WITH x AS (SELECT 1) SELECT * FROM x")).toEqual({ allowed: true });
  });

  it("allows SHOW and DESCRIBE", () => {
    expect(classifyReadSql("SHOW TABLES")).toEqual({ allowed: true });
    expect(classifyReadSql("DESCRIBE TABLE t")).toEqual({ allowed: true });
  });

  it("allows EXPLAIN", () => {
    expect(classifyReadSql("EXPLAIN SELECT * FROM t")).toEqual({ allowed: true });
  });

  it("allows surrounding whitespace and a trailing semicolon", () => {
    expect(classifyReadSql("  SELECT 1 ;")).toEqual({ allowed: true });
  });

  it("rejects empty input", () => {
    const result = classifyReadSql("   ");
    expect(result.allowed).toBe(false);
  });

  it("rejects writes (INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/KILL/OPTIMIZE)", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET x = 1",
      "DELETE FROM t",
      "ALTER TABLE t ADD COLUMN c Int32",
      "CREATE TABLE t (id Int32) ENGINE = MergeTree",
      "DROP TABLE t",
      "TRUNCATE TABLE t",
      "KILL QUERY WHERE query_id = 'x'",
      "OPTIMIZE TABLE t FINAL",
    ]) {
      const result = classifyReadSql(sql);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeTruthy();
    }
  });

  it("rejects multi-statement input", () => {
    const result = classifyReadSql("SELECT 1; DROP TABLE t");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/multi-statement/i);
  });

  it("rejects unknown statements (fail closed)", () => {
    const result = classifyReadSql("SYSTEM FLUSH LOGS");
    expect(result.allowed).toBe(false);
  });
});
