type: patch

### Fixed
- **GitHub SSO login** — GitHub now sends an RFC 9207 `iss` parameter (`https://github.com/login/oauth`) that could never match the synthetic plain-OAuth2 issuer, rejecting every login. OAuth2 callbacks now ignore `iss` unless an explicit `issuer` is configured (which validates it strictly instead).
