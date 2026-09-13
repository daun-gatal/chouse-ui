# Single sign-on (SSO)

CHouse UI authenticates users against its own RBAC system; SSO delegates the *authentication* step to your identity provider while the app still issues its own session tokens and applies its own roles.

Three protocols are supported:

| Protocol | Use it for | Notes |
| --- | --- | --- |
| **OIDC** | Okta, Auth0, Keycloak, Google, Microsoft Entra — any OpenID Connect IdP | Endpoints auto-discovered from the issuer |
| **OAuth2** | Plain OAuth2 providers (e.g. GitHub) without OIDC discovery | You supply endpoints + claim mapping |
| **SAML 2.0** | Enterprise SAML IdPs | SP- and IdP-initiated; assertion signature enforced |

Providers can be defined in **config** (YAML/env, read-only) or managed live in the **admin UI** (stored in the database). Both can be active at once.

## Configuration sources & precedence

1. **Config layer** — env vars or the YAML file (`CHOUSE_CONFIG_PATH`); YAML keys flatten 1:1 to env vars (e.g. `auth.sso.providers.google.client_secret` → `AUTH_SSO_PROVIDERS_GOOGLE_CLIENT_SECRET`). A YAML key **wins** over the same env var.
2. **Admin UI layer** — providers created/edited in **Admin → SSO** (`sso:view`/`sso:edit`) are stored in the RBAC database.

Register the redirect URI at your IdP:

```
<base_url>/auth/sso/callback
```

`base_url` comes from `AUTH_SSO_BASE_URL` / `auth.sso.base_url` — the public URL of the app.

## Global settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `auth.sso.enabled` | `false` | Master switch |
| `auth.sso.base_url` | — | Public URL for redirect URIs |
| `auth.sso.default_role` | `viewer` | Role for JIT-provisioned users |
| `auth.sso.auto_link_by_email` | `true` | Link SSO to an existing local user when the IdP asserts `email_verified` |
| `auth.password_login.enabled` | `true` | `false` = require SSO |

> **Warning:** Disabling password login is fail-safe: the setting is ignored unless at least one usable SSO provider exists, so you can't lock yourself out.

## OIDC provider

```yaml
auth:
  sso:
    enabled: true
    base_url: https://chouse.corp
    providers:
      okta:
        type: oidc
        display_name: "Okta"
        issuer: https://corp.okta.com
        client_id: "..."
        # keep the secret in env: AUTH_SSO_PROVIDERS_OKTA_CLIENT_SECRET
        scopes: "openid profile email"
```

Endpoints auto-discover from the issuer; individual endpoints can be overridden (`authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`) and non-standard claims remapped with `claim_mapping: "subject:sub,email:email,username:name"`.

## OAuth2 provider

```yaml
      acme-oauth2:
        type: oauth2
        display_name: "Acme"
        authorization_endpoint: https://acme.example.com/oauth/authorize
        token_endpoint: https://acme.example.com/oauth/token
        userinfo_endpoint: https://acme.example.com/oauth/userinfo
        client_id: "..."
        scopes: "profile email"
        claim_mapping: "subject:id,email:email,username:login"   # required
```

Optional strict RFC 9207 `iss` validation — set `issuer` when the IdP sends a stable `iss` (e.g. GitHub: `https://github.com/login/oauth`).

## SAML provider

```yaml
      corp-saml:
        type: saml
        display_name: "Corporate SSO"
        saml_idp_entity_id: https://idp.example.com/entity
        saml_idp_sso_url: https://idp.example.com/sso
        saml_sp_entity_id: https://chouse.corp
        saml_idp_certificate: "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"
        saml_allow_idp_initiated: false   # off by default (less secure)
```

Register the ACS URL at the IdP: `<sp_entity_id>/auth/sso/saml/acs`. Assertion signatures are enforced against the IdP certificate.

## Role mapping & provisioning

- `role_mapping_claim: groups` + `role_mapping: "idp-group-a:admin,idp-group-b:developer"` syncs roles from an IdP claim on every login
- Users holding `super_admin` are never demoted by role sync
- New users are provisioned JIT with `default_role`

## Security notes

- State + nonce (OIDC) / signed assertions (SAML) protect the callback
- Multi-replica SAML: assertion signature verification needs no shared state, but IdP-initiated flows with relay state are easiest to reason about at one replica — see the deployment caveat in the upstream guide
- Config changes propagate to other replicas within `auth.config_watch_interval_ms` (default 15 s) — see [Architecture](/docs/architecture/)

## Troubleshooting

- `redirect_uri mismatch` — `base_url` doesn't match what the IdP has registered
- `Invalid issuer` — OIDC discovery failed; check the issuer URL is reachable from the server
- SAML `Signature validation failed` — the IdP certificate changed; re-paste the certificate
- See also [Troubleshooting](/docs/troubleshooting/)
