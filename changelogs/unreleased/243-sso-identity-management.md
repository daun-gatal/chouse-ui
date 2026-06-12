type: minor

### Added
- **SSO identity management** — the user's **Security** tab now lists each linked SSO provider (display name, the email it was linked by, and last sign-in) and lets admins unlink an identity. Backed by new `GET`/`DELETE /rbac/users/:id/identities` endpoints (`users:view` to list, `users:update` to unlink, with super-admin targets protected), and a new `user.sso_identity_unlink` audit action. Unlinking warns that an SSO-only user will be locked out until their password is reset.
