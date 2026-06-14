type: minor

### Added
- **SSO sign-in audit coverage** — first-time SSO sign-ins now record their outcome in the audit log: `sso.user_provision` when an account is just-in-time created, and `sso.identity_link` when an SSO identity is auto-linked to an existing user by verified email. These are written alongside the existing `auth.sso_login` entry, so JIT provisioning and account linking are no longer invisible to auditors.
