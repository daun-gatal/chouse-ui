# SsoSettings

## Overview

Admin page for global SSO settings and OIDC/OAuth2/SAML provider CRUD through a three-step wizard; config-sourced providers and settings are read-only.

## Interface

- `[index.tsx:SsoSettings]` - default and only export; renders the internal `SettingsPanel`, `ProvidersPanel` and `ProviderWizard`

## Invariants

- SSO_EDIT gates settings, add, toggle and edit; SSO_DELETE gates delete; `source === 'config'` providers have no actions `[index.tsx:SsoSettings]`
- Settings editable only when `canEdit && hasProviders && settings.source !== 'config'`; base URL must be http(s) `[index.tsx:SettingsPanel]`
- Provider id must match `/^[a-z0-9_-]+$/`; per-type URL/secret/certificate requirements `[index.tsx:ProviderWizard]`
- OIDC/OAuth2 save only after `testProvider` passes or Save anyway is on; any draft change clears the test result `[index.tsx:ProviderWizard]`
- `clientSecret` sent only when typed; `id` only on create `[index.tsx:buildPayload]`

## Side Effects

- Queries `['sso-settings']`, `['rbac-roles']`, `['sso-admin-providers']` `[index.tsx:SettingsPanel]` `[index.tsx:ProvidersPanel]`
- Reads `rbacSsoAdminApi.getSettings/getProviders` `[index.tsx:SettingsPanel]` `[index.tsx:ProvidersPanel]`
- `rbacSsoAdminApi.updateSettings` (invalidates `['sso-settings']`) `[index.tsx:SettingsPanel]`
- `rbacSsoAdminApi.createProvider/updateProvider/testProvider/parseSamlMetadata` `[index.tsx:ProviderWizard]`; `deleteProvider` and enable/disable via `updateProvider` `[index.tsx:ProvidersPanel]`
- Invalidates both provider and settings keys after provider mutations `[index.tsx:ProviderWizard]` `[index.tsx:ProvidersPanel]`
- Toasts; clipboard copy with 1500ms reset `[index.tsx:CopyableValue]`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features/admin/components` (from repo root; full suite: `bunx vitest run`)
