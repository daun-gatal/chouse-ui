# ClickHouseUsers

## Overview

Lists native ClickHouse users and opens `ClickHouseUserWizard` for create/edit, with delete, an extract-direct-grants-to-role action and automatic session reconnect.

## Interface

- `[index.tsx:ClickHouseUsersManagement]` - default export; users table, user wizard, delete and extract-to-role dialogs

## Invariants

- Create needs CH_USERS_CREATE, edit CH_USERS_UPDATE, delete CH_USERS_DELETE, extract CH_ROLES_CREATE `[index.tsx:ClickHouseUsersManagement]`
- "Extract to role" shows only for read-only users or users with direct grants; Edit and Delete are hidden for read-only users `[index.tsx:ClickHouseUsersManagement]`
- Extract requires a non-empty trimmed role name (default `${user}_role`) `[index.tsx:handleExtractRole]`
- Roles list fails soft to []; a no-session error triggers one reconnect and retry `[index.tsx:loadAll]`

## Side Effects

- `rbacClickHouseUsersApi.list/delete/extractRole`, `rbacClickHouseRolesApi.list` `[index.tsx:loadAll]`
- Session reconnect via `useChReconnect` `[index.tsx:loadAll]`
- Toasts and `log.error`; manual refetch after mutations

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
