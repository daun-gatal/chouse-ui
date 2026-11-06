# pages

## Overview
Route-level page components (default exports) wired up in `src/App.tsx`. Each page composes feature modules from `src/features/` and shared components; most are wrapped by an `AdminRoute` or `PrivateRoute` guard in `App.tsx`. Several files are Monitoring sub-tabs rather than routes.

## Interface
- Top-level routes (from `src/App.tsx`): `Login` `/login` [Login.tsx:Login], `SsoCallback` `/auth/sso/callback` [SsoCallback.tsx:SsoCallback], `SsoComplete` `/login/sso-complete` [SsoComplete.tsx:SsoComplete], `OAuthConnect` `/preferences/connect` [OAuthConnect.tsx:OAuthConnect], `ExplainPopout` `/explain-popout` [ExplainPopout.tsx:ExplainPopout], `FleetPage` `/fleet` [Fleet.tsx:FleetPage], `Doctor` `/doctor/:reportId?` [Doctor.tsx:Doctor], `HomePage` `/overview` [Home.tsx:HomePage], `Monitoring` `/monitoring/:tab?` [Monitoring.tsx:Monitoring], `DashboardsPage` `/dashboards/:id?` and `/dashboards/:id/snapshots/:snapshotId` [Dashboards.tsx:DashboardsPage], `Data` `/data/:tab?/:a?/:b?` [Data.tsx:Data], `Agents` `/ai/:tab?/:id?` [Agents.tsx:Agents], `ExplorerPage` `/explorer` [Explorer.tsx:ExplorerPage], `Admin` `/admin/:tab?` [Admin.tsx:Admin], `Preferences` `/preferences` [Preferences.tsx:Preferences], `NotFound` `*` [NotFound.tsx:NotFound]
- Legacy redirects: `LegacyDataOpsRedirect` (`/dataops/*` to `/data`) [Data.tsx:LegacyDataOpsRedirect], `LegacyAgentsRedirect` (`/agents/*` to `/ai`) [Agents.tsx:LegacyAgentsRedirect]
- Monitoring sub-tabs, imported by `Monitoring.tsx`: `LogsPage` [Logs.tsx:LogsPage], `Metrics` [Metrics.tsx:Metrics], `LiveQueriesTable` [LiveQueries.tsx:LiveQueriesTable], `PartsPage` [Parts.tsx:PartsPage], `SchemaDoctorPage` [SchemaDoctor.tsx:SchemaDoctorPage], `ClusterActivityPage` [ClusterActivity.tsx:ClusterActivityPage], `ErrorsPage` [Errors.tsx:ErrorsPage]

## Invariants
- Route-level permission gating is declared in `src/App.tsx` (`AdminRoute requiredPermission=...`) using the lists in `src/lib/navAccess.ts`; in-page tabs also check permissions, e.g. Monitoring tabs via `hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_VIEW | LOGS_VIEW | PARTS_VIEW ...)` and Admin tabs via `ADMIN_TAB_PERMISSIONS` [Monitoring.tsx:Monitoring], [Admin.tsx:Admin].
- SSO pages only follow same-app redirects: `safeClientRedirect` rejects targets that do not start with `/`, start with `//` or `/\`, or contain control characters, falling back to `/` [SsoCallback.tsx:safeClientRedirect], [SsoComplete.tsx:safeClientRedirect].
- `/logs`, `/metrics` redirect to `/monitoring` and `/settings` to `/preferences` (in `src/App.tsx`).

## Side Effects
- `Login` calls `useRbacStore.login` and, for SSO, sets `window.location.href` to `ssoApi.startUrl(provider.id, redirectTo)` [Login.tsx:Login].
- `SsoCallback` / `SsoComplete` call `completeSsoLogin` / `completeSamlLogin` on the RBAC store, then navigate [SsoCallback.tsx:SsoCallback], [SsoComplete.tsx:SsoComplete].
- `OAuthConnect` loads the request with `getSignInRequest`, calls `approveSignIn` / `denySignIn`, then `window.location.assign`s the returned redirect URL [OAuthConnect.tsx:OAuthConnect].
- `ExplainPopout` reads its initial data from localStorage key `explain_popout_data` [ExplainPopout.tsx:ExplainPopout].
- `LiveQueriesTable` can kill running queries via `useKillQuery` [LiveQueries.tsx:LiveQueriesTable].

## Verification
- Run: `bunx vitest run src/pages`
