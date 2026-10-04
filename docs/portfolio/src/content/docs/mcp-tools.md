---
generated: the MCP tool registry in packages/server/src/mcp
---
All 43 tools the [MCP server](/docs/mcp/) offers. 31 are on by default: the read-only tools that don't spend LLM budget. Writes, destructive tools and tools that call the AI stay off until an administrator turns them on in **Agents › MCP**, one tool or one category at a time.

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
| [`propose_remediation`](#propose_remediation) | Write | No | `remediation:propose` |
| [`list_health_checks`](#list_health_checks) | Read | Yes | `data_health:view` |
| [`get_health_check`](#get_health_check) | Read | Yes | `data_health:view` |
| [`health_timeline`](#health_timeline) | Read | Yes | `data_health:view` |
| [`run_health_check`](#run_health_check) | Write | No | `data_health:run` |
| [`acknowledge_incident`](#acknowledge_incident) | Write | No | `data_health:edit` |
| [`metrics_overview`](#metrics_overview) | Read | Yes | `metrics:view` |
| [`live_queries`](#live_queries) | Read | Yes | `live_queries:view` |
| [`fleet_snapshots`](#fleet_snapshots) | Read | Yes | `fleet:view` |
| [`list_alerts`](#list_alerts) | Read | Yes | `alerting:view` |
| [`audit_list`](#audit_list) | Read | Yes | `audit:view` |
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
| `status` | `healthy | lagging | stalled | retrying | failing | stopped | inefficient | unsupported_on_version` | No | Only pipelines in this status |
| `kind` | `string` | No | Only this source kind (e.g. kafka, s3queue, refreshable_view) |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

### list_incidents

*Data incidents* — **Read** · on by default · needs any of `observe:view`, `data_health:view`

Data and pipeline incidents with severity, subject and the deterministic root-cause summary when computed.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `active | all` | No | Active incidents only, or include recovered |
| `connection_id` | `string` | No | Connection id (defaults to the request's connection) |

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
