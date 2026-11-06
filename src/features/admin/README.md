# admin

## Overview

Admin area of the SPA. `components/` holds the admin pages (RBAC users, data access policies, connections, SSO, AI models, alerting settings, native ClickHouse users and roles); `routes/` holds the `AdminRoute` guard that wraps them. No source files live directly here.

## Subdirectories & Boundaries

- components: [components](./components/README.md) - Admin page components, one folder per page, plus shared native ClickHouse wizards in `clickhouse/`.
- routes: [routes](./routes/README.md) - Route guard for admin pages: waits for RBAC init, redirects unauthenticated users to login, and renders `NoPermission` unless the user holds at least one of the listed permissions (or, when none are listed, the admin role); the `redirectTo` prop is unused.
