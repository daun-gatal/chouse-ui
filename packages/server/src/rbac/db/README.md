# RBAC Database & Migrations

## Overview
The RBAC metadata database layer: driver selection and connection lifecycle for
SQLite (`bun:sqlite`) or PostgreSQL (`postgres`), dialect-agnostic raw-SQL
helpers, the shared config-generation counter, and the forward-only migration
chain. `migrations.ts` holds the core chain (`MIGRATIONS`) and the runner;
feature migrations live in `*Migrations.ts` modules with their DDL in matching
`*Schema.ts` modules (except `collectorLoadMigrations.ts`, whose DDL is `collectorLoadSchemaStatements` in `observeSchema.ts`), appended to `MIGRATIONS` in order. Core Drizzle tables are
in [`../schema/`](../schema/README.md).

## Interface
- `index.ts`
  - `[index.ts:getDatabaseConfig]` - env `RBAC_DB_TYPE` (`sqlite` default | `postgres`), `RBAC_SQLITE_PATH` (default `./data/rbac.db`), `RBAC_POSTGRES_URL` or `DATABASE_URL`, `RBAC_POSTGRES_POOL_SIZE` (default 10).
  - `[index.ts:initializeDatabase]`, `[index.ts:getDatabase]`, `[index.ts:getDatabaseType]`, `[index.ts:getPostgresClient]`, `[index.ts:isSqlite]`, `[index.ts:isPostgres]`, `[index.ts:getSchema]`, `[index.ts:closeDatabase]`, `[index.ts:checkDatabaseHealth]` (`{ healthy, type, error? }`); re-exports drizzle `sql` and everything from `migrations.ts`; types `DatabaseType`, `DatabaseConfig`, `SqliteDb`, `PostgresDb`, `RbacDb`.
- `raw.ts`: `[raw.ts:rawAll]`, `[raw.ts:rawRun]`, `[raw.ts:toNumber]` - one call/result shape over both drivers.
- `configGeneration.ts`: `[configGeneration.ts:readConfigGeneration]`, `[configGeneration.ts:bumpConfigGeneration]` (table `rbac_config_generation`, row `id = 1`).
- `reset.ts`: `[reset.ts:RBAC_TABLES]` (every table a fresh install creates), `[reset.ts:LEGACY_RBAC_TABLES]`, `[reset.ts:dropRbacTables]` (used by `rbac:reset`; drops only those tables, `CASCADE` on PostgreSQL, foreign keys off during the drop on SQLite).
- `migrations.ts`
  - `[migrations.ts:Migration]` (`version`, `name`, `description`, `up`, optional `down`), `MigrationStatus`, `MigrationResult`.
  - `[migrations.ts:MIGRATIONS]` - ordered chain; `[migrations.ts:APP_VERSION]` (`'1.75.0'`, the RBAC schema version, not the app release).
  - `[migrations.ts:runMigrations]` (`{ skipSeed?, through? }`), `[migrations.ts:getMigrationStatus]`, `[migrations.ts:needsUpgrade]`, `[migrations.ts:getCurrentVersion]`, `[migrations.ts:isFirstRun]`.
- Feature migration arrays appended to `MIGRATIONS`, in order: `OBSERVE_MIGRATIONS` (1.53-1.55, ADR 0016), `AI_REGISTRY_MIGRATIONS` (1.56, ADR 0019), `COLLECTOR_LOAD_MIGRATIONS` (1.57, DDL from `[observeSchema.ts:collectorLoadSchemaStatements]`), `AI_USAGE_MIGRATIONS` (1.58-1.60, ADR 0020), `DASHBOARDS_MIGRATIONS` (1.61, ADR 0021), `AI_GUARDRAILS_MIGRATIONS` (1.62, ADR 0022), `DASHBOARDS_V2_MIGRATIONS` (1.63-1.64, ADR 0023), `AI_PLATFORM_MIGRATIONS` (1.65-1.70, ADR 0024), `AI_ASSISTANT_MIGRATIONS` (1.71-1.73, ADR 0025), `NOTIFY_MIGRATIONS` (1.74, ADR 0026), `MCP_OAUTH_MIGRATIONS` (1.75, ADR 0028) `[migrations.ts:MIGRATIONS]`.
- Schema modules export DDL builders and name lists used by migrations and tests, for example `[observeSchema.ts:observeSchemaStatements]`, `[observeSchema.ts:Dialect]`, `[observeSchema.ts:OBSERVE_TABLE_NAMES]`, `[dashboardsSchema.ts:dashboardsSchemaStatements]`, `[aiRegistrySchema.ts:aiRegistrySchemaStatements]`, `[mcpOAuthSchema.ts:MCP_OAUTH_TABLE_NAMES]`, `[notifySchema.ts:NOTIFY_TABLE_NAMES]`.
- Data-migration helpers: `[dashboardsV2Migrations.ts:convertStoredDashboard]` (1.63.0 panel/layout conversion), `[notifyMigrations.ts:legacyEventSource]` (alert-event backfill).

## Invariants
- Migrations are forward-only, not transaction-wrapped, and must be idempotent (`IF NOT EXISTS`, guarded column adds, grants that skip existing rows); destructive steps go in their own later migration (for example 1.55.0 after the 1.54.0 data move) `[observeMigrations.ts]` header.
- Feature DDL is written once with `{BIGINT}`/`{REAL}` placeholders rendered per dialect so SQLite and PostgreSQL cannot drift `[observeSchema.ts]` header; timestamps are unix milliseconds unless a column ends in `_s`.
- Every migration version needs a `VERSION_CHECKS` entry in `migrations.test.ts` and must pass fresh, stepwise, and skip-version upgrades on both dialects (project rule in `AGENTS.md`).
- On PostgreSQL, `runMigrations` holds a session advisory lock (`MIGRATION_ADVISORY_LOCK_KEY_1/2`) on a reserved connection, so only one replica migrates at a time `[migrations.ts:runMigrations]`.
- A first run (no rows in `_rbac_migrations`) creates the base schema from Drizzle before applying the chain; already-applied versions are skipped; a failed `up` throws `Migration <v> failed` and stops the chain `[migrations.ts:runMigrationsBody]`.
- `through` must name a known version or the runner throws, so a typo cannot apply everything `[migrations.ts:runMigrationsBody]`.
- `initializeDatabase` is a singleton; PostgreSQL requires a URL; SQLite opens with `journal_mode = WAL` and `foreign_keys = ON` `[index.ts:initializeDatabase]`.
- Built-in AI agents and guardrails are seeded at startup, not by migrations, so migrations never depend on shipped prompt text `[aiRegistryMigrations.ts]`, `[aiGuardrailsMigrations.ts]` headers.
- A failed `bumpConfigGeneration` is logged, not thrown; `readConfigGeneration` returns 0 when the table is missing `[configGeneration.ts]`.

## Side Effects
- Creates the SQLite file and directory, or the PostgreSQL database if absent, and opens the connection pool `[index.ts:initializeDatabase]`.
- Runs DDL and data transforms on the RBAC database and records each applied version in `_rbac_migrations` `[migrations.ts:runMigrationsBody]`.
- Acquires and releases a PostgreSQL advisory lock during migrations `[migrations.ts:runMigrations]`.
- Updates `rbac_config_generation` to signal other replicas `[configGeneration.ts:bumpConfigGeneration]`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh`
- Migrations (MANDATORY for any change to `migrations.ts` or a `*Migrations.ts` module; SQLite + PostgreSQL via Docker): `./scripts/test-migrations.sh`
