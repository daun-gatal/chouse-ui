# MCP OAuth Authorization Server

## Overview
Lets MCP agents sign in to CHouse with OAuth 2.1 instead of a pasted personal
access token (ADR 0028). Provides the public discovery, dynamic client
registration, authorize, token, and revocation endpoints; issuer resolution;
redirect-URI policy; secret/PKCE helpers; and the DB store for clients,
pending sign-ins, grants, and tokens. The consent page and per-user grant
management are the authenticated `/api/oauth` routes in
`packages/server/src/routes/oauth.ts`.

## Interface
- `routes.ts`: `[routes.ts:createOAuthRoutes]` (mounted at `/` by `packages/server/src/index.ts`) serving `GET /.well-known/oauth-protected-resource[/*]`, `GET /.well-known/oauth-authorization-server[/*]`, `POST /oauth/register`, `GET /oauth/authorize`, `POST /oauth/token`, `POST /oauth/revoke`. Also `[routes.ts:CONSENT_PATH]` (`/preferences/connect`), `[routes.ts:OAUTH_SCOPE]` (`mcp`), `[routes.ts:cleanClientName]`, `[routes.ts:withParams]`, `OAuthRoutesOptions`.
- `issuer.ts`: `[issuer.ts:resolveIssuer]` -> `[issuer.ts:IssuerResult]` (`{ ok: true, value: OAuthIssuer } | { ok: false, reason }`), `[issuer.ts:OAuthIssuer]` (`{ issuer, resource }` where resource = issuer + MCP path), `[issuer.ts:resourceMetadataUrl]`, `[issuer.ts:sameResource]`, `[issuer.ts:isLoopbackHost]`.
- `redirects.ts`: `[redirects.ts:redirectUriProblem]`, `[redirects.ts:matchRegisteredUri]`, `[redirects.ts:hostMatches]`, `[redirects.ts:redirectLabel]`.
- `secrets.ts`: `[secrets.ts:OAUTH_ACCESS_PREFIX]` (`ch_oat_`), `[secrets.ts:OAUTH_REFRESH_PREFIX]` (`ch_ort_`), `randomSecret`, `newClientId`, `hashSecret`, `isValidChallenge`, `[secrets.ts:verifyPkce]`.
- `store.ts`: clients (`registerClient`, `getClient`, `listClients`, `setClientStatus`; `CLIENT_STATUSES` = `allowed | pending | blocked`), sign-ins (`createRequest`, `getPendingRequest`, `decideRequest`, `[store.ts:redeemCode]`), grants (`createGrant`, `revokeGrant`, `listGrants`), tokens (`issueTokens`, `[store.ts:rotateRefreshToken]`, `revokeToken`, `[store.ts:verifyAccessToken]`), `[store.ts:purgeExpired]`; TTLs `REQUEST_TTL_MS` (10 min), `CODE_TTL_MS` (60 s), `ACCESS_TTL_MS` (1 h), `REFRESH_TTL_MS` (30 d), `UNUSED_CLIENT_TTL_MS` (30 d); `OAUTH_GRANT_KIND` (`oauth`).

## Invariants
- Every endpoint answers 404 unless MCP is enabled, OAuth is enabled, and an issuer resolves; the gate is per route because the app is mounted at `/` and must not touch other paths `[routes.ts:createOAuthRoutes]`.
- The issuer comes from the MCP public URL setting, else `PUBLIC_BASE_URL`; it must be https (http only for loopback) with no query, fragment, or credentials `[issuer.ts:resolveIssuer]`.
- Redirect URIs: no fragment or credentials, https unless loopback, app schemes refused while redirect hosts are restricted; loopback URIs match on any port (RFC 8252 §7.3) `[redirects.ts:redirectUriProblem]`, `[redirects.ts:matchRegisteredUri]`.
- PKCE is S256 only and compared in constant time `[secrets.ts:verifyPkce]`.
- Codes and tokens are 256-bit random values stored only as SHA-256 hashes `[secrets.ts]` header.
- Racy transitions (deciding a sign-in, redeeming a code, rotating a refresh token) are conditional `UPDATE ... RETURNING`, so exactly one replica wins `[store.ts]` header.
- Reusing a code or a refresh token revokes the whole grant `[store.ts:redeemCode]`, `[store.ts:rotateRefreshToken]`.
- A grant is a row in `rbac_api_keys` with `kind = 'oauth'`, so PAT rules (live owner permissions, token fences) apply; access tokens are accepted only on `/mcp` and MCP tool subrequests (`rbac/services/patAuth.ts:verifyBearer`).
- These endpoints take no cookies; CORS is `*` without credentials (`OAUTH_PUBLIC_PATHS` in `middleware/cors.ts`); errors follow RFC 6749 §5.2 `[routes.ts]` header.

## Side Effects
- Reads/writes `oauth_clients`, `oauth_requests`, `oauth_tokens`, and `rbac_api_keys` (grants) in the RBAC database `[store.ts]`.
- `purgeExpired` deletes expired requests/tokens and unused clients `[store.ts:purgeExpired]`. There is no timer: it runs fire-and-forget after each successful `POST /oauth/register` and on each `POST /oauth/token` from an allowed client `[routes.ts:createOAuthRoutes]`.
- Unhandled errors are logged and returned as `server_error` `[routes.ts:createOAuthRoutes]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/mcp/oauth`
