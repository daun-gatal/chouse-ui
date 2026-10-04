CHouse UI is the team operator's console for on-prem ClickHouse. Most tools nail one piece — a query workspace, a dashboard, an AI assistant, a cluster monitor. CHouse UI is the **combination**: a team access layer (app-level RBAC, audit logging, and encrypted server-side credentials so the browser never sees a password), multi-cluster fleet monitoring with Slack/email alerts, and **Chouse AI** — an autonomous, read-only SRE that runs root-cause scans, optimizes queries and diagnoses errors right in the monitoring tabs.

Open source under Apache 2.0, self-hosted, no exporter or agent required on your clusters.

## Capability matrix

| Capability | What you get |
| --- | --- |
| **Credential management** | AES-256-GCM encrypted server-side storage — the browser never sees a password |
| **Architecture** | Secure backend proxy — no direct browser-to-ClickHouse |
| **Access control** | Full RBAC: six roles, granular permission strings, per-user/role data access rules |
| **Multi-connection** | Manage many ClickHouse servers from one UI; fleet view monitors them all at once |
| **Audit trail** | Every action and query logged with actor, connection and timestamp |
| **Monitoring** | ClickHouse-native observability — query logs, memory breakdown, top-resource queries, replica lag, parts/merges, schema lints |
| **Fleet view** | Every cluster in one pane with per-card polling, status/memory/lag and drill-down |
| **Data observability** | Learned freshness and volume baselines for every table, every ingestion source in one status vocabulary, lineage, cross-layer root cause and approved fixes |
| **Agent governance** | Dataset health, lineage and context for MCP agents; budgets checked before queries run; a pause switch |
| **Chouse AI (SRE)** | Read-only diagnostics: fleet root-cause scans with auto-RCA to Slack/email, in-tab query optimization (before → after EXPLAIN), error/parts diagnosis |

The same capability set is operable without the browser: the [MCP server](/docs/mcp/) for AI agents and the [CLI](/docs/cli/) for scripts and CI.

## How the documentation is organized

Search every page with **⌘K** (or **/**), or use the sidebar. The sections follow what you need to do, in order:

1. **[Start here](/docs/start/)** — this introduction, the quick start, first login and the core concepts
2. **[Install & upgrade](/docs/install/)** — Docker, Helm, the production checklist, migrations and upgrades, compatibility
3. **[Configure](/docs/configure/)** — YAML and environment variable references, secrets, ClickHouse connections
4. **[Access & security](/docs/access/)** — users and roles, data access rules, the permission catalog, SSO, tokens, sessions, audit, the security model
5. **[Using CHouse UI](/docs/using/)** — one group per menu in the app: [Home](/docs/using/#home), [Explorer](/docs/using/#explorer), [Data](/docs/using/#data), [Monitoring](/docs/using/#monitoring), [Fleet](/docs/using/#fleet), [Doctor](/docs/using/#doctor) and [Agents](/docs/using/#agents)
6. **[Automation](/docs/automation/)** — the MCP server for AI agents and the CLI for scripts and CI
7. **[Reference & help](/docs/reference/)** — architecture, troubleshooting, FAQ

Pages about a screen open with where it is in the app and the permissions that show it, so you can go from what you see to what you need.

## Where to start

| If you are… | Read |
| --- | --- |
| Evaluating CHouse UI | [Quick start](/docs/quick-start/) — running locally in five minutes |
| Setting it up for your team | [First login](/docs/first-login/) → [Production checklist](/docs/production-checklist/) |
| Rolling out to users | [Users & roles](/docs/rbac-roles/) → [Data access rules](/docs/data-access-rules/) |
| Looking for a specific screen | [Using CHouse UI](/docs/using/) — grouped like the app's menu |
