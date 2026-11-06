# SAML SSO

## Overview
SAML 2.0 support for RBAC single sign-on, wrapping `@node-saml/node-saml`. Builds
SP-initiated AuthnRequests, validates SAMLResponses (SP- and IdP-initiated) into
the shared `SsoIdentity`, parses IdP metadata XML, and keeps the cross-replica
stores (request IDs, one-time token handoff codes, assertion replay cache) in
the RBAC database (ADR 0010). Consumed by [`../routes.ts`](../routes.ts) and the
SSO admin routes.

## Interface
- `client.ts`
  - `[client.ts:SamlProviderConfig]`, `[client.ts:SamlValidationResult]`.
  - `[client.ts:buildSamlAuthnRequest]` - builds the redirect URL and saves the request id.
  - `[client.ts:validateSamlResponse]` - verifies signature/InResponseTo and returns the identity.
  - `[client.ts:resolveSamlProviderByIssuer]`, `[client.ts:extractSamlIssuer]` - map a response's issuer to a configured provider.
  - `[client.ts:summarizeSamlResponse]` - diagnostic summary for logs.
  - Test hooks: `[client.ts:resetSamlRequestCache]`, `[client.ts:seedSamlRequestId]`.
- `handoff.ts`
  - `[handoff.ts:HandoffPayload]` (`user`, `tokens`, `redirect`).
  - `[handoff.ts:stashTokens]` / `[handoff.ts:claimTokens]` - ACS-to-SPA one-time code exchange.
  - `[handoff.ts:markAssertionSeen]` - replay check; `true` if fresh.
  - Test hook: `[handoff.ts:resetHandoffState]`.
- `metadata.ts`: `[metadata.ts:parseIdpMetadataXml]` -> `[metadata.ts:ParsedIdpMetadata]` (`idpEntityId`, `idpSsoUrl` for HTTP-Redirect binding, signing `idpCertificate` PEM).

## Invariants
- Signature verification is mandatory (`wantAssertionsSigned: true`) and delegated to node-saml's XML-DSig; never bypassed `[client.ts]`.
- InResponseTo uses `ValidateInResponseTo.ifPresent`: validated against the shared cache when present, allowed absent only for IdP-initiated flows; never `always` `[client.ts]`.
- Request IDs are one-time-use: saves never overwrite (`ON CONFLICT DO NOTHING`) and node-saml removes the entry on successful validation `[client.ts:samlRequestCache]`.
- Handoff codes are single-use regardless of expiry (`DELETE ... RETURNING`); an expired or undecryptable payload returns `null` (fail closed) `[handoff.ts:claimTokens]`.
- Replay detection is a single atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so two replicas cannot both accept one assertion `[handoff.ts:markAssertionSeen]`.
- Metadata parsing throws unless entity ID, HTTP-Redirect SSO URL, and a signing certificate are all present `[metadata.ts:parseIdpMetadataXml]`.

## Side Effects
- Reads/writes `rbac_saml_request_ids` (request-ID cache) `[client.ts:samlRequestCache]`.
- Reads/writes/deletes `rbac_saml_handoff_codes` and `rbac_saml_assertions_seen`; expired rows are swept before each write `[handoff.ts:sweep]`.
- Handoff payloads (fresh JWT pairs) are encrypted at rest with AES-256-GCM via `encryptPassword`/`decryptPassword` from `rbac/services/connections` `[handoff.ts:stashTokens]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Targeted: `cd packages/server && bun test src/rbac/sso`
