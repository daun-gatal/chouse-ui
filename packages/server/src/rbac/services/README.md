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
- `personalAccessTokens.ts`: `[personalAccessTokens.ts:PAT_PREFIX]` (`ch_pat_`), `PAT_KIND`, `hashPatToken`, `createPat`, `listPats`, `ownsLiveKey`, `revokePat`, `rotatePat`, `verifyPatToken`, `resolveKeyIdentity`, `touchPatLastUsed`, `[personalAccessTokens.ts:patOwner]` (owner id by token hash for rate limiting: no expiry/revocation checks, no writes, `null` when unknown).
- `connections.ts`: `[connections.ts:encryptPassword]` / `[connections.ts:decryptPassword]` (aliases `encryptSecret`/`decryptSecret`), `deriveServerSecret`, `createConnection`, `getConnectionById`, `getConnectionWithPassword`, `listConnections`, `updateConnection`, `deleteConnection`, `getDefaultConnection`, `testConnection`, `testSavedConnection`, `getUserConnections`, `listConnectionDatabases`, `listConnectionTables`.
- `dataAccess.ts`: `[dataAccess.ts:getRulesForUser]`, `getRulesForRole`, `[dataAccess.ts:evaluateRules]`, `checkUserAccess`, `checkRoleAccess`, `filterDatabasesForUser`, `filterTablesForUser`.
- `dataAccessPolicies.ts`: `createPolicy`, `getPolicyById`, `listPolicies`, `updatePolicy`, `deletePolicy`, `replacePolicyRules`, `getPoliciesForRole`, `getRolesForPolicy`, `setPoliciesForRole`, `getPolicyIdsForRole`, `getPolicyRulesForRoleIds` `[dataAccessPolicies.ts]`.
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
- A PAT carries no permissions of its own: each verification re-resolves the owner's live roles/permissions and intersects them with the token's scopes (empty = full inherit) `[personalAccessTokens.ts]` header.
- Data access: rules are sorted by priority, deny before allow at equal priority; no matching rule means no access; system databases are queryable by default but hidden from the UI `[dataAccess.ts:evaluateRules]`.
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
