# RBAC Routes (`/api/rbac`)

## Overview
Hono sub-apps for the RBAC control plane, combined in `index.ts` as
`rbacRoutes` and mounted at `/api/rbac` by
[`../../routes/index.ts`](../../routes/index.ts). They cover login and sessions,
personal access tokens, users, roles, audit logs, ClickHouse connections, data
access rules and policies, native ClickHouse users and roles, user preferences,
AI providers/models/configs, and SSO administration. Logic lives in
[`../services/`](../services/README.md); the SSO login flow is in
[`../sso/`](../sso/README.md).

## Interface
- `[index.ts:rbacRoutes]` - mounts `/auth` (`auth.ts`), `/pats` (`personalAccessTokens.ts`), `/auth/sso` (`../sso/routes.ts`), `/users`, `/roles`, `/audit`, `/connections`, `/data-access`, `/data-access-policies`, `/clickhouse-users`, `/clickhouse-roles`, `/user-preferences`, `/ai-providers` (`aiProviders.ts`), `/ai-base-models` (`aiModels.ts`), `/ai-models` (`aiConfigs.ts`), `/sso-admin`; plus `GET /health` and `GET /status` (schema version and migration status).
- `auth.ts`: `POST /login`, `GET /config` (`passwordLoginEnabled`), `POST /refresh`, `POST /logout`, `POST /logout-all`, `GET /me`, `GET /profile`, `POST /change-password`, `GET /validate`.
- `personalAccessTokens.ts`: `GET /`, `POST /`, `DELETE /:id`, `POST /:id/rotate`, `GET|PUT /:id/write-policy`.
- `users.ts`: CRUD plus `POST /:id/reset-password`, `POST /:id/assign-roles`, `GET /:id/identities`, `DELETE /:id/identities/:identityId`.
- `roles.ts`: CRUD plus `GET /permissions/list`, `GET /permissions/by-category`.
- `audit.ts`: `GET /`, `/actions`, `/metadata`, `/export`, `/stats`, `DELETE /`.
- `connections.ts`: `GET /`, `/my`, `/default`, `/:id`, `/session`; `POST /`, `PATCH /:id`, `DELETE /:id`; `POST /test`, `/:id/test`, `/:id/connect`, `/disconnect`.
- `dataAccess.ts`: `POST /check`, `/filter/databases`, `/filter/tables`. `dataAccessPolicies.ts`: policy CRUD, `GET /role/:roleId`, `POST /role/:roleId` (replaces a role's policies; needs `data_access:assign`, audits `AUDIT_ACTIONS.DATA_ACCESS_ASSIGN`), `GET /:id/roles`, `GET /schema/:connectionId/databases|tables`.
- `clickhouseUsers.ts`, `clickhouseRoles.ts`: list/get/create/patch/delete plus `generate-ddl` previews, `GET /clusters`, `GET /privileges`, `POST /:username/extract-role`, `POST /:name/disable|enable`. Shared helpers in `clickhouseShared.ts`: `[clickhouseShared.ts:getClickHouseService]`, `[clickhouseShared.ts:getConnectionId]`, `[clickhouseShared.ts:handleError]`, `grantSchema`, `grantsSchema`, `defaultRolesSchema`.
- `userPreferences.ts`: `GET|POST|DELETE /favorites`, `DELETE /favorites/:id`, `GET /favorites/check`, `GET|POST|DELETE /recent`, `GET|PUT /preferences`, `GET|PATCH /preferences/onboarding` (onboarding progress is writable).
- `aiProviders.ts`, `aiModels.ts`, `aiConfigs.ts`: CRUD; `aiConfigs.ts` also `GET /default`, `GET /active`.
- `ssoAdmin.ts`: `GET|PUT /settings`, provider CRUD under `/providers`, `POST /providers/parse-metadata`, `POST /providers/test`.

## Invariants
- PAT CRUD, password change, and logout call `requireJwtSession`, so a personal access token cannot mint, rotate, or revoke credentials (ADR 0011) `[personalAccessTokens.ts]`, `[auth.ts]`.
- When password login is disabled, `POST /login` rejects before checking credentials and audits `LOGIN_FAILED` with reason `password_login_disabled` `[auth.ts]`.
- A connection is saved only if `testConnection` succeeds (else 400 `CONNECTION_TEST_FAILED`) and its user holds every required ClickHouse privilege (else 422 `PRIVILEGES_MISSING`); updates re-check only when credentials change `[connections.ts:verifyBeforeSave]`, `[connections.ts:changesCredentials]`.
- Native ClickHouse user/role routes resolve the target `ClickHouseService` per request from the connection the client names, never from pod-local state (ADR 0010) `[clickhouseShared.ts:getClickHouseService]`.
- SSO setting/provider mutations call `applySsoConfigChange` (bumping the shared generation) and are audited `[ssoAdmin.ts]`.
- `GET /health` is public; the raw driver error is logged, not returned `[index.ts]`.
- Login and SSO start/callback rate limits are applied in `packages/server/src/index.ts` (keys from `middleware/rateLimitKeys.ts`, DB-backed store), not in this directory.

## Side Effects
- RBAC database writes and audit logs for every mutation, via `../services`.
- ClickHouse DDL and grants on managed connections (`clickhouseUsers.ts`, `clickhouseRoles.ts`); connection tests open ClickHouse connections (`connections.ts`).
- Config-generation bumps on SSO admin changes (`ssoAdmin.ts`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/rbac/routes`
