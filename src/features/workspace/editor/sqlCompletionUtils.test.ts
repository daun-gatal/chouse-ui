/**
 * Tests for sqlCompletionUtils: parseQueryContext and buildDatabaseStructureFromColumns
 */

import { describe, it, expect } from "vitest";
import {
  parseQueryContext,
  buildDatabaseStructureFromColumns,
  getTablesInScope,
} from "./sqlCompletionUtils";

function pos(lineNumber: number, column: number): { lineNumber: number; column: number } {
  return { lineNumber, column };
}

describe("sqlCompletionUtils", () => {
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

    it("should use current line only", () => {
      const query = "SELECT *\nFROM ";
      const result = parseQueryContext(query, pos(2, 6));
      expect(result.kind).toBe("afterFrom");
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
  });

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
  });

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
});
