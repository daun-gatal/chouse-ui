import { describe, expect, it } from "bun:test";

import { parseDdl, referencesColumn, referencesTable } from "./parse";

describe("parseDdl", () => {
  it("parses ALTER with several column commands and ON CLUSTER", () => {
    const parsed = parseDdl(`
      -- finance asked for gross vs net amounts
      ALTER TABLE shop.orders_raw ON CLUSTER prod
        RENAME COLUMN amount TO amount_gross,
        ADD COLUMN coupon Nullable(String) DEFAULT NULL,
        MODIFY COLUMN duration Float64 CODEC(ZSTD(1)),
        DROP COLUMN IF EXISTS legacy;`);
    expect(parsed).toEqual({
      kind: "alter",
      database: "shop",
      table: "orders_raw",
      onCluster: "prod",
      changes: [
        { op: "rename_column", column: "amount", to: "amount_gross" },
        { op: "add_column", column: "coupon", type: "Nullable(String)" },
        { op: "modify_column", column: "duration", type: "Float64" },
        { op: "drop_column", column: "legacy" },
      ],
    });
  });

  it("keeps commas inside types and settings out of the command split", () => {
    const parsed = parseDdl("ALTER TABLE t ADD COLUMN m Map(String, UInt64), MODIFY SETTING index_granularity = 8192");
    expect(parsed.kind).toBe("alter");
    if (parsed.kind !== "alter") return;
    expect(parsed.changes).toEqual([
      { op: "add_column", column: "m", type: "Map(String, UInt64)" },
      { op: "other", text: "MODIFY SETTING index_granularity = 8192" },
    ]);
  });

  it("parses table-level statements with quoting", () => {
    expect(parseDdl("DROP TABLE IF EXISTS `shop`.`orders raw`")).toEqual({ kind: "drop_table", database: "shop", table: "orders raw", onCluster: null });
    expect(parseDdl("RENAME TABLE a.b TO a.c ON CLUSTER x")).toEqual({ kind: "rename_table", database: "a", table: "b", toDatabase: "a", toTable: "c", onCluster: "x" });
    expect(parseDdl("TRUNCATE TABLE events")).toEqual({ kind: "truncate", database: null, table: "events", onCluster: null });
    expect(parseDdl("EXCHANGE TABLES a.x AND a.y")).toMatchObject({ kind: "exchange_tables", table: "x", otherTable: "y" });
    expect(parseDdl("DROP DATABASE IF EXISTS staging")).toEqual({ kind: "drop_database", database: "staging", onCluster: null });
  });

  it("reports anything else as unknown", () => {
    expect(parseDdl("CREATE TABLE x (a UInt8) ENGINE = Memory").kind).toBe("unknown");
    expect(parseDdl("SELECT 1").kind).toBe("unknown");
  });
});

describe("reference matching", () => {
  it("matches whole identifiers only", () => {
    expect(referencesColumn("SELECT sum(amount) FROM t", "amount")).toBe(true);
    expect(referencesColumn("SELECT amount_gross FROM t", "amount")).toBe(false);
    expect(referencesColumn("SELECT `amount` FROM t", "amount")).toBe(true);
  });

  it("matches qualified tables and, optionally, bare names after FROM/JOIN", () => {
    expect(referencesTable("SELECT * FROM shop.orders_raw", "shop", "orders_raw", false)).toBe(true);
    expect(referencesTable("SELECT * FROM shop.orders_raw_queue", "shop", "orders_raw", false)).toBe(false);
    expect(referencesTable("SELECT * FROM orders_raw WHERE 1", "shop", "orders_raw", true)).toBe(true);
    expect(referencesTable("SELECT * FROM orders_raw WHERE 1", "shop", "orders_raw", false)).toBe(false);
  });
});
