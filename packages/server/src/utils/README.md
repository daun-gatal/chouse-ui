# Server Utilities

## Overview
Leaf helpers shared across the Bun/Hono server: the Pino logger, YAML config
loading into `process.env`, ClickHouse SQL identifier/literal escaping and
grammar checks, User-Agent/CDN header parsing for audit enrichment, and a
text headline helper. No module here depends on routes, services, or RBAC.

## Interface
- `logger.ts`
  - `[logger.ts:logger]` - the process-wide Pino logger (`service: "chouse-ui-server"`, ISO timestamps).
  - `[logger.ts:requestLogger]` - child logger bound to a `requestId`, for route handlers and middleware.
  - `[logger.ts:Logger]` - type alias for `pino.Logger`.
- `configLoader.ts`
  - `[configLoader.ts:flattenConfig]` - flattens nested YAML into upper-cased, `_`-joined env-style keys (`{ rbac: { db_type } }` -> `RBAC_DB_TYPE`).
  - Module side effect on import: `[configLoader.ts:loadConfig]` (not exported) runs immediately.
- `sqlIdentifier.ts`
  - `[sqlIdentifier.ts:validateIdentifier]`, `[sqlIdentifier.ts:escapeIdentifier]`, `[sqlIdentifier.ts:escapeQualifiedIdentifier]` - identifier validation and backtick quoting.
  - `[sqlIdentifier.ts:quoteStringLiteral]` - ClickHouse string literal quoting (escapes `\` and `'`).
  - `[sqlIdentifier.ts:validateColumnType]`, `[sqlIdentifier.ts:isNameWithOptionalArgs]`, `[sqlIdentifier.ts:isSafeKeyExpression]` - whole-string grammar checks for types and ORDER/PARTITION/PRIMARY key expressions.
  - `[sqlIdentifier.ts:validateTableEngine]`, `[sqlIdentifier.ts:validateDatabaseEngine]` - engine allow-lists, bypassed only when `allowAnyEngine` is true.
  - `[sqlIdentifier.ts:validateFormat]` - `INSERT ... FORMAT` allow-list. It upper-cases the input before the lookup while `ALLOWED_FORMATS` holds mixed-case names, so only `CSV`, `TSV`, `JSON` and `XML` pass; no server route calls it today (`../routes/explorer.ts` only imports it) — known issue, see [ARCHITECTURE.md › Known issues](../../../../ARCHITECTURE.md#known-issues).
- `parseUserAgent.ts`
  - `[parseUserAgent.ts:parseUserAgent]`, `[parseUserAgent.ts:extractClientInfo]`, `[parseUserAgent.ts:getClientHeaders]`, types `ParsedUserAgent`, `ClientInfo`.
- `text.ts`
  - `[text.ts:headline]` - first non-empty line, whitespace-collapsed, cut at a word boundary with an ellipsis.

## Invariants
- `escapeIdentifier` throws unless the name matches `^[a-zA-Z_][a-zA-Z0-9_]*$`, is 1-64 chars, and is not in the reserved-keyword set (`default` is intentionally allowed) `[sqlIdentifier.ts:validateIdentifier]`.
- String literals must escape the backslash before the quote; escaping only `'` lets a trailing `\` swallow the closing quote `[sqlIdentifier.ts:quoteStringLiteral]`.
- Engine/type arguments may contain only identifiers, numbers, quote-free string literals, `,` `=` `-` `.` and balanced parentheses, with nothing after the outer `)` and no query keywords `[sqlIdentifier.ts:isNameWithOptionalArgs]`.
- Key expressions reject literals, query keywords, and clause keywords (`AS`, `ORDER`, `TTL`, `ENGINE`, ...) `[sqlIdentifier.ts:isSafeKeyExpression]`.
- Non-admin engines are restricted to local-storage engines (`LOCAL_TABLE_ENGINES`, `LOCAL_DATABASE_ENGINES`) so Merge/Distributed/URL/S3/MySQL cannot bypass data-access rules `[sqlIdentifier.ts:validateEngine]`.
- `configLoader` must be the first import of the server entry (`packages/server/src/index.ts` line 1) so YAML values override env before other modules read it `[configLoader.ts:loadConfig]`.
- Never log passwords, tokens, or PII through `logger` (module contract in `[logger.ts]` header).

## Side Effects
- Importing `configLoader.ts` reads the YAML file at `CHOUSE_CONFIG_PATH`, writes every flattened key into `process.env`, reconciles `logger.level` with a YAML `LOG_LEVEL`, and calls `process.exit(1)` if the file is missing, unparsable, or not an object `[configLoader.ts:loadConfig]`.
- Importing `logger.ts` reads `NODE_ENV`/`LOG_LEVEL` once and, in development, dynamically loads `pino-pretty` (falls back to JSON if absent); output goes to stdout `[logger.ts:baseLogger]`.
- All other modules are pure functions.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/utils`
