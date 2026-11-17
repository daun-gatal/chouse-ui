# ConnectionManagement

## Overview

The list of saved ClickHouse connections and one panel to create and edit them (ADR 0033, ADR 0034). Each row shows the connection's kind, the health of a role-ceiling or personal login, and who can query it; its actions are Test, Active, Edit and Delete on every kind. The panel is a right-side sheet with three tabs that each save on their own: **General** (name, environment, active, default, collection schedule), **ClickHouse login** (one form for the kind and the login of every kind, with Test and Save or Create) and **Who can query** (the role map of a role ceiling, the person links of a personal connection, the data access policies of a shared login). The rules the panel follows are pure functions in `loginForm.ts`.

## Interface

- `[index.tsx:ConnectionManagement]` - default export; connections table with the login and readiness pills, the connection panel, delete confirmation, collection schedule sheet (`CollectorSchedule` from `@/features/observe`)
- `[ConnectionPanel.tsx:ConnectionPanel]` - the panel for one connection, or for a new one when `connection` is null (`initialTab`, `onClose`, `onReload` reloading the list, `onCreated`); `[ConnectionPanel.tsx:connectionIdentityKey]` is the query key of a super admin's read of the login
- `[GeneralTab.tsx:GeneralTab]` - name, environment, active, default and `ConnectionObservability`; while creating, only name and environment
- `[LoginTab.tsx:LoginTab]` - the login form (kind, host, port, TLS, user, password, default database, system role, impersonation role, access contact) with Test, Save / Create, the kind hint, "What changes for people", the footer warning, the health line with *Re-run checks*, and the read-only view for someone who cannot change the login
- `[WhoCanQueryTab.tsx:WhoCanQueryTab]` - who can query, by kind; counts and the access contact for someone who is not a super admin
- `[KindPicker.tsx:KindPicker]` - the Kind dropdown: each kind with a description, locked kinds with the reason
- `[CheckResults.tsx:CheckResults]` - what a Test, Create, Save or re-check found, grouped "For your ClickHouse admin" (with statements to copy), "For you" and "Passed · n", plus the privilege report when a feature is missing
- `[ScriptDialog.tsx:ScriptDialog]` - the setup script for the ClickHouse administrator, with the *New empty user* / *Empty the current user* toggle and Copy
- `[PersonLinks.tsx:PersonLinks]` - the links of one connection (`connection`, `onChanged`): the table with *Check again* / *Confirm* / *Remove*, the *Link a person* form, the GRANT script, the users without a link and the readiness line; `[PersonLinks.tsx:readinessLine]`, `[PersonLinks.tsx:clickhouseUserProblem]`, `[PersonLinks.tsx:connectionBindingsKey]`
- `[RoleMapEditor.tsx:RoleMapEditor]` - one row per CHouse role with its ClickHouse role name and its people (`connectionId`, `onSaved`, `viewerRoles`, `onDirtyChange`, `saveRef`); *Save mappings* replaces the whole map
- `[PrivilegeReport.tsx:PrivilegeReport]` - blocked/ok/warn privilege report with copyable grants; `[PrivilegeReport.tsx:privilegeSummary]`, `[PrivilegeReport.tsx:optionalSummary]`, `[PrivilegeReport.tsx:otherDatabasesSummary]`, `[PrivilegeReport.tsx:CopyButton]` (shared by the panel)
- `loginForm.ts` - the pure rules: drafts `[loginForm.ts:loginDraftFrom]` `[loginForm.ts:generalDraftFrom]`, request routing `[loginForm.ts:loginRoute]`, request bodies `[loginForm.ts:identityChangeFrom]` `[loginForm.ts:loginPatch]` `[loginForm.ts:generalPatch]` `[loginForm.ts:createSharedInput]` `[loginForm.ts:sharedTestInput]`, validation `[loginForm.ts:loginProblem]` `[loginForm.ts:nameProblem]` `[loginForm.ts:kindLock]`, copy `[loginForm.ts:kindHint]` `[loginForm.ts:peopleNote]` `[loginForm.ts:footerWarning]` `[loginForm.ts:resultHeadline]`, the script `[loginForm.ts:setupScript]`, check grouping `[loginForm.ts:groupChecks]`, list pills `[loginForm.ts:readinessPill]` `[loginForm.ts:loginPill]` `[loginForm.ts:whoCount]`, and `[loginForm.ts:connectionEnvironment]`
- `panelParts.tsx` - `[panelParts.tsx:Section]`, `[panelParts.tsx:Note]`, `[panelParts.tsx:StatusPill]`, `[panelParts.tsx:KindBadge]`, `[panelParts.tsx:Fact]`
- `formStyles.ts` - class names shared by the tabs and dialogs `[formStyles.ts:INPUT_CLASS]` `[formStyles.ts:SECTION_TITLE_CLASS]`

