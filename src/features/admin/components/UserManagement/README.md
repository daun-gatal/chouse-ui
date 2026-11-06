# UserManagement

## Overview

Paginated, filterable RBAC user list in card or list layout with saved filter/layout preferences and edit, activate/deactivate and reset-password row actions.

## Interface

- `[index.tsx:UserManagement]` - default and only export

## Invariants

- Create needs USERS_CREATE; row actions need USERS_UPDATE `[index.tsx:UserManagement]`
- Email and last login shown only to users who can create/update users or super admins `[index.tsx:UserManagement]`
- Non-super-admins cannot edit `super_admin` users; reset hidden for SSO users; no self-toggle `[index.tsx:getUserPerms]`
- Page clamped to `[1, totalPages]` `[index.tsx:goToPage]`; reset to 1 when search, role or status filter changes (separate `useEffect`) `[index.tsx:setCurrentPage]`

## Side Effects

- `rbacUsersApi.list` on filter/page change, `rbacRolesApi.list` on mount `[index.tsx:fetchUsers]`
- `rbacUsersApi.update({isActive})` and `resetPassword({generatePassword: true})` `[index.tsx:handleToggleActive]` `[index.tsx:handleResetPassword]`
- 500ms debounced preference saves via `useUserManagementPreferences` / `usePaginationPreference` `[index.tsx:UserManagement]`
- Navigation to `/admin/users/create` and `/admin/users/edit/:id`; toasts; clipboard

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
