CHouse UI is a self-hosted observability console for running ClickHouse as a team. It watches your **clusters**, the **queries** running on them and the **data** flowing through them, traces problems to their root cause, and fixes them — but only after a person approves. Everyone gets one place to query and explore, and AI agents and scripts use the same server, under the same rules.

Open source under Apache 2.0. It runs next to your clusters with nothing to install on them: CHouse UI only needs a ClickHouse user to connect with.

## Capability matrix

| Area | What you get |
| --- | --- |
| **Monitoring** | Ten [Monitoring](/docs/monitoring-overview/) tabs from live queries to [performance regressions](/docs/monitoring-performance/), [capacity forecasts](/docs/monitoring-capacity/) and [upgrade readiness](/docs/monitoring-upgrades/); every cluster at once on [Fleet](/docs/fleet/) with [alerts](/docs/alerting/) |
| **Data observability** | Learned freshness and volume for [every table](/docs/data-observability/), [pipelines](/docs/data-pipelines/) from Kafka to S3Queue in one status vocabulary, [lineage](/docs/data-lineage/) without instrumentation, [promises](/docs/data-health/) and [coverage](/docs/data-coverage/) |
| **Root cause & fixes** | [Incidents](/docs/data-incidents/) traced across layers with their blast radius, investigation notebooks, and fixes from a closed catalog that run only after approval |
| **Chouse AI** | [AI Assist](/docs/workspace-ai-assist/) in the editor, [in-tab diagnosis](/docs/ai-in-tab/), the [Doctor](/docs/doctor/) for fleet health checks, incident explanations and plain-language watchers — on [your choice of model](/docs/ai-models/) |
| **Query & explore** | [SQL editor](/docs/workspace-editor/) with schema-aware completion, [Visual EXPLAIN](/docs/workspace-explain/), [saved queries](/docs/workspace-saved-queries/), the [Explorer](/docs/explorer-databases/) for databases and tables, [uploads](/docs/explorer-upload/) and [exports](/docs/explorer-export/) |
| **Access control** | Own [users and roles](/docs/rbac-roles/) with 100+ [permissions](/docs/permissions/), [data access policies](/docs/data-access-rules/) per connection, [SSO](/docs/sso/), [audit log](/docs/audit-log/); credentials encrypted and never sent to the browser |
| **Automation** | An [MCP server](/docs/mcp/) for AI agents with [governance](/docs/agents/) — budgets, health notices, a pause switch — and the [`chouse` CLI](/docs/cli/) for scripts and CI |
| **Deployment** | One container and one port; [Docker](/docs/deploy-docker/) or a signed [Helm chart](/docs/deploy-helm/); SQLite for one replica, PostgreSQL for many |

New in this release: [What's new in 3.14](/docs/whats-new/).

## How the documentation is organized

Search every page with **⌘K** (or **/**), or use the sidebar. The sections follow what you need to do, in order:

1. **[Start here](/docs/start/)** — this introduction, the quick start, first login and the core concepts
2. **[Install & upgrade](/docs/install/)** — Docker, Helm and its values, the production checklist, migrations and upgrades, compatibility
3. **[Configure](/docs/configure/)** — YAML and environment variable references, secrets, ClickHouse connections
4. **[Access & security](/docs/access/)** — users and roles, data access rules, the permission catalog, SSO, tokens, sessions, audit, the security model
5. **[Using CHouse UI](/docs/using/)** — one group per menu in the app: [Home](/docs/using/#home), [Explorer](/docs/using/#explorer), [Data](/docs/using/#data), [Monitoring](/docs/using/#monitoring), [Fleet](/docs/using/#fleet), [Doctor](/docs/using/#doctor), [Agents](/docs/using/#agents), [Admin](/docs/using/#admin) and [Preferences](/docs/using/#preferences)
6. **[Guides](/docs/guides/)** — step-by-step walk-throughs: investigate a stale table, approve a fix, connect an agent, use the CLI in CI, plan an upgrade, set up team access
7. **[Automation](/docs/automation/)** — the MCP server and its tool catalog, and the CLI with its command reference
8. **[Reference & help](/docs/reference/)** — architecture, troubleshooting, FAQ and a glossary

Pages about a screen open with where it is in the app and the permissions that show it, so you can go from what you see to what you need.

## Where to start

| If you are… | Read |
| --- | --- |
| Evaluating CHouse UI | [Quick start](/docs/quick-start/) — running locally in five minutes |
| Setting it up for your team | [First login](/docs/first-login/) → [Production checklist](/docs/production-checklist/) |
| Rolling out to users | [Users & roles](/docs/rbac-roles/) → [Data access rules](/docs/data-access-rules/) |
| Looking for a specific screen | [Using CHouse UI](/docs/using/) — grouped like the app's menu |
