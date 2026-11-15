# Server HTTP Middleware

## Overview
Hono middleware and request-scoped helpers shared by the server's routes:
request IDs, CORS, global error mapping, ClickHouse connection resolution,
RBAC-driven data-access checks backed by ClickHouse's own SQL parser
([sqlAccess/](./sqlAccess/README.md), ADR 0030), the schema-change
preflight gate, and the DB-backed rate-limit store with its key functions.

## Interface
- `requestId.ts`: `[requestId.ts:requestId]` - sets `c.var.requestId` from `x-request-id` or `crypto.randomUUID()` and echoes it in the response header.
- `cors.ts`: `[cors.ts:corsMiddleware]`, `[cors.ts:CorsOptions]`, `[cors.ts:OAUTH_PUBLIC_PATHS]` (MCP OAuth discovery/register/token/revoke paths served with `*`).
- `error.ts`: `[error.ts:errorHandler]` (global `onError`), `[error.ts:notFoundHandler]`.
- `connectionContext.ts`: `[connectionContext.ts:connectionContextMiddleware]`, `[connectionContext.ts:ConnectionContextVariables]`, `[connectionContext.ts:agentTags]`, `[connectionContext.ts:getCookie]`, constants `CONNECTION_ID_HEADER` (`X-Connection-Id`), `CONNECTION_ID_COOKIE` (`ch_connection`), `SESSION_ID_HEADER`, `SESSION_ID_COOKIE`.
- `dataAccess.ts`: `[dataAccess.ts:optionalRbacMiddleware]`, `[dataAccess.ts:checkDatabaseAccess]`, `[dataAccess.ts:checkTableAccess]`, `[dataAccess.ts:filterDatabases]`, `[dataAccess.ts:filterTables]`, `[dataAccess.ts:validateQueryAccess]` (takes `QueryAccessInput { userId, isAdmin, permissions, sql, params?, connectionId, parser? }`, returns `QueryAccessResult { allowed, reason?, code?, status?, statementType?, statement? }`), `[dataAccess.ts:validateSystemRead]` (a model's read of system tables for a person), `[dataAccess.ts:checkedOf]`, `[dataAccess.ts:accessDeniedStatus]`, `[dataAccess.ts:accessDeniedError]`. Tests only: `[dataAccess.ts:setAccessOverrideForTests]`.
- `sqlParser.ts` (`node-sql-parser`; hints only, never the access decision): `[sqlParser.ts:splitSqlStatements]`, `[sqlParser.ts:parseStatement]`, `[sqlParser.ts:SAFE_TABLE_FUNCTIONS]`, types `TableRef`, `ParsedStatement`.
- [sqlAccess/](./sqlAccess/README.md) - the ADR 0030 pipeline `validateQueryAccess` runs for non-admins, and the `EXECUTE AS` check it runs for everyone.
- `schemaPreflight.ts`: `[schemaPreflight.ts:enforceSchemaPreflight]` - returns a 409 `Response` or `null` to proceed.
- `rateLimitStore.ts`: `[rateLimitStore.ts:DbRateLimitStore]` (`hono-rate-limiter` `Store`), `[rateLimitStore.ts:cleanupExpiredRateLimits]`.
- `rateLimitKeys.ts`: `[rateLimitKeys.ts:rateLimitClientKey]`, `[rateLimitKeys.ts:loginAccountKey]`, `[rateLimitKeys.ts:rateLimitUserKey]`.

## Invariants
- Connection resolution order: `X-Connection-Id` (re-checked against RBAC each request), else a legacy `X-Session-ID` fails closed with `connectionContextStale` (409), else the user's default connection; no RBAC user means `AppError.unauthorized` `[connectionContext.ts:connectionContextMiddleware]`.
- `validateQueryAccess` parses an admin's statement with ClickHouse and refuses it when the parse holds an `EXECUTE AS` node (`IMPERSONATION`), when ClickHouse cannot parse it, or when the parse cannot run (ADR 0033 §3); an admin skips the permission and table checks. For everyone else it refuses when there is no RBAC user (`PERMISSION_DENIED`) or no connection (`CHECK_UNAVAILABLE`), has ClickHouse parse the exact text (and params) that will run, needs the statement's permission (`table:select`, `table:insert`, `database:drop`, …), then checks every target, read and database against the user's data access rules. Unqualified names resolve against the connection's default database. Any refusal carries a `code`; `status` is 400 for `SQL_SYNTAX`/`QUERY_PARAM_UNBOUND`, 503 for `CHECK_UNAVAILABLE`, else 403 `[dataAccess.ts:validateQueryAccess]`, `[dataAccess.ts:accessDeniedStatus]`.
- Non-admins may only use inline-data table functions in `SAFE_TABLE_FUNCTIONS`; `remote`, `url`, `s3`, `mysql`, etc. are refused by the `sqlAccess/` walker `[sqlParser.ts:SAFE_TABLE_FUNCTIONS]`.
- Each table is checked once, keyed on database + table, so `public.t` cannot mask `secret.t` `[dataAccess.ts:validateQueryAccess]`.
- An allowed result carries the `CheckedStatement` to send: the exact text, parameters, connection and account that were checked, whether ClickHouse's parse says it is a read, and whether the person holds any write permission. `dataAccess.ts` is the only file that makes one, and `[dataAccess.ts:checkedOf]` throws for a refusal. For an admin the kind is read from the same parse (one `EXPLAIN AST`), and a shape the policy does not know is sent as a possible write `[dataAccess.ts:validateQueryAccess]`.
- A non-admin's read of a statement log needs `query:history:view:all` and of an access table `clickhouse:users:view`, wherever the table sits in the statement `[../rbac/services/systemTables.ts:systemTablePermission]`. `[dataAccess.ts:validateSystemRead]` applies the same rule with no table permission and no data access rule, and allows only a single SELECT that reads nothing outside `system` and `information_schema`.
- `[dataAccess.ts:setAccessOverrideForTests]` throws unless `NODE_ENV` is `test`; it can skip the permission or the table stage, never the parse or the `EXECUTE AS` refusal, and a forced write from a person with no write permission is still sent read-only.
- `checkDatabaseAccess`/`checkTableAccess`/`filterDatabases`/`filterTables` grant admins everything, throw when no RBAC user is supplied, and hide system databases/tables from non-admins `[dataAccess.ts]`.
- A token that names a scope is checked as a non-administrator: `optionalRbacMiddleware` sets `isRbacAdmin` to false for it, and `validateQueryAccess` / `validateSystemRead` drop the administrator path for it (`[dataAccess.ts:validateQueryAccess]`), so the permission for the statement's kind and for restricted system tables comes from the token's scope. Its owner's exemption from data access rules is kept in the four access helpers and the table check `[dataAccess.ts:filterTables]`.
- On a `personal` connection (ADR 0033 §7) `validateQueryAccess` runs one path for everyone, admins included: the account needs an active binding, the statement must be one of a kind in `WRAPPABLE_KINDS` (no `SET`, `USE`, `EXECUTE AS` or inline rows), a non-admin needs the CHouse permission for that kind, and ClickHouse must confirm the wrapped texts. No table is checked there: the person's own ClickHouse user decides `[dataAccess.ts:validateQueryAccess]`.
- On a `personal` connection `checkDatabaseAccess`/`checkTableAccess`/`filterDatabases`/`filterTables` answer a non-admin's read from what their bound ClickHouse user can see, and leave a write to ClickHouse, which checks that user's grants when the statement runs `[dataAccess.ts:filterTables]`.
- CORS: a wildcard origin never sends `Access-Control-Allow-Credentials`; credentialed responses echo the exact origin with `Vary: Origin`; in `strictMode` a disallowed origin gets 403 `CORS_BLOCKED`, except on the default `bypassPaths` (`/api/health`, `/api/rbac/health`, `/api/rbac/status`, `/auth/sso/saml/acs`, `/mcp`), which skip the origin check `[cors.ts:corsMiddleware]`.
- Rate-limit client keys use the rightmost `X-Forwarded-For` hop (the one the nearest proxy appended), then `X-Real-IP`, then the socket address; login is also keyed per account identifier so header rotation cannot reset the budget `[rateLimitKeys.ts:rateLimitClientKey]`, `[rateLimitKeys.ts:loginAccountKey]`.
- `rateLimitUserKey` keys by the owning user (`user:<id>`) taken from a verified session JWT or, for a PAT or OAuth access token, from one hash lookup of the token's owner (no writes); anything else (no token, a bad JWT, an unknown token) counts by client address (`addr:<key>`). So a forged token can't spend another user's budget, rotating made-up tokens can't escape the per-address limit, and extra tokens add no budget `[rateLimitKeys.ts:rateLimitUserKey]`.
- A breaking DDL proceeds only if the caller is admin or holds `schema:override` and sent `X-Schema-Override: confirm`; dependents in tables the caller cannot read are counted, not named `[schemaPreflight.ts:enforceSchemaPreflight]`.
- `AppError`, Hono `HTTPException`, and `ZodError` keep their 4xx status; stack traces are only returned for 500s outside production `[error.ts:errorHandler]`.

## Side Effects
- `DbRateLimitStore` upserts and reads counters in the RBAC table `_rbac_rate_limits`; `cleanupExpiredRateLimits` deletes expired rows (no-op with a warning if the table is missing) `[rateLimitStore.ts]`.
- `enforceSchemaPreflight` runs DDL impact analysis against ClickHouse and writes an `AUDIT_ACTIONS.SCHEMA_OVERRIDE` audit log when an override is used `[schemaPreflight.ts:enforceSchemaPreflight]`.
- `connectionContextMiddleware` creates/reuses a `ClickHouseService` via `services/connectionResolver` and populates `service`, `session`, `sessionId`, `rbacConnectionId` on the context `[connectionContext.ts:connectionContextMiddleware]`.
- `validateQueryAccess` runs one `EXPLAIN AST` per non-admin statement on the connection (plus a cached `currentDatabase()` when the connection names no database) `[sqlAccess/clickhouseParse.ts:clickhouseParsePort]`.
- `optionalRbacMiddleware` verifies the bearer token and sets `rbacUserId`, `rbacRoles`, `rbacPermissions`, `isRbacAdmin` `[dataAccess.ts:optionalRbacMiddleware]`.
- `errorHandler` writes structured warn/error logs via `requestLogger` `[error.ts:errorHandler]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/middleware`
- After changing the access check, re-record its fixtures against real ClickHouse: see [sqlAccess/](./sqlAccess/README.md#verification)
