# packages/server

## Overview

The CHouse UI backend package: a Bun + Hono v4 API server (`src/`) plus
dev-only maintenance scripts (`scripts/`). It serves the `/api` REST surface,
the `/mcp` endpoint and the OAuth routes, and in production also serves the
built SPA. Its own state lives in an RBAC database (SQLite or PostgreSQL via
Drizzle); ClickHouse is reached via `@clickhouse/client`.

Package scripts (`package.json`): `dev`, `start`, `build`
(`bun build src/index.ts --target bun`), `rbac:status|migrate|seed|reset|version`
(`src/rbac/cli.ts`), `test:isolated`, `typecheck`.

## Subdirectories & Boundaries

- src: [./src/README.md](./src/README.md) — server source: entry point `index.ts`, plus `mcp`, `middleware`, `rbac`, `routes`, `services`, `types`, `utils`
- scripts: [./scripts/README.md](./scripts/README.md) — dev-only `seed-scheduled-queries.ts`, which wipes and re-seeds demo scheduled-query data in the RBAC DB
