# helpers

## Overview
Client-side SQL identifier validation and escaping for ClickHouse, column-type and format allow-lists, and a heuristic that detects DDL/DML statements.

## Interface
- `validateIdentifier(name)` - letters/digits/underscore, starts with a letter or `_`, 1-64 chars, not a reserved keyword (`default` is allowed) [sqlUtils.ts:validateIdentifier]
- `escapeIdentifier(name)` - backtick-quotes a validated identifier [sqlUtils.ts:escapeIdentifier]
- `escapeQualifiedIdentifier(parts)` - escapes and joins with `.` (for `db.table`) [sqlUtils.ts:escapeQualifiedIdentifier]
- `validateColumnType(type)` - checks the (base) type against `ALLOWED_COLUMN_TYPES` [sqlUtils.ts:validateColumnType]
- `validateFormat(format)` - upper-cases the input and checks it against `ALLOWED_FORMATS`; because that set holds mixed-case names (`JSONEachRow`, `Parquet`, ...), only `CSV`, `TSV`, `JSON` and `XML` can validate. No caller in `src/` outside tests today — known issue, see [ARCHITECTURE.md › Known issues](../../ARCHITECTURE.md#known-issues) [sqlUtils.ts:validateFormat]
- `isCreateOrInsert(query)` - regex detection of CREATE/INSERT/ALTER/DROP-style statements, ignoring `--` comment lines [sqlUtils.ts:isCreateOrInsert]

## Invariants
- `escapeIdentifier` and `escapeQualifiedIdentifier` throw on invalid identifiers instead of quoting them; `escapeQualifiedIdentifier` throws on an empty array [sqlUtils.ts:escapeIdentifier], [sqlUtils.ts:escapeQualifiedIdentifier].
- These helpers are client-side conveniences; server-built SQL must still use the server's own `escapeIdentifier`/`quoteStringLiteral` (see `.rules/SECURITY.md`).

## Side Effects
- None. Pure functions.

## Verification
- Run: `bunx vitest run src/helpers`
