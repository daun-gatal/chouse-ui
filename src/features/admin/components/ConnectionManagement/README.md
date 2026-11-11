# ConnectionManagement

## Overview

CRUD for saved ClickHouse connections with a create/edit dialog that tests the connection and shows a per-feature privilege report with GRANT statements, plus activate/deactivate, environment tags and a global collector-schedule sheet.

## Interface

- `[index.tsx:ConnectionManagement]` - default export; connections table, form dialog, delete confirmation, collection schedule sheet (`CollectorSchedule` from `@/features/observe`)
- `[index.tsx:connectionEnvironment]` - reads `metadata.environment` (production/staging/development/unset)
- `[PrivilegeReport.tsx:PrivilegeReport]` - blocked/ok/warn privilege report with copyable grants
- `[PrivilegeReport.tsx:privilegeSummary]` - one-sentence summary of what blocks the save (required features)
- `[PrivilegeReport.tsx:optionalSummary]` - one-sentence warning for optional features that are missing, or null
- `[PrivilegeReport.tsx:otherDatabasesSummary]` - one-line count of access to the other databases (information row, never blocks)

## Invariants

- Add/activate/edit need CONNECTIONS_EDIT, delete CONNECTIONS_DELETE, schedule CONNECTIONS_VIEW `[index.tsx:ConnectionManagement]`
- Zod: name, host, username required (max 255), port int default 8123 `[index.tsx:connectionSchema]`
- Editing a credential field clears the stale test result and report `[index.tsx:CREDENTIAL_FIELDS]`
- Save fails closed on missing required privileges: a `PRIVILEGES_MISSING` error keeps the dialog open with the blocked report `[index.tsx:onSubmit]` `[PrivilegeReport.tsx:PrivilegeReport]`
- Optional features (ClickHouse access admin, ADR 0031) never block: they render amber with an *Optional* tag, and a save, test or row test with one missing shows a warning toast instead of success `[index.tsx:onSubmit]` `[PrivilegeReport.tsx:optionalSummary]`
- Password sent on update only if non-empty; environment `unset` removes the metadata key `[index.tsx:onSubmit]`

## Side Effects

- `rbacConnectionsApi.list/create/update/delete/test/testSaved`, `privilegeReportFromError` (`@/api/rbac`) `[index.tsx:ConnectionManagement]`
- Embeds `ConnectionObservability` and `CollectorSchedule` which fetch their own data `[index.tsx:ConnectionManagement]`
- Clipboard writes with 1500ms reset `[PrivilegeReport.tsx:CopyButton]`; toasts; `scrollIntoView` on blocked save

## Verification

- Run: `bunx vitest run src/features/admin/components/ConnectionManagement` (from repo root; full suite: `bunx vitest run`)
