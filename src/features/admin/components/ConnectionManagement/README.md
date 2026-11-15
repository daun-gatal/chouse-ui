# ConnectionManagement

## Overview

CRUD for saved ClickHouse connections with a create/edit dialog that tests the connection and shows a per-feature privilege report with GRANT statements, plus activate/deactivate, environment tags and a global collector-schedule sheet. For a super admin it also holds the ClickHouse login panel (ADR 0033): a connection's kind (shared login, role ceiling or personal), the switch to another login, its checks, and the map from CHouse roles to ClickHouse roles; and the linked ClickHouse users panel: which account runs as which ClickHouse user on a personal connection.

## Interface

- `[index.tsx:ConnectionManagement]` - default export; connections table, form dialog, delete confirmation, collection schedule sheet (`CollectorSchedule` from `@/features/observe`)
- `[index.tsx:connectionEnvironment]` - reads `metadata.environment` (production/staging/development/unset)
- `[PrivilegeReport.tsx:PrivilegeReport]` - blocked/ok/warn privilege report with copyable grants
- `[PrivilegeReport.tsx:privilegeSummary]` - one-sentence summary of what blocks the save (required features)
- `[PrivilegeReport.tsx:optionalSummary]` - one-sentence warning for optional features that are missing, or null
- `[PrivilegeReport.tsx:otherDatabasesSummary]` - one-line count of access to the other databases (information row, never blocks)
- `[PrivilegeReport.tsx:CopyButton]` - copy-to-clipboard button, shared with the identity panel
- `[IdentityPanel.tsx:IdentityPanel]` - sheet for one connection (`connection`, `onClose`, `onChanged`): current kind, user, system role and health with *Check now*; the switch form with *Check* and *Save*; check rows and the privilege report; role map (role ceiling); setup statements for the ClickHouse administrator (the role ceiling's or the personal ones)
- `[BindingsPanel.tsx:BindingsPanel]` - sheet for one connection (`connection`, `onClose`): the table of links with *Check again* / *Confirm* / *Remove*, the *Add link* form (account search and ClickHouse user), the grant script, the users without a link and the readiness line; `[BindingsPanel.tsx:readinessLine]`, `[BindingsPanel.tsx:clickhouseUserProblem]`, `[BindingsPanel.tsx:connectionBindingsKey]`
- `[RoleMapEditor.tsx:RoleMapEditor]` - one row per CHouse role with its ClickHouse role name (`connectionId`, `onSaved`); Save replaces the whole map
- `formStyles.ts` - class names shared by the dialogs and the panels `[formStyles.ts:INPUT_CLASS]` `[formStyles.ts:SECTION_TITLE_CLASS]`

## Invariants

- Add/activate/edit need CONNECTIONS_EDIT, delete CONNECTIONS_DELETE, schedule CONNECTIONS_VIEW `[index.tsx:ConnectionManagement]`
- Zod: name, host, username required (max 255), port int default 8123 `[index.tsx:connectionSchema]`
- Editing a credential field clears the stale test result and report `[index.tsx:CREDENTIAL_FIELDS]`
- Save fails closed on missing required privileges: a `PRIVILEGES_MISSING` error keeps the dialog open with the blocked report `[index.tsx:onSubmit]` `[PrivilegeReport.tsx:PrivilegeReport]`
- Optional features (ClickHouse access admin, ADR 0031) never block: they render amber with an *Optional* tag, and a save, test or row test with one missing shows a warning toast instead of success `[index.tsx:onSubmit]` `[PrivilegeReport.tsx:optionalSummary]`
- Password sent on update only if non-empty; environment `unset` removes the metadata key `[index.tsx:onSubmit]`
- The ClickHouse login and linked ClickHouse users actions and panels render only when `isSuperAdmin()`; this is UI gating, the server refuses everyone else with 403 `[index.tsx:ConnectionManagement]`
- A connection whose kind is not a shared login shows a kind badge, and a failing login a marker with the reason; its edit dialog disables host, port, TLS, user and password and leaves them out of the update (the server answers 409 `IDENTITY_MANAGED_LOGIN` otherwise) `[index.tsx:onSubmit]`
- *Check* saves nothing; *Save* is the only write of kind, login and role names, and a change of user or kind asks for confirmation first, with the warning that the new user replaces the old one at once `[IdentityPanel.tsx:IdentityPanel]`
- Password is required when the ClickHouse user changes and is otherwise sent only if non-empty; the system role is sent for a role ceiling and a personal connection; the impersonation role only for a personal one, where it must match `CLICKHOUSE_ROLE_NAME` and differ from the system role; host, port and TLS only when *Change server* is open `[IdentityPanel.tsx:changeFrom]` `[IdentityPanel.tsx:formProblem]`
- A refused save (`IDENTITY_CHECK_FAILED`) keeps the form, shows the failing checks and stores nothing; editing the form clears a shown result `[IdentityPanel.tsx:IdentityPanel]`
- A kind this build does not know is named as such, with the notice that the connection refuses requests until it is switched; the form then starts on a shared login `[IdentityPanel.tsx:formFrom]`
- The selected kind decides what is prepared, and the stored kind while the form says shared login: a role ceiling shows the role map and its setup statements, a personal connection shows `personalSetupStatements` and no role map `[IdentityPanel.tsx:IdentityPanel]`
- The linked ClickHouse users panel opens for every kind, so links can be prepared first; on a kind other than personal it says the links are not in use `[BindingsPanel.tsx:BindingsPanel]`
- A link is added only with an account chosen and a ClickHouse user that matches `CLICKHOUSE_USER_NAME` and is not `default`; an account already linked on the connection cannot be chosen; a refused link shows the server's message and keeps the form `[BindingsPanel.tsx:clickhouseUserProblem]` `[BindingsPanel.tsx:BindingsPanel]`
- *Check again* shows on waiting and active links, *Confirm* on suspended ones, *Remove* on all and only after a confirmation dialog; CHouse never runs the grant or revoke statements it shows `[BindingsPanel.tsx:BindingsPanel]`
- A ClickHouse role name must match `CLICKHOUSE_ROLE_NAME`; an empty name means not mapped and is left out of the save; Save is off while a name is invalid or nothing changed `[RoleMapEditor.tsx:RoleMapEditor]`
- With `report.kind` set the report says it was checked on the system role, and a feature with `source` `mapped_role` / `person` / `unavailable` shows that instead of granted/missing; without `kind` it renders as before `[PrivilegeReport.tsx:FeatureRow]`

## Side Effects

- `rbacConnectionsApi.list/create/update/delete/test/testSaved`, `privilegeReportFromError` (`@/api/rbac`) `[index.tsx:ConnectionManagement]`
- Embeds `ConnectionObservability` and `CollectorSchedule` which fetch their own data `[index.tsx:ConnectionManagement]`
- `getConnectionIdentity`, `checkConnectionIdentity`, `switchConnectionIdentity`, `setConnectionAccessContact`, `recheckConnectionIdentity` (`@/api/connectionIdentity`); a save, a contact save and *Check now* call `onChanged`, which reloads the list `[IdentityPanel.tsx:IdentityPanel]`
- `rbacRolesApi.list`, `getConnectionRoleMap`, `setConnectionRoleMap` `[RoleMapEditor.tsx:RoleMapEditor]`
- TanStack query `['clickhouse-bindings', connectionId]` (`getConnectionBindings`) and `rbacUsersApi.list` for the account search; `createBinding`, `confirmBinding`, `recheckBinding`, `removeBinding` invalidate it and `['my-clickhouse-links']` `[BindingsPanel.tsx:BindingsPanel]`
- Clipboard writes with 1500ms reset `[PrivilegeReport.tsx:CopyButton]`; toasts; `scrollIntoView` on blocked save

## Verification

- Run: `bunx vitest run src/features/admin/components/ConnectionManagement` (from repo root; full suite: `bunx vitest run`)
