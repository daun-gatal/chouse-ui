# packages/server/src — API Server Source

## Overview

Source of the Bun + Hono v4 API server. `index.ts` is the process entry point.
It loads YAML config into the environment, validates required secrets, builds
the Hono app (security headers, CORS, request logging, body limit, rate limits),
mounts `/api`, the `/mcp` endpoint, the OAuth routes and the SAML ACS, and
serves the built SPA. It then initializes RBAC, starts the background workers
and handles graceful shutdown.

## Interface

- `app` — the root `Hono` instance [index.ts:app]
- `server` — the `Bun.serve` handle on `PORT` (default `5521`), with
  `idleTimeout: 120` for long SSE streams [index.ts:server]
- Mounts:
  - `/api` → `./routes` [index.ts:app.route("/api", api)]
  - `MCP_PATH` → `createMcpApp(buildMcpDeps(app))` [index.ts]
  - `/` → `createOAuthRoutes()` for `/.well-known/*` and `/oauth/*` [index.ts]
  - `POST SAML_ACS_PATH` → `samlAcsHandler` [index.ts]
  - `serveStatic({ root: STATIC_PATH })`, then an SPA `index.html` fallback before `notFoundHandler` [index.ts]
- `registerInProcessApi(app)` — lets assistant tools call `/api` in-process as the chatting user [index.ts]

### Subdirectories

- [mcp](./mcp/README.md) — stateless Streamable HTTP MCP endpoint, tool catalog and OAuth 2.1 authorization server
- [middleware](./middleware/README.md) — request IDs, CORS, error mapping, connection resolution, SQL data-access checks, schema preflight, rate-limit store/keys
- [rbac](./rbac/README.md) — RBAC DB, schema, migrations, services, auth middleware, `/api/rbac` routes and SSO
- [routes](./routes/README.md) — the `/api` Hono app and every feature route module
- [services](./services/README.md) — business logic: ClickHouse client pool, AI engine and registry, observability, dashboards, alerting, scheduled queries, remediation, upgrades
- [types](./types/README.md) — Zod request schemas, API envelope, `AppError`
- [utils](./utils/README.md) — Pino logger, YAML config loader, SQL identifier/literal escaping, User-Agent parsing

## Invariants

- `./utils/configLoader` must be the first import, so YAML config is in
  `process.env` before any module reads it [index.ts]
- In production, `JWT_SECRET` (≥32 chars), `RBAC_ENCRYPTION_KEY` (≥32 chars)
  and `RBAC_ENCRYPTION_SALT` (exactly 64 chars) are required
  [index.ts:validateEnvironmentVariables]
- CORS credentials are enabled, with strict mode only in production when
  `CORS_ORIGIN` is not `*`. `CORS_ORIGIN=*` in production only produces a
  warning [index.ts:validateEnvironmentVariables, corsMiddleware call]
- Non-`/api` responses get `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` and a CSP (`connect-src 'self'`, `frame-ancestors
  'self'`). `unsafe-eval` is allowed only outside production [index.ts]
- Request bodies are capped at 10 MiB, returning 413 [index.ts:bodyLimit]
- Rate limits are registered on the root app before `/api` is mounted.
  Login, SSO start/callback and `/oauth/register` count in the RBAC database
  (`DbRateLimitStore`, shared across replicas) keyed by `rateLimitClientKey`,
  with an extra per-account key (`loginAccountKey`) on `/api/rbac/auth/login`.
  `/api/integrations/*`, `/oauth/*`, `/.well-known/*`, `/api/query/*`,
  `/api/ai/*` and `/api/*` use the in-memory store, so each pod counts
  separately [index.ts]
- `/api/query/*` (300/min) and `/api/ai/*` (60/min) key on
  `c.get('rbacUserId') || 'unknown'`, but `rbacUserId` is only set later by the
  route-level auth middleware, so all callers share one `'unknown'` bucket per
  pod; the general `/api/*` limiter (1000/min) falls back to
  `rateLimitClientKey`, i.e. per address, not per user — see the 2026-11-06
  drift report follow-ups [index.ts]
- Background schedulers (scheduled queries, dashboard alerts and reports,
  Need You sweeper) start only when `SCHEDULED_QUERIES_ENABLED !== "false"`.
  SQLite with `CHOUSE_HA=true` logs an error, because leases cannot span pods [index.ts]
- If RBAC initialization fails, the error is logged and the server keeps
  running; it is not fatal [index.ts]

## Side Effects

- On startup, after `initializeRbac()`: `syncRegistrySeeds`,
  `startApprovalSweeper`, `startTriageRunner`, `startObservability`,
  `DoctorScheduler.start`, the optional schedulers, `refreshSsoConfig` and
  `startConfigGenerationWatcher` [index.ts]
- Intervals: `cleanupExpiredRateLimits` every 60 s and `pruneAiUsage` hourly [index.ts]
- On `SIGINT`/`SIGTERM`, `gracefulShutdown` runs in order: stop the server,
  clear the intervals, flush AI usage writes (5 s cap), stop observability, the
  scheduled-query scheduler, the dashboard alert evaluator and report
  scheduler, the Need You sweeper and the config watcher, run
  `shutdownRbac()`, then `process.exit(0)` [index.ts:gracefulShutdown].
  `startApprovalSweeper`, `startTriageRunner` and `DoctorScheduler` are not
  stopped there — known issue, see [ARCHITECTURE.md › Known issues](../../../ARCHITECTURE.md#known-issues)
- Logs a warning for ignored legacy MCP env keys (`legacyMcpEnvKeys`) [index.ts]

## Verification

- Run: `./scripts/test-isolated-server.sh` (from the repository root; Bun Test)
- Migrations: `./scripts/test-migrations.sh` (SQLite + PostgreSQL via Docker)
- Typecheck: `bun run typecheck` (in `packages/server`)
