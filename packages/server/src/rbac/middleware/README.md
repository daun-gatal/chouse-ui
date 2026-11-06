# RBAC Auth Middleware

## Overview
Hono middleware and context helpers for RBAC authentication and authorization.
Verifies the bearer token (browser JWT, personal access token, or an MCP OAuth
token on an in-process MCP subrequest), attaches the identity to the Hono
context, and provides permission/role gate factories used by every protected
route. `index.ts` re-exports `rbacAuth.ts`.

## Interface
- `[rbacAuth.ts:RbacContext]` - context variables `rbacUser`, `rbacUserId`, `rbacRoles`, `rbacPermissions`, `authMethod`, `patId` (merged into Hono's `ContextVariableMap`).
- Authentication: `[rbacAuth.ts:rbacAuthMiddleware]` (required), `[rbacAuth.ts:optionalRbacAuthMiddleware]` (sets nothing on a missing/invalid token).
- Gate factories: `[rbacAuth.ts:requirePermission]`, `[rbacAuth.ts:requireAnyPermission]`, `[rbacAuth.ts:requireAllPermissions]`, `[rbacAuth.ts:requireRole]`, `[rbacAuth.ts:requireAnyRole]`, `[rbacAuth.ts:superAdminOnly]`, `[rbacAuth.ts:adminOnly]`.
- Handler helpers: `[rbacAuth.ts:getRbacUser]` (throws 401), `[rbacAuth.ts:getRbacUserOptional]`, `[rbacAuth.ts:requireJwtSession]`, `[rbacAuth.ts:hasPermission]`, `[rbacAuth.ts:hasRole]`, `[rbacAuth.ts:isSuperAdmin]`, `[rbacAuth.ts:isAdmin]`, `[rbacAuth.ts:getClientIp]`.
- `[index.ts]` - `export * from './rbacAuth'`.

## Invariants
- OAuth access tokens are accepted only when `isMcpSubrequestFor(token)` is true (`verifyBearer(..., { allowOAuth })`); otherwise only JWTs and PATs authenticate `[rbacAuth.ts:rbacAuthMiddleware]`.
- Gate factories run `rbacAuthMiddleware` themselves, so they work without a separate auth `use` `[rbacAuth.ts:requirePermission]`.
- Permission gates check the token's permissions first and, on a miss, re-check the database (`userHasPermission` and friends) so newly granted permissions apply before the token refreshes; failure is `AppError.forbidden` `[rbacAuth.ts:requirePermission]`.
- `super_admin` and `admin` are role names, not permissions; `isAdmin`/`adminOnly` accept either `[rbacAuth.ts:adminOnly]`, `[rbacAuth.ts:isAdmin]`.
- Token lifecycle and account-takeover actions (PAT CRUD, password change, logout) must call `requireJwtSession`, which rejects `authMethod === 'pat'` with 403 (ADR 0011) `[rbacAuth.ts:requireJwtSession]`.
- `getClientIp` takes the leftmost `X-Forwarded-For` entry, which the client controls: use it for audit context only, never to key a security limit (use `middleware/rateLimitKeys.ts` instead) `[rbacAuth.ts:getClientIp]`.

## Side Effects
- On a failed `rbacAuthMiddleware` verification, writes an `AUDIT_ACTIONS.LOGIN_FAILED` audit log with IP and User-Agent `[rbacAuth.ts:rbacAuthMiddleware]`.
- Permission gates may query the RBAC database on a token miss `[rbacAuth.ts:requirePermission]`.
- Sets RBAC variables on the Hono context.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/rbac/middleware`
