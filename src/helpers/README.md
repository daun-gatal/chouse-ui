# helpers

## Overview
Client-side SQL identifier validation and escaping for ClickHouse, column-type and format allow-lists, and a heuristic that detects DDL/DML statements.

## Interface
- `validateIdentifier(name)` - letters/digits/underscore, starts with a letter or `_`, 1-64 chars, not a reserved keyword (`default` is allowed) [sqlUtils.ts:validateIdentifier]
- `escapeIdentifier(name)` - backtick-quotes a validated identifier [sqlUtils.ts:escapeIdentifier]
- `escapeQualifiedIdentifier(parts)` - escapes and joins with `.` (for `db.table`) [sqlUtils.ts:escapeQualifiedIdentifier]
- `validateFormat(format)` - case-insensitive check against `ALLOWED_FORMATS` (ClickHouse spelling kept, compared upper-cased). No caller in `src/` outside tests today [sqlUtils.ts:validateFormat]
- `validateColumnType(type)` accepts only an allowed base type with at most one balanced argument list and nothing after it (`isNameWithOptionalArgs`, same rule as the server) [sqlUtils.ts:validateColumnType], [sqlUtils.ts:isNameWithOptionalArgs]
- `quoteIdentifier(name)` backtick-quotes any name, escaping `` ` `` and `\`, and never throws; `quoteStringLiteral(value)` escapes `'` and `\` [sqlUtils.ts:quoteIdentifier], [sqlUtils.ts:quoteStringLiteral]
- `buildCreateTableSql(input)` quotes every name, quotes comments as literals, rejects an invalid column type or engine with `CreateTableSqlError`, and passes DEFAULT/PARTITION BY/TTL expressions through as written [createTableSql.ts:buildCreateTableSql]
- `isCreateOrInsert(query)` - regex detection of CREATE/INSERT/ALTER/DROP-style statements, ignoring `--` comment lines [sqlUtils.ts:isCreateOrInsert]

## Invariants
- `escapeIdentifier` and `escapeQualifiedIdentifier` throw on invalid identifiers instead of quoting them; `escapeQualifiedIdentifier` throws on an empty array [sqlUtils.ts:escapeIdentifier], [sqlUtils.ts:escapeQualifiedIdentifier].
- These helpers are client-side conveniences; server-built SQL must still use the server's own `escapeIdentifier`/`quoteStringLiteral` (see `.rules/SECURITY.md`).

## Side Effects
- None. Pure functions.

## Verification
- Run: `bunx vitest run src/helpers`