## Invariants

- Add and Edit (and the pills that open the panel) need CONNECTIONS_EDIT, delete CONNECTIONS_DELETE, schedule CONNECTIONS_VIEW `[index.tsx:ConnectionManagement]`
- Every tab is visible to everyone who opens the panel; Who can query is disabled until the connection exists `[ConnectionPanel.tsx:ConnectionPanel]`
- Each tab saves on its own. Leaving a tab, or closing, with unsaved changes asks Stay / Discard / Save and go; a refused Save and go stays on the tab. While creating, General and ClickHouse login are one form, so moving between them asks nothing, and closing offers only Stay / Discard `[ConnectionPanel.tsx:ConnectionPanel]`
- General's save never sends a login field, and sends `isActive` / `isDefault` only when they change; the server's `CONNECTION_NOT_READY` shows under the Default toggle `[loginForm.ts:generalPatch]` `[GeneralTab.tsx:GeneralTab]`
- Save, Create and Test go where `loginRoute` says: create + shared login → `POST /connections` (Test `POST /connections/test`); create + any other kind → `POST /connections/identity` (Test `POST /connections/identity/check`); stored shared login kept shared → `PATCH /connections/:id` with only the changed login fields (Test `POST /connections/test` with the connection id); anything else → `PUT /connections/:id/identity` (Test `POST /connections/:id/identity/check`). Only the access contact changing on a kept kind is saved with `PUT …/identity/contact`, without the checks `[loginForm.ts:loginRoute]` `[LoginTab.tsx:LoginTab]`
- Test saves nothing. Create needs General's name: without it the panel shows General with the problem and sends nothing `[loginForm.ts:nameProblem]`
- A role-ceiling or personal login is changed by a super admin only: anyone else sees it read-only with "Only a super admin can change the login of …. Ask <access contact>." An admin can choose only Shared login; a kind the server cannot run is locked with the server's reason, except the stored kind `[loginForm.ts:kindLock]` `[LoginTab.tsx:LoginTab]`
- Password: empty keeps the stored one on edit, except for a new user, or (on the identity routes) another host or port or TLS turned off; creating a role-ceiling or personal login needs one; at most 1000 characters. Port 1–65535; role names match `CLICKHOUSE_ROLE_NAME` and the impersonation role differs from the system role `[loginForm.ts:loginProblem]`
- The kind hint shows when the selected kind differs from the stored one, or at create for a kind other than a shared login; when the stored user is a shared login's (it has grants) it names it and offers a new empty user or emptying it. "What changes for people" shows on a switch to personal or back to a shared login `[loginForm.ts:kindHint]` `[loginForm.ts:peopleNote]`
- The footer warns "<old user> keeps working until you save." when the user changes, "Queries on this connection fail until you save." when only the kind changes, and nothing else `[loginForm.ts:footerWarning]`
- The setup script is built from the form's names, never contains the password, and the *Empty the current user* variant swaps `CREATE USER` for `REVOKE ALL ON *.* FROM <current user>;` `[loginForm.ts:setupScript]`
- Editing a login field clears a shown result; a refused save (`IDENTITY_CHECK_FAILED`, `KIND_UNSUPPORTED_ON_SERVER`, `PRIVILEGES_MISSING`) keeps the form and shows why; `CONNECTION_CHANGED` asks to reload `[LoginTab.tsx:LoginTab]`
- After Create the panel edits the new connection on Who can query, and after a saved switch to a role ceiling or personal it moves there too; the new connection is not selected in the app `[index.tsx:ConnectionManagement]` `[ConnectionPanel.tsx:ConnectionPanel]`
- The readiness pill opens Who can query; a login pill that is not passing opens ClickHouse login; a refusing connection shows its state once, on the login pill `[loginForm.ts:readinessPill]` `[loginForm.ts:loginPill]`
- Who can query: a super admin edits the role map (role ceiling) or the links (personal); anyone else sees counts and whom to ask `[WhoCanQueryTab.tsx:WhoCanQueryTab]`
- A link is added only with an account chosen and a ClickHouse user that matches `CLICKHOUSE_USER_NAME` and is not `default`; an account already linked cannot be chosen; *Remove* asks first; CHouse never runs the grant or revoke statements it shows `[PersonLinks.tsx:clickhouseUserProblem]` `[PersonLinks.tsx:PersonLinks]`
- A ClickHouse role name must match `CLICKHOUSE_ROLE_NAME`; an empty name means not mapped and is left out of the save; the warning counts the people of unmapped roles and says when the viewer's own role is one `[RoleMapEditor.tsx:RoleMapEditor]`
- Optional features (ClickHouse access admin, ADR 0031) never block: a save, test or row test with one missing shows a warning toast instead of success `[PrivilegeReport.tsx:optionalSummary]`
- With `report.kind` set the report says it was checked on the system role, and a feature with `source` `mapped_role` / `person` / `unavailable` shows that instead of granted/missing `[PrivilegeReport.tsx:PrivilegeReport]`

