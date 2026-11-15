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
- Permission gates check the credential's permissions first and, on a miss, ask `userHasPermission` and friends. For a browser session that reads the database, so a newly granted permission applies before the session refreshes. For a token (`authMethod === 'pat'`: a PAT or an OAuth grant) it answers from the token's own list, so a scope is never widened; failure is `AppError.forbidden` `[rbacAuth.ts:requirePermission]`.
- Every middleware that verifies a bearer token records the token's permission list in the request's holder (`[rbacAuth.ts:rememberCredential]`, read by `[../services/tokenScope.ts:tokenPermissionsFor]`), and clears it for a browser session. The holder is opened by the server's outermost middleware, so a handler's own "list, else database" check is held to the scope even when a router runs the auth middleware with an empty continuation. `[rbacAuth.ts:inTokenScope]` does the same for code that runs a middleware without that holder.
- A token that names a scope does not carry `super_admin` or `admin` (removed when it is resolved), so a role check never passes for it; `tokenAdminOwner` records that its owner is one. A route gated by a role alone calls `[rbacAuth.ts:refuseScopedToken]`, which rejects such a token (`tokenScoped`) with a 403 that says why.
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
