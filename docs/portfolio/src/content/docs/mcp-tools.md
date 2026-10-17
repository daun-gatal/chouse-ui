---
generated: the MCP tool registry in packages/server/src/mcp
---
All 66 tools the [MCP server](/docs/mcp/) offers. 52 are on by default: the read-only tools that don't spend LLM budget. Writes, destructive tools and tools that call the AI stay off until an administrator turns them on in **AI Governance › MCP**, one tool or one category at a time.

An agent only sees a tool in `tools/list` when it is on **and** the agent's token holds one of the listed permissions. The underlying API still checks the permission and the user's [data access rules](/docs/data-access-rules/) on every call.

| Access | Meaning | MCP annotations |
| --- | --- | --- |
| Read | Reads data or state; changes nothing | `readOnlyHint`, `idempotentHint` |
| Write | Creates something or starts work: saves a query, runs a job or check, proposes a fix, acknowledges an incident | — |
| Destructive | Runs DDL/DML, deletes CHouse UI objects or kills a query | `destructiveHint` |

## All tools

| Tool | Access | On by default | Needs any of |
| --- | --- | --- | --- |
| [`whoami`](#whoami) | Read | Yes | any token |
| [`list_connections`](#list_connections) | Read | Yes | `connections:view` |
| [`use_connection`](#use_connection) | Read | Yes | `connections:view` |
| [`list_databases`](#list_databases) | Read | Yes | `database:view`, `table:view` |
| [`list_tables`](#list_tables) | Read | Yes | `database:view`, `table:view` |
| [`describe_table`](#describe_table) | Read | Yes | `table:view` |
| [`sample_table`](#sample_table) | Read | Yes | `table:select` |
| [`query`](#query) | Read | Yes | `query:execute`, `table:select` |
| [`explain_query`](#explain_query) | Read | Yes | `query:execute`, `table:select` |
| [`list_saved_queries`](#list_saved_queries) | Read | Yes | `saved_queries:view` |
| [`get_saved_query`](#get_saved_query) | Read | Yes | `saved_queries:view` |
| [`run_saved_query`](#run_saved_query) | Read | Yes | `saved_queries:view` |
| [`create_saved_query`](#create_saved_query) | Write | No | `saved_queries:create` |
| [`query_raw`](#query_raw) | Destructive | No | `query:execute:ddl`, `query:execute:dml` |
| [`delete_saved_query`](#delete_saved_query) | Destructive | No | `saved_queries:delete` |
| [`get_dataset_health`](#get_dataset_health) | Read | Yes | `observe:view` |
| [`get_lineage`](#get_lineage) | Read | Yes | `observe:view` |
| [`get_table_context`](#get_table_context) | Read | Yes | `observe:view` |
| [`get_metric`](#get_metric) | Read | Yes | `observe:view` |
| [`get_pipeline_status`](#get_pipeline_status) | Read | Yes | `observe:view` |
| [`list_incidents`](#list_incidents) | Read | Yes | `observe:view`, `data_health:view` |
| [`list_remediation_actions`](#list_remediation_actions) | Read | Yes | `remediation:propose`, `remediation:approve`, `remediation:approve_high` |
| [`get_remediation_action`](#get_remediation_action) | Read | Yes | `remediation:propose`, `remediation:approve`, `remediation:approve_high` |
| [`get_investigation_notebook`](#get_investigation_notebook) | Read | Yes | `data_health:view`, `observe:view`, `doctor:view` |
| [`propose_remediation`](#propose_remediation) | Write | No | `remediation:propose` |
| [`list_health_checks`](#list_health_checks) | Read | Yes | `data_health:view` |
| [`get_health_check`](#get_health_check) | Read | Yes | `data_health:view` |
| [`health_timeline`](#health_timeline) | Read | Yes | `data_health:view` |
| [`run_health_check`](#run_health_check) | Write | No | `data_health:run` |
| [`acknowledge_incident`](#acknowledge_incident) | Write | No | `data_health:edit` |
| [`get_query_regressions`](#get_query_regressions) | Read | Yes | `performance:view` |
| [`get_query_shape_history`](#get_query_shape_history) | Read | Yes | `performance:view` |
| [`get_capacity`](#get_capacity) | Read | Yes | `capacity:view` |
| [`list_upgrade_assessments`](#list_upgrade_assessments) | Read | Yes | `upgrades:view` |
| [`get_upgrade_assessment`](#get_upgrade_assessment) | Read | Yes | `upgrades:view` |
| [`get_canary_replay`](#get_canary_replay) | Read | Yes | `upgrades:view` |
| [`get_upgrade_rollout`](#get_upgrade_rollout) | Read | Yes | `upgrades:view` |
| [`list_dashboards`](#list_dashboards) | Read | Yes | `dashboards:view` |
| [`get_dashboard`](#get_dashboard) | Read | Yes | `dashboards:view` |
| [`export_dashboard`](#export_dashboard) | Read | Yes | `dashboards:view` |
| [`run_dashboard_panel`](#run_dashboard_panel) | Read | Yes | `dashboards:view` |
| [`apply_dashboard`](#apply_dashboard) | Write | No | `dashboards:edit` |
| [`delete_dashboard`](#delete_dashboard) | Destructive | No | `dashboards:delete` |
| [`metrics_overview`](#metrics_overview) | Read | Yes | `metrics:view` |
| [`live_queries`](#live_queries) | Read | Yes | `live_queries:view` |
| [`fleet_snapshots`](#fleet_snapshots) | Read | Yes | `fleet:view` |
| [`list_alerts`](#list_alerts) | Read | Yes | `alerting:view` |
| [`audit_list`](#audit_list) | Read | Yes | `audit:view` |
| [`get_collector_status`](#get_collector_status) | Read | Yes | `observe:view` |
| [`get_collector_schedule`](#get_collector_schedule) | Read | Yes | `connections:view` |
| [`test_alert_channel`](#test_alert_channel) | Write | No | `alerting:edit` |
| [`kill_query`](#kill_query) | Destructive | No | `live_queries:kill`, `live_queries:kill_all` |
| [`list_scheduled_jobs`](#list_scheduled_jobs) | Read | Yes | `scheduled_queries:view` |
| [`get_scheduled_job`](#get_scheduled_job) | Read | Yes | `scheduled_queries:view` |
| [`list_scheduled_runs`](#list_scheduled_runs) | Read | Yes | `scheduled_queries:view` |
| [`run_scheduled_job`](#run_scheduled_job) | Write | No | `scheduled_queries:run` |
| [`delete_scheduled_job`](#delete_scheduled_job) | Destructive | No | `scheduled_queries:delete` |
| [`ai_optimize`](#ai_optimize) | Read · LLM | No | `ai:optimize` |
| [`doctor_scan`](#doctor_scan) | Write · LLM | No | `doctor:run` |
| [`doctor_reports`](#doctor_reports) | Read | Yes | `doctor:view` |
| [`get_doctor_report`](#get_doctor_report) | Read | Yes | `doctor:view` |
| [`get_ai_usage`](#get_ai_usage) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`get_ai_data_egress`](#get_ai_data_egress) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`list_ai_requests`](#list_ai_requests) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`get_ai_request`](#get_ai_request) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`list_ai_agents`](#list_ai_agents) | Read | Yes | `ai_agents:view` |

## Identity & connections

### whoami

*Who am I* — **Read** · on by default · any token

Report the authenticated user's identity, roles, permissions, and active connection context. Use this first to learn what the agent is allowed to do.

No parameters.

### list_connections

*List connections* — **Read** · on by default · needs any of `connections:view`

List the ClickHouse connections visible to this token.

No parameters.

### use_connection

*Check a connection* — **Read** · on by default · needs any of `connections:view`

Validate a connection id and return its details. To operate on that connection, pass the id as the connection_id argument on other tools (or set the X-Connection-Id request header). Never mutates state.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `connection_id` | `string` | Yes | Connection id to validate and adopt |

## Explore

### list_databases

*List databases* — **Read** · on by default · needs any of `database:view`, `table:view`

List the databases and tables visible to this token (respects data-access policies). Returns the filtered database tree.

No parameters.

### list_tables

*List tables* — **Read** · on by default · needs any of `database:view`, `table:view`

List the tables inside one database (respects data-access policies).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes | Database name |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### describe_table

*Describe a table* — **Read** · on by default · needs any of `table:view`

Describe a table: columns, types, engine, and other metadata.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes | Database name |
| `table` | `string` | Yes | Table name |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### sample_table

*Sample rows* — **Read** · on by default · needs any of `table:select`

Preview up to 20 rows of a table (bounded sample).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes | Database name |
| `table` | `string` | Yes | Table name |
| `limit` | `number` | No | Rows to sample (max 20) |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

## Query

### query

*Run a read-only query* — **Read** · on by default · needs any of `query:execute`, `table:select`

Run a single read-only SELECT/WITH/SHOW/DESCRIBE/EXPLAIN query against ClickHouse. Writes and multi-statement input are rejected. Results are capped (100 rows default, max 500).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sql` | `string` | Yes | The SELECT/WITH/SHOW/DESCRIBE/EXPLAIN statement |
| `limit` | `number` | No | Maximum rows to return |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### explain_query

*Explain a query* — **Read** · on by default · needs any of `query:execute`, `table:select`

Return the EXPLAIN plan for a SELECT/WITH query without executing it.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sql` | `string` | Yes | The SELECT/WITH statement to explain |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### list_saved_queries

*List saved queries* — **Read** · on by default · needs any of `saved_queries:view`

List saved queries visible to this token.

No parameters.

### get_saved_query

*Get a saved query* — **Read** · on by default · needs any of `saved_queries:view`

Get one saved query definition by id.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Saved query id |

### run_saved_query

*Run a saved query* — **Read** · on by default · needs any of `saved_queries:view`

Execute a saved query through the safe SELECT-only path. Saved queries that write are refused — use the UI for those.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Saved query id |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### create_saved_query

*Save a query* — **Write** · off by default · needs any of `saved_queries:create`

Save a query definition for reuse.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Display name |
| `query` | `string` | Yes | The SQL to save |
| `description` | `string` | No | Optional description |

### query_raw

*Run any SQL* — **Destructive** · off by default · needs any of `query:execute:ddl`, `query:execute:dml`

Execute an arbitrary SQL statement (DDL/DML); prefer the read-only 'query' tool for SELECTs. Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the client's permission prompt before the call.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sql` | `string` | Yes | The SQL statement to execute |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### delete_saved_query

*Delete a saved query* — **Destructive** · off by default · needs any of `saved_queries:delete`

Delete a saved query by id. Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the client's permission prompt before the call.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Saved query id |

## Data observability

### get_dataset_health

*Dataset health* — **Read** · on by default · needs any of `observe:view`

Health of one table: trust state, freshness, volume baseline, open incidents, owners and recent writers. Check this before relying on a table's data.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes | Database name |
| `table` | `string` | Yes | Table name |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_lineage

*Table lineage* — **Read** · on by default · needs any of `observe:view`

Column-free table lineage around one table: sources, materialized views, dictionaries, scheduled jobs and downstream tables.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes | Database name |
| `table` | `string` | Yes | Table name |
| `direction` | `up | down | both` | No | Upstream, downstream or both |
| `depth` | `number` | No | Hops to follow |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_table_context

*Table context* — **Read** · on by default · needs any of `observe:view`

Curated context for a table: description, owner, column meanings, caveats and defined metrics.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes | Database name |
| `table` | `string` | Yes | Table name |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_metric

*Metric definitions* — **Read** · on by default · needs any of `observe:view`

Defined business metrics (name, SQL expression, table, filters). Use these definitions instead of inventing aggregations.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | No | Metric name to look up; omit to list all |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_pipeline_status

*Pipeline status* — **Read** · on by default · needs any of `observe:view`

Ingestion pipelines (Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, refreshable views, scheduled jobs, ...) with one shared status vocabulary, lag and error class.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `healthy | lagging | stalled | retrying | failing | stopped | inefficient | paused | unsupported_on_version` | No | Only pipelines in this status |
| `kind` | `string` | No | Only this source kind (e.g. kafka, s3queue, refreshable_view) |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### list_incidents

*Data incidents* — **Read** · on by default · needs any of `observe:view`, `data_health:view`

Data and pipeline incidents with severity, subject and the deterministic root-cause summary when computed.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `active | all` | No | Active incidents only, or include recovered |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### list_remediation_actions

*Remediation actions* — **Read** · on by default · needs any of `remediation:propose`, `remediation:approve`, `remediation:approve_high`

Proposed and past fixes on a connection: action type and parameters, who proposed it and why, approvals needed and given, status and the incident it addresses.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `array` | No | Only actions in these statuses (e.g. proposed, approved, failed) |
| `incident_id` | `string` | No | Only actions proposed for this incident |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_remediation_action

*Remediation action* — **Read** · on by default · needs any of `remediation:propose`, `remediation:approve`, `remediation:approve_high`

One remediation action with its approvals and every execution: the statements run, verification and rollback.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Remediation action id |

### get_investigation_notebook

*Investigation notebook* — **Read** · on by default · needs any of `data_health:view`, `observe:view`, `doctor:view`

The investigation notebook of an incident or Doctor report: Chouse AI findings, query snapshots, notes and actions, in order. Needs the view permission of what it belongs to.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `attached_to` | `incident_data_health | incident_observe | doctor_report` | Yes | What the notebook belongs to: a Data Health incident, an observability incident or a Doctor report |
| `ref` | `string` | Yes | The incident id (from list_incidents) or Doctor report id |

### propose_remediation

*Propose a fix* — **Write** · off by default · needs any of `remediation:propose`

Propose a fix from the closed remediation catalog. This only files a proposal: a human approves it in CHouse UI, the CLI or Slack before anything runs, and the proposer can never approve its own proposal.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | `string` | Yes | Catalog action type, e.g. kill_query, optimize_partition, restart_engine_table |
| `params` | `record` | Yes | Action parameters as defined by the remediation catalog |
| `rationale` | `string` | Yes | Why this fix: the evidence it addresses |
| `incident_source` | `data_health | observe` | No | Incident this fixes |
| `incident_id` | `string` | No | Incident id this fixes |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

## Data health

### list_health_checks

*List data health promises* — **Read** · on by default · needs any of `data_health:view`

List data-health promises (checks).

No parameters.

### get_health_check

*Get a data health promise* — **Read** · on by default · needs any of `data_health:view`

Get one data-health check by id, including its incidents.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data-health check id |

### health_timeline

*Data health timeline* — **Read** · on by default · needs any of `data_health:view`

Evaluation timeline for one data-health check.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data-health check id |

### run_health_check

*Run a data health check* — **Write** · off by default · needs any of `data_health:run`

Evaluate a data-health check now.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Resource id |

### acknowledge_incident

*Acknowledge an incident* — **Write** · off by default · needs any of `data_health:edit`

Acknowledge an open data-health incident.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Resource id |

## Performance, capacity & upgrades

### get_query_regressions

*Query regressions* — **Read** · on by default · needs any of `performance:view`

Query shapes that got slower or heavier than their own baseline, with the upgrades, DDL and setting changes around their onset, plus hourly totals. Sample query text is included only with query:history:view:all.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_query_shape_history

*Query shape history* — **Read** · on by default · needs any of `performance:view`

Hourly runs, errors, p50/p95 latency, bytes read and server version of one query shape, per replica.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `fingerprint` | `string` | Yes | Query shape fingerprint from get_query_regressions |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_capacity

*Capacity and cost* — **Read** · on by default · needs any of `capacity:view`

Disk forecasts per node (days until the threshold), the fastest-growing tables, cold tables, measured codec savings, and cost by consumer when the token also has cost:view.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### list_upgrade_assessments

*Upgrade assessments* — **Read** · on by default · needs any of `upgrades:view`

Upgrade readiness assessments of a connection (target version, verdict, findings) and its canary workload replays.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_upgrade_assessment

*Upgrade assessment* — **Read** · on by default · needs any of `upgrades:view`

One upgrade readiness assessment: every rule checked against the real workload, with the evidence behind each finding.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Assessment id |

### get_canary_replay

*Canary replay* — **Read** · on by default · needs any of `upgrades:view`

One workload replay on a canary connection: queries replayed, skipped and missing on the canary, and the most serious result or latency differences. Replayed query text is included only with query:history:view:all.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Replay id |

### get_upgrade_rollout

*Upgrade rollout* — **Read** · on by default · needs any of `upgrades:view`

Every connection the token can use with its ClickHouse version and rollout gates: replica lag, open regressions and sick replicas.

No parameters.

## Dashboards

### list_dashboards

*List dashboards* — **Read** · on by default · needs any of `dashboards:view`

Dashboards this token's user may view (own, shared with their roles, or all with dashboards:manage), with panel counts and access.

No parameters.

### get_dashboard

*Get a dashboard* — **Read** · on by default · needs any of `dashboards:view`

One dashboard: its variables, panels (SQL and chart settings), shares, lint findings and the caller's access.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |

### export_dashboard

*Export a dashboard* — **Read** · on by default · needs any of `dashboards:view`

A dashboard as JSON (format chouse.dashboard/v1) that apply_dashboard and the CLI take — to review or keep in git.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |

### run_dashboard_panel

*Run a dashboard panel* — **Read** · on by default · needs any of `dashboards:view`

Run one panel's read-only query for a time range and variable values, with the caller's own data access. Returns columns and rows (at most 10,000), or for a fleet panel one result per connection.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id |
| `panel_id` | `string` | Yes | Panel id (from get_dashboard) |
| `range` | `15m | 1h | 3h | 6h | 12h | 24h | 2d | 7d | 30d` | Yes | How far back to run the panel |
| `values` | `record` | No | Variable values by name; a variable left out uses its default |
| `connection_id` | `string` | No | Connection to run on (defaults to the dashboard's connection) |

### apply_dashboard

*Create or update a dashboard* — **Write** · off by default · needs any of `dashboards:edit`

Create a dashboard from an export, or update the one its id names to match it exactly (panels left out are removed with their alerts). Every panel is validated like a save in the UI; nothing is partly applied.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dashboard` | `record` | Yes | A dashboard export ({format: "chouse.dashboard/v1", id, dashboard}) as export_dashboard returns it. With an id, that dashboard is updated in place (its panel ids are kept); with id null, a new dashboard is created. |

### delete_dashboard

*Delete a dashboard* — **Destructive** · off by default · needs any of `dashboards:delete`

Delete a dashboard with its panels, shares, pins and panel alerts. Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the client's permission prompt before the call.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |

## Monitoring

### metrics_overview

*Server metrics* — **Read** · on by default · needs any of `metrics:view`

Server metrics overview: cluster stats and current load.

No parameters.

### live_queries

*Running queries* — **Read** · on by default · needs any of `live_queries:view`

List currently running ClickHouse queries.

No parameters.

### fleet_snapshots

*Fleet health* — **Read** · on by default · needs any of `fleet:view`

Latest fleet health snapshots across connections.

No parameters.

### list_alerts

*Alert rules and channels* — **Read** · on by default · needs any of `alerting:view`

List alerting configuration and events: channels, rules, or events.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | `channels | rules | events` | Yes | Which alerting object to list |

### audit_list

*Audit log* — **Read** · on by default · needs any of `audit:view`

List the caller's audit trail (global entries require audit:view).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | `number` | No | Entries to return |

### get_collector_status

*Collector status* — **Read** · on by default · needs any of `observe:view`

Each observability collector of a connection: state, last run and last success, last error, missing grants, whether it is paused, and what its last run read from ClickHouse. Use it when observability data looks stale or missing.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### get_collector_schedule

*Collection schedule* — **Read** · on by default · needs any of `connections:view`

How often each observability collector runs and whether it is paused: the defaults, or one connection's effective schedule with its overrides, each collector's last run, and the bytes it reads from ClickHouse per day at that interval.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `connection_id` | `string` | No | A connection's effective schedule; omit for the defaults every connection inherits |

### test_alert_channel

*Test an alert channel* — **Write** · off by default · needs any of `alerting:edit`

Send a test notification through an alert channel (this pages people).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Resource id |

### kill_query

*Kill a query* — **Destructive** · off by default · needs any of `live_queries:kill`, `live_queries:kill_all`

Terminate a running ClickHouse query by query_id. Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the client's permission prompt before the call.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query_id` | `string` | Yes | query_id of the running query (see live_queries) |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

## Scheduled queries

### list_scheduled_jobs

*List scheduled jobs* — **Read** · on by default · needs any of `scheduled_queries:view`

List scheduled queries.

No parameters.

### get_scheduled_job

*Get a scheduled job* — **Read** · on by default · needs any of `scheduled_queries:view`

Get one scheduled query by id.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Scheduled query id |

### list_scheduled_runs

*Scheduled job runs* — **Read** · on by default · needs any of `scheduled_queries:view`

Run history for one scheduled query.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Scheduled query id |

### run_scheduled_job

*Run a scheduled job now* — **Write** · off by default · needs any of `scheduled_queries:run`

Trigger a scheduled query to run now.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Resource id |

### delete_scheduled_job

*Delete a scheduled job* — **Destructive** · off by default · needs any of `scheduled_queries:delete`

Delete a scheduled query by id. Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the client's permission prompt before the call.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Scheduled query id |

## Chouse AI

### ai_optimize

*Optimize a query with AI* — **Read** · spends LLM budget · off by default · needs any of `ai:optimize`

Ask the AI optimizer to analyze a SQL query and suggest rewrites (spends LLM budget).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sql` | `string` | Yes | The SQL query to optimize |
| `connection_id` | `string` | No | Connection id (defaults to the request/header connection) |

### doctor_scan

*Run a Doctor scan* — **Write** · spends LLM budget · off by default · needs any of `doctor:run`

Run the AI fleet doctor across connections and return a structured report (spends LLM budget).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `hours` | `number` | No | Lookback window in hours |

### doctor_reports

*List Doctor reports* — **Read** · on by default · needs any of `doctor:view`

List past AI doctor reports.

No parameters.

### get_doctor_report

*Get a Doctor report* — **Read** · on by default · needs any of `doctor:view`

Get one AI doctor report by id.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Doctor report id |

## AI governance

### get_ai_usage

*AI usage* — **Read** · on by default · needs any of `ai_usage:view`, `ai:chat`, `ai:optimize`

What CHouse's AI chat and features used in a window: requests, tokens, estimated cost (priced models only), ClickHouse read by AI tools, rows sent to providers, the split by origin (UI, MCP agents, tokens, background) and usage by model. `scope` says whether it covers everyone (ai_usage:view) or only the token owner's own requests.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `days` | `number` | No | Window in days (default 7; capped at the server's retention) |

### get_ai_data_egress

*Data sent to AI providers* — **Read** · on by default · needs any of `ai_usage:view`, `ai:chat`, `ai:optimize`

Tables, columns and CHouse record types that AI tools returned to an LLM provider, most rows first: rows, bytes, users, requests and providers per source.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `days` | `number` | No | Window in days (default 7; capped at the server's retention) |
| `q` | `string` | No | Only sources whose name contains this text (a table or CHouse record type) |

### list_ai_requests

*AI requests* — **Read** · on by default · needs any of `ai_usage:view`, `ai:chat`, `ai:optimize`

Recent AI requests, newest first: who and what started each (origin, token, client), the agent, tokens, cost, ClickHouse read, rows sent and status. Prompt and response text are never stored.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `days` | `number` | No | Window in days (default 7; capped at the server's retention) |
| `q` | `string` | No | Match on user, agent, feature, client, token name or a table sent to the model |
| `origin` | `ui | mcp | token | background` | No | Only requests started from the UI, by MCP agents, by token callers (CLI, scripts) or in the background |
| `limit` | `number` | No | Rows to return (default 50) |
| `offset` | `number` | No | Rows to skip, for paging |

### get_ai_request

*AI request* — **Read** · on by default · needs any of `ai_usage:view`, `ai:chat`, `ai:optimize`

One AI request step by step: each LLM call with tokens and cost, each tool call with the ClickHouse queries it ran and the data it sent to the model.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | AI request id from list_ai_requests |

### list_ai_agents

*AI agents* — **Read** · on by default · needs any of `ai_agents:view`

How CHouse's AI is set up: which agent each AI feature runs, and each agent's model, harness, tools, skills, subagents and tuning, whether it is built in or customized and has an update. Prompt templates and skill files are left out.

No parameters.
