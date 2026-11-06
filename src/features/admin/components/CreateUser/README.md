# CreateUser

## Overview

Page for creating an RBAC user with email, username, optional display name, a generated or manual password and one role; shows a generated password once after creation.

## Interface

- `[index.tsx:CreateUser]` - default export; create-user form and generated-password result view

## Invariants

- Changing the role requires ROLES_ASSIGN, but the `isDefault` role is pre-selected on load regardless; `super_admin` hidden unless `isSuperAdmin()` `[index.tsx:CreateUser]`
- Exactly one role at a time `[index.tsx:toggleRole]`
- Manual password: >= 12 chars with upper, lower, digit, special, and matching confirmation `[index.tsx:passwordReqs]`
- Manual mode's generate button builds a 16-char password client-side with `Math.random()` (not a CSPRNG) and fills both password fields — known issue, see [ARCHITECTURE.md › Known issues](../../../../../ARCHITECTURE.md#known-issues) `[index.tsx:handleGeneratePasswordManually]`
- Username forced to lowercase `[a-z0-9_-]` `[index.tsx:CreateUser]`

## Side Effects

- `rbacRolesApi.list` on mount, `rbacUsersApi.create` on submit `[index.tsx:CreateUser]`
- Navigation to `/admin`; clipboard copy of the generated password `[index.tsx:copyGeneratedPassword]`
- Toasts and `log.error`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
