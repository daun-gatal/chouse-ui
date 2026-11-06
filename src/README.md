# src — CHouse UI Frontend

## Overview

React 19 + Vite 7 single-page app for CHouse UI. `main.tsx` mounts the app
inside an error boundary and the shared TanStack Query provider. `App.tsx` owns
routing, the authenticated shell layout and ClickHouse session recovery.
Feature code lives under `features/`. Shared UI, API clients, hooks, stores and
utilities live in the sibling directories below.

## Interface

- `App` (default export) — router with public routes (`/login`,
  `/auth/sso/callback`, `/login/sso-complete`, `/preferences/connect`,
  `/explain-popout`) and authenticated routes under `MainLayout` [App.tsx:App]
- `MainLayout` — authenticated shell: `Outlet`, `FloatingDock`, `Chobi`,
  `CommandPalette`, `SchemaPreflightDialog`, `OnboardingProvider` [App.tsx:MainLayout]
- `__CH_UI_VERSION__` global and the `Window.env` / `Window.MonacoEnvironment`
  declarations [vite-env.d.ts]
- App entry: `ReactDOM.createRoot(#root)` rendering
  `ErrorBoundary > QueryProvider > Toaster + App` [main.tsx]

### Subdirectories

- [api](./api/README.md) — typed backend HTTP clients; `client.ts` owns transport, tokens and retries
- [components](./components/README.md) — shared non-feature components (ui primitives, common shell/guards, charts, monitoring, sidebar)
- [constants](./constants/README.md) — client mirrors of the server's AI provider and model-param constants
- [features](./features/README.md) — feature modules (admin, AI governance, Chobi, dashboards, data health, explorer, fleet, observe, onboarding, RBAC, scheduled queries, workspace)
- [helpers](./helpers/README.md) — ClickHouse identifier validation/escaping and DDL/DML detection
- [hooks](./hooks/README.md) — TanStack Query wrappers, monitoring SQL hooks, fleet polling, viewport utilities
- [lib](./lib/README.md) — logging, SSE, z-index layers, nav permission maps, connection activation, viz
- [pages](./pages/README.md) — route-level page components wired in `App.tsx`
- [providers](./providers/README.md) — `QueryProvider` and the single shared `QueryClient`
- [stores](./stores/README.md) — Zustand stores (RBAC auth, connection, workspace, explorer, preferences, Chobi)
- [types](./types/README.md) — EXPLAIN types and `Window.env`
- [utils](./utils/README.md) — per-user session cleanup and cross-tab user-change sync

## Invariants

- Each authenticated route is wrapped in `AdminRoute` with a
  `requiredPermission` from `RBAC_PERMISSIONS` or the `*_ACCESS_PERMISSIONS`
  maps in `@/lib/navAccess`, except `/overview` and `/preferences`, which
  only require a signed-in user (`PrivateRoute`). This gates the UI only;
  the server stays authoritative [App.tsx:App]
- Legacy paths redirect rather than render: `/logs` and `/metrics` go to
  `/monitoring`, `/settings` goes to `/preferences`, and `/dataops/*` and
  `/agents/*` go through `LegacyDataOpsRedirect` / `LegacyAgentsRedirect` [App.tsx:App]
- Cmd/Ctrl+K toggles the command palette, except while an onboarding overlay
  or hub is visible [App.tsx:MainLayout]
- `crypto.randomUUID` is polyfilled before render when the browser lacks it [main.tsx]
- Event listeners registered in `MainLayout` are removed on unmount [App.tsx:MainLayout]

## Side Effects

- On ClickHouse session expiry (`api.setOnSessionExpired`), the app reconnects
  the active connection via `rbacConnectionsApi.connect`, updates
  `useAuthStore`, and shows a toast [App.tsx:App]
- Reads localStorage `chouseui-dock-mode` and listens for `dock:mode-change`,
  `fullscreenchange` and `keydown` [App.tsx:MainLayout]
- In development only, injects `window.env.VITE_CLICKHOUSE_URLS` from Vite env [main.tsx]

## Verification

- Run: `bunx vitest run` (from the repository root; `vitest.config.ts` uses jsdom and `src/test/setup.ts`)
- Typecheck: `bun run typecheck`
