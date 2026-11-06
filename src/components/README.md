# components

## Overview
Shared React components that are not owned by a single feature (feature-specific UI lives under `src/features/`). Groups the shadcn/ui primitive layer, app-wide shell and guard components, chart rendering, monitoring panels, and the sidebar user menu.

## Subdirectories & Boundaries
- ui: [./ui/README.md](./ui/README.md) - shadcn/ui and Radix primitives (dialogs, menus, form controls, `DataTable`, `Toaster`) whose floating layers take z-index from `src/lib/layers.ts`.
- common: [./common/README.md](./common/README.md) - route and permission guards (`PrivateRoute`, `RestrictedRoute`, `PermissionGuard`), `AppInitializer`, `FloatingDock`, `CommandPalette`, `ConnectionSelector`, theme, error boundaries, shared dialogs, and AI model/chart components; contains `PageShell`, `ai-chat`, `form`.
- charts: [./charts/README.md](./charts/README.md) - `PanelVisual` and `VizSpecEditor` over `src/lib/viz`, plus house-style control classes.
- monitoring: [./monitoring/README.md](./monitoring/README.md) - Monitoring page charts and panels over `useMonitoringTimeline`, the read-only `DdlSimulator`, and `AiDiagnoseButton`.
- sidebar: [./sidebar/README.md](./sidebar/README.md) - `UserMenu` with logout.
