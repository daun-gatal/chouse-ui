/**
 * Tests for sqlCompletionUtils: parseQueryContext, buildDatabaseStructureFromColumns,
 * getTablesInScope, getTextBeforeCursor, resolveTableAlias
 */

import { describe, it, expect } from "vitest";
import {
  parseQueryContext,
  buildDatabaseStructureFromColumns,
  getTablesInScope,
  getTextBeforeCursor,
  parseCTEDefinitions,
  resolveTableAlias,
  type TableInScope,
} from "./sqlCompletionUtils";

function pos(lineNumber: number, column: number): { lineNumber: number; column: number } {
  return { lineNumber, column };
}

describe("sqlCompletionUtils", () => {
  // ============================================
  // getTextBeforeCursor
  // ============================================

  describe("getTextBeforeCursor", () => {
    it("should return text before cursor on single line", () => {
      const query = "SELECT * FROM users";
      const result = getTextBeforeCursor(query, pos(1, 10));
      expect(result).toContain("SELECT *");
    });

    it("should return text before cursor on multi-line", () => {
      const query = "SELECT *\nFROM users\nWHERE id = 1";
      const result = getTextBeforeCursor(query, pos(2, 6));
      expect(result).toContain("SELECT *");
      expect(result).toContain("FROM ");
    });

    it("should handle cursor at start of file", () => {
      const query = "SELECT";
      const result = getTextBeforeCursor(query, pos(1, 1));
      expect(result.trim()).toBe("S");
    });
  });

  // ============================================
  // parseQueryContext
  // ============================================

  describe("parseQueryContext", () => {
    it("should return afterFrom when cursor is after FROM token", () => {
      const query = "SELECT * FROM ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterFrom");
      expect(result.isTypingDatabase).toBe(false);
    });

    it("should return afterSelect when cursor is after SELECT", () => {
      const query = "SELECT ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterSelect");
    });

    it("should return afterSelect when cursor is after comma in select list", () => {
      const query = "SELECT id, ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterSelect");
    });

    it("should return afterWhere when cursor is after WHERE", () => {
      const query = "SELECT * FROM t WHERE ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterWhere");
    });

    it("should return afterJoin when cursor is after JOIN", () => {
      const query = "SELECT * FROM a JOIN ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterJoin");
    });

    it("should return afterOn when cursor is after ON", () => {
      const query = "SELECT * FROM a JOIN b ON ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterOn");
    });

    it("should return dbDot and isTypingDatabase when typing db.", () => {
      const query = "FROM default.";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("dbDot");
      expect(result.database).toBe("default");
      expect(result.isTypingDatabase).toBe(true);
    });

    it("should return dbTableDot when typing db.table.", () => {
      const query = "SELECT default.users.";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("dbTableDot");
      expect(result.database).toBe("default");
      expect(result.table).toBe("users");
    });

    it("should parse database and table from qualified name", () => {
      const query = "FROM default.users";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.database).toBe("default");
      expect(result.table).toBe("users");
    });

    it("should return generic when no keyword context", () => {
      const query = "foo bar";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("generic");
    });

    it("should include tablesInScope for afterSelect/afterWhere/afterOn", () => {
      const query = "SELECT * FROM users WHERE ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterWhere");
      expect(result.tablesInScope).toEqual([{ table: "users" }]);
    });

    it("should include tablesInScope with database and alias", () => {
      const query = "SELECT u.id FROM default.users AS u WHERE ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.tablesInScope).toEqual([{ database: "default", table: "users", alias: "u" }]);
    });

    // New context tests
    it("should return afterGroupBy when cursor is after GROUP BY", () => {
      const query = "SELECT id, count(*) FROM users GROUP BY ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterGroupBy");
    });

    it("should return afterOrderBy when cursor is after ORDER BY", () => {
      const query = "SELECT * FROM users ORDER BY ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterOrderBy");
    });

    it("should return afterHaving when cursor is after HAVING", () => {
      const query = "SELECT id, count(*) FROM users GROUP BY id HAVING ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterHaving");
    });

    it("should return afterPrewhere when cursor is after PREWHERE", () => {
      const query = "SELECT * FROM users PREWHERE ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterPrewhere");
    });

    it("should return afterInsertInto when cursor is after INSERT INTO", () => {
      const query = "INSERT INTO ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterInsertInto");
    });

    it("should return afterSettings when cursor is after SETTINGS", () => {
      const query = "SELECT * FROM users SETTINGS ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterSettings");
    });

    it("should return afterEngine when cursor is after ENGINE =", () => {
      const query = "CREATE TABLE t (id UInt64) ENGINE = ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterEngine");
    });

    it("should return afterUsing when cursor is after USING", () => {
      const query = "SELECT * FROM a JOIN b USING ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterUsing");
    });

    it("should return afterValues when cursor is after VALUES", () => {
      const query = "INSERT INTO t VALUES ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterValues");
    });

    // Multi-line context detection
    it("should detect afterWhere on multi-line query (cursor on WHERE line)", () => {
      const query = "SELECT *\nFROM users\nWHERE ";
      const result = parseQueryContext(query, pos(3, 7));
      expect(result.kind).toBe("afterWhere");
    });

    it("should detect afterGroupBy on multi-line query", () => {
      const query = "SELECT id, count(*)\nFROM users\nGROUP BY ";
      const result = parseQueryContext(query, pos(3, 10));
      expect(result.kind).toBe("afterGroupBy");
    });

    it("should detect afterOrderBy on multi-line query", () => {
      const query = "SELECT *\nFROM users\nORDER BY ";
      const result = parseQueryContext(query, pos(3, 10));
      expect(result.kind).toBe("afterOrderBy");
    });

    it("should include tablesInScope for afterGroupBy", () => {
      const query = "SELECT id FROM users GROUP BY ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterGroupBy");
      expect(result.tablesInScope).toEqual([{ table: "users" }]);
    });

    it("should include tablesInScope for afterOrderBy", () => {
      const query = "SELECT id FROM users ORDER BY ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterOrderBy");
      expect(result.tablesInScope).toEqual([{ table: "users" }]);
    });

    it("should include tablesInScope for afterHaving", () => {
      const query = "SELECT id FROM users GROUP BY id HAVING ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterHaving");
      expect(result.tablesInScope).toEqual([{ table: "users" }]);
    });

    it("should include tablesInScope for afterPrewhere", () => {
      const query = "SELECT id FROM users PREWHERE ";
      const result = parseQueryContext(query, pos(1, query.length));
      expect(result.kind).toBe("afterPrewhere");
      expect(result.tablesInScope).toEqual([{ table: "users" }]);
    });
  });

  // ============================================
  // getTablesInScope
  // ============================================

  describe("getTablesInScope", () => {
    it("should return empty when no FROM before cursor", () => {
      const query = "SELECT ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([]);
    });

    it("should return table from FROM", () => {
      const query = "SELECT * FROM users WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "users" }]);
    });

    it("should return database.table from FROM", () => {
      const query = "SELECT * FROM default.users ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ database: "default", table: "users" }]);
    });

    it("should return tables from FROM and JOIN", () => {
      const query = "SELECT * FROM a JOIN b ON a.id = b.id WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "a" }, { table: "b" }]);
    });

    it("should return alias when AS is used", () => {
      const query = "SELECT * FROM users AS u WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "users", alias: "u" }]);
    });

    it("should not duplicate the same table ref (e.g. FROM a JOIN a)", () => {
      const query = "SELECT * FROM a JOIN a ON a.id = a.id WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "a" }]);
    });

    // Implicit alias tests
    it("should detect implicit alias (FROM users u)", () => {
      const query = "SELECT * FROM users u WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "users", alias: "u" }]);
    });

    it("should detect implicit alias with database prefix (FROM default.users u)", () => {
      const query = "SELECT * FROM default.users u WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([
        { database: "default", table: "users", alias: "u" },
      ]);
    });

    it("should detect implicit aliases on JOIN tables", () => {
      const query = "SELECT * FROM users u JOIN orders o ON u.id = o.user_id WHERE ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([
        { table: "users", alias: "u" },
        { table: "orders", alias: "o" },
      ]);
    });

    it("should not treat SQL keywords as implicit aliases", () => {
      const query = "SELECT * FROM users WHERE id = 1";
      const tables = getTablesInScope(query, pos(1, query.length));
      expect(tables).toEqual([{ table: "users" }]);
      expect(tables[0].alias).toBeUndefined();
    });

    it("should not treat JOIN keywords as implicit aliases", () => {
      const query = "SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id";
      const tables = getTablesInScope(query, pos(1, query.length));
      expect(tables).toEqual([{ table: "users" }, { table: "orders" }]);
    });

    it("should handle LEFT OUTER JOIN", () => {
      const query = "SELECT * FROM a LEFT OUTER JOIN b ON a.id = b.id ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "a" }, { table: "b" }]);
    });

    it("should handle GLOBAL ANY JOIN", () => {
      const query = "SELECT * FROM a GLOBAL ANY JOIN b ON a.id = b.id ";
      expect(getTablesInScope(query, pos(1, query.length))).toEqual([{ table: "a" }, { table: "b" }]);
    });

    // Multi-line tests
    it("should find tables across multiple lines", () => {
      const query = "SELECT *\nFROM users u\nJOIN orders o ON u.id = o.user_id\nWHERE ";
      expect(getTablesInScope(query, pos(4, 7))).toEqual([
        { table: "users", alias: "u" },
        { table: "orders", alias: "o" },
      ]);
    });
  });

  // ============================================
  // resolveTableAlias
  // ============================================

  describe("resolveTableAlias", () => {
    const tables: TableInScope[] = [
      { database: "default", table: "users", alias: "u" },
      { database: "default", table: "orders", alias: "o" },
      { table: "products" },
    ];

    it("should resolve by alias", () => {
      const result = resolveTableAlias("u", tables);
      expect(result?.table).toBe("users");
      expect(result?.alias).toBe("u");
    });

    it("should resolve by table name", () => {
      const result = resolveTableAlias("products", tables);
      expect(result?.table).toBe("products");
    });

    it("should resolve by qualified name", () => {
      const result = resolveTableAlias("default.orders", tables);
      expect(result?.table).toBe("orders");
    });

    it("should return undefined for unknown alias", () => {
      expect(resolveTableAlias("unknown", tables)).toBeUndefined();
    });
  });

  // ============================================
  // buildDatabaseStructureFromColumns
  // ============================================

  describe("buildDatabaseStructureFromColumns", () => {
    it("should return empty array for empty columns", () => {
      const result = buildDatabaseStructureFromColumns([]);
      expect(result).toEqual([]);
    });

    it("should build one database with one table and one column", () => {
      const columns = [
        { database: "default", table: "users", column_name: "id", column_type: "UInt64" },
      ];
      const result = buildDatabaseStructureFromColumns(columns);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("default");
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].name).toBe("users");
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].name).toBe("id");
      expect(result[0].children[0].children[0].type).toBe("UInt64");
    });

    it("should aggregate multiple columns in same table", () => {
      const columns = [
        { database: "default", table: "users", column_name: "id", column_type: "UInt64" },
        { database: "default", table: "users", column_name: "name", column_type: "String" },
      ];
      const result = buildDatabaseStructureFromColumns(columns);
      expect(result).toHaveLength(1);
      expect(result[0].children[0].children).toHaveLength(2);
      const names = result[0].children[0].children.map((c) => c.name);
      expect(names).toContain("id");
      expect(names).toContain("name");
    });

    it("should build multiple databases and tables", () => {
      const columns = [
        { database: "db1", table: "t1", column_name: "a", column_type: "Int32" },
        { database: "db1", table: "t2", column_name: "b", column_type: "String" },
        { database: "db2", table: "t1", column_name: "c", column_type: "UInt8" },
      ];
      const result = buildDatabaseStructureFromColumns(columns);
      expect(result).toHaveLength(2);
      const db1 = result.find((d) => d.name === "db1");
      const db2 = result.find((d) => d.name === "db2");
      expect(db1?.children).toHaveLength(2);
      expect(db2?.children).toHaveLength(1);
      expect(db1?.children[0].children[0].name).toBe("a");
      expect(db2?.children[0].children[0].name).toBe("c");
    });
  });

  // ============================================
  // parseCTEDefinitions
  // ============================================

  describe("parseCTEDefinitions", () => {
    it("should return empty for non-CTE queries", () => {
      expect(parseCTEDefinitions("SELECT * FROM users")).toEqual([]);
    });

    it("should parse a single CTE", () => {
      const query = "WITH a AS (SELECT * FROM public.users) SELECT * FROM a";
      const result = parseCTEDefinitions(query);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("a");
      expect(result[0].tables).toHaveLength(1);
      expect(result[0].tables[0]).toEqual({ database: "public", table: "users" });
    });

    it("should parse multiple CTEs", () => {
      const query = `WITH a AS (
        SELECT * FROM public.jobs
      ), b AS (
        SELECT * FROM public.students
      )
      SELECT * FROM a JOIN b ON a.id = b.id`;
      const result = parseCTEDefinitions(query);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("a");
      expect(result[0].tables[0]).toEqual({ database: "public", table: "jobs" });
      expect(result[1].name).toBe("b");
      expect(result[1].tables[0]).toEqual({ database: "public", table: "students" });
    });

    it("should parse CTE with unqualified table name", () => {
      const query = "WITH temp AS (SELECT id FROM users) SELECT * FROM temp";
      const result = parseCTEDefinitions(query);
      expect(result).toHaveLength(1);
      expect(result[0].tables[0]).toEqual({ table: "users" });
    });

    it("should handle nested parentheses in CTE body", () => {
      const query = "WITH a AS (SELECT count(*) AS cnt FROM (SELECT 1) sub JOIN users) SELECT * FROM a";
      const result = parseCTEDefinitions(query);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("a");
      expect(result[0].tables).toHaveLength(1);
      expect(result[0].tables[0]).toEqual({ table: "users" });
    });

    it("should handle CTE with joins inside body", () => {
      const query = "WITH combined AS (SELECT * FROM db.orders JOIN db.items ON orders.id = items.order_id) SELECT * FROM combined";
      const result = parseCTEDefinitions(query);
      expect(result).toHaveLength(1);
      expect(result[0].tables).toHaveLength(2);
      expect(result[0].tables[0]).toEqual({ database: "db", table: "orders" });
      expect(result[0].tables[1]).toEqual({ database: "db", table: "items" });
    });
  });

  // ============================================
  // getTablesInScope with CTE resolution
  // ============================================

  describe("getTablesInScope — CTE resolution", () => {
    it("should resolve CTE alias to underlying table", () => {
      const query = `WITH a AS (SELECT * FROM public.users)
SELECT * FROM a WHERE `;
      const result = getTablesInScope(query, { lineNumber: 2, column: 23 });
      expect(result).toHaveLength(1);
      expect(result[0].database).toBe("public");
      expect(result[0].table).toBe("users");
      expect(result[0].alias).toBe("a");
    });

    it("should resolve multiple CTE aliases", () => {
      const query = `WITH a AS (
  SELECT * FROM public.jobs
), b AS (
  SELECT * FROM public.students
)
SELECT * FROM a JOIN b ON a.id = b.id`;
      const result = getTablesInScope(query, { lineNumber: 6, column: 45 });
      expect(result).toHaveLength(2);
      expect(result[0].alias).toBe("a");
      expect(result[0].table).toBe("jobs");
      expect(result[1].alias).toBe("b");
      expect(result[1].table).toBe("students");
    });

    it("should not resolve non-CTE table names", () => {
      const query = `WITH a AS (SELECT * FROM public.users)
SELECT * FROM orders`;
      const result = getTablesInScope(query, { lineNumber: 2, column: 21 });
      expect(result).toHaveLength(1);
      expect(result[0].table).toBe("orders");
      expect(result[0].alias).toBeUndefined();
    });
  });
});
