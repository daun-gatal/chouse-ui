# components/sidebar

## Overview
The signed-in user's menu in the navigation sidebar.

## Interface
- `UserMenu` (default export) - prop `isCollapsed` [UserMenu.tsx:UserMenu]

## Invariants
- Reads the current user and `logout` from `useRbacStore` [UserMenu.tsx:UserMenu].

## Side Effects
- Logging out is confirmed through a `ConfirmationDialog`, then calls `rbacConnectionsApi.disconnect(sessionId)` when a session exists (errors only logged), then `useRbacStore.logout`, then `clearSession()` (also run if logout throws), and always navigates to `/login` [UserMenu.tsx:handleLogout].

## Verification
- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/components`
