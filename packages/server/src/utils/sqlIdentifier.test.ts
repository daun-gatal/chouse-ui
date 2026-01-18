
import { describe, it, expect } from "bun:test";
import { validateIdentifier, escapeIdentifier, escapeQualifiedIdentifier, validateColumnType, validateFormat } from "./sqlIdentifier";

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
});
