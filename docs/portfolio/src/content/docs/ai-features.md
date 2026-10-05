---
generated: packages/server/src/services/ai (feature contracts and seeds)
---
Every AI feature in CHouse UI, where it appears, what it needs, the template variables it hands its agent, and the agent it runs on after a fresh install. Rebind a feature or edit its agent in **Agents › Assistant** — see [AI agents](/docs/ai-agents/).

**Needs** is the permission a user must hold to use the feature; the route checks it before any agent runs. **Tools may use** is the run context the feature gives its agent's tools — an agent bound to a feature can only use tools whose context the feature provides:

| Context | What the tools can do |
| --- | --- |
| ClickHouse session | Runs on the signed-in user's ClickHouse connection, with their data access rules. |
| Fleet nodes | Read-only system.* queries on the nodes the feature resolved. |
| Your CHouse access | Calls CHouse's own API as the chatting user — they see only what their permissions allow. |

Features marked *Evidence only* gather their evidence in code and hand it over as `ctx.evidence`; their agents work from that and call no tools.

## All features

| Feature | Where | Needs | Tools may use | Built-in agent |
| --- | --- | --- | --- | --- |
| [Chat](#chat) | Chat | `ai:chat` | ClickHouse session, Your CHouse access | [ClickHouse Data](#clickhouse-data) |
| [Optimize query](#optimize-query) | SQL editor | `ai:optimize` | ClickHouse session | [SQL Optimizer](#sql-optimizer) |
| [Debug query](#debug-query) | SQL editor | `ai:optimize` | ClickHouse session | [SQL Debugger](#sql-debugger) |
| [Optimization pre-screen](#optimization-pre-screen) | SQL editor | `ai:optimize` | ClickHouse session | [Query Evaluator](#query-evaluator) |
| [Fleet Doctor scan](#fleet-doctor-scan) | Doctor | `doctor:run` | Fleet nodes | [Fleet Doctor](#fleet-doctor) |
| [Optimize a heavy query](#optimize-a-heavy-query) | Diagnostics | `ai:optimize` | Fleet nodes | [Heavy Query Optimizer](#heavy-query-optimizer) |
| [Diagnose a server error](#diagnose-a-server-error) | Diagnostics | `ai:optimize` | Fleet nodes | [Error Diagnostician](#error-diagnostician) |
| [Diagnose part health](#diagnose-part-health) | Diagnostics | `ai:optimize` | Fleet nodes | [Parts Diagnostician](#parts-diagnostician) |
| [Diagnose a schema finding](#diagnose-a-schema-finding) | Diagnostics | `ai:optimize` | Fleet nodes | [Schema Diagnostician](#schema-diagnostician) |
| [Draft a scheduled query](#draft-a-scheduled-query) | DataOps | `ai:optimize` | ClickHouse session | [Scheduled Query Drafter](#scheduled-query-drafter) |
| [Scheduled query preflight](#scheduled-query-preflight) | DataOps | `ai:optimize` | ClickHouse session | [Scheduled Query Reviewer](#scheduled-query-reviewer) |
| [Scheduled query brief](#scheduled-query-brief) | DataOps | `ai:optimize` | Evidence only | [Scheduled Query Briefer](#scheduled-query-briefer) |
| [Diagnose a scheduled run](#diagnose-a-scheduled-run) | DataOps | `ai:optimize` | Evidence only | [Scheduled Run Investigator](#scheduled-run-investigator) |
| [Assess a recovery plan](#assess-a-recovery-plan) | DataOps | `ai:optimize` | Evidence only | [Recovery Planner](#recovery-planner) |
| [Recommend health checks](#recommend-health-checks) | DataOps | `ai:optimize` | ClickHouse session | [Health Promise Advisor](#health-promise-advisor) |
| [Data health brief](#data-health-brief) | DataOps | `ai:optimize` | Evidence only | [Data Health Briefer](#data-health-briefer) |
| [Diagnose a data health incident](#diagnose-a-data-health-incident) | DataOps | `ai:optimize` | Evidence only | [Health Incident Investigator](#health-incident-investigator) |
| [Tune health checks](#tune-health-checks) | DataOps | `ai:optimize` | Evidence only | [Health Promise Tuner](#health-promise-tuner) |
| [Correlate incidents](#correlate-incidents) | DataOps | `ai:optimize` | Evidence only | [Incident Correlator](#incident-correlator) |
| [Explain an incident](#explain-an-incident) | Observability | `ai:optimize` | Evidence only | [Incident Explainer](#incident-explainer) |
| [Compile a watcher](#compile-a-watcher) | Observability | `ai:optimize` | Evidence only | [Watcher Compiler](#watcher-compiler) |
| [Draft table context](#draft-table-context) | Observability | `ai:optimize` | Evidence only | [Table Context Drafter](#table-context-drafter) |

## Chat features

### Chat

ID `chat` · needs `ai:chat` · free-form chat answer

The chat bubble. The bound agent answers when a thread has no agent picked; users can pick any top-level chat agent they may use.

**Tools may use:** ClickHouse session, Your CHouse access. **Built-in agent:** [ClickHouse Data](#clickhouse-data).

No template variables — chat agents render without any.

## SQL editor features

### Optimize query

ID `optimize-query` · needs `ai:optimize` · structured answer (JSON contract)

SQL editor › Optimize: rewrites a SELECT for speed and memory, proven with a before→after EXPLAIN estimate.

**Tools may use:** ClickHouse session. **Built-in agent:** [SQL Optimizer](#sql-optimizer).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.query` | string | The SELECT to optimize (trimmed). |
| `ctx.additionalPrompt` | string | Extra instructions from the user (trimmed; empty when none). |

### Debug query

ID `debug-query` · needs `ai:optimize` · structured answer (JSON contract)

SQL editor › Debug: explains why a query failed and returns a validated fix.

**Tools may use:** ClickHouse session. **Built-in agent:** [SQL Debugger](#sql-debugger).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.query` | string | The failed query (trimmed). |
| `ctx.error` | string | The ClickHouse error message (trimmed). |
| `ctx.additionalPrompt` | string | Extra instructions from the user (trimmed; empty when none). |

### Optimization pre-screen

ID `check-optimize` · needs `ai:optimize` · structured answer (JSON contract)

SQL editor: silently decides whether a query is worth optimizing before offering Optimize.

**Tools may use:** ClickHouse session. **Built-in agent:** [Query Evaluator](#query-evaluator).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.query` | string | The query to evaluate (trimmed). |

## Doctor features

### Fleet Doctor scan

ID `fleet-scan` · needs `doctor:run` · structured answer (JSON contract) · also runs in the background

Doctor › Scan (manual, scheduled or alert-triggered): reviews every node and deep-dives heavy queries into a health report.

**Tools may use:** Fleet nodes. **Built-in agent:** [Fleet Doctor](#fleet-doctor).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.hours` | number | Investigation window in hours. |
| `ctx.nodeCount` | number | Number of nodes scanned. |
| `ctx.overview` | json | Per-node overview (pretty-printed JSON). |
| `ctx.needsPlaybook` | boolean | True when the scan found a heavy or top-memory query worth optimizing. |

## Diagnostics features

### Optimize a heavy query

ID `optimize-log` · needs `ai:optimize` · structured answer (JSON contract)

Query Logs › Optimize: rewrites one heavy query from the log, proven with a before→after EXPLAIN estimate.

**Tools may use:** Fleet nodes. **Built-in agent:** [Heavy Query Optimizer](#heavy-query-optimizer).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.node.id` | string | Connection id of the node the query ran on. |
| `ctx.node.name` | string | Connection name of that node. |
| `ctx.peakMemory` | string | Observed peak memory, or "unknown". |
| `ctx.query` | string | The cleaned query text (first 8000 characters). |

### Diagnose a server error

ID `diagnose-error` · needs `ai:optimize` · structured answer (JSON contract)

Errors › Diagnose: explains one server error from system.errors and gives a concrete fix.

**Tools may use:** Fleet nodes. **Built-in agent:** [Error Diagnostician](#error-diagnostician).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.node.id` | string | Connection id of the node under investigation. |
| `ctx.node.name` | string | Connection name of that node. |
| `ctx.error.code` | string | Error code, or "?". |
| `ctx.error.name` | string | Error name, e.g. TOO_MANY_PARTS. |
| `ctx.error.message` | string | Last error message, or "(none)". |

### Diagnose part health

ID `diagnose-parts` · needs `ai:optimize` · structured answer (JSON contract)

Parts › Diagnose: explains part and partition health of one MergeTree table.

**Tools may use:** Fleet nodes. **Built-in agent:** [Parts Diagnostician](#parts-diagnostician).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.node.id` | string | Connection id of the node under investigation. |
| `ctx.node.name` | string | Connection name of that node. |
| `ctx.database` | string | Database of the table. |
| `ctx.table` | string | Table name. |

### Diagnose a schema finding

ID `diagnose-schema` · needs `ai:optimize` · structured answer (JSON contract)

Schema Advisor › Diagnose: turns one column-level finding into a concrete ALTER TABLE fix.

**Tools may use:** Fleet nodes. **Built-in agent:** [Schema Diagnostician](#schema-diagnostician).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.node.id` | string | Connection id of the node under investigation. |
| `ctx.node.name` | string | Connection name of that node. |
| `ctx.database` | string | Database of the table. |
| `ctx.table` | string | Table name. |
| `ctx.column` | string | Column name. |
| `ctx.columnType` | string | Current column type. |
| `ctx.category` | string | Finding category: nullable, oversized or compression. |
| `ctx.sizeLine` | string | One line with rows / on-disk / uncompressed bytes, or empty. |

## DataOps features

### Draft a scheduled query

ID `draft-scheduled-query` · needs `ai:optimize` · structured answer (JSON contract)

Scheduled Queries › New with AI: turns intent into an editable draft.

**Tools may use:** ClickHouse session. **Built-in agent:** [Scheduled Query Drafter](#scheduled-query-drafter).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Scheduled query preflight

ID `assess-scheduled-query` · needs `ai:optimize` · structured answer (JSON contract)

Scheduled Queries › Editor › AI preflight: risks and improvements before saving.

**Tools may use:** ClickHouse session. **Built-in agent:** [Scheduled Query Reviewer](#scheduled-query-reviewer).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Scheduled query brief

ID `summarize-scheduled-query` · needs `ai:optimize` · structured answer (JSON contract)

Scheduled Queries › AI brief: purpose, health, meaningful change and whether action is needed.

**Tools may use:** Evidence only. **Built-in agent:** [Scheduled Query Briefer](#scheduled-query-briefer).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Diagnose a scheduled run

ID `diagnose-scheduled-run` · needs `ai:optimize` · structured answer (JSON contract)

Scheduled Queries › Run › Diagnose: ranks causes of one failed or slow run.

**Tools may use:** Evidence only. **Built-in agent:** [Scheduled Run Investigator](#scheduled-run-investigator).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Assess a recovery plan

ID `plan-scheduled-recovery` · needs `ai:optimize` · structured answer (JSON contract)

Scheduled Queries › Recover: assesses a bounded backfill before it runs.

**Tools may use:** Evidence only. **Built-in agent:** [Recovery Planner](#recovery-planner).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Recommend health checks

ID `recommend-health-promise` · needs `ai:optimize` · structured answer (JSON contract)

Data Health › New with AI: recommends checks for one table from bounded aggregates.

**Tools may use:** ClickHouse session. **Built-in agent:** [Health Promise Advisor](#health-promise-advisor).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Data health brief

ID `summarize-data-health` · needs `ai:optimize` · structured answer (JSON contract)

Data Health › AI brief for one protected dataset.

**Tools may use:** Evidence only. **Built-in agent:** [Data Health Briefer](#data-health-briefer).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Diagnose a data health incident

ID `diagnose-health-incident` · needs `ai:optimize` · structured answer (JSON contract)

Data Health › Incident › Diagnose: monitor failure or bad data, likely impact, safe next actions.

**Tools may use:** Evidence only. **Built-in agent:** [Health Incident Investigator](#health-incident-investigator).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Tune health checks

ID `tune-health-promise` · needs `ai:optimize` · structured answer (JSON contract)

Data Health › Tune: recommends threshold and cadence changes from history.

**Tools may use:** Evidence only. **Built-in agent:** [Health Promise Tuner](#health-promise-tuner).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Correlate incidents

ID `correlate-health-incidents` · needs `ai:optimize` · structured answer (JSON contract)

Data Health › Correlate: groups incidents that share a credible cause.

**Tools may use:** Evidence only. **Built-in agent:** [Incident Correlator](#incident-correlator).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

## Observability features

### Explain an incident

ID `explain-incident` · needs `ai:optimize` · structured answer (JSON contract)

Observe › Incident › Explain: narrates the stored root-cause chain and drafts catalog fixes.

**Tools may use:** Evidence only. **Built-in agent:** [Incident Explainer](#incident-explainer).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Compile a watcher

ID `compile-watcher` · needs `ai:optimize` · structured answer (JSON contract)

Observe › Watch with AI: compiles a sentence into one Data Health check.

**Tools may use:** Evidence only. **Built-in agent:** [Watcher Compiler](#watcher-compiler).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

### Draft table context

ID `draft-table-context` · needs `ai:optimize` · structured answer (JSON contract)

Context › Draft with AI: drafts a table's curated context from metadata and an aggregate-only profile.

**Tools may use:** Evidence only. **Built-in agent:** [Table Context Drafter](#table-context-drafter).

| Variable | Type | Value |
| --- | --- | --- |
| `ctx.evidence` | json | The evidence object the feature assembled (JSON). |

## Built-in agents

The 27 agents CHouse installs. Steps are the agent's step budget; its recursion limit defaults to four times that, and at least 24. Without a timeout of its own, a run stops after 4 minutes for a feature and 2 minutes in the chat. See [Editing agents](/docs/ai-agent-editor/#settings).

### SQL Optimizer

Rewrites a SELECT for speed and memory from its DDL and EXPLAIN plan (SQL editor › Optimize).

| Setting | Value |
| --- | --- |
| Slug | `sql-optimizer` |
| Kind | Feature agent |
| Used by | [Optimize query](#optimize-query) |
| Harness | Focused |
| Tuning | 10 steps |
| Tools | `list_databases`, `list_tables`, `get_table_schema`, `get_table_ddl`, `get_table_size`, `get_table_sample`, `run_select_query`, `explain_query`, `get_database_info`, `get_running_queries`, `get_server_info`, `search_columns`, `analyze_query`, `validate_sql`, `export_query_result`, `get_slow_queries` |
| Skills | all built-in skills on demand |

### SQL Debugger

Explains why a query failed and returns a validated fix (SQL editor › Debug).

| Setting | Value |
| --- | --- |
| Slug | `sql-debugger` |
| Kind | Feature agent |
| Used by | [Debug query](#debug-query) |
| Harness | Focused |
| Tuning | 10 steps |
| Tools | `list_databases`, `list_tables`, `get_table_schema`, `get_table_ddl`, `get_table_size`, `get_table_sample`, `run_select_query`, `explain_query`, `get_database_info`, `get_running_queries`, `get_server_info`, `search_columns`, `analyze_query`, `validate_sql`, `export_query_result`, `get_slow_queries` |
| Skills | all built-in skills on demand |

### Query Evaluator

Quick, silent pre-screen: is this query worth optimizing? (SQL editor).

| Setting | Value |
| --- | --- |
| Slug | `query-evaluator` |
| Kind | Feature agent |
| Used by | [Optimization pre-screen](#optimization-pre-screen) |
| Harness | Focused |
| Tuning | 4 steps |
| Tools | `analyze_query`, `get_table_ddl`, `get_table_schema` |
| Skills | all built-in skills on demand |

### Heavy Query Optimizer

Optimizes one heavy query picked from the Query Logs, proven with a before→after EXPLAIN estimate.

| Setting | Value |
| --- | --- |
| Slug | `log-query-optimizer` |
| Kind | Feature agent |
| Used by | [Optimize a heavy query](#optimize-a-heavy-query) |
| Harness | Focused |
| Tuning | 8 steps · 16,000 output tokens |
| Tools | `query_node` |
| Skills | all built-in skills on demand; pinned `clickhouse-playbook` (reference.md) |

### Error Diagnostician

Explains one server error from system.errors and gives a concrete fix.

| Setting | Value |
| --- | --- |
| Slug | `error-diagnostician` |
| Kind | Feature agent |
| Used by | [Diagnose a server error](#diagnose-a-server-error) |
| Harness | Focused |
| Tuning | 8 steps · 8,000 output tokens |
| Tools | `query_node` |
| Skills | all built-in skills on demand; pinned `clickhouse-playbook` (reference.md) |

### Parts Diagnostician

Diagnoses part and partition health of one MergeTree table.

| Setting | Value |
| --- | --- |
| Slug | `parts-diagnostician` |
| Kind | Feature agent |
| Used by | [Diagnose part health](#diagnose-part-health) |
| Harness | Focused |
| Tuning | 8 steps · 8,000 output tokens |
| Tools | `query_node` |
| Skills | all built-in skills on demand; pinned `clickhouse-playbook` (reference.md) |

### Schema Diagnostician

Turns one Schema Advisor finding into a concrete ALTER TABLE fix.

| Setting | Value |
| --- | --- |
| Slug | `schema-diagnostician` |
| Kind | Feature agent |
| Used by | [Diagnose a schema finding](#diagnose-a-schema-finding) |
| Harness | Focused |
| Tuning | 8 steps · 8,000 output tokens |
| Tools | `query_node` |
| Skills | all built-in skills on demand; pinned `clickhouse-playbook` (reference.md) |

### Fleet Doctor

Reviews every node's health, deep-dives heavy queries and writes the Doctor report.

| Setting | Value |
| --- | --- |
| Slug | `fleet-doctor` |
| Kind | Feature agent |
| Used by | [Fleet Doctor scan](#fleet-doctor-scan) |
| Harness | Focused |
| Tuning | 12 steps · 16,000 output tokens |
| Tools | `query_node` |
| Skills | all built-in skills on demand |

### Scheduled Query Drafter

Turns an operator's intent into an editable scheduled query draft.

| Setting | Value |
| --- | --- |
| Slug | `scheduled-query-drafter` |
| Kind | Feature agent |
| Used by | [Draft a scheduled query](#draft-a-scheduled-query) |
| Harness | Focused |
| Tuning | 7 steps · 4,500 output tokens |
| Tools | `list_databases`, `list_tables`, `get_table_schema`, `get_table_ddl`, `analyze_query` |
| Skills | all built-in skills on demand |

### Scheduled Query Reviewer

Preflight risk review of a scheduled query before it is saved.

| Setting | Value |
| --- | --- |
| Slug | `scheduled-query-reviewer` |
| Kind | Feature agent |
| Used by | [Scheduled query preflight](#scheduled-query-preflight) |
| Harness | Focused |
| Tuning | 6 steps · 3,000 output tokens |
| Tools | `analyze_query`, `validate_sql`, `get_table_schema`, `get_table_ddl`, `explain_query` |
| Skills | all built-in skills on demand |

### Scheduled Query Briefer

Operational brief for one scheduled query.

| Setting | Value |
| --- | --- |
| Slug | `scheduled-query-briefer` |
| Kind | Feature agent |
| Used by | [Scheduled query brief](#scheduled-query-brief) |
| Harness | Focused |
| Tuning | 3 steps · 2,500 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Scheduled Run Investigator

Ranks the likely causes of one failed or slow scheduled run.

| Setting | Value |
| --- | --- |
| Slug | `scheduled-run-investigator` |
| Kind | Feature agent |
| Used by | [Diagnose a scheduled run](#diagnose-a-scheduled-run) |
| Harness | Focused |
| Tuning | 5 steps · 4,000 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Recovery Planner

Assesses a bounded backfill / recovery plan before it runs.

| Setting | Value |
| --- | --- |
| Slug | `recovery-planner` |
| Kind | Feature agent |
| Used by | [Assess a recovery plan](#assess-a-recovery-plan) |
| Harness | Focused |
| Tuning | 3 steps · 2,500 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Health Promise Advisor

Recommends Data Health checks for one table from bounded aggregates.

| Setting | Value |
| --- | --- |
| Slug | `health-promise-advisor` |
| Kind | Feature agent |
| Used by | [Recommend health checks](#recommend-health-checks) |
| Harness | Focused |
| Tuning | 8 steps · 5,000 output tokens |
| Tools | `get_table_schema`, `get_table_ddl`, `run_bounded_aggregate` |
| Skills | all built-in skills on demand |

### Data Health Briefer

Operational brief for one protected dataset.

| Setting | Value |
| --- | --- |
| Slug | `data-health-briefer` |
| Kind | Feature agent |
| Used by | [Data health brief](#data-health-brief) |
| Harness | Focused |
| Tuning | 3 steps · 2,500 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Health Incident Investigator

Diagnoses a Data Health incident: monitor failure or bad data.

| Setting | Value |
| --- | --- |
| Slug | `health-incident-investigator` |
| Kind | Feature agent |
| Used by | [Diagnose a data health incident](#diagnose-a-data-health-incident) |
| Harness | Focused |
| Tuning | 5 steps · 4,000 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Health Promise Tuner

Tunes noisy or insensitive Data Health checks from their history.

| Setting | Value |
| --- | --- |
| Slug | `health-promise-tuner` |
| Kind | Feature agent |
| Used by | [Tune health checks](#tune-health-checks) |
| Harness | Focused |
| Tuning | 4 steps · 3,500 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Incident Correlator

Groups Data Health incidents that share a credible cause.

| Setting | Value |
| --- | --- |
| Slug | `incident-correlator` |
| Kind | Feature agent |
| Used by | [Correlate incidents](#correlate-incidents) |
| Harness | Focused |
| Tuning | 4 steps · 3,000 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Incident Explainer

Narrates an incident's stored root-cause chain and drafts catalog fixes.

| Setting | Value |
| --- | --- |
| Slug | `incident-explainer` |
| Kind | Feature agent |
| Used by | [Explain an incident](#explain-an-incident) |
| Harness | Focused |
| Tuning | 3 steps · 3,000 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Watcher Compiler

Compiles a sentence into one Data Health check.

| Setting | Value |
| --- | --- |
| Slug | `watcher-compiler` |
| Kind | Feature agent |
| Used by | [Compile a watcher](#compile-a-watcher) |
| Harness | Focused |
| Tuning | 3 steps · 2,500 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### Table Context Drafter

Drafts a table's curated context from metadata and an aggregate-only profile.

| Setting | Value |
| --- | --- |
| Slug | `table-context-drafter` |
| Kind | Feature agent |
| Used by | [Draft table context](#draft-table-context) |
| Harness | Focused |
| Tuning | 3 steps · 2,500 output tokens |
| Tools | none |
| Skills | all built-in skills on demand |

### ClickHouse Data

Answers questions about ClickHouse data: databases, tables, columns, SQL, query performance, server state and charts.

| Setting | Value |
| --- | --- |
| Slug | `clickhouse-data` |
| Kind | Chat agent |
| Used by | [Chat](#chat), subagent of CHouse Assistant |
| Harness | Focused |
| Tuning | 12 steps |
| Tools | `list_databases`, `list_tables`, `get_table_schema`, `get_table_ddl`, `get_table_size`, `get_table_sample`, `run_select_query`, `explain_query`, `get_database_info`, `get_running_queries`, `get_server_info`, `search_columns`, `analyze_query`, `validate_sql`, `export_query_result`, `get_slow_queries`, `render_chart`, `generate_query`, `optimize_query` |
| Skills | all built-in skills on demand |

### CHouse Admin

Answers read-only questions about CHouse itself: users, roles, permissions, data access, connections, scheduled jobs, data health, alerts, incidents, Doctor reports, AI models, external agents and the audit log.

| Setting | Value |
| --- | --- |
| Slug | `chouse-admin` |
| Kind | Chat agent |
| Used by | subagent of CHouse Assistant |
| Harness | Delegating |
| Tuning | 10 steps |
| Tools | `whoami` |
| Skills | none |
| Subagents | [Access Auditor](#access-auditor), [Operations Analyst](#operations-analyst), [Platform Auditor](#platform-auditor) |

### Access Auditor

Users, roles, permissions, data access policies, personal access tokens, SSO, and ClickHouse users and roles.

| Setting | Value |
| --- | --- |
| Slug | `access-auditor` |
| Kind | Chat agent |
| Used by | subagent of CHouse Admin |
| Harness | Focused |
| Tuning | 8 steps |
| Tools | `whoami`, `list_users`, `get_user`, `list_roles`, `get_role`, `list_permissions`, `list_data_access_policies`, `list_my_access_tokens`, `list_clickhouse_users`, `list_clickhouse_roles`, `get_sso_settings` |
| Skills | none |

### Operations Analyst

Scheduled jobs and runs, Data Health promises and incidents, alerting, observability incidents, Doctor reports and fleet health.

| Setting | Value |
| --- | --- |
| Slug | `operations-analyst` |
| Kind | Chat agent |
| Used by | subagent of CHouse Admin |
| Harness | Focused |
| Tuning | 8 steps |
| Tools | `list_scheduled_jobs`, `get_scheduled_job`, `list_scheduled_runs`, `list_health_checks`, `get_health_check`, `list_health_incidents`, `list_alerting`, `list_observe_incidents`, `list_doctor_reports`, `fleet_snapshots` |
| Skills | none |

### Platform Auditor

Connections, AI models, external agents and MCP settings, and the audit log.

| Setting | Value |
| --- | --- |
| Slug | `platform-auditor` |
| Kind | Chat agent |
| Used by | subagent of CHouse Admin |
| Harness | Focused |
| Tuning | 8 steps |
| Tools | `whoami`, `list_connections`, `list_ai_models`, `list_agent_sessions`, `get_agent_governance`, `audit_log` |
| Skills | none |

### CHouse Assistant

Routes each chat request to ClickHouse Data or CHouse Admin, and combines their answers for questions that span both.

| Setting | Value |
| --- | --- |
| Slug | `chouse-assistant` |
| Kind | Router |
| Used by | — |
| Harness | Router |
| Tuning | 10 steps · 180 s timeout |
| Tools | none |
| Skills | none |
| Subagents | [ClickHouse Data](#clickhouse-data), [CHouse Admin](#chouse-admin) |
