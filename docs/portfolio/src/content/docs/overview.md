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
| **Chouse AI (SRE)** | Read-only diagnostics: fleet root-cause scans with auto-RCA to Slack/email, in-tab query optimization (before → after EXPLAIN), error/parts diagnosis |

The same capability set is operable without the browser: the [MCP server](/docs/mcp/) for AI agents and the [CLI](/docs/cli/) for scripts and CI.

## How the documentation is organized

Use the left sidebar to navigate; this list is the map:

1. **Getting started** — install, first login and the concepts that explain everything else
2. **Configuration** — YAML and environment variable references, secrets, the production checklist
3. **Access & security** — roles, data access rules, the permission catalog, SSO, tokens, audit
4. **Database Explorer** — connections, schema and table management, uploads, exports
5. **Query workspace** — the SQL editor, Visual EXPLAIN, saved queries, command palette, AI Assist
6. **Monitoring** — query logs, live queries, parts, schema advisor, cluster activity, metrics, errors
7. **Fleet & Chouse AI** — the fleet view, threshold alerts, the Fleet Doctor and in-tab AI actions
8. **DataOps** — scheduled queries, data health promises and the operational AI brief
9. **Automation** — MCP server and CLI
10. **Deploy & reference** — Docker, Helm, upgrades, architecture, security model, troubleshooting, FAQ

## Where to start

| If you are… | Read |
| --- | --- |
| Evaluating CHouse UI | [Quick start](/docs/quick-start/) — running locally in five minutes |
| Setting it up for your team | [First login](/docs/first-login/) → [Production checklist](/docs/production-checklist/) |
| Rolling out to users | [Users & roles](/docs/rbac-roles/) → [Data access rules](/docs/data-access-rules/) |
| Looking for a specific feature | The sidebar group that matches it — every capability has a page |
