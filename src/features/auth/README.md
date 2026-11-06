# auth

## Overview

Infers an SSO brand from a provider id and display name and renders the matching logo, falling back to a generic OIDC/SAML glyph.

## Interface

- `[SsoProviderIcon.tsx:SsoProviderIcon]` - brand SVG or fallback icon
- `[ssoBrand.ts:resolveSsoBrand]` - keyword regex brand resolution
- `[ssoBrand.ts:SsoBrandInput]`, `SsoBrand` - types

## Invariants

- First keyword match wins in `BRAND_KEYWORDS` order `[ssoBrand.ts:resolveSsoBrand]`
- Fallback is `generic-saml` only for `type === 'saml'` `[ssoBrand.ts:resolveSsoBrand]`

## Side Effects

- None

## Verification

- Run: `bunx vitest run src/features/auth` (from repo root; full suite: `bunx vitest run`)
