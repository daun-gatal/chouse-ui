# Server HTTP Middleware

## Overview
Hono middleware and request-scoped helpers shared by the server's routes:
request IDs, CORS, global error mapping, ClickHouse connection resolution,
RBAC-driven data-access checks backed by an AST SQL parser, the schema-change
preflight gate, and the DB-backed rate-limit store with its key functions.

## Interface
- `requestId.ts`: `[requestId.ts:requestId]` - sets `c.var.requestId` from `x-request-id` or `crypto.randomUUID()` and echoes it in the response header.
- `cors.ts`: `[cors.ts:corsMiddleware]`, `[cors.ts:CorsOptions]`, `[cors.ts:OAUTH_PUBLIC_PATHS]` (MCP OAuth discovery/register/token/revoke paths served with `*`).
- `error.ts`: `[error.ts:errorHandler]` (global `onError`), `[error.ts:notFoundHandler]`.
- `connectionContext.ts`: `[connectionContext.ts:connectionContextMiddleware]`, `[connectionContext.ts:ConnectionContextVariables]`, `[connectionContext.ts:agentTags]`, `[connectionContext.ts:getCookie]`, constants `CONNECTION_ID_HEADER` (`X-Connection-Id`), `CONNECTION_ID_COOKIE` (`ch_connection`), `SESSION_ID_HEADER`, `SESSION_ID_COOKIE`.
- `dataAccess.ts`: `[dataAccess.ts:optionalRbacMiddleware]`, `[dataAccess.ts:checkDatabaseAccess]`, `[dataAccess.ts:checkTableAccess]`, `[dataAccess.ts:filterDatabases]`, `[dataAccess.ts:filterTables]`, `[dataAccess.ts:validateQueryAccess]`, `[dataAccess.ts:getQueryAccessType]`, `[dataAccess.ts:extractTablesFromQuery]`, `[dataAccess.ts:extractTablesFromExplainEstimate]`.
- `sqlParser.ts`: `[sqlParser.ts:splitSqlStatements]`, `[sqlParser.ts:parseStatement]`, `[sqlParser.ts:getAccessTypeFromStatementType]`, `[sqlParser.ts:SAFE_TABLE_FUNCTIONS]`, types `TableRef`, `ParsedStatement`, `AccessType`.
- `schemaPreflight.ts`: `[schemaPreflight.ts:enforceSchemaPreflight]` - returns a 409 `Response` or `null` to proceed.
- `rateLimitStore.ts`: `[rateLimitStore.ts:DbRateLimitStore]` (`hono-rate-limiter` `Store`), `[rateLimitStore.ts:cleanupExpiredRateLimits]`.
- `rateLimitKeys.ts`: `[rateLimitKeys.ts:rateLimitClientKey]`, `[rateLimitKeys.ts:loginAccountKey]`.

## Invariants
- Connection resolution order: `X-Connection-Id` (re-checked against RBAC each request), else a legacy `X-Session-ID` fails closed with `connectionContextStale` (409), else the user's default connection; no RBAC user means `AppError.unauthorized` `[connectionContext.ts:connectionContextMiddleware]`.
- `validateQueryAccess` lets admins through, denies when there is no RBAC user or no statements, and validates every split statement; any denied statement denies the whole request `[dataAccess.ts:validateQueryAccess]`.
- A statement the splitter and parser disagree on (multiple ASTs) is typed `unknown` and denied. A statement the AST parser cannot parse is not denied: `parseStatement` falls back to keyword typing and regex table extraction and never throws, so the deny branch around it in `validateSingleStatement` is unreachable and enforcement for such SQL rests on the regex fallback — known issue, see [ARCHITECTURE.md › Known issues](../../../../ARCHITECTURE.md#known-issues) `[sqlParser.ts:parseStatement]`, `[sqlParser.ts:getStatementTypeFallback]`, `[sqlParser.ts:extractTablesFallback]`.
- Each statement also needs its operation permission (`table:select`, `table:insert`, ...); an unrecognised statement type is denied, and a statement with no detected tables is allowed ("might be a system query") — known issue, see [ARCHITECTURE.md › Known issues](../../../../ARCHITECTURE.md#known-issues) `[dataAccess.ts:getRequiredStatementPermission]`, `[dataAccess.ts:validateSingleStatement]`.
- Non-admins may only use inline-data table functions in `SAFE_TABLE_FUNCTIONS`; `remote`, `url`, `s3`, `mysql`, etc. are denied `[sqlParser.ts:SAFE_TABLE_FUNCTIONS]`.
- Table dedup keys on database + table + role so `public.t` cannot mask `secret.t` `[dataAccess.ts:validateSingleStatement]`.
- `checkDatabaseAccess`/`checkTableAccess`/`filterDatabases`/`filterTables` grant admins everything, throw when no RBAC user is supplied, and hide system databases/tables from non-admins `[dataAccess.ts]`.
- CORS: a wildcard origin never sends `Access-Control-Allow-Credentials`; credentialed responses echo the exact origin with `Vary: Origin`; in `strictMode` a disallowed origin gets 403 `CORS_BLOCKED`, except on the default `bypassPaths` (`/api/health`, `/api/rbac/health`, `/api/rbac/status`, `/auth/sso/saml/acs`, `/mcp`), which skip the origin check `[cors.ts:corsMiddleware]`.
- Rate-limit client keys use the rightmost `X-Forwarded-For` hop (the one the nearest proxy appended), then `X-Real-IP`, then the socket address; login is also keyed per account identifier so header rotation cannot reset the budget `[rateLimitKeys.ts:rateLimitClientKey]`, `[rateLimitKeys.ts:loginAccountKey]`.
- A breaking DDL proceeds only if the caller is admin or holds `schema:override` and sent `X-Schema-Override: confirm`; dependents in tables the caller cannot read are counted, not named `[schemaPreflight.ts:enforceSchemaPreflight]`.
- `AppError`, Hono `HTTPException`, and `ZodError` keep their 4xx status; stack traces are only returned for 500s outside production `[error.ts:errorHandler]`.

## Side Effects
- `DbRateLimitStore` upserts and reads counters in the RBAC table `_rbac_rate_limits`; `cleanupExpiredRateLimits` deletes expired rows (no-op with a warning if the table is missing) `[rateLimitStore.ts]`.
- `enforceSchemaPreflight` runs DDL impact analysis against ClickHouse and writes an `AUDIT_ACTIONS.SCHEMA_OVERRIDE` audit log when an override is used `[schemaPreflight.ts:enforceSchemaPreflight]`.
- `connectionContextMiddleware` creates/reuses a `ClickHouseService` via `services/connectionResolver` and populates `service`, `session`, `sessionId`, `rbacConnectionId` on the context `[connectionContext.ts:connectionContextMiddleware]`.
- `optionalRbacMiddleware` verifies the bearer token and sets `rbacUserId`, `rbacRoles`, `rbacPermissions`, `isRbacAdmin` `[dataAccess.ts:optionalRbacMiddleware]`.
- `errorHandler` writes structured warn/error logs via `requestLogger` `[error.ts:errorHandler]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/middleware`
