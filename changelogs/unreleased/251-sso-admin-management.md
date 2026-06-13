type: minor

### Added
- **Manage SSO in Admin** — a new Admin → SSO section to edit global SSO settings (enabled, base URL, default role, auto-link) and add/edit/delete OIDC and OAuth2 providers, coexisting with read-only env/YAML providers. Adding a provider runs a live test before save; deleting one force-unlinks all linked users (with a clear warning) and is fully audited. Gated by new granular permissions — `sso:view` (admin), `sso:edit`, and `sso:delete` (super admin). Client secrets are encrypted at rest and never returned.
- **SSO advanced provider options** — OIDC providers can now override individual discovered endpoints and remap non-standard ID-token claims, and any provider can send custom authorization-request parameters (e.g. `prompt`, `login_hint`, `hd`, `audience`); reserved keys are ignored. Configurable from the wizard's Advanced section and via `auth_params` in YAML/env.
