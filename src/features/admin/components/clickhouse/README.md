# clickhouse

## Overview

Building blocks for native ClickHouse user/role management: user and role wizards, a privilege-tree picker, a database/table scope picker, a cluster dropdown and a session-reconnect hook.

## Interface

- `[ClickHouseUserWizard.tsx:ClickHouseUserWizard]` - 3-step create/edit user dialog
- `[ClickHouseRoleWizard.tsx:ClickHouseRoleWizard]` - 4-step create/edit role dialog
- `[CHPrivilegeTree.tsx:CHPrivilegeTree]` - privilege tree emitting a minimal privilege set
- `[CHScopePicker.tsx:CHScopePicker]` / `CHScope` - `*.*`, `db.*` or `db.table` scope picker
- `[ClusterSelect.tsx:ClusterSelect]` - cluster dropdown (empty = no ON CLUSTER)
- `[useChReconnect.ts:useChReconnect]` / `isNoSessionError` - re-activate the active connection; detect `NO_SESSION` errors

## Invariants

- Usernames and role names on create must match `/^[a-zA-Z_][a-zA-Z0-9_]*$/` `[ClickHouseUserWizard.tsx:ClickHouseUserWizard]` `[ClickHouseRoleWizard.tsx:ClickHouseRoleWizard]`
- User create needs >= 1 role and, unless `no_password`, a password of >= 8 chars with upper, lower, digit, special; on edit the password is optional, but a typed one must pass the same checks `[ClickHouseUserWizard.tsx:passwordValid]`
- Existing column-level grants are preserved unchanged `[ClickHouseRoleWizard.tsx:ClickHouseRoleWizard]`
- Privileges implied by a selected ancestor are locked; selecting a parent drops redundant descendants `[CHPrivilegeTree.tsx:CHPrivilegeTree]`
- `isNoSessionError` matches only `ApiError.code === "NO_SESSION"` or the messages "no active clickhouse session" / "session not found" / "please reconnect"; it does not match `CONNECTION_CONTEXT_STALE`, although the file header says the server now reports that code — known issue, see [ARCHITECTURE.md › Known issues](../../../../../ARCHITECTURE.md#known-issues) `[useChReconnect.ts:isNoSessionError]`
- No permission gating in this directory (callers gate)

## Side Effects

- `rbacClickHouseUsersApi.get/create/update/getClusters` `[ClickHouseUserWizard.tsx:ClickHouseUserWizard]` `[ClusterSelect.tsx:ClusterSelect]`
- `rbacClickHouseRolesApi.get/create/update` `[ClickHouseRoleWizard.tsx:ClickHouseRoleWizard]`
- `getDatabases()` from `@/api/explorer` `[CHScopePicker.tsx:CHScopePicker]`
- `activateConnection({connectionId, queryClient})` using `useAuthStore` `[useChReconnect.ts:useChReconnect]`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
