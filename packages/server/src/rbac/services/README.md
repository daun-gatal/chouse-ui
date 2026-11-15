# RBAC Services

## Overview
Business logic behind the RBAC control plane: users, roles, permissions,
sessions and audit logs; password hashing and JWTs; bearer verification for
JWTs, personal access tokens and MCP OAuth tokens; encrypted ClickHouse
connections and AI provider credentials; data access policies and their rule
evaluation; native ClickHouse user/role/grant management; saved queries; user
preferences; and the first-run seed. Called by [`../routes/`](../routes/README.md),
[`../middleware/`](../middleware/README.md), and feature code across the server.

## Interface
- `rbac.ts`: users (`createUser`, `getUserById`, `getUserByEmailOrUsername`, `updateUser`, `updateUserPassword`, `completeBootstrapOnboarding`, `deleteUser`, `listUsers`), roles (`createRole`, `getRoleById`, `getRoleByName`, `updateRole`, `deleteRole`, `listRoles`), permissions (`listPermissions`, `getPermissionsByCategory`, `userHasPermission`, `userHasAnyPermission`, `userHasAllPermissions`, `getUserPermissions`, `getUserRoles`), sessions (`createSessionAndTokens`, `authenticateUser`, `refreshAccessToken`, `logoutUser`, `logoutAllSessions`), audit (`createAuditLog`, `createAuditLogWithContext`, `getAuditLogs`, `deleteAuditLogs`, `getAuditMetadata`) `[rbac.ts]`.
- `password.ts`: `[password.ts:hashPassword]`, `[password.ts:verifyPassword]`, `[password.ts:validatePasswordStrength]`, `[password.ts:generateSecurePassword]`, `[password.ts:needsRehash]`.
- `jwt.ts` (`jose`): `[jwt.ts:generateAccessToken]`, `[jwt.ts:generateRefreshToken]`, `[jwt.ts:generateTokenPair]`, `[jwt.ts:verifyToken]`, `[jwt.ts:verifyAccessToken]`, `[jwt.ts:verifyRefreshToken]`, `[jwt.ts:extractTokenFromHeader]`, `[jwt.ts:getJwtSecretKey]`, `[jwt.ts:getTokenExpiration]`, `[jwt.ts:isTokenExpiringSoon]`, `[jwt.ts:getRefreshTokenExpiryMs]`, type `TokenPayload`.
- `patAuth.ts`: `[patAuth.ts:verifyBearer]` (single entry for all bearer types), `[patAuth.ts:toTokenPayload]`, types `AuthMethod` (`jwt | pat`), `BearerIdentity`.
- `tokenScope.ts`: `[tokenScope.ts:withRequestScope]` (one holder per request), `[tokenScope.ts:setTokenScope]`, `[tokenScope.ts:runWithTokenScope]`, `[tokenScope.ts:tokenPermissionsFor]`, `[tokenScope.ts:narrowedAdminToken]`, `[tokenScope.ts:asCredential]` (an account loaded from the database, as the request's credential carries it) - the permission list of the token behind the current request.
- `personalAccessTokens.ts`: `[personalAccessTokens.ts:PAT_PREFIX]` (`ch_pat_`), `PAT_KIND`, `hashPatToken`, `createPat`, `listPats`, `ownsLiveKey`, `revokePat`, `rotatePat`, `verifyPatToken`, `resolveKeyIdentity`, `touchPatLastUsed`, `[personalAccessTokens.ts:patOwner]` (owner id by token hash for rate limiting: no expiry/revocation checks, no writes, `null` when unknown).
- `connections.ts`: `[connections.ts:encryptPassword]` / `[connections.ts:decryptPassword]` (aliases `encryptSecret`/`decryptSecret`), `deriveServerSecret`, `createConnection`, `getConnectionById`, `getConnectionWithPassword`, `listConnections`, `updateConnection`, `deleteConnection`, `getDefaultConnection`, `testConnection`, `testSavedConnection`, `getUserConnections`, `listConnectionDatabases`, `listConnectionTables`.
- `dataAccess.ts`: `[dataAccess.ts:getRulesForUser]`, `getRulesForRole`, `[dataAccess.ts:evaluateRules]`, `checkUserAccess`, `checkRoleAccess`, `filterDatabasesForUser`, `filterTablesForUser`.
- `dataAccessPolicies.ts`: `createPolicy`, `getPolicyById`, `listPolicies`, `updatePolicy`, `deletePolicy`, `replacePolicyRules`, `getPoliciesForRole`, `getRolesForPolicy`, `setPoliciesForRole`, `getPolicyIdsForRole`, `getPolicyRulesForRoleIds` `[dataAccessPolicies.ts]`.
- `systemTables.ts`: `[systemTables.ts:systemTablePermission]`, `[systemTables.ts:systemTableRefusal]` - the `system` tables that show other people's work and the permission each needs (ADR 0033 §4).
- `connectionIdentity.ts`: `[connectionIdentity.ts:getIdentity]`, `[connectionIdentity.ts:checkIdentityChange]`, `[connectionIdentity.ts:switchIdentity]`, `[connectionIdentity.ts:setAccessContact]`, `[connectionIdentity.ts:getRoleMap]`, `[connectionIdentity.ts:setRoleMap]`, `[connectionIdentity.ts:roleIsMapped]`, `[connectionIdentity.ts:mappedRoleIds]`, `[connectionIdentity.ts:ceilingSetupStatements]` - connection kinds and the role ceiling (ADR 0033 §5, §6).
- `clickhouseBindings.ts` (ADR 0033 §7.4): `[clickhouseBindings.ts:createBinding]`, `[clickhouseBindings.ts:confirmBinding]`, `[clickhouseBindings.ts:recheckBinding]`, `[clickhouseBindings.ts:removeBinding]`, `[clickhouseBindings.ts:testBinding]`, `[clickhouseBindings.ts:suspendBindingsOf]`, `[clickhouseBindings.ts:checkConnectionBindings]`, `[clickhouseBindings.ts:listBindingsOfConnection]`, `[clickhouseBindings.ts:listBindingsOfUser]`, `[clickhouseBindings.ts:getBinding]`, `[clickhouseBindings.ts:grantScript]`, `[clickhouseBindings.ts:bindingCounts]`; `[connectionIdentity.ts:personalSetupStatements]`.
- `clickhousePrivileges.ts`: `[clickhousePrivileges.ts:CH_PRIVILEGES]` catalog, `normalizePrivilege`, `assertValidPrivilege`, `formatGrantTarget`, `clusterClause`, grant-atom diffing (`grantToAtoms`, `diffAtoms`, `atomsToStatements`, `buildGrantDiffStatements`, `buildGrantStatements`, `systemGrantRowsToGrants`), quoting helpers `escapeIdentifier`, `quoteIdent`, `escapeLiteral`.
- `clickhouseRoles.ts`: `listClickHouseRoles`, `getClickHouseRole`, `createClickHouseRole`, `updateClickHouseRole`, `deleteClickHouseRole`, `generateCreateRoleDDL`, `generateRoleDiffDDL`, `disableClickHouseRole`, `enableClickHouseRole`, `getDisabledRoleNames`, `listClickHousePrivileges` `[clickhouseRoles.ts]`.
- `clickhouseUsers.ts`: `listClickHouseUsers`, `getClickHouseUser`, `createClickHouseUser`, `updateClickHouseUser`, `deleteClickHouseUser`, `generateUserDDL`, `generateUpdateUserDDL`, `getCurrentUserState`, `extractRoleFromUser` `[clickhouseUsers.ts]`.
- `aiModels.ts`: CRUD for AI providers, models, and configs plus `[aiModels.ts:getAiConfigWithKey]` and `[aiModels.ts:getDefaultAiConfig]` (decrypted key for runtime use).
- `savedQueries.ts`, `userPreferences.ts`: per-user saved queries; favorites, recent items, preferences, and onboarding progress (`mergeOnboardingProgress`, `normalizeOnboardingProgress`).
- `seed.ts`: `[seed.ts:seedDatabase]`, `seedPermissions`, `seedRoles`, `seedSuperAdmin`, `needsSeeding`, catalogs `PERMISSION_CATEGORIES`, `PERMISSION_DISPLAY_NAMES`, `ROLE_DEFINITIONS`.
- `index.ts` re-exports `password`, `jwt`, `rbac`, `seed`, `connections`, `savedQueries` only; import the others by path.

## Invariants
- Passwords are hashed with Argon2id via `Bun.password.hash`; minimum length is 8 `[password.ts:hashPassword]`, `[password.ts:validatePasswordStrength]`.
- In production, `JWT_SECRET` must be set and at least 32 characters or the module throws at import; tokens use `JWT_ISSUER` (default `chouseui`) and `JWT_AUDIENCE` (default `chouseui-client`); access/refresh expiry come from `JWT_ACCESS_EXPIRY`/`JWT_REFRESH_EXPIRY` (defaults `4h`/`7d`) `[jwt.ts]`.
- Connection passwords and other secrets use AES-256-GCM. In production `RBAC_ENCRYPTION_KEY` (at least 32 characters) and `RBAC_ENCRYPTION_SALT` are required or key derivation throws; outside production the key falls back to `JWT_SECRET`, then a hard-coded dev key `[connections.ts:getEncryptionKey]`.
- `verifyBearer` accepts `ch_oat_` OAuth tokens only when `allowOAuth` is set; PATs and OAuth grants both resolve to `authMethod: "pat"` so every token fence applies to both `[patAuth.ts:verifyBearer]`.
- While a token's request runs, `userHasPermission`, `userHasAnyPermission` and `userHasAllPermissions` answer a question about the token's owner from the token's own list (`[tokenScope.ts:tokenPermissionsFor]`), never from the owner's roles; a question about another account, and any question outside a token's request, reads the database as before. `getUserPermissions` always returns the owner's full list: it is what a token's scope is validated against, not a check `[rbac.ts:userHasPermission]`.
- A PAT carries no permissions of its own: each verification re-resolves the owner's live roles/permissions and intersects them with the token's scopes (empty = full inherit) `[personalAccessTokens.ts]` header.
- A token that names a scope does not carry `super_admin` or `admin`: they are removed from its roles and `adminOwner` records that the owner is one `[personalAccessTokens.ts:resolveKeyIdentity]`. Connection reach stays the account's: a super admin account gets every active connection from `[connections.ts:getUserConnections]`, whatever credential asks.
- Data access: rules are sorted by priority, deny before allow at equal priority; no matching rule means no access; system databases are queryable by default but hidden from the UI `[dataAccess.ts:evaluateRules]`.
- The statement and session logs of `system` (and a rotated `<name>_<n>` copy) need `query:history:view:all`; the access tables need `clickhouse:users:view`; every other system table needs nothing `[systemTables.ts:systemTablePermission]`.
- A switch of kind or login is one write, made only after the identity checks and the privilege check for the new kind pass (`[connectionIdentity.ts:switchIdentity]`). A role map entry holds a ClickHouse role name of letters, digits and underscores, and a CHouse role maps to at most one per connection (`[connectionIdentity.ts:setRoleMap]`). A connection response carries its kind, system role, access contact and stored verdict.
- A binding moves only on what ClickHouse answered: a check that could not run changes nothing. A suspended or disabled binding is never tested; a super admin confirms the first, and only removal ends the second (`[clickhouseBindings.ts:testBinding]`, `[clickhouseBindings.ts:confirmBinding]`).
- A binding stores the ClickHouse user's id read by name; a different id later disables it. `default`, a connection's login, the connection's remediation login and a user who (or whose roles) can manage users, pass grants on or act as another user cannot be bound (`[clickhouseBindings.ts:createBinding]`).
- Every binding state change is audited; no function here takes or stores a ClickHouse password.
- `[connections.ts:getUserConnections]` lists a `personal` connection for an account only through a binding, and any other kind only through a policy.
- A data-access rule grants access to a connection only if it is an allow rule scoped to that connection; null-connection rules apply only on connections the user can already reach `[connections.ts:getUserConnections]`.
- ClickHouse is the source of truth for native roles/users (`system.roles`, `system.users`, `system.grants`, `system.role_grants`); edits issue only the changed GRANT/REVOKE statements `[clickhouseRoles.ts]`, `[clickhouseUsers.ts]` headers.
- The seed super admin comes from `RBAC_ADMIN_EMAIL`/`RBAC_ADMIN_USERNAME`/`RBAC_ADMIN_PASSWORD` (defaults `admin@localhost`/`admin`/`admin123!`); with the default password the user must change it on first login `[seed.ts:seedSuperAdmin]`.

## Side Effects
- RBAC database reads/writes for users, roles, sessions, audit logs, connections, policies, PATs, AI configs, saved queries, preferences `[rbac.ts]`, `[connections.ts]`, `[personalAccessTokens.ts]`, `[aiModels.ts]`.
- ClickHouse DDL (`CREATE/ALTER/DROP USER|ROLE`, `GRANT`, `REVOKE`) and `system.*` reads on managed connections `[clickhouseRoles.ts]`, `[clickhouseUsers.ts]`.
- Outbound connections to ClickHouse when testing or listing a connection's databases/tables `[connections.ts:testConnection]`.
- PAT verification updates `last_used` asynchronously (`void touchPatLastUsed`) `[patAuth.ts:verifyBearer]`.
- `seedDatabase` inserts permissions, system roles, role grants, and the super admin; logs a warning when the default admin password is in use `[seed.ts]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/rbac/services`
