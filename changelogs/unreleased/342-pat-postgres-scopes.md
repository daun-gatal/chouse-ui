type: patch

### Fixed
- **Personal access tokens on PostgreSQL** — token creation failed with a 500 because `rbac_api_keys.scopes` was created as `TEXT[]` while the server maps it as JSONB. Migration `1.52.0` converts the column to JSONB (existing installs) and the snapshot now creates it correctly (fresh installs).
