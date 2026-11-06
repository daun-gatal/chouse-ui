# rbac/components

## Overview

RBAC admin and self-service UI: roles table and 3-step role wizard, audit log viewer with export/prune, personal access tokens with write policies, OAuth connected apps and Telegram account linking.

## Interface

- `[index.ts]` - re-exports `RbacRolesTable`, `RbacAuditLogs`, `RoleFormDialog`, `PersonalAccessTokensCard`, `LinkedChatAccountsCard`
- `[RbacRolesTable.tsx:RbacRolesTable]`, `[RoleFormDialog.tsx:RoleFormDialog]` - roles
- `[RbacAuditLogs.tsx:RbacAuditLogs]`, `[RbacAuditExportDialog.tsx:RbacAuditExportDialog]`, `[RbacAuditPruneDialog.tsx:RbacAuditPruneDialog]` - audit
- `[PersonalAccessTokensCard.tsx:PersonalAccessTokensCard]`, `[TokenWritePolicyDialog.tsx:TokenWritePolicyDialog]`, `[WritePolicyFields.tsx:WritePolicyFields]` - PATs
- `[ConnectedAppsSection.tsx:ConnectedAppsSection]` / `CONNECTED_APPS_QUERY_KEY`, `[LinkedChatAccountsCard.tsx:LinkedChatAccountsCard]`

## Invariants

- ROLES_CREATE/UPDATE/DELETE gate role actions; system roles not deletable; delete disabled with users `[RbacRolesTable.tsx:RbacRolesTable]`
- Editing system roles needs super admin; >= 1 permission and, for non-system roles, >= 1 data-access policy `[RoleFormDialog.tsx:RoleFormDialog]`
- Export/Prune need AUDIT_EXPORT/AUDIT_DELETE `[RbacAuditLogs.tsx:RbacAuditLogs]`
- PAT scopes limited to the user's own permissions `[PersonalAccessTokensCard.tsx:PersonalAccessTokensCard]`
- Write-policy controls capped by the ceiling toolkits and max tier `[WritePolicyFields.tsx:WritePolicyFields]`

## Side Effects

- `rbacRolesApi`, `rbacDataAccessPoliciesApi` queries/mutations invalidating `['rbac-roles']` `[RoleFormDialog.tsx:RoleFormDialog]`
- `rbacAuditApi.list/getStats` (60s) / `exportLogs` (Blob download) / `delete` `[RbacAuditLogs.tsx:RbacAuditLogs]` `[RbacAuditExportDialog.tsx:RbacAuditExportDialog]`
- `rbacPatApi` list/create/revoke/rotate/write policy `[PersonalAccessTokensCard.tsx:PersonalAccessTokensCard]`
- `listConnectedApps`, `revokeConnectedApp`, `getChatIdentities`, `createTelegramLink`, `unlinkChatIdentity` `[ConnectedAppsSection.tsx:ConnectedAppsSection]` `[LinkedChatAccountsCard.tsx:LinkedChatAccountsCard]`

## Verification

- No co-located tests; covered by `bun run typecheck` and the `src/features` suite: `bunx vitest run src/features`
