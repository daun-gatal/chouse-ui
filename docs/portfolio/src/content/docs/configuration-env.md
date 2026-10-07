---
generated: docs/portfolio/src/content/reference/config-keys.ts
---
Every setting the server reads, with its default. Set them as environment variables, or as keys in a YAML file named by `CHOUSE_CONFIG_PATH` — see [YAML configuration](/docs/configuration-yaml/).

- **Precedence:** a key in the YAML file overrides the environment variable of the same name. Keys the file leaves out keep the environment's value.
- **YAML names:** nested keys are joined with `_` and upper-cased, so `rbac.db_type` is `RBAC_DB_TYPE`. The YAML key shown below is the one the annotated example uses.
- **Production:** with `NODE_ENV=production` the server refuses to start without `JWT_SECRET`, `RBAC_ENCRYPTION_KEY`, `RBAC_ENCRYPTION_SALT`. Generate them with [openssl](/docs/configuration-secrets/).
- **In the app, not here:** the MCP endpoint, SSO providers created in Admin › SSO, alert rules, AI models and agent policies are stored in the database and changed in the UI.

## Core server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5521` | HTTP port for the UI, the API and the MCP endpoint (`/mcp`). YAML: `port`. |
| `NODE_ENV` | `development` | Set `production` for real deployments: the server then refuses to start without `JWT_SECRET`, `RBAC_ENCRYPTION_KEY` and `RBAC_ENCRYPTION_SALT`, tightens the content security policy and enforces `CORS_ORIGIN`. YAML: `node_env`. |
| `STATIC_PATH` | `./dist` | Directory of the built frontend the server serves. YAML: `static_path`. |
| `CORS_ORIGIN` | `*` | Allowed browser origins, comma-separated. Set your domain in production — `*` logs a warning there. The MCP endpoint ignores it and uses its own allowed origins (AI Governance › MCP). YAML: `cors_origin`. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` or `fatal`. Logs are JSON (Pino). YAML: `log_level`. |
| `CHOUSE_CONFIG_PATH` | — | Path to a YAML configuration file. Its keys are flattened into these variable names and **override** the environment — see [YAML configuration](/docs/configuration-yaml/). |
| `PUBLIC_BASE_URL` | — | The URL people and agents use to reach CHouse UI, e.g. `https://chouse.example.com`. Used for links in Slack approval messages and as the MCP endpoint address when AI Governance › MCP has no public address set. |
| `VERSION` | `dev` | Version string shown in the UI and returned by `/api/config`. Set by the release image; leave it alone. |

## ClickHouse connection defaults

| Variable | Default | Description |
| --- | --- | --- |
| `CLICKHOUSE_DEFAULT_URL` | — | Pre-fills the host URL in the connection form. YAML: `clickhouse.default_url`. |
| `CLICKHOUSE_DEFAULT_USER` | `default` | Pre-fills the user in the connection form. YAML: `clickhouse.default_user`. |
| `CLICKHOUSE_PRESET_URLS` | — | Comma-separated host URLs offered as a dropdown in the connection form. YAML: `clickhouse.preset_urls`. |

## RBAC database

| Variable | Default | Description |
| --- | --- | --- |
| `RBAC_DB_TYPE` | `sqlite` | `sqlite` or `postgres`. Use PostgreSQL for more than one replica. YAML: `rbac.db_type`. |
| `RBAC_SQLITE_PATH` | `./data/rbac.db` | SQLite file path (Docker image: `/app/data/rbac.db`). YAML: `rbac.sqlite_path`. |
| `RBAC_POSTGRES_URL` | — | *Secret.* `postgres://user:password@host:5432/dbname`. Required when `RBAC_DB_TYPE=postgres`. YAML: `rbac.postgres_url`. |
| `DATABASE_URL` | — | *Secret.* Fallback for `RBAC_POSTGRES_URL` when that is not set. |
| `RBAC_POSTGRES_POOL_SIZE` | `10` | PostgreSQL connection pool size per pod. YAML: `rbac.postgres_pool_size`. |

