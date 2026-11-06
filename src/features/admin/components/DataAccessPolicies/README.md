# DataAccessPolicies

## Overview

Admin UI to list, create, edit and delete named data access policies (allow/deny database/table pattern rules scoped per connection) through a three-step wizard.

## Interface

- `[index.tsx:DataAccessPolicies]` - named and default export; policies table and Connections > Access > Details wizard

## Invariants

- New needs DATA_ACCESS_CREATE, edit DATA_ACCESS_UPDATE, delete DATA_ACCESS_DELETE `[index.tsx:DataAccessPolicies]`
- System policies cannot be deleted; delete disabled while attached to a role `[index.tsx:DataAccessPolicies]`
- Steps need >= 1 connection, >= 1 rule, and a name of >= 2 chars `[index.tsx:step1Valid]` `[index.tsx:step2Valid]` `[index.tsx:step3Valid]`
- Empty patterns saved as `*`; removing a connection prunes its rules; global rules preserved `[index.tsx:saveMutation]` `[index.tsx:toggleScopeConn]`

## Side Effects

- TanStack queries `['rbac-data-access-policies']` and `['rbac-connections']`; mutations invalidate the policies key `[index.tsx:saveMutation]` `[index.tsx:deleteMutation]`
- Direct `rbacDataAccessPoliciesApi.listDatabases/listTables` calls `[index.tsx:loadDatabases]` `[index.tsx:toggleDb]`
- Toasts and `log.error`; delete has no confirmation dialog

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
