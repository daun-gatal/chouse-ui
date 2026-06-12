type: minor

### Added
- **Manage SSO in Admin** — a new Admin → SSO section to edit global SSO settings (enabled, base URL, default role, auto-link) and add/edit/delete OIDC and OAuth2 providers, coexisting with read-only env/YAML providers. Adding a provider runs a live test before save; deleting one force-unlinks all linked users (with a clear warning) and is fully audited. Gated by new `sso:view` (admin) and `sso:manage` (super admin) permissions. Client secrets are encrypted at rest and never returned.
