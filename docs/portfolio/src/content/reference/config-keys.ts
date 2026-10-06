/**
 * Server configuration keys: the source of the Environment variables page.
 *
 * The server reads its settings ad hoc from process.env (YAML is flattened
 * into the same names), so there is no schema to generate from. Instead,
 * scripts/gen-reference.ts scans packages/server/src for every variable the
 * server reads and fails if one is missing here, or if an entry here is no
 * longer read (unless it is marked deprecated/removed). Add new variables
 * here in the same PR that introduces them.
 */

export interface ConfigKey {
  name: string;
  section: string;
  /** Default as the server applies it; omit when there is none. */
  default?: string;
  description: string;
  /** "production" — the server refuses to start in production without it. */
  required?: "production";
  /** Holds a secret: keep it out of committed YAML and logs. */
  secret?: boolean;
  /** Still read but on its way out (deprecated), or no longer read (removed). */
  status?: "deprecated" | "removed";
}

/** Section order on the page. */
export const CONFIG_SECTIONS = [
  "Core server",
  "ClickHouse connection defaults",
  "RBAC database",
  "Authentication & sessions",
  "Encryption",
  "First-run admin",
  "Single sign-on",
  "Data observability",
  "Fleet & alerts",
  "Remediation & Slack",
  "Doctor",
  "Scheduled queries & HA",
  "Maintenance",
  "Removed or deprecated",
] as const;

/**
 * Variables the server reads that are not user configuration: test
 * harnesses and values the runtime sets for the process.
 */
export const IGNORED_ENV = new Set(["DOCKER_HOST", "MIGRATION_TEST_PG_HOST", "MIGRATION_TEST_PG_PORT"]);

