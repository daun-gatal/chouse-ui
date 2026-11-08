import { describe, expect, it } from "vitest";
import { buildCreateTableSql, CreateTableSqlError } from "./createTableSql";

const base = {
  database: "analytics",
  table: "events",
  columns: [{ name: "id", type: "UInt64", nullable: false }],
  engine: "MergeTree",
  orderBy: ["id"],
};

describe("buildCreateTableSql", () => {
  it("builds a plain statement with quoted names", () => {
    expect(buildCreateTableSql(base)).toBe(
      "CREATE TABLE `analytics`.`events` (\n    `id` UInt64\n)\nENGINE = MergeTree\nORDER BY (`id`)",
    );
  });

  it("quotes a database name that would otherwise break the statement", () => {
    const sql = buildCreateTableSql({ ...base, database: "x`.t (a Int8) ENGINE=Memory; DROP TABLE y; --" });
    expect(sql.startsWith("CREATE TABLE `x\\`.t (a Int8) ENGINE=Memory; DROP TABLE y; --`.`events`")).toBe(true);
  });

  it("quotes column and ORDER BY names, including backticks and backslashes", () => {
    const sql = buildCreateTableSql({ ...base, columns: [{ name: "we`ird\\", type: "String", nullable: true }], orderBy: ["we`ird\\"] });
    expect(sql).toContain("`we\\`ird\\\\` Nullable(String)");
    expect(sql).toContain("ORDER BY (`we\\`ird\\\\`)");
  });

  it("quotes the cluster as an identifier", () => {
    expect(buildCreateTableSql({ ...base, cluster: "main' x" })).toContain("ON CLUSTER `main' x`");
  });

  it("quotes comments as string literals, backslash included", () => {
    const sql = buildCreateTableSql({ ...base, comment: "it's \\", columns: [{ name: "id", type: "UInt64", nullable: false, description: "a\\'b" }] });
    expect(sql).toContain("COMMENT 'a\\\\\\'b'");
    expect(sql).toContain("\nCOMMENT 'it\\'s \\\\'");
  });

  it("rejects a column type that carries more SQL", () => {
    expect(() => buildCreateTableSql({ ...base, columns: [{ name: "id", type: "UInt64) ENGINE=Memory AS SELECT * FROM secret.s --", nullable: false }] })).toThrow(CreateTableSqlError);
    expect(() => buildCreateTableSql({ ...base, columns: [{ name: "id", type: "NotAType", nullable: false }] })).toThrow(CreateTableSqlError);
  });

  it("accepts parameterised types", () => {
    for (const type of ["Map(String, Array(UInt64))", "DateTime64(3, 'UTC')", "Enum8('a' = 1, 'b' = 2)", "Decimal(10, 2)", "LowCardinality(String)"]) {
      expect(() => buildCreateTableSql({ ...base, columns: [{ name: "c", type, nullable: false }] })).not.toThrow();
    }
  });

  it("rejects an engine that isn't a bare name", () => {
    expect(() => buildCreateTableSql({ ...base, engine: "Merge(secret, '.*')" })).toThrow(CreateTableSqlError);
  });

  it("keeps user-written expressions and omits empty clauses", () => {
    const sql = buildCreateTableSql({ ...base, columns: [{ name: "ts", type: "DateTime", nullable: false, defaultValue: "now()" }], partitionBy: "toYYYYMM(ts)", ttl: "ts + INTERVAL 30 DAY", orderBy: [] });
    expect(sql).toContain("`ts` DateTime DEFAULT now()");
    expect(sql).toContain("\nPARTITION BY toYYYYMM(ts)");
    expect(sql).toContain("\nTTL ts + INTERVAL 30 DAY");
    expect(sql).not.toContain("ORDER BY");
  });
});
