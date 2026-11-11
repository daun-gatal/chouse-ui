# stores

## Overview
Zustand global state. Holds RBAC auth (user, roles, permissions, login/logout/SSO), the active ClickHouse connection, SQL workspace tabs, explorer tree state, user preferences, the AI model choice, Chobi assistant UI state, and the transient schema-preflight prompt. Barrel: `index.ts`.

## Interface
- `rbac.ts` - `useRbacStore` (`login`, `logout`, `checkAuth`, `completeSsoLogin`, `completeSamlLogin`, `hasPermission`, `hasAnyPermission`, `hasAllPermissions`, `hasRole`, `hasAnyRole`, `isSuperAdmin`, `isAdmin`), selectors `selectRbacUser`, `selectRbacRoles`, `selectRbacPermissions`, `selectIsRbacAuthenticated`, `selectIsRbacLoading`, `RBAC_PERMISSIONS`, `RbacPermission`, `RbacState` [rbac.ts:useRbacStore], [rbac.ts:RBAC_PERMISSIONS]
- `auth.ts` - `useAuthStore` (connection info: `sessionId`, `activeConnectionId`, `activeConnectionName`, `setConnectionInfo`), `ConnectionInfoState` / `AuthState` [auth.ts:useAuthStore]
- `workspace.ts` - `useWorkspaceStore` (tabs, `resetWorkspace`), `genTabId`, `Tab`, `WorkspaceState` [workspace.ts:useWorkspaceStore]
- `explorer.ts` - `useExplorerStore` (`clearDatabases`, favorites, recents), `FavoriteItem`, `RecentItem`, `SortOption`, `ViewMode` [explorer.ts:useExplorerStore]
- `preferences.ts` - `usePreferencesStore`, `RESULT_ROWS_MIN` (100), `RESULT_ROWS_MAX` (100,000), `RESULT_ROWS_DEFAULT` (10,000) [preferences.ts:usePreferencesStore]
- `aiModel.ts` - `useAiModelStore`, `createUserSpecificStorage` [aiModel.ts:useAiModelStore]
- `chobi.ts` - `useChobiStore`, `askContext`, `ASK_CONTEXT_MAX_CHARS`, `CHOBI_TABS`, `clampLauncherY`, `inQuietHours`, `nudgesMuted`, `userScopedStorage`, `savedChobiState`, `restoreChobiState` (not in the barrel) [chobi.ts:useChobiStore]
- `schemaPreflight.ts` - `useSchemaPreflightStore` (`ask`), `parsePreflightDetails`, `PreflightImpact`, `PreflightPrompt` (not in the barrel) [schemaPreflight.ts:useSchemaPreflightStore]

## Invariants
- Client permission checks (`hasPermission`, `isAdmin`) only gate UI; `isAdmin` is true for the `super_admin` or `admin` role, `isSuperAdmin` only for `super_admin` [rbac.ts:isAdmin], [rbac.ts:isSuperAdmin].
- `login` and SSO completions run in this order: `cleanupUserSession` for the previous user, the API call, `broadcastUserChange(newUserId)`, then `set(...)` of the new state (the broadcast goes out before the new state is set) [rbac.ts:login], [rbac.ts:completeSsoLogin].
- `rbac-storage` persists only `user`, `roles`, `permissions` [rbac.ts:useRbacStore]; `connection-info-storage` persists only connection display info (`sessionId`, `username`, `url`, `version`, active connection id and name); it holds no ClickHouse privilege or admin flag, because the app authorises from RBAC alone (#422) [auth.ts:useAuthStore].
- Persisted workspace tabs drop `result`, `isLoading`, and `error` [workspace.ts:useWorkspaceStore].
- Workspace, explorer, AI-model, preferences, and Chobi state are stored per user (keys suffixed with the user id), so two users on one browser do not share state [workspace.ts:useWorkspaceStore], [chobi.ts:userScopedStorage], [aiModel.ts:createUserSpecificStorage].
- The schema-preflight store is not persisted; a prompt lives only while its request waits [schemaPreflight.ts:useSchemaPreflightStore].
- Store tests must use dynamic imports to avoid persist initialisation issues (AGENTS.md).

## Side Effects
- localStorage via Zustand `persist`: `rbac-storage`, `connection-info-storage`, `workspace-storage-<id>`, `explorer-storage-<id>`, `preferences-storage-<id>`, `ai-model-storage-<id>`, `chobi-storage-<id>`; plus `workspace-last-user-id` / `explorer-last-user-id` [rbac.ts:useRbacStore], [auth.ts:useAuthStore], [workspace.ts:useWorkspaceStore], [explorer.ts:useExplorerStore].
- `useRbacStore` calls `rbacAuthApi` (which stores tokens via `setRbacTokens` [../api/rbac.ts:rbacAuthApi]) and clears tokens with `clearRbacTokens` on logout or failed auth checks [rbac.ts:logout], [rbac.ts:checkAuth].

## Verification
- Run: `bunx vitest run src/stores`
