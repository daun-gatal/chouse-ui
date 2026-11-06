# components/common

## Overview
App-level shared components used across pages and features: auth and permission route guards, the app initialiser, the floating navigation dock and command palette, the ClickHouse connection selector, theme provider, error boundaries, reusable dialogs (confirmation, info, download, diff, schema preflight, AI debug/optimise), AI model selection, AI chart rendering, and loading skeletons.

## Interface
- Subdirectories: [PageShell](./PageShell/README.md) (page header, nav pills, sub-tabs), [ai-chat](./ai-chat/README.md) (approval cards, action receipts, memory notes, composer extras), [form](./form/README.md) (react-hook-form `InputField`).
- Routing and access: `PrivateRoute` [privateRoute.tsx:PrivateRoute], `RestrictedRoute` (`requireAdmin`) [RestrictedRoute.tsx:RestrictedRoute], `PermissionGuard` (`requiredPermission`, `fallback`, `showTooltip`) [PermissionGuard.tsx:PermissionGuard], `DefaultRedirect` [DefaultRedirect.tsx:DefaultRedirect], `NoPermission` (default) [NoPermission.tsx:NoPermission]
- App shell: `AppInitializer` [AppInit.tsx:AppInitializer], `FloatingDock` (default) and `loadDockPreferencesFromLocal` [FloatingDock.tsx:FloatingDock], `CommandPalette` (default) [CommandPalette.tsx:CommandPalette], `ConnectionSelector` (default) [ConnectionSelector.tsx:ConnectionSelector], `McpStatusDockItem` [McpStatusDockItem.tsx:McpStatusDockItem], `PageTitleUpdater` / `getPageTitle` [PageTitleUpdater.tsx:getPageTitle], `ThemeProvider` / `useTheme` [theme-provider.tsx:ThemeProvider]
- Errors: `ErrorBoundary`, `AsyncErrorBoundary`, `QueryErrorFallback` [ErrorBoundary.tsx:ErrorBoundary]
- Dialogs: `ConfirmationDialog` [ConfirmationDialog.tsx:ConfirmationDialog], `InfoDialog` (default) [InfoDialog.tsx:InfoDialog], `DownloadDialog` [DownloadDialog.tsx:DownloadDialog], `DiffEditor` [DiffEditor.tsx:DiffEditor], `ResponsiveDraggableDialog` [ResponsiveDraggableDialog.tsx:ResponsiveDraggableDialog], `SchemaPreflightDialog` [SchemaPreflightDialog.tsx:SchemaPreflightDialog], `DebugQueryDialog` [DebugQueryDialog.tsx:DebugQueryDialog], `OptimizeQueryDialog` [OptimizeQueryDialog.tsx:OptimizeQueryDialog]
- AI: `AiModelSelect` / `useAiModelSelection` [AiModelSelect.tsx:useAiModelSelection], `AiModelButton` [AiModelButton.tsx:AiModelButton], `AiContextPreview` [AiContextPreview.tsx:AiContextPreview], `AiChartRenderer`, `ChartView`, `PanelOverlays` [AiChartRenderer.tsx:AiChartRenderer], chart helpers `normalizeChartSpec`, `isChartSpec`, `resolveYAxes`, `formatAxisValue`, `buildColorPalette`, `COLOR_PALETTES` [AiChartUtils.ts:normalizeChartSpec]
- Misc: `DataControls` [DataControls.tsx:DataControls], skeletons `SkeletonRows`, `SkeletonStatGrid`, `SkeletonCardGrid`, `SkeletonTree`, `SkeletonChart`, `SkeletonList`, `SkeletonText` [Skeletons.tsx:SkeletonRows]

## Invariants
- `PrivateRoute` and `RestrictedRoute` show a spinner until `useRbacStore` is initialised, redirect unauthenticated users to `/login?redirect=<path>`, and `RestrictedRoute` with `requireAdmin` redirects non-admins to `/` [RestrictedRoute.tsx:RestrictedRoute], [privateRoute.tsx:PrivateRoute].
- `PermissionGuard` renders `fallback` unless the user is RBAC-authenticated and `hasPermission(requiredPermission)`; it is UI gating only [PermissionGuard.tsx:PermissionGuard].
- `DefaultRedirect` picks the landing page from `src/lib/navAccess.ts` permission lists (`/fleet`, `/overview`, `/explorer`, ...) [DefaultRedirect.tsx:DefaultRedirect].
- `ConfirmationDialog` sanitises HTML descriptions with `DOMPurify.sanitize` before `dangerouslySetInnerHTML`; keep that pairing [ConfirmationDialog.tsx:ConfirmationDialog].
- `ErrorBoundary` reports through `log.error`, never raw `console.*` [ErrorBoundary.tsx:ErrorBoundary].

## Side Effects
- `AppInitializer` runs `useRbacStore.checkAuth`, subscribes to `listenForUserChanges`, and on the `auth:unauthorized` window event logs out and navigates to `/login` [AppInit.tsx:AppInitializer].
- `ConnectionSelector` lists and connects through `rbacConnectionsApi.getMyConnections` / `connect` / `disconnect` and stores `clickhouse_selected_connection_id` in localStorage [ConnectionSelector.tsx:ConnectionSelector].
- `CommandPalette` can disconnect the session and call `rbacAuthApi.logout` [CommandPalette.tsx:CommandPalette].
- `FloatingDock` keeps dock layout in localStorage keys `chouseui-dock-*` and also loads and saves it per device type in the user's `workspacePreferences` via `rbacUserPreferencesApi.getPreferences` / `updatePreferences` [FloatingDock.tsx:loadDockPreferencesFromLocal], [FloatingDock.tsx:saveDockPreferencesToDb]; `ThemeProvider` saves the theme to `rbacUserPreferencesApi` with a localStorage fallback [theme-provider.tsx:ThemeProvider]; `ResponsiveDraggableDialog` saves size and position via `rbacUserPreferencesApi` [ResponsiveDraggableDialog.tsx:ResponsiveDraggableDialog].
- `DebugQueryDialog` and `OptimizeQueryDialog` call the AI endpoints `debugQuery`, `optimizeQuery`, `optimizeQueryFromLog`; `AiModelSelect` fetches `fetchAiModels` [DebugQueryDialog.tsx:DebugQueryDialog], [OptimizeQueryDialog.tsx:OptimizeQueryDialog], [AiModelSelect.tsx:useAiModelSelection].
- `PageTitleUpdater` sets `document.title` [PageTitleUpdater.tsx:PageTitleUpdater].

## Verification
- Run: `bunx vitest run src/components/common`