## Authentication & sessions

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_SECRET` | — | **Required in production.** *Secret.* Signs session tokens (and encrypts stored credentials if `RBAC_ENCRYPTION_KEY` is not set). At least 32 characters; generate with `openssl rand -base64 32`. YAML: `jwt.secret`. |
| `JWT_ACCESS_EXPIRY` | `4h` | Access-token lifetime (`m`, `h`, `d`). YAML: `jwt.access_expiry`. |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh-token lifetime — how long a session survives without signing in again. YAML: `jwt.refresh_expiry`. |
| `JWT_ISSUER` | `chouseui` | `iss` claim on issued tokens. |
| `JWT_AUDIENCE` | `chouseui-client` | `aud` claim on issued tokens. |
| `AUTH_PASSWORD_LOGIN_ENABLED` | `true` | `false` requires SSO. Ignored unless at least one usable SSO provider is configured, so a bad SSO config cannot lock everyone out. YAML: `auth.password_login.enabled`. |
| `AUTH_CONFIG_WATCH_INTERVAL_MS` | `15000` | How often each replica checks for SSO and login-setting changes made on another replica. Minimum 1000; irrelevant with one replica. YAML: `auth.config_watch_interval_ms`. |

## Encryption

| Variable | Default | Description |
| --- | --- | --- |
| `RBAC_ENCRYPTION_KEY` | — | **Required in production.** *Secret.* AES-256-GCM key for stored ClickHouse and remediation credentials. 64 hex characters: `openssl rand -hex 32`. Changing it makes stored passwords unreadable. YAML: `rbac.encryption.key`. |
| `RBAC_ENCRYPTION_SALT` | — | **Required in production.** *Secret.* Key-derivation salt. Exactly 64 hex characters: `openssl rand -hex 32`. YAML: `rbac.encryption.salt`. |

## First-run admin

| Variable | Default | Description |
| --- | --- | --- |
| `RBAC_ADMIN_EMAIL` | `admin@localhost` | Email of the super admin created on first start. Ignored once any user exists. YAML: `rbac.admin.email`. |
| `RBAC_ADMIN_USERNAME` | `admin` | Username of the first-run super admin. YAML: `rbac.admin.username`. |
| `RBAC_ADMIN_PASSWORD` | `admin123!` | *Secret.* Password of the first-run super admin. Change it at first login. YAML: `rbac.admin.password`. |

## Single sign-on

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_SSO_ENABLED` | `false` | Turn on SSO sign-in. YAML: `auth.sso.enabled`. |
| `AUTH_SSO_BASE_URL` | — | Public app URL; the redirect URI to register at your IdP is `<base>/auth/sso/callback`. YAML: `auth.sso.base_url`. |
| `AUTH_SSO_DEFAULT_ROLE` | `viewer` | Role given to users created on first SSO sign-in when no role mapping matches. YAML: `auth.sso.default_role`. |
| `AUTH_SSO_AUTO_LINK_BY_EMAIL` | `true` | Link an SSO identity to an existing user with the same verified email. YAML: `auth.sso.auto_link_by_email`. |
| `AUTH_SSO_PROVIDERS_<ID>_<FIELD>` | — | *Secret.* One provider per `<ID>`: `TYPE`, `DISPLAY_NAME`, `ISSUER`, `CLIENT_ID`, `CLIENT_SECRET`, `SCOPES`, endpoints, claim and role mapping, and SAML fields. See [SSO](/docs/sso/) for every field. |

## Data observability

| Variable | Default | Description |
| --- | --- | --- |
| `OBSERVE_FLEET_INTERVAL` | `30` | Seconds between fleet metric samples. Takes precedence over `FLEET_POLL_INTERVAL_SECONDS`. YAML: `observe.fleet_interval`. |
| `OBSERVE_RETENTION_DAYS` | `90` | Days an observed lineage edge (one seen in query logs, not declared in DDL) is kept after it was last seen. YAML: `observe.retention_days`. |
| `OBSERVE_MAX_FINGERPRINTS` | `5000` | Most query shapes tracked per connection for performance baselines. YAML: `observe.max_fingerprints`. |
| `OBSERVE_MAX_PARALLEL` | `4` | Collector runs a pod executes at once. |
| `OBSERVE_RUN_TIMEOUT_SECONDS` | `120` | Time limit for one collector run before it is abandoned. |
| `OBSERVE_INCIDENT_HOLD_SECONDS` | `300` | Seconds a pipeline must stay bad before it opens an incident, so brief blips do not page. `0` opens on the first bad sample. |
| `OBSERVE_CAPACITY_THRESHOLD` | `0.85` | Disk fill ratio that capacity forecasts warn about (0–1). |
| `OBSERVE_SCRATCH_DATABASE` | `chouse_scratch` | Database used for codec trials and upgrade replays. Needs write access for `upgrades:run`. YAML: `observe.scratch_database`. |

