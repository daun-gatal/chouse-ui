# ClickHouseRoles

## Overview

Lists native ClickHouse roles and opens `ClickHouseRoleWizard` for create/edit, with enable/disable, delete and automatic reconnect when the ClickHouse session has expired.

## Interface

- `[index.tsx:ClickHouseRolesManagement]` - default export; roles table, role wizard, delete dialog, disconnected state

## Invariants

- Create needs CH_ROLES_CREATE, toggle/edit CH_ROLES_UPDATE, delete CH_ROLES_DELETE; read-only roles hide toggle, edit and delete; Edit is also hidden for disabled roles `[index.tsx:ClickHouseRolesManagement]`
- Delete disabled while `assignedCount > 0` `[index.tsx:ClickHouseRolesManagement]`
- On a no-session error, reconnect and retry once, then show the disconnected state `[index.tsx:loadRoles]`

## Side Effects

- `rbacClickHouseRolesApi.list/getPrivileges/delete/enable/disable` (`@/api/rbac`) `[index.tsx:loadRoles]`
- Session reconnect via `useChReconnect` `[index.tsx:loadRoles]`
- Toasts and `log.error` on failure; manual refetch after mutations

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
