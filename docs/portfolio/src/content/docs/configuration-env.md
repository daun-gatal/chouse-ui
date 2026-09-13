# Environment variables

All configuration can be expressed as environment variables (`.env`) or as nested YAML keys — see [YAML configuration](/docs/configuration-yaml/). The annotated source of truth is [`.env.example`](https://github.com/daun-gatal/chouse-ui/blob/main/.env.example).

## Core server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5521` | HTTP port for the UI + API |
| `NODE_ENV` | `development` | `production` for real deployments |
| `STATIC_PATH` | `./dist` | Built frontend assets to serve |
| `CORS_ORIGIN` | `*` | Allowed browser origin — set to your domain in production |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` (Pino JSON logs) |
| `CHOUSE_CONFIG_PATH` | — | Path to a YAML config file |

## ClickHouse connection defaults

| Variable | Purpose |
| --- | --- |
| `CLICKHOUSE_DEFAULT_URL` | Pre-fills the connection form host |
| `CLICKHOUSE_DEFAULT_USER` | Pre-fills the user (`default`) |
| `CLICKHOUSE_PRESET_URLS` | Comma-separated dropdown of preset URLs |

## RBAC database

| Variable | Default | Purpose |
| --- | --- | --- |
| `RBAC_DB_TYPE` | `sqlite` | `sqlite` or `postgres` |
| `RBAC_SQLITE_PATH` | `./data/rbac.db` | SQLite file path |
| `RBAC_POSTGRES_URL` | — | `postgres://user:password@host:5432/dbname` — required for multi-instance HA |
| `RBAC_POSTGRES_POOL_SIZE` | `10` | Connection pool size |

## JWT authentication

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | — | Signing secret, min 32 bytes — **required in production** |
| `JWT_ACCESS_EXPIRY` | `4h` | Access-token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh-token lifetime |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `chouseui` / `chouseui-client` | Claim overrides |

## Encryption

| Variable | Purpose |
| --- | --- |
| `RBAC_ENCRYPTION_KEY` | AES-256 key for ClickHouse connection passwords — 32-byte hex, **required in production** |
| `RBAC_ENCRYPTION_SALT` | Key-derivation salt — 32-byte hex, **required in production** |

## Admin seeding (first run only)

| Variable | Default |
| --- | --- |
| `RBAC_ADMIN_EMAIL` | `admin@localhost` |
| `RBAC_ADMIN_USERNAME` | `admin` |
| `RBAC_ADMIN_PASSWORD` | `admin123!` |

## Fleet & alerts

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLEET_POLLER_ENABLED` | `false` | Background per-cluster metric snapshots |
| `FLEET_POLL_INTERVAL_SECONDS` | `30` | Poll cadence |
| `ALERT_CONFIG_FILE` | `/app/data/alert-config.json` | Alert rules/channels store |

## Doctor & scheduled queries

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOCTOR_SCHEDULE_FILE` | `/app/data/doctor-schedule.json` | Doctor schedule store |
| `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` | `60` | Min minutes between automatic RCA runs per server |
| `SCHEDULED_QUERIES_ENABLED` | `true` | In-process scheduler on this pod |
| `CHOUSE_HA` | `false` | HA signal; with SQLite + true, warns that the scheduler lease cannot span pods |

## SSO & auth

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_SSO_ENABLED` | `false` | Enable SSO login |
| `AUTH_SSO_BASE_URL` | — | Public app URL (builds the redirect URI `<base>/auth/sso/callback`) |
| `AUTH_SSO_DEFAULT_ROLE` | `viewer` | Role for JIT-provisioned users |
| `AUTH_SSO_AUTO_LINK_BY_EMAIL` | `true` | Link to existing users when IdP asserts `email_verified` |
| `AUTH_SSO_PROVIDERS_<ID>_<FIELD>` | — | Per-provider config (type, issuer, client_id, client_secret, scopes, role mapping…) |
| `AUTH_PASSWORD_LOGIN_ENABLED` | `true` | `false` requires SSO (fail-safe: ignored if no valid provider exists) |
| `AUTH_CONFIG_WATCH_INTERVAL_MS` | `15000` | Multi-replica SSO config propagation interval |

## MCP server

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_ENABLED` | `false` | Serve the MCP endpoint on port `8752` |
| `MCP_ALLOW_WRITES` | `false` | Create/run/ack operational actions |
| `MCP_ALLOW_DESTRUCTIVE` | `false` | KILL/raw SQL/deletes (requires writes) |
| `MCP_TOOLSETS` | `core,explore,query,observe,ops` | Registered toolsets |
| `MCP_ALLOWED_ORIGINS` | — | Origin allowlist (DNS-rebinding protection) |
| `MCP_TIMEOUT_SECONDS` | `60` | Per-request tool timeout |

> **Tip:** Generate every secret with [openssl](/docs/configuration-secrets/) — never reuse the example values.