export const CONFIG_KEYS: ConfigKey[] = [
  // Core server
  { name: "PORT", section: "Core server", default: "5521", description: "HTTP port for the UI, the API and the MCP endpoint (`/mcp`)." },
  { name: "NODE_ENV", section: "Core server", default: "development", description: "Set `production` for real deployments: the server then refuses to start without `JWT_SECRET`, `RBAC_ENCRYPTION_KEY` and `RBAC_ENCRYPTION_SALT`, tightens the content security policy and enforces `CORS_ORIGIN`." },
  { name: "STATIC_PATH", section: "Core server", default: "./dist", description: "Directory of the built frontend the server serves." },
  { name: "CORS_ORIGIN", section: "Core server", default: "*", description: "Allowed browser origins, comma-separated. Set your domain in production — `*` logs a warning there. The MCP endpoint ignores it and uses its own allowed origins (AI Governance › MCP)." },
  { name: "LOG_LEVEL", section: "Core server", default: "info", description: "`trace`, `debug`, `info`, `warn`, `error` or `fatal`. Logs are JSON (Pino)." },
  { name: "CHOUSE_CONFIG_PATH", section: "Core server", description: "Path to a YAML configuration file. Its keys are flattened into these variable names and **override** the environment — see [YAML configuration](/docs/configuration-yaml/)." },
  { name: "PUBLIC_BASE_URL", section: "Core server", description: "The URL people and agents use to reach CHouse UI, e.g. `https://chouse.example.com`. Used for links in Slack approval messages and as the MCP endpoint address when AI Governance › MCP has no public address set." },
  { name: "VERSION", section: "Core server", default: "dev", description: "Version string shown in the UI and returned by `/api/config`. Set by the release image; leave it alone." },

  // ClickHouse defaults
  { name: "CLICKHOUSE_DEFAULT_URL", section: "ClickHouse connection defaults", description: "Pre-fills the host URL in the connection form." },
  { name: "CLICKHOUSE_DEFAULT_USER", section: "ClickHouse connection defaults", default: "default", description: "Pre-fills the user in the connection form." },
  { name: "CLICKHOUSE_PRESET_URLS", section: "ClickHouse connection defaults", description: "Comma-separated host URLs offered as a dropdown in the connection form." },

  // RBAC database
  { name: "RBAC_DB_TYPE", section: "RBAC database", default: "sqlite", description: "`sqlite` or `postgres`. Use PostgreSQL for more than one replica." },
  { name: "RBAC_SQLITE_PATH", section: "RBAC database", default: "./data/rbac.db", description: "SQLite file path (Docker image: `/app/data/rbac.db`)." },
  { name: "RBAC_POSTGRES_URL", section: "RBAC database", secret: true, description: "`postgres://user:password@host:5432/dbname`. Required when `RBAC_DB_TYPE=postgres`." },
  { name: "DATABASE_URL", section: "RBAC database", secret: true, description: "Fallback for `RBAC_POSTGRES_URL` when that is not set." },
  { name: "RBAC_POSTGRES_POOL_SIZE", section: "RBAC database", default: "10", description: "PostgreSQL connection pool size per pod." },

  // Auth
  { name: "JWT_SECRET", section: "Authentication & sessions", required: "production", secret: true, description: "Signs session tokens (and encrypts stored credentials if `RBAC_ENCRYPTION_KEY` is not set). At least 32 characters; generate with `openssl rand -base64 32`." },
  { name: "JWT_ACCESS_EXPIRY", section: "Authentication & sessions", default: "4h", description: "Access-token lifetime (`m`, `h`, `d`)." },
  { name: "JWT_REFRESH_EXPIRY", section: "Authentication & sessions", default: "7d", description: "Refresh-token lifetime — how long a session survives without signing in again." },
  { name: "JWT_ISSUER", section: "Authentication & sessions", default: "chouseui", description: "`iss` claim on issued tokens." },
  { name: "JWT_AUDIENCE", section: "Authentication & sessions", default: "chouseui-client", description: "`aud` claim on issued tokens." },
  { name: "AUTH_PASSWORD_LOGIN_ENABLED", section: "Authentication & sessions", default: "true", description: "`false` requires SSO. Ignored unless at least one usable SSO provider is configured, so a bad SSO config cannot lock everyone out." },
  { name: "AUTH_CONFIG_WATCH_INTERVAL_MS", section: "Authentication & sessions", default: "15000", description: "How often each replica checks for SSO and login-setting changes made on another replica. Minimum 1000; irrelevant with one replica." },

  // Encryption
  { name: "RBAC_ENCRYPTION_KEY", section: "Encryption", required: "production", secret: true, description: "AES-256-GCM key for stored ClickHouse and remediation credentials. 64 hex characters: `openssl rand -hex 32`. Changing it makes stored passwords unreadable." },
  { name: "RBAC_ENCRYPTION_SALT", section: "Encryption", required: "production", secret: true, description: "Key-derivation salt. Exactly 64 hex characters: `openssl rand -hex 32`." },

  // Admin seed
  { name: "RBAC_ADMIN_EMAIL", section: "First-run admin", default: "admin@localhost", description: "Email of the super admin created on first start. Ignored once any user exists." },
  { name: "RBAC_ADMIN_USERNAME", section: "First-run admin", default: "admin", description: "Username of the first-run super admin." },
  { name: "RBAC_ADMIN_PASSWORD", section: "First-run admin", default: "admin123!", secret: true, description: "Password of the first-run super admin. Change it at first login." },

  // SSO
  { name: "AUTH_SSO_ENABLED", section: "Single sign-on", default: "false", description: "Turn on SSO sign-in." },
  { name: "AUTH_SSO_BASE_URL", section: "Single sign-on", description: "Public app URL; the redirect URI to register at your IdP is `<base>/auth/sso/callback`." },
  { name: "AUTH_SSO_DEFAULT_ROLE", section: "Single sign-on", default: "viewer", description: "Role given to users created on first SSO sign-in when no role mapping matches." },
  { name: "AUTH_SSO_AUTO_LINK_BY_EMAIL", section: "Single sign-on", default: "true", description: "Link an SSO identity to an existing user with the same verified email." },
  { name: "AUTH_SSO_PROVIDERS_<ID>_<FIELD>", section: "Single sign-on", secret: true, description: "One provider per `<ID>`: `TYPE`, `DISPLAY_NAME`, `ISSUER`, `CLIENT_ID`, `CLIENT_SECRET`, `SCOPES`, endpoints, claim and role mapping, and SAML fields. See [SSO](/docs/sso/) for every field." },

  // Observability
  { name: "OBSERVE_FLEET_INTERVAL", section: "Data observability", default: "30", description: "Seconds between fleet metric samples. Takes precedence over `FLEET_POLL_INTERVAL_SECONDS`." },
  { name: "OBSERVE_RETENTION_DAYS", section: "Data observability", default: "90", description: "Days an observed lineage edge (one seen in query logs, not declared in DDL) is kept after it was last seen." },
  { name: "OBSERVE_MAX_FINGERPRINTS", section: "Data observability", default: "5000", description: "Most query shapes tracked per connection for performance baselines." },
  { name: "OBSERVE_MAX_PARALLEL", section: "Data observability", default: "4", description: "Collector runs a pod executes at once." },
  { name: "OBSERVE_RUN_TIMEOUT_SECONDS", section: "Data observability", default: "120", description: "Time limit for one collector run before it is abandoned." },
  { name: "OBSERVE_INCIDENT_HOLD_SECONDS", section: "Data observability", default: "300", description: "Seconds a pipeline must stay bad before it opens an incident, so brief blips do not page. `0` opens on the first bad sample." },
  { name: "OBSERVE_CAPACITY_THRESHOLD", section: "Data observability", default: "0.85", description: "Disk fill ratio that capacity forecasts warn about (0–1)." },
  { name: "OBSERVE_SCRATCH_DATABASE", section: "Data observability", default: "chouse_scratch", description: "Database used for codec trials and upgrade replays. Needs write access for `upgrades:run`." },

  // Fleet
  { name: "FLEET_POLL_INTERVAL_SECONDS", section: "Fleet & alerts", default: "30", description: "Fleet sample interval, kept for compatibility. `OBSERVE_FLEET_INTERVAL` wins when both are set." },
  { name: "FLEET_RETENTION_HOURS", section: "Fleet & alerts", default: "24", description: "Hours of fleet samples kept for the Fleet page trends." },
  { name: "FLEET_PRUNE_INTERVAL_MINUTES", section: "Fleet & alerts", default: "5", description: "How often old fleet samples are pruned." },
  { name: "FLEET_METRIC_TIMEOUT_SECONDS", section: "Fleet & alerts", default: "15", description: "Time limit for one fleet metric query against a cluster." },
  { name: "ALERT_CONFIG_FILE", section: "Fleet & alerts", default: "/app/data/alert-config.json", description: "Legacy alert rules file, imported into the database on upgrade. Rules are managed in Admin › Alerting." },

  // Remediation
  { name: "REMEDIATION_MAINTENANCE_WINDOW", section: "Remediation & Slack", default: "02:00-04:00", description: "UTC window in which TTL and codec changes may run." },
  { name: "SLACK_SIGNING_SECRET", section: "Remediation & Slack", secret: true, description: "Verifies approval button clicks coming from Slack." },
  { name: "SLACK_BOT_TOKEN", section: "Remediation & Slack", secret: true, description: "Bot token used to post fix approval requests." },
  { name: "REMEDIATION_SLACK_CHANNEL", section: "Remediation & Slack", description: "Channel that receives fix approval requests." },

  // Doctor
  { name: "DOCTOR_SCHEDULE_FILE", section: "Doctor", default: "/app/data/doctor-schedule.json", description: "Legacy doctor schedule file, imported into the database on upgrade." },
  { name: "DOCTOR_AUTO_RCA_COOLDOWN_MINUTES", section: "Doctor", default: "60", description: "Minimum minutes between automatic root-cause runs for one server after an alert." },

  // Scheduler / HA
  { name: "SCHEDULED_QUERIES_ENABLED", section: "Scheduled queries & HA", default: "true", description: "`false` stops this pod from running scheduled queries (for a dedicated scheduler deployment). Job leases make running it on every pod safe." },
  { name: "CHOUSE_HA", section: "Scheduled queries & HA", default: "false", description: "Set by the Helm chart when replicas > 1. With SQLite, the server logs an error that job leases cannot span pods." },
  { name: "HOSTNAME", section: "Scheduled queries & HA", description: "Identifies the pod that holds a job lease in run history. Set by the container runtime." },

  // Maintenance
  { name: "CONFIRM_RESET", section: "Maintenance", description: "Must be `yes` for `bun run rbac:reset` (in `packages/server`) to wipe the RBAC database — see [Migrations & upgrades](/docs/migrations-upgrades/)." },

  // Removed / deprecated
  { name: "FLEET_POLLER_ENABLED", section: "Removed or deprecated", status: "deprecated", description: "Ignored since 3.14 — fleet collection always runs. A warning is logged when it is set." },
  { name: "MCP_ENABLED", section: "Removed or deprecated", status: "removed", description: "Removed in 3.14. Turn the endpoint on in AI Governance › MCP. A warning names any `MCP_*` key still set." },
  { name: "MCP_PORT", section: "Removed or deprecated", status: "removed", description: "Removed in 3.14. MCP is served at `/mcp` on `PORT`." },
  { name: "MCP_HOST", section: "Removed or deprecated", status: "removed", description: "Removed in 3.14. MCP is served at `/mcp` on `PORT`." },
  { name: "MCP_ALLOW_WRITES", section: "Removed or deprecated", status: "removed", description: "Removed in 3.14. Turn write tools on one by one in AI Governance › MCP." },
];