## Fleet & alerts

| Variable | Default | Description |
| --- | --- | --- |
| `FLEET_POLL_INTERVAL_SECONDS` | `30` | Fleet sample interval, kept for compatibility. `OBSERVE_FLEET_INTERVAL` wins when both are set. YAML: `fleet.poll_interval_seconds`. |
| `FLEET_RETENTION_HOURS` | `24` | Hours of fleet samples kept for the Fleet page trends. |
| `FLEET_PRUNE_INTERVAL_MINUTES` | `5` | How often old fleet samples are pruned. |
| `FLEET_METRIC_TIMEOUT_SECONDS` | `15` | Time limit for one fleet metric query against a cluster. |
| `ALERT_CONFIG_FILE` | `/app/data/alert-config.json` | Legacy alert rules file, imported into the database on upgrade. Rules are managed in Admin › Alerting. |

## Remediation & Slack

| Variable | Default | Description |
| --- | --- | --- |
| `REMEDIATION_MAINTENANCE_WINDOW` | `02:00-04:00` | UTC window in which TTL and codec changes may run. YAML: `remediation.maintenance_window`. |
| `SLACK_SIGNING_SECRET` | — | *Secret.* Verifies approval button clicks coming from Slack. |
| `SLACK_BOT_TOKEN` | — | *Secret.* Bot token used to post fix approval requests. |
| `REMEDIATION_SLACK_CHANNEL` | — | Channel that receives fix approval requests. |

## Doctor

| Variable | Default | Description |
| --- | --- | --- |
| `DOCTOR_SCHEDULE_FILE` | `/app/data/doctor-schedule.json` | Legacy doctor schedule file, imported into the database on upgrade. YAML: `doctor.schedule_file`. |
| `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` | `60` | Minimum minutes between automatic root-cause runs for one server after an alert. YAML: `doctor.auto_rca_cooldown_minutes`. |

## Scheduled queries & HA

| Variable | Default | Description |
| --- | --- | --- |
| `SCHEDULED_QUERIES_ENABLED` | `true` | `false` stops this pod from running scheduled queries (for a dedicated scheduler deployment). Job leases make running it on every pod safe. YAML: `scheduled_queries.enabled`. |
| `CHOUSE_HA` | `false` | Set by the Helm chart when replicas > 1. With SQLite, the server logs an error that job leases cannot span pods. |
| `HOSTNAME` | — | Identifies the pod that holds a job lease in run history. Set by the container runtime. |

## Maintenance

| Variable | Default | Description |
| --- | --- | --- |
| `CONFIRM_RESET` | — | Must be `yes` for `bun run rbac:reset` (in `packages/server`) to wipe the RBAC database — see [Migrations & upgrades](/docs/migrations-upgrades/). |

## Removed or deprecated

| Variable | Default | Description |
| --- | --- | --- |
| `FLEET_POLLER_ENABLED` | — | **Deprecated.** Ignored since 3.14 — fleet collection always runs. A warning is logged when it is set. |
| `MCP_ENABLED` | — | **Removed.** Removed in 3.14. Turn the endpoint on in AI Governance › MCP. A warning names any `MCP_*` key still set. |
| `MCP_PORT` | — | **Removed.** Removed in 3.14. MCP is served at `/mcp` on `PORT`. |
| `MCP_HOST` | — | **Removed.** Removed in 3.14. MCP is served at `/mcp` on `PORT`. |
| `MCP_ALLOW_WRITES` | — | **Removed.** Removed in 3.14. Turn write tools on one by one in AI Governance › MCP. |
