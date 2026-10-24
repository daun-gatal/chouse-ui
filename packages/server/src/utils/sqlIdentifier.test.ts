
import { describe, it, expect } from "bun:test";
import {
    validateIdentifier,
    escapeIdentifier,
    escapeQualifiedIdentifier,
    validateColumnType,
    validateFormat,
    validateTableEngine,
    validateDatabaseEngine,
    isSafeKeyExpression,
    quoteStringLiteral,
} from "./sqlIdentifier";

describe("SQL Identifier Utils", () => {
    describe("validateIdentifier", () => {
        it("should accept valid identifiers", () => {
            expect(validateIdentifier("users")).toBe(true);
            expect(validateIdentifier("MyTable_123")).toBe(true);
            expect(validateIdentifier("_hidden")).toBe(true);
        });

        it("should reject invalid identifiers", () => {
            expect(validateIdentifier("")).toBe(false); // Empty
            expect(validateIdentifier("123table")).toBe(false); // Starts with digit
            expect(validateIdentifier("table-name")).toBe(false); // Hyphen
            expect(validateIdentifier("table name")).toBe(false); // Space
            expect(validateIdentifier("table.name")).toBe(false); // Dot (should be separate)
        });

        it("should reject reserved keywords", () => {
            expect(validateIdentifier("SELECT")).toBe(false);
            expect(validateIdentifier("drop")).toBe(false);
            expect(validateIdentifier("table")).toBe(false);
        });

        it("should allow default (ClickHouse built-in database name)", () => {
            expect(validateIdentifier("default")).toBe(true);
        });
    });

    describe("escapeIdentifier", () => {
        it("should escape valid identifier", () => {
            expect(escapeIdentifier("users")).toBe("`users`");
        });

        it("should throw on invalid identifier", () => {
            expect(() => escapeIdentifier("drop table")).toThrow();
        });
    });

    describe("escapeQualifiedIdentifier", () => {
        it("should escape multiple parts", () => {
            expect(escapeQualifiedIdentifier(["db", "my_table"])).toBe("`db`.`my_table`");
        });

        it("should allow default database (ClickHouse built-in)", () => {
            expect(escapeQualifiedIdentifier(["default", "viz_test_largest_tables"])).toBe("`default`.`viz_test_largest_tables`");
        });
    });

    describe("validateColumnType", () => {
        it("should accept allowed types", () => {
            expect(validateColumnType("String")).toBe(true);
            expect(validateColumnType("Int32")).toBe(true);
            expect(validateColumnType("Nullable(String)")).toBe(true); // Base type check
            expect(validateColumnType("Array(Int32)")).toBe(true);
        });

        it("should reject disallowed types", () => {
            expect(validateColumnType("UnknownType")).toBe(false);
            expect(validateColumnType("DROP TABLE")).toBe(false);
        });
    });

    describe("validateFormat", () => {
        it("should accept allowed formats", () => {
            expect(validateFormat("JSON")).toBe(true);
            expect(validateFormat("CSV")).toBe(true);
            expect(validateFormat("json")).toBe(true); // Case insensitive check? Implementation usually uppercases
        });

        it("should reject invalid formats", () => {
            expect(validateFormat("Exe")).toBe(false);
        });
    });

    describe("validateColumnType (whole string)", () => {
        it.each([
            "UInt64", "Nullable(String)", "Map(String, Array(UInt64))", "DateTime64(3, 'UTC')",
            "Decimal(10, 2)", "Enum8('a' = 1, 'b' = -2)", "AggregateFunction(sum, UInt64)",
            "Tuple(a String, b Nullable(Int32))",
        ])("accepts %s", (type) => {
            expect(validateColumnType(type)).toBe(true);
        });

        it.each([
            "String) ENGINE = Memory",
            "String DEFAULT 1",
            "Nullable(String))",
            "Enum8('a\\' = 1)",
            "Nullable((SELECT 1))",
        ])("rejects %s", (type) => {
            expect(validateColumnType(type)).toBe(false);
        });
    });

    describe("validateTableEngine / validateDatabaseEngine", () => {
        it("accepts local engines for everyone", () => {
            expect(validateTableEngine("MergeTree()", false)).toBe(true);
            expect(validateTableEngine("ReplicatedMergeTree('/ch/{shard}/t', '{replica}')", false)).toBe(true);
            expect(validateDatabaseEngine("Atomic", false)).toBe(true);
        });

        it("keeps data-reaching engines to admins", () => {
            expect(validateTableEngine("Merge('db', '.*')", false)).toBe(false);
            expect(validateTableEngine("Merge('db', '.*')", true)).toBe(true);
            expect(validateDatabaseEngine("MySQL('host:3306', 'db', 'u', 'p')", false)).toBe(false);
        });

        it("rejects trailing clauses even for admins", () => {
            expect(validateTableEngine("Memory AS SELECT 1", true)).toBe(false);
            expect(validateTableEngine("Memory() SETTINGS x = 1", true)).toBe(false);
            expect(validateDatabaseEngine("Atomic; DROP DATABASE x", true)).toBe(false);
        });
    });

    describe("isSafeKeyExpression", () => {
        it("accepts column lists and function calls", () => {
            expect(isSafeKeyExpression("id, toDate(ts)")).toBe(true);
            expect(isSafeKeyExpression("intHash32(user_id) % 16")).toBe(true);
        });

        it("rejects literals, keywords and unbalanced parentheses", () => {
            expect(isSafeKeyExpression("id AS SELECT 1")).toBe(false);
            expect(isSafeKeyExpression("toDate('x')")).toBe(false);
            expect(isSafeKeyExpression("id) TTL ts")).toBe(false);
            expect(isSafeKeyExpression("")).toBe(false);
        });
    });

    describe("quoteStringLiteral", () => {
        it("escapes quotes and backslashes", () => {
            expect(quoteStringLiteral("it's")).toBe("'it\\'s'");
            expect(quoteStringLiteral("a\\")).toBe("'a\\\\'");
        });
    });
});
