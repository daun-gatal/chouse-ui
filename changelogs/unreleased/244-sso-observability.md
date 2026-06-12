type: patch

### Changed
- **SSO logging is more diagnosable** — the server now logs the configured providers at startup (`SSO enabled — N provider(s) loaded` with id/type/display name, or `SSO disabled`), and start/callback failures now include the identity provider's own `error`, `error_description`, `code`, and `cause` instead of only the wrapped error message. No behaviour or API change; secrets are never logged.
