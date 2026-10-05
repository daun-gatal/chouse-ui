# Architecture

CHouse UI is one server process that serves the web app, the API and the MCP endpoint on a single port, plus a database of its own. The browser, the CLI and AI agents all go through the same server, which talks to your ClickHouse clusters.

## Request path

{{diagram:architecture}}

Every request passes the same checks, whichever client sent it:

1. **Authenticate** — a session JWT from the web app, or a [personal access token](/docs/personal-access-tokens/) checked live for the CLI, MCP and scripts.
2. **Authorize** — the endpoint's required [permission](/docs/permissions/).
3. **Parse SQL** — `node-sql-parser` splits statements and extracts every database and table referenced.
4. **Check data access** — the user's [data access policies](/docs/data-access-rules/) for that connection.
5. **Preflight DDL** — [schema preflight](/docs/data-incidents/#schema-change-preflight) stops changes that would break dependents.
6. **Forward** — `@clickhouse/client` on the server, with the connection's credentials, which never reach the browser.

The MCP endpoint (`/mcp`) translates tool calls into these same API requests, so an agent can never do more than its token's owner. [AI Governance](/docs/agents/) adds budgets checked with `EXPLAIN ESTIMATE` before agent queries run.

## Background work

Background services run inside every server pod. Each piece of work claims a lease in the RBAC database first, so with several replicas each job runs on exactly one pod and moves to another if that pod dies.

| Service | Does | Lease | Switch |
| --- | --- | --- | --- |
| Observability collector | Samples metadata per connection: catalog, lineage, pipelines, tables, usage, queries, changes, capacity, profiles, fleet | Per connection and collector | Always on |
| Fleet alerter | Evaluates [alert rules](/docs/alerting/) on each fleet sample | Runs with the fleet collector | Always on |
| Scheduled-query runner | Runs [scheduled queries](/docs/scheduled-queries/) and promise evaluations | Per job | `SCHEDULED_QUERIES_ENABLED` |
| Remediation worker | Runs approved [fixes](/docs/data-incidents/#fixes-with-approval), verifies them, resumes delayed jobs | Remediation lease | Always on |
| Doctor scheduler | Runs [scheduled Doctor scans](/docs/doctor/#scheduled-scans) | Claims the schedule row | Configured in the UI |

Settings that tune them are on [Environment variables](/docs/configuration-env/).

## Storage

| Store | Holds | Backend |
| --- | --- | --- |
| RBAC database | Users, roles, policies, connections (credentials encrypted), audit log, preferences, tokens, AI models, SSO, alerting, saved and scheduled queries, promises, MCP and agent settings, observability evidence, incidents, notebooks, fixes | SQLite (one replica) or PostgreSQL (any number of replicas) |
| `/app/data` volume | The SQLite file, when you use SQLite | Docker volume or PVC |

Your ClickHouse data stays in ClickHouse. CHouse UI stores metadata about it (baselines, lineage, samples of system tables), and query result snapshots only where a person saves one in a notebook.

Migrations run automatically on start — see [Migrations & upgrades](/docs/migrations-upgrades/).

## AI

| Feature | Uses | Can change anything? |
| --- | --- | --- |
| [AI Assist](/docs/workspace-ai-assist/) and chat | Schema context and your query | No — suggests SQL you run yourself |
| [In-tab AI](/docs/ai-in-tab/) | One log, error or part row | No — suggests a rewrite or fix to review |
| [Doctor](/docs/doctor/) | Single `SELECT` on `system.*`, `readonly=1` | No — reports and *proposes* fixes |
| Incident explanations, [watchers](/docs/data-context/#watchers), [operational brief](/docs/dataops-ai/) | Stored evidence, context, run history | No — drafts that a person reviews |

Models and providers are configured in [AI models](/docs/ai-models/). The AI layer is built on DeepAgents / LangChain.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Web app — React 19, Vite 7, React Router 7, Zustand, TanStack Query, shadcn/ui, Tailwind 4, Monaco, AG Grid |
| `packages/server/` | Server — Bun, Hono, Drizzle ORM (SQLite/PostgreSQL), Pino, jose (JWT), node-sql-parser, the MCP server |
| `cli/` | The `chouse` CLI (Go, Cobra) |
| `charts/chouse-ui/` | The Helm chart |
| `docs/adr/` | Architecture decision records |
| `docs/portfolio/` | This website and documentation |
