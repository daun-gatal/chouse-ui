type: patch

### Fixed
- **GitHub SSO (and other plain OAuth2 providers)** — userinfo is now fetched directly instead of through the OIDC-only helper, which rejected GitHub's numeric `id`/missing `sub` (`"sub" property must be a string`). GitHub accounts with a private email also now resolve their primary verified address via `/user/emails`, so just-in-time provisioning no longer fails with "did not supply an email address".
- **SSO attribute-mapping parsing** — claim/role/auth-param mappings now accept either `=` or `:` as the key/value separator, so values entered as `subject=id,...` are parsed correctly instead of silently producing an empty mapping.