## Side Effects

- `rbacConnectionsApi.list/create/update/delete/test/testSaved`, `privilegeReportFromError` (`@/api/rbac`) `[index.tsx:ConnectionManagement]` `[LoginTab.tsx:LoginTab]` `[GeneralTab.tsx:GeneralTab]`
- `createIdentityConnection`, `checkNewConnectionIdentity`, `checkConnectionIdentity`, `switchConnectionIdentity`, `setConnectionAccessContact`, `recheckConnectionIdentity` (`@/api/connectionIdentity`) `[LoginTab.tsx:LoginTab]`
- TanStack query `connectionIdentityKey(id)` (`getConnectionIdentity`, super admin only); a save on the login or the role map invalidates it and `['my-connection-identities']`, and reloads the list `[ConnectionPanel.tsx:ConnectionPanel]`
- `rbacRolesApi.list`, `getConnectionRoleMap`, `setConnectionRoleMap` `[RoleMapEditor.tsx:RoleMapEditor]`
- TanStack query `['clickhouse-bindings', connectionId]` (`getConnectionBindings`; also read by the login tab to count links on a switch to personal) and `rbacUsersApi.list` for the account search; `createBinding`, `confirmBinding`, `recheckBinding`, `removeBinding` invalidate it and `['my-clickhouse-links']` `[PersonLinks.tsx:PersonLinks]`
- Embeds `ConnectionObservability` and `CollectorSchedule`, which fetch their own data `[GeneralTab.tsx:GeneralTab]` `[index.tsx:ConnectionManagement]`
- Clipboard writes with 1500ms reset `[PrivilegeReport.tsx:CopyButton]`; toasts; `scrollIntoView` on a refused save

## Verification

- Run: `bunx vitest run src/features/admin/components/ConnectionManagement` (from repo root; full suite: `bunx vitest run`)
