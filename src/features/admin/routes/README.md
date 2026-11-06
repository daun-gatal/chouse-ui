# admin/routes

## Overview

Route guard for admin pages: waits for RBAC init, redirects unauthenticated users to login, and renders `NoPermission` when required permissions (or admin role by default) are missing.

## Interface

- `[adminRoute.tsx:AdminRoute]` - named and default export; props `children`, `redirectTo?` (unused), `requiredPermission?: string | string[]`

## Invariants

- Spinner while `!isInitialized || isLoading` `[adminRoute.tsx:AdminRoute]`
- Unauthenticated users redirect to `/login?redirect=<encoded path>` `[adminRoute.tsx:AdminRoute]`
- With `requiredPermission`, `hasAnyPermission` must pass; otherwise `isAdmin()`; failure renders `<NoPermission/>` `[adminRoute.tsx:AdminRoute]`

## Side Effects

- `<Navigate replace>` to the login URL; no API calls `[adminRoute.tsx:AdminRoute]`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin` (from repo root; full suite: `bunx vitest run`)
