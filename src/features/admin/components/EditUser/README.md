# EditUser

## Overview

Page that loads one RBAC user by the `:userId` route param and edits profile, single role, active status, password and linked SSO identities, plus deletion, through `@/api/rbac` only.

## Interface

- `[index.tsx:EditUser]` - default export; Details/Roles/Security tabs with reset-password, delete and unlink-SSO dialogs

## Invariants

- Edits need USERS_UPDATE, delete USERS_DELETE (hidden for self), role changes ROLES_ASSIGN `[index.tsx:EditUser]`
- Non-super-admins opening a `super_admin` user are redirected to `/admin` `[index.tsx:EditUser]`
- Exactly one role; Save disabled with none `[index.tsx:toggleRole]`; self-deactivation disabled `[index.tsx:EditUser]`
- Manual reset password: >= 12 chars with upper, lower, digit, special; reset only offered without SSO identities `[index.tsx:handleResetPassword]`
- The manual reset's generate button builds a 16-char password client-side with `Math.random()` (not a CSPRNG) and fills both fields — known issue, see [ARCHITECTURE.md › Known issues](../../../../../ARCHITECTURE.md#known-issues) `[index.tsx:handleGeneratePasswordManually]`
- Only changed fields are sent in `UpdateUserInput` `[index.tsx:handleSave]`

## Side Effects

- `rbacUsersApi.get`, `rbacRolesApi.list`, `rbacUsersApi.getIdentities` on mount `[index.tsx:EditUser]`
- `rbacUsersApi.update/resetPassword/delete/unlinkIdentity` `[index.tsx:handleSave]` `[index.tsx:handleDelete]` `[index.tsx:handleUnlinkIdentity]`
- Navigation to `/admin`; toasts; clipboard copy `[index.tsx:copyPassword]`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
