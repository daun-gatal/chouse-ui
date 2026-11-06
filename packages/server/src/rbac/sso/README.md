# RBAC Single Sign-On

## Overview
OIDC, OAuth2, and SAML single sign-on for RBAC users. Merges read-only
environment providers with editable DB providers into an in-process config,
keeps replicas in sync through a shared config-generation counter, runs the
`/api/rbac/auth/sso/*` login flow, and provisions or links local users from a
verified identity. SAML specifics live in [saml/](./saml/README.md).

## Interface
- `routes.ts`: `[routes.ts:ssoRoutes]` (default export, mounted at `/auth/sso` by `rbac/routes/index.ts`): `GET /providers` (public list for the login page), `GET /:provider/start`, `POST /callback`, `POST /saml/acs`, `POST /saml/exchange`. Also `[routes.ts:samlAcsHandler]` and `[routes.ts:SAML_ACS_PATH]` (`/auth/sso/saml/acs`), which `packages/server/src/index.ts` mounts directly on the app.
- `config.ts`: `[config.ts:loadSsoConfig]` (env `AUTH_SSO_ENABLED`, `AUTH_SSO_BASE_URL`, `AUTH_SSO_DEFAULT_ROLE`, `AUTH_SSO_AUTO_LINK_BY_EMAIL`, `AUTH_SSO_PROVIDERS_<ID>_<FIELD>`), `[config.ts:buildSsoConfig]`, `[config.ts:getSsoConfig]`, `[config.ts:refreshSsoConfig]`, `[config.ts:applySsoConfigChange]`, `[config.ts:getCachedConfigGeneration]`, `[config.ts:resetSsoConfigCache]`, types `SsoConfig`, `SsoProviderConfig`.
- `configWatcher.ts`: `[configWatcher.ts:startConfigGenerationWatcher]`, `[configWatcher.ts:stopConfigGenerationWatcher]`, `[configWatcher.ts:checkConfigGeneration]`.
- `client.ts` (openid-client v6): `[client.ts:SsoIdentity]`, `[client.ts:getProviderConfiguration]`, `[client.ts:buildAuthorizationRedirect]`, `[client.ts:exchangeCodeForIdentity]`, `[client.ts:normalizeOidcClaims]`, `[client.ts:applyClaimMapping]`, `[client.ts:resetProviderConfigurationCache]`.
- `service.ts`: `[service.ts:provisionSsoUser]` -> `[service.ts:SsoProvisionOutcome]` (`authenticated | linked | created`).
- `state.ts`: `[state.ts:signStatePayload]`, `[state.ts:verifyStatePayload]`, `[state.ts:SSO_STATE_COOKIE]` (`chouse_sso_state`), `[state.ts:SSO_STATE_TTL_SECONDS]` (600).
- `identity.ts`: `rbac_user_identities` CRUD - `getUserIdentity`, `createUserIdentity`, `touchUserIdentity`, `userHasSsoIdentity`, `listUserIdentities`, `deleteUserIdentity` `[identity.ts]`.
- `store.ts`: `rbac_sso_settings` / `rbac_sso_providers` CRUD - `getDbSettings`, `upsertDbSettings`, `listDbProviders`, `getDbProvider`, `createDbProvider`, `updateDbProvider`, `deleteDbProvider`, `decryptProviderSecret`, `countIdentitiesByProvider`, `listIdentityUserIdsByProvider`, `deleteIdentitiesByProvider` `[store.ts]`.
- `test.ts`: `[test.ts:testProviderConfig]` - live pre-save validation of an OIDC/OAuth2 candidate (production code, not a test file).
- `errors.ts`: `[errors.ts:describeSsoError]` - flattens openid-client errors into a loggable object without secrets.
- Subdirectory: [saml/](./saml/README.md) - SAML AuthnRequest/Response handling, IdP metadata parsing, and DB-backed handoff and replay stores.

## Invariants
- Env providers win over DB providers with the same id; disabled or invalid DB providers are skipped `[config.ts:buildSsoConfig]`.
- Any provider/settings change must go through `applySsoConfigChange`, which bumps the shared generation before rebuilding so other replicas pick it up `[config.ts:applySsoConfigChange]`.
- Redirect targets are same-app relative only: `//host`, `/\host`, and control characters fall back to `/` `[routes.ts:safeRedirect]`.
- The state cookie is HS256-signed with `JWT_SECRET`, expires after 600 s, and is deleted on every callback, success or failure `[state.ts]`, `[routes.ts]`.
- Provisioning order: existing identity link, then verified-email match only when `autoLinkByEmail` and `emailVerified`, then JIT create with the default role; inactive users are rejected before any side effect; a concurrent-link unique violation re-resolves to the winner `[service.ts:provisionSsoUser]`.
- SAML session tokens are returned only via the one-time `/saml/exchange` code, never in a redirect URL `[routes.ts]`.
- Audit failures for provisioning outcomes never block sign-in `[routes.ts:auditProvisionOutcome]`.
- `testProviderConfig` never persists anything `[test.ts:testProviderConfig]`.

## Side Effects
- DB reads/writes on `rbac_sso_settings`, `rbac_sso_providers`, `rbac_user_identities`; client secrets encrypted with AES-256-GCM `[store.ts]`, `[identity.ts]`.
- Creates/links users and syncs roles from `role_mapping` on login `[service.ts:provisionSsoUser]`.
- Audit log entries `SSO_USER_PROVISION` and `SSO_IDENTITY_LINK` `[routes.ts:auditProvisionOutcome]`, plus `SSO_LOGIN` on success and `SSO_LOGIN_FAILED` on failure for the OIDC/OAuth2 callback and the SAML ACS `[routes.ts:ssoRoutes]`, `[routes.ts:samlAcsHandler]`.
- Outbound HTTPS to IdPs for discovery, token exchange, and userinfo `[client.ts]`, and for reachability probes `[test.ts:testProviderConfig]`.
- A `setInterval` poller (default 15 s, `AUTH_CONFIG_WATCH_INTERVAL_MS` >= 1000, `unref`'d) reads the config generation and rebuilds the cache on change `[configWatcher.ts:startConfigGenerationWatcher]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/rbac/sso`
