# Architecture

CHouse UI is a monorepo with two main packages:

- **Frontend** (`src/`) — React 19 + Vite SPA with Zustand stores, TanStack Query and shadcn/ui
- **Backend** (`packages/server/`) — Bun + Hono API server with RBAC, ClickHouse proxy and AI optimizer

## Request path

{{diagram:architecture}}

## The security pipeline (per request)

1. **Auth** — JWT verified (or [PAT](/docs/personal-access-tokens/) checked live)
2. **RBAC check** — required [permission](/docs/permissions/) for the endpoint
3. **SQL parse** — `node-sql-parser` extracts statements and referenced tables
4. **Data access rules** — deny/allow evaluation (see [Data access rules](/docs/data-access-rules/))
5. **Forward** — `@clickhouse/client` server-side, credentials never leaving the server

## Background workers

| Worker | Purpose | Toggle |
| --- | --- | --- |
| Fleet poller | Per-cluster metric snapshots to SQLite; advisory-lease HA | `FLEET_POLLER_ENABLED` |
| Scheduled queries runner | Cron jobs with per-job atomic leases | `SCHEDULED_QUERIES_ENABLED` |
| Data-health evaluator | Promise evaluations, incident tracking | rides the scheduler |
| Doctor scheduler | Scheduled fleet scans + auto-RCA | `DOCTOR_SCHEDULE_FILE` |

## Storage layout

| Store | Contents | Backend |
| --- | --- | --- |
| RBAC database | Users, roles, connections, audit, preferences, AI models, SSO config | SQLite (single instance) or PostgreSQL (HA) |
| `/app/data` | SQLite file, alert config, doctor schedule | volume |

## AI services

| Service | Role | Safety |
| --- | --- | --- |
| AI Optimizer | Rewrite + EXPLAIN for [in-tab Optimize](/docs/ai-in-tab/) | read-only, advisory |
| AI Chat | [Workspace assistant](/docs/workspace-ai-assist/) | schema context only |
| Fleet Doctor | Autonomous [fleet scans](/docs/ai-fleet-doctor/) | guarded single-SELECT `system.*`, `readonly=1` |

Providers plug in via the AI models admin; see the [provider list](/docs/workspace-ai-assist/).

## Key libraries

| Layer | Library |
| --- | --- |
| Server | Bun, Hono, Drizzle ORM, Pino, jose (JWT) |
| SQL safety | node-sql-parser |
| AI | DeepAgents / LangChain |
| Frontend | React 19, Vite 7, React Router 7, Zustand, TanStack Query/Table/Virtual, shadcn/ui + Radix, Tailwind 4, Monaco, AG Grid, Recharts + uPlot, cmdk, DOMPurify |
| ClickHouse | `@clickhouse/client` (server), `@clickhouse/client-web` |
