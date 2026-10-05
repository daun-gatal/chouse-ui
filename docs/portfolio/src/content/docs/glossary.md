# Glossary

Terms used across CHouse UI and these docs.

| Term | Meaning |
| --- | --- |
| **Agent** | An AI client (Claude Code, Cursor, …) that uses CHouse UI over [MCP](/docs/mcp/) or the API with a personal access token. Governed on the [AI Governance](/docs/agents/) page |
| **Approval class** | Whether a [fix](/docs/data-incidents/#fixes-with-approval) is low-impact (one approver, `remediation:approve`) or high-impact (two approvers, `remediation:approve_high`) |
| **Baseline** | What CHouse UI learned is normal for a table — write cadence and hourly volume — or for a query shape's latency |
| **Blast radius** | Everything downstream of an incident's root cause: tables, promises, jobs, saved queries and agents |
| **Canary** | A connection on a newer ClickHouse version used to replay your workload before [upgrading](/docs/monitoring-upgrades/) |
| **Collector** | The server component that reads ClickHouse metadata on a schedule and stores the evidence. See [How data is watched](/docs/data-observability/) |
| **Connection** | A ClickHouse server CHouse UI talks to, with encrypted credentials. See [Connections](/docs/connections/) |
| **Coverage** | How many tables are protected by promises, by criticality. See [Coverage](/docs/data-coverage/) |
| **Criticality** | *critical*, *important* or *normal*, learned from how much a table is read; can be pinned by hand |
| **Data access policy** | A named set of database/table rules, per connection, attached to roles. See [Data access rules](/docs/data-access-rules/) |
| **Deployment** (AI) | A named model configuration people use, pointing at a provider model. See [AI models](/docs/ai-models/) |
| **Evidence** | What the collector stored from system tables, which every status, root cause and suggestion is computed from |
| **Fix** / **remediation action** | One action from the closed remediation catalog, run only after approval |
| **Health notice** | A note attached to an agent's query result when a table it read has an open incident or is degraded |
| **Incident** | Something wrong with the data, a pipeline or the engine — *open*, *acknowledged* or *recovered*. See [Incidents](/docs/data-incidents/) |
| **Lease** | A short-lived claim in the RBAC database that makes one pod do a piece of background work at a time |
| **Lineage** | How data flows between tables, from metadata and `query_log`. See [Lineage](/docs/data-lineage/) |
| **Maintenance window** | The UTC window in which TTL and codec fixes may run (`REMEDIATION_MAINTENANCE_WINDOW`) |
| **MCP** | Model Context Protocol — how AI agents call CHouse UI's tools at `/mcp` |
| **Notebook** | A shared investigation record of AI findings, query snapshots, notes and fixes, exportable as a postmortem |
| **Permission** | A string such as `logs:view` that opens a feature. See the [permission catalog](/docs/permissions/) |
| **Personal access token (PAT)** | A `ch_pat_…` token that lets the CLI, agents and scripts act as you. See [Personal access tokens](/docs/personal-access-tokens/) |
| **Pipeline** | Any way data enters ClickHouse — a view, queue engine, replication, writer or job. See [Pipelines](/docs/data-pipelines/) |
| **Preflight** | The check before DDL runs that stops changes which would break dependents |
| **Promise** | An explicit check on a dataset, evaluated on a schedule. See [Datasets & promises](/docs/data-health/) |
| **Query shape** | Queries that are the same except for literals (`normalized_query_hash`), tracked together for performance |
| **RBAC database** | CHouse UI's own SQLite or PostgreSQL database for users, settings and evidence |
| **Remediation credential** | A separate ClickHouse login per connection, the only one fixes run with |
| **Role** | A bundle of permissions and data access policies. Six are built in. See [Users & roles](/docs/rbac-roles/) |
| **Root cause chain** | The computed path from an incident's symptom down through data, transform, ingestion, external and engine layers |
| **Scheduled query** | A SQL job on a schedule or after another job. See [Scheduled queries](/docs/scheduled-queries/) |
| **Trust state** | A table's state from its baseline: *learning*, *trusted*, *degraded* or *stale* |
| **Watcher** | A plain-language sentence that Chouse AI turns into a promise for you to review. See [Context](/docs/data-context/#watchers) |
