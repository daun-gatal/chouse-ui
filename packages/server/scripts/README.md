# Server Dev Scripts

## Overview
Standalone Bun scripts run against the server's RBAC database outside the HTTP
server. Currently one development seed that fills the Scheduled Queries feature
with demo jobs, run history, and notification channels.

## Interface
- `seed-scheduled-queries.ts` - CLI entry `[seed-scheduled-queries.ts:main]`. Run from the repo root with `bun run seed:scheduled-queries` (root `package.json`) or `bun run packages/server/scripts/seed-scheduled-queries.ts`.
  - Reads `RBAC_ADMIN_EMAIL` (default `admin@localhost`) to attribute `created_by` `[seed-scheduled-queries.ts:main]`.
  - Seeds the `JOBS` matrix via `store.createJob` / `store.setJobChannels` and synthetic history via `[seed-scheduled-queries.ts:seedRuns]`.

## Invariants
- Development only: it wipes the scheduled-query tables on every run, so never point it at a production RBAC database `[seed-scheduled-queries.ts:main]`.
- Re-runnable: existing connections and users are reused, never deleted; only channels whose names start with the `Demo ` prefix (`DEMO_CHANNEL_PREFIX`) are removed and recreated `[seed-scheduled-queries.ts:main]`.
- Must call `initializeRbac()` first so migrations have run before any table is touched `[seed-scheduled-queries.ts:main]`.

## Side Effects
- Runs RBAC init and migrations on the configured RBAC database (SQLite or PostgreSQL) `[seed-scheduled-queries.ts:main]`.
- `DELETE FROM` `scheduled_query_outbox`, `scheduled_query_runs`, `scheduled_query_channels`, `scheduled_queries`, and demo rows in `notification_channels` `[seed-scheduled-queries.ts:main]`.
- Creates connections `Demo ClickHouse` (only if none exist) and `Demo Secondary CH` (if missing) via `createConnection`; creates three demo channels (Slack, Email, Webhook) via `createChannel` `[seed-scheduled-queries.ts:main]`.
- Inserts `scheduled_query_runs` rows, updates `scheduled_queries.last_run_at`, and inserts a pending `scheduled_query_outbox` alert for the `errors_last_hour` job `[seed-scheduled-queries.ts:seedRuns]`, `[seed-scheduled-queries.ts:main]`.
- Exits the process (`process.exit(0)` on success, `1` on failure).

## Verification
- No dedicated tests. Server suite (from repo root): `./scripts/test-isolated-server.sh`
- Manual: `bun run seed:scheduled-queries`, then open Scheduled Queries in the UI.
