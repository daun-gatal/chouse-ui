# YAML configuration

CHouse UI accepts a grouped YAML file as the preferred alternative to individual environment variables. Point the server at it:

```bash
CHOUSE_CONFIG_PATH=./.config.yaml bun run packages/server/src/index.ts
```

## How YAML and env vars interact

- Every YAML key maps 1:1 to an upper-snake-case env var, nesting joined by underscores: `rbac.encryption.key` → `RBAC_ENCRYPTION_KEY`, `auth.sso.providers.google.client_secret` → `AUTH_SSO_PROVIDERS_GOOGLE_CLIENT_SECRET`
- A key present in the YAML **wins** over the same env var
- A key omitted from the YAML keeps whatever the environment provides — so you can keep secrets out of the file (see below)

> **Warning:** YAML values are loaded verbatim — there is no `"${VAR}"` expansion. A value like `${GOOGLE_CLIENT_SECRET}` is passed to the IdP as that literal string. To keep a secret out of the YAML, simply omit its key.

## Minimal production example

```yaml
port: 5521
node_env: production
log_level: info

rbac:
  db_type: postgres
  postgres_url: postgres://user:password@db-host:5432/chouse
  encryption:
    key: ""    # openssl rand -hex 32
    salt: ""   # openssl rand -hex 32
  admin:
    email: ops@example.com
    username: ops
    password: Password1!

jwt:
  secret: ""   # openssl rand -base64 32
  access_expiry: 4h
  refresh_expiry: 7d

clickhouse:
  default_url: ""
  default_user: default
  preset_urls: ""
```

## Full option groups

The complete annotated example lives in [`.config.example.yaml`](https://github.com/daun-gatal/chouse-ui/blob/main/.config.example.yaml). Option groups:

| Group | Keys |
| --- | --- |
| Core server | `port`, `version`, `node_env`, `static_path`, `cors_origin`, `log_level` |
| `rbac` | `db_type`, `sqlite_path`, `postgres_url`, `postgres_pool_size`, `encryption.key`, `encryption.salt`, `admin.{email,username,password}` |
| `clickhouse` | `default_url`, `default_user`, `preset_urls` |
| `jwt` | `secret`, `access_expiry`, `refresh_expiry`, `issuer`, `audience` |
| `fleet` | `poller_enabled`, `poll_interval_seconds`, `alert_config_file` |
| `doctor` | `schedule_file`, `auto_rca_cooldown_minutes` |
| `scheduled_queries` | `enabled` |
| `mcp` | `enabled`, `allow_writes`, `allow_destructive`, `toolsets`, `allowed_origins`, `timeout_seconds` |
| `auth.sso` | `enabled`, `base_url`, `default_role`, `auto_link_by_email`, `providers.<id>.*` |
| `auth.password_login` | `enabled` |
| `auth.config_watch_interval_ms` | multi-replica SSO/config propagation |

> **Tip:** Keep client secrets (`saml_idp_certificate`, `client_secret`) in environment variables rather than the YAML — omit the keys here and the env values apply.

## Multi-replica note

SSO configuration is cached per pod and refreshed via a shared generation counter in the RBAC database. `auth.config_watch_interval_ms` (default `15000`, floor `1000`) bounds how fast changes propagate to replicas that did not serve the mutation — see [SSO](/docs/sso/).
