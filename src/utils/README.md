# utils

## Overview
Session cleanup on logout or user switch, and cross-tab user-change syncing, so no data leaks between users of the same browser.

## Interface
- `cleanupUserSession(currentUserId)` - best-effort teardown of all user-scoped state [sessionCleanup.ts:cleanupUserSession]
- `broadcastUserChange(newUserId)` - posts `USER_CHANGED` on the `user-change` BroadcastChannel [sessionCleanup.ts:broadcastUserChange]
- `listenForUserChanges(onUserChange)` - subscribes to other tabs' user changes; returns an unsubscribe function or `undefined` when BroadcastChannel is unavailable [sessionCleanup.ts:listenForUserChanges]

## Invariants
- `cleanupUserSession` must run BEFORE new user state is set in the RBAC store; `useRbacStore.login` and the SSO completions call it first, then the API, then `broadcastUserChange` [sessionCleanup.ts:cleanupUserSession], [../stores/rbac.ts:login].
- Cleanup never throws: each failure is logged with `log.error` and cleanup continues [sessionCleanup.ts:cleanupUserSession].
- The listener only reacts when the broadcast user id differs from the current `useRbacStore` user [sessionCleanup.ts:listenForUserChanges].
- When a new per-user TanStack query key is added, it must be removed here too (e.g. `scheduled-queries`, `savedQueries`) [sessionCleanup.ts:cleanupUserSession].

## Side Effects
- Calls `rbacConnectionsApi.disconnect(sessionId)` and `clearSession()` on the API client [sessionCleanup.ts:cleanupUserSession].
- Resets `useWorkspaceStore` and clears `useExplorerStore` databases; removes TanStack queries (`databases`, `tableDetails`, `tableSample`, `systemStats`, `productionMetrics`, `topTables`, `recentQueries`, `savedQueries`, `scheduled-queries`, `intellisense`) and calls `clearIntellisenseCache` [sessionCleanup.ts:cleanupUserSession].
- Removes localStorage keys `explorer-storage-<id>`, `workspace-storage-<id>`, `explorer-last-user-id`, `workspace-last-user-id` [sessionCleanup.ts:cleanupUserSession].
- Opens a singleton `BroadcastChannel('user-change')` [sessionCleanup.ts:broadcastUserChange].
- On a `USER_CHANGED` message for a different user id, `listenForUserChanges` starts `cleanupUserSession(currentUserId)` (disconnect, query/storage clearing; not awaited, failures logged) and then calls `onUserChange(userId)` [sessionCleanup.ts:listenForUserChanges].

## Verification
- Run: `bunx vitest run src/utils`
