---
generated: the MCP tool registry in packages/server/src/mcp
---
All 137 tools the [MCP server](/docs/mcp/) offers. 122 are on by default: the read-only tools that don't spend LLM budget. Writes, destructive tools and tools that call the AI stay off until an administrator turns them on in **AI Governance › MCP**, one tool or one category at a time.

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
| [`update_saved_query`](#update_saved_query) | Write | Yes | `saved_queries:update` |
| [`share_saved_query`](#share_saved_query) | Write | Yes | `saved_queries:share` |
| [`create_database`](#create_database) | Write | Yes | `database:create` |
| [`create_table`](#create_table) | Write | Yes | `table:create` |
| [`drop_table`](#drop_table) | Destructive | Yes | `table:drop` |
| [`drop_database`](#drop_database) | Destructive | Yes | `database:drop` |
| [`run_sql_change`](#run_sql_change) | Write | Yes | `query:execute:dml`, `query:execute:ddl`, `table:insert`, `table:update`, `table:delete`, `table:create`, `table:alter`, `table:drop`, `database:create`, `database:drop` |
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
| [`create_health_promise`](#create_health_promise) | Write | Yes | `data_health:edit` |
| [`watch_table`](#watch_table) | Write | Yes | `data_health:edit` |
| [`update_health_promise`](#update_health_promise) | Write | Yes | `data_health:edit` |
| [`pause_health_promise`](#pause_health_promise) | Write | Yes | `data_health:edit` |
| [`resume_health_promise`](#resume_health_promise) | Write | Yes | `data_health:edit` |
| [`acknowledge_health_incident`](#acknowledge_health_incident) | Write | Yes | `data_health:edit` |
| [`snooze_health_incident`](#snooze_health_incident) | Write | Yes | `data_health:edit` |
| [`delete_health_promise`](#delete_health_promise) | Write | Yes | `data_health:delete` |
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
| [`list_dashboard_versions`](#list_dashboard_versions) | Read | Yes | `dashboards:view` |
| [`get_dashboard_annotations`](#get_dashboard_annotations) | Read | Yes | `dashboards:view` |
| [`create_dashboard_snapshot`](#create_dashboard_snapshot) | Write | No | `dashboards:view`, `query:execute` |
| [`apply_dashboard`](#apply_dashboard) | Write | No | `dashboards:edit` |
| [`delete_dashboard`](#delete_dashboard) | Destructive | No | `dashboards:delete` |
| [`create_dashboard`](#create_dashboard) | Write | Yes | `dashboards:edit` |
| [`update_dashboard`](#update_dashboard) | Write | Yes | `dashboards:edit` |
| [`add_panel`](#add_panel) | Write | Yes | `dashboards:edit` |
| [`update_panel`](#update_panel) | Write | Yes | `dashboards:edit` |
| [`remove_panel`](#remove_panel) | Write | Yes | `dashboards:edit` |
| [`restore_dashboard_version`](#restore_dashboard_version) | Write | Yes | `dashboards:edit` |
| [`add_dashboard_note`](#add_dashboard_note) | Write | Yes | `dashboards:edit` |
| [`delete_dashboard_note`](#delete_dashboard_note) | Write | Yes | `dashboards:view` |
| [`share_dashboard`](#share_dashboard) | Write | Yes | `dashboards:share` |
| [`update_table_context`](#update_table_context) | Write | Yes | `context:edit` |
| [`upsert_metric`](#upsert_metric) | Write | Yes | `context:edit` |
| [`delete_metric`](#delete_metric) | Write | Yes | `context:edit` |
| [`metrics_overview`](#metrics_overview) | Read | Yes | `metrics:view` |
| [`live_queries`](#live_queries) | Read | Yes | `live_queries:view` |
| [`fleet_snapshots`](#fleet_snapshots) | Read | Yes | `fleet:view` |
| [`list_alerts`](#list_alerts) | Read | Yes | `alerting:view` |
| [`audit_list`](#audit_list) | Read | Yes | `audit:view` |
| [`get_collector_status`](#get_collector_status) | Read | Yes | `observe:view` |
| [`get_collector_schedule`](#get_collector_schedule) | Read | Yes | `connections:view` |
| [`test_alert_channel`](#test_alert_channel) | Write | No | `alerting:edit` |
| [`kill_query`](#kill_query) | Destructive | No | `live_queries:kill`, `live_queries:kill_all` |
| [`create_alert_rule`](#create_alert_rule) | Write | Yes | `alerting:edit` |
| [`update_alert_rule`](#update_alert_rule) | Write | Yes | `alerting:edit` |
| [`mute_alert_rule`](#mute_alert_rule) | Write | Yes | `alerting:edit` |
| [`post_alert_message`](#post_alert_message) | Write | Yes | `alerting:edit` |
| [`clear_alert_events`](#clear_alert_events) | Write | Yes | `alerting:delete` |
| [`acknowledge_observe_incident`](#acknowledge_observe_incident) | Write | Yes | `observe:edit` |
| [`dismiss_suggestion`](#dismiss_suggestion) | Write | Yes | `observe:edit` |
| [`pin_table_criticality`](#pin_table_criticality) | Write | Yes | `observe:edit` |
| [`add_notebook_cell`](#add_notebook_cell) | Write | Yes | `notebooks:edit` |
| [`update_cost_rates`](#update_cost_rates) | Write | Yes | `settings:update` |
| [`update_collector_schedule`](#update_collector_schedule) | Write | Yes | `connections:edit` |
| [`start_codec_trial`](#start_codec_trial) | Write | Yes | `upgrades:run` |
| [`run_doctor_scan`](#run_doctor_scan) | Write | Yes | `doctor:run` |
| [`update_doctor_schedule`](#update_doctor_schedule) | Write | Yes | `doctor:run` |
| [`update_fleet_alert_config`](#update_fleet_alert_config) | Write | Yes | `settings:update` |
| [`run_upgrade_assessment`](#run_upgrade_assessment) | Write | Yes | `upgrades:run` |
| [`run_canary_replay`](#run_canary_replay) | Write | Yes | `upgrades:run` |
| [`list_scheduled_jobs`](#list_scheduled_jobs) | Read | Yes | `scheduled_queries:view` |
| [`get_scheduled_job`](#get_scheduled_job) | Read | Yes | `scheduled_queries:view` |
| [`list_scheduled_runs`](#list_scheduled_runs) | Read | Yes | `scheduled_queries:view` |
| [`run_scheduled_job`](#run_scheduled_job) | Write | No | `scheduled_queries:run` |
| [`delete_scheduled_job`](#delete_scheduled_job) | Destructive | No | `scheduled_queries:delete` |
| [`create_scheduled_query`](#create_scheduled_query) | Write | Yes | `scheduled_queries:edit` |
| [`update_scheduled_job`](#update_scheduled_job) | Write | Yes | `scheduled_queries:edit` |
| [`pause_scheduled_job`](#pause_scheduled_job) | Write | Yes | `scheduled_queries:edit` |
| [`resume_scheduled_job`](#resume_scheduled_job) | Write | Yes | `scheduled_queries:edit` |
| [`ai_optimize`](#ai_optimize) | Read · LLM | No | `ai:optimize` |
| [`doctor_scan`](#doctor_scan) | Write · LLM | No | `doctor:run` |
| [`doctor_reports`](#doctor_reports) | Read | Yes | `doctor:view` |
| [`get_doctor_report`](#get_doctor_report) | Read | Yes | `doctor:view` |
| [`get_action_status`](#get_action_status) | Write | Yes | any token |
| [`undo_action`](#undo_action) | Write | Yes | any token |
| [`get_ai_usage`](#get_ai_usage) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`get_ai_data_egress`](#get_ai_data_egress) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`list_ai_requests`](#list_ai_requests) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`get_ai_request`](#get_ai_request) | Read | Yes | `ai_usage:view`, `ai:chat`, `ai:optimize` |
| [`list_ai_agents`](#list_ai_agents) | Read | Yes | `ai_agents:view` |
| [`list_ai_guardrails`](#list_ai_guardrails) | Read | Yes | `ai_guardrails:view` |
| [`list_ai_guardrail_triggers`](#list_ai_guardrail_triggers) | Read | Yes | `ai_guardrails:view` |
| [`draft_ai_agent`](#draft_ai_agent) | Write | Yes | `ai_agents:manage` |
| [`run_ai_eval`](#run_ai_eval) | Write | Yes | `ai_agents:manage` |
| [`publish_ai_agent`](#publish_ai_agent) | Destructive | Yes | `ai_agents:manage` |
| [`create_user`](#create_user) | Destructive | Yes | `users:create` |
| [`update_user`](#update_user) | Destructive | Yes | `users:update` |
| [`deactivate_user`](#deactivate_user) | Destructive | Yes | `users:update` |
| [`assign_role`](#assign_role) | Destructive | Yes | `roles:assign` |
| [`create_role`](#create_role) | Destructive | Yes | `roles:create` |
| [`update_role`](#update_role) | Destructive | Yes | `roles:update` |
| [`delete_role`](#delete_role) | Destructive | Yes | `roles:delete` |
| [`create_data_access_policy`](#create_data_access_policy) | Destructive | Yes | `data_access:create` |
| [`update_data_access_policy`](#update_data_access_policy) | Destructive | Yes | `data_access:update` |
| [`delete_data_access_policy`](#delete_data_access_policy) | Destructive | Yes | `data_access:delete` |
| [`set_role_policies`](#set_role_policies) | Destructive | Yes | `data_access:assign` |
| [`create_clickhouse_role`](#create_clickhouse_role) | Destructive | Yes | `clickhouse:roles:create` |
| [`update_clickhouse_role`](#update_clickhouse_role) | Destructive | Yes | `clickhouse:roles:update` |

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

### update_saved_query

*Edit a saved query* — **Write** · on by default · needs any of `saved_queries:update`

Change a saved query's name, SQL or description (from list_saved_queries). Only the fields given change. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Saved query id |
| `name` | `string` | No |   |
| `query` | `string` | No |   |
| `description` | `string` | No |   |

### share_saved_query

*Share a saved query* — **Write** · on by default · needs any of `saved_queries:share`

Make a saved query visible to everyone who can see saved queries, or private again. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Saved query id |
| `shared` | `boolean` | Yes | true to share with everyone, false to make it private |

### create_database

*Create a database* — **Write** · on by default · needs any of `database:create`

Create a ClickHouse database on the active connection. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `engine` | `string` | No | Database engine, default Atomic |
| `cluster` | `string` | No | ON CLUSTER name |

### create_table

*Create a table* — **Write** · on by default · needs any of `table:create`

Create a ClickHouse table on the active connection from columns, an engine and keys; CHouse validates every type and key expression. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `name` | `string` | Yes |   |
| `columns` | `array` | Yes |   |
| `engine` | `string` | No | Default MergeTree() |
| `orderBy` | `string` | No |   |
| `partitionBy` | `string` | No |   |
| `primaryKey` | `string` | No |   |
| `cluster` | `string` | No |   |

### drop_table

*Drop a table* — **Destructive** · on by default · needs any of `table:drop`

Drop a ClickHouse table on the active connection. Irreversible: a second person approves it. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |

### drop_database

*Drop a database* — **Destructive** · on by default · needs any of `database:drop`

Drop a ClickHouse database and every table in it, on the active connection. Irreversible: a second person approves it. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |

### run_sql_change

*Change data or schema with SQL* — **Write** · on by default · needs any of `query:execute:dml`, `query:execute:ddl`, `table:insert`, `table:update`, `table:delete`, `table:create`, `table:alter`, `table:drop`, `database:create`, `database:drop`

Run one INSERT, UPDATE, DELETE, CREATE, DROP, ALTER or TRUNCATE statement on the active connection. INSERT and CREATE ask once; anything that alters, removes or rewrites data needs a second person's approval. Prefer create_table, drop_table and create_database when they fit. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sql` | `string` | Yes | Exactly one statement |

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

### create_health_promise

*Create a data health promise* — **Write** · on by default · needs any of `data_health:edit`

Create a data health promise on a table of the active connection: checks (freshness, volume, nulls…) evaluated on a schedule. Use the check definitions recommend_health_promise or the data health docs describe. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `description` | `string` | No |   |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `eventTimeColumn` | `string` | No | Column holding each row's event time, for freshness and slot checks |
| `eventTimeEncoding` | `native | unix_seconds | unix_milliseconds | unix_microseconds | unix_nanoseconds | string` | No | How the event time is stored: native (a Date or DateTime column, the default), unix_* numbers, or string |
| `eventTimeTimezone` | `string` | No | IANA timezone of string event-time values (string only) |
| `criticality` | `standard | important | critical` | No |   |
| `frequency` | `daily | weekly | monthly | cron` | Yes | How often it runs; for hourly or finer use cron with cronExpr (e.g. "0 * * * *") |
| `hour` | `number` | No | Hour of day (daily, weekly, monthly) |
| `dayOfWeek` | `number` | No | 0 = Sunday (weekly) |
| `dayOfMonth` | `number` | No | Day of month (monthly) |
| `cronExpr` | `string` | No | Cron expression (frequency cron) |
| `timezone` | `string` | No | IANA timezone, default UTC |
| `checks` | `array` | Yes | Check definitions, each with a type and its settings |

### watch_table

*Keep an eye on a table* — **Write** · on by default · needs any of `data_health:edit`

Watch a table on the active connection for a while ("keep an eye on shop.orders until tomorrow"): a personal Data Health promise, checked every 15 minutes, that says when new rows stop arriving and removes itself when the watch ends — 09:00 tomorrow by default, at most 7 days, five per connection. Needs the table's event-time column (look it up with the table's columns first). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `eventTimeColumn` | `string` | Yes | Column holding each row's event time: the watch checks that new rows keep arriving |
| `eventTimeEncoding` | `native | unix_seconds | unix_milliseconds | unix_microseconds | unix_nanoseconds | string` | No | How the event time is stored (default native) |
| `maxAgeMinutes` | `number` | No | The newest row may be at most this old (default 60) |
| `until` | `string` | No | When the watch ends, ISO 8601 (e.g. 2026-10-25T09:00:00Z); default 09:00 tomorrow |
| `timezone` | `string` | No | IANA timezone for the default end (09:00 tomorrow); default UTC |

### update_health_promise

*Edit a data health promise* — **Write** · on by default · needs any of `data_health:edit`

Change a promise's name, description, criticality, schedule, thresholds (grace, breach/recover after) or its whole list of checks. Only the fields given change. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data Health promise id (from list_health_checks) |
| `name` | `string` | No |   |
| `description` | `string` | No |   |
| `criticality` | `standard | important | critical` | No |   |
| `frequency` | `daily | weekly | monthly | cron` | No | How often it runs; for hourly or finer use cron with cronExpr (e.g. "0 * * * *") |
| `hour` | `number` | No | Hour of day (daily, weekly, monthly) |
| `dayOfWeek` | `number` | No | 0 = Sunday (weekly) |
| `dayOfMonth` | `number` | No | Day of month (monthly) |
| `cronExpr` | `string` | No | Cron expression (frequency cron) |
| `graceSecs` | `number` | No |   |
| `breachAfter` | `number` | No |   |
| `recoverAfter` | `number` | No |   |
| `checks` | `array` | No | Replaces every check |

### pause_health_promise

*Pause a data health promise* — **Write** · on by default · needs any of `data_health:edit`

Stop a promise's checks from running until it is resumed. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data Health promise id (from list_health_checks) |

### resume_health_promise

*Resume a data health promise* — **Write** · on by default · needs any of `data_health:edit`

Let a paused promise's checks run on their schedule again. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data Health promise id (from list_health_checks) |

### acknowledge_health_incident

*Acknowledge a data health incident* — **Write** · on by default · needs any of `data_health:edit`

Mark a data health incident as acknowledged (someone is on it). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data Health incident id (from list_health_incidents) |

### snooze_health_incident

*Snooze a data health incident* — **Write** · on by default · needs any of `data_health:edit`

Silence a data health incident's notifications for a number of hours. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data Health incident id (from list_health_incidents) |
| `hours` | `number` | Yes | How long, in hours (up to a week) |

### delete_health_promise

*Delete a data health promise* — **Write** · on by default · needs any of `data_health:delete`

Delete a promise with its checks, samples and incident history. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Data Health promise id (from list_health_checks) |

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

A dashboard as JSON (format chouse.dashboard/v2) that apply_dashboard and the CLI take — to review or keep in git.

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
| `values` | `record` | No | Variable values by name: a string, or a list for a multi-value variable; a variable left out uses its default |
| `connection_id` | `string` | No | Connection to run on (defaults to the request/header connection); a fleet panel runs on every connection |

### list_dashboard_versions

*List dashboard versions* — **Read** · on by default · needs any of `dashboards:view`

The last 50 saves of a dashboard, newest first: version number, who saved it, when, and how (UI, token, import, restore, rollup…).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |

### get_dashboard_annotations

*Get dashboard annotations* — **Read** · on by default · needs any of `dashboards:view`

What changed around a dashboard's charts in a range — DDL, upgrades, settings, new writers, panel alerts, incidents, fixes and notes — read with the caller's own access. Each kind says whether it could be read and why not.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id |
| `range` | `15m | 1h | 3h | 6h | 12h | 24h | 2d | 7d | 30d` | Yes | How far back to look |
| `sources` | `array` | No | Which kinds of event to read (default: every kind): DDL, upgrades, settings changes, new writers, panel alerts, incidents, fixes, notes |
| `connection_id` | `string` | No | Connection whose events to read (defaults to the request/header connection) |

### create_dashboard_snapshot

*Snapshot a dashboard* — **Write** · off by default · needs any of `dashboards:view`, `query:execute`

Freeze every chart panel's result for a range ending now, as the caller, so it can be shared after the data moves on (at most 10 MiB). Whoever opens it still only sees what their own access allows.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id |
| `name` | `string` | Yes | Snapshot name |
| `range` | `15m | 1h | 3h | 6h | 12h | 24h | 2d | 7d | 30d` | Yes | The range to freeze, ending now |
| `values` | `record` | No | Variable values by name: a string, or a list for a multi-value variable; a variable left out uses its default |
| `role_ids` | `array` | No | Roles (from the dashboard's shares) that may open it besides you; default none |
| `expires_in_days` | `number` | No | Days until it expires (default 30) |
| `connection_id` | `string` | No | Connection to run on (defaults to the request/header connection); a fleet panel runs on every connection |

### apply_dashboard

*Create or update a dashboard* — **Write** · off by default · needs any of `dashboards:edit`

Create a dashboard from an export, or update the one its id names to match it exactly (panels left out are removed with their alerts). Every panel is validated like a save in the UI; nothing is partly applied.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `dashboard` | `record` | Yes | A dashboard export ({format: "chouse.dashboard/v2", id, dashboard}) as export_dashboard returns it; a chouse.dashboard/v1 export from before CHouse 3.16 is converted. With an id, that dashboard is updated in place (its panel ids are kept); with id null, a new dashboard is created. |

### delete_dashboard

*Delete a dashboard* — **Destructive** · off by default · needs any of `dashboards:delete`

Delete a dashboard with its panels, shares, pins and panel alerts. Destructive — enabled by an administrator and limited by your token's scopes; the human approves via the client's permission prompt before the call.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |

### create_dashboard

*Create a dashboard* — **Write** · on by default · needs any of `dashboards:edit`

Create a dashboard on the active connection from panels (title, SQL, chart type and columns). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | `string` | Yes |   |
| `description` | `string` | No |   |
| `timeRange` | `15m | 1h | 3h | 6h | 12h | 24h | 2d | 7d | 30d` | No | Default time range, 24h if omitted |
| `panels` | `array` | Yes |   |

### update_dashboard

*Edit a dashboard* — **Write** · on by default · needs any of `dashboards:edit`

Change a dashboard's title, description, default time range or auto-refresh. Only the fields given change. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `title` | `string` | No |   |
| `description` | `string` | No |   |
| `timeRange` | `15m | 1h | 3h | 6h | 12h | 24h | 2d | 7d | 30d` | No |   |
| `refreshSeconds` | `union` | No |   |

### add_panel

*Add a dashboard panel* — **Write** · on by default · needs any of `dashboards:edit`

Add a chart panel (title, read-only SQL, chart type, x and y columns) at the bottom of a dashboard. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | `string` | Yes |   |
| `sql` | `string` | Yes | Read-only SELECT; may use {{from}} / {{to}} time-range macros |
| `chart` | `bar | horizontal_bar | grouped_bar | stacked_bar | line | multi_line | area | stacked_area | pie | donut | scatter | radar | treemap | funnel | histogram | heatmap | stat | table` | Yes | Chart type; table shows every column |
| `x` | `string` | No | x column (not for stat or table) |
| `y` | `array` | No | y columns (stat: exactly one; table and histogram: none) |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |

### update_panel

*Edit a dashboard panel* — **Write** · on by default · needs any of `dashboards:edit`

Change a chart panel's title, SQL, chart type or columns. Only the fields given change; its place on the canvas stays. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `panelId` | `string` | Yes | Panel id (from get_dashboard) |
| `title` | `string` | No |   |
| `sql` | `string` | No |   |
| `chart` | `bar | horizontal_bar | grouped_bar | stacked_bar | line | multi_line | area | stacked_area | pie | donut | scatter | radar | treemap | funnel | histogram | heatmap | stat | table` | No |   |
| `x` | `string` | No |   |
| `y` | `array` | No |   |

### remove_panel

*Remove a dashboard panel* — **Write** · on by default · needs any of `dashboards:edit`

Remove a panel from a dashboard (its alerts go with it). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `panelId` | `string` | Yes | Panel id (from get_dashboard) |

### restore_dashboard_version

*Restore a dashboard version* — **Write** · on by default · needs any of `dashboards:edit`

Save an older version of a dashboard (from its version history) as the newest one. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `version` | `number` | Yes |   |

### add_dashboard_note

*Add a dashboard note* — **Write** · on by default · needs any of `dashboards:edit`

Pin a note to a moment on a dashboard's timeline (e.g. a deploy), on the active connection. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `text` | `string` | Yes |   |
| `at` | `string` | No | ISO time; default now |

### delete_dashboard_note

*Delete a dashboard note* — **Write** · on by default · needs any of `dashboards:view`

Delete a note from a dashboard's timeline (yours, or any if you can edit the dashboard). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `noteId` | `string` | Yes |   |

### share_dashboard

*Share a dashboard* — **Write** · on by default · needs any of `dashboards:share`

Set which roles can see a dashboard, and which of them can edit it. Replaces the current shares. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Dashboard id (from list_dashboards) |
| `shares` | `array` | Yes |   |

### update_table_context

*Update table context* — **Write** · on by default · needs any of `context:edit`

Set a table's curated context (description, grain, owner, tags) that every agent and person reads. Only the fields given change. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `description` | `string` | No |   |
| `grain` | `string` | No | What one row is, e.g. one order line |
| `owner` | `string` | No |   |
| `tags` | `array` | No |   |

### upsert_metric

*Define a metric* — **Write** · on by default · needs any of `context:edit`

Define (or redefine, by name) a business metric on a table: an aggregate SQL expression every agent and person reads, e.g. revenue = sum(price * qty). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `name` | `string` | Yes |   |
| `expression` | `string` | Yes |   |
| `description` | `string` | No |   |
| `owner` | `string` | No |   |

### delete_metric

*Delete a metric* — **Write** · on by default · needs any of `context:edit`

Delete a table's business metric by name. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `name` | `string` | Yes |   |

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

### create_alert_rule

*Create an alert rule* — **Write** · on by default · needs any of `alerting:edit`

Create an alert rule that notifies channels (from list_alerting) when its condition fires. Fleet threshold rules use config keys memoryPercent, queryMemoryGb, longQueryMin, partsEtaMin; only one fleet rule may be enabled. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `sourceType` | `fleet_threshold | data_quality` | No | Default fleet_threshold |
| `severity` | `info | warning | critical` | No |   |
| `enabled` | `boolean` | No |   |
| `config` | `record` | No |   |
| `channelIds` | `array` | No |   |

### update_alert_rule

*Edit an alert rule* — **Write** · on by default · needs any of `alerting:edit`

Change an alert rule's name, severity, thresholds (config), channels or whether it is on. Only the fields given change. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Alert rule id (from list_alerting with kind rules) |
| `name` | `string` | No |   |
| `severity` | `info | warning | critical` | No |   |
| `enabled` | `boolean` | No |   |
| `config` | `record` | No | Replaces the rule's config |
| `channelIds` | `array` | No |   |

### mute_alert_rule

*Mute an alert rule* — **Write** · on by default · needs any of `alerting:edit`

Turn an alert rule off so it stops notifying; undo (or update_alert_rule with enabled true) turns it back on. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Alert rule id (from list_alerting with kind rules) |

### post_alert_message

*Post to an alert channel* — **Write** · on by default · needs any of `alerting:edit`

Post a short message to an alert channel (Slack, email…) — a handoff, a status update. It reaches real people and cannot be taken back, so write it for them. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Alert channel id (from list_alerting with kind channels) |
| `title` | `string` | Yes |   |
| `text` | `string` | Yes |   |

### clear_alert_events

*Clear recent alerts* — **Write** · on by default · needs any of `alerting:delete`

Delete fired alert events: all of them, or those older than a number of hours. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `olderThanHours` | `number` | No | Only events older than this; omit for all |

### acknowledge_observe_incident

*Acknowledge an observability incident* — **Write** · on by default · needs any of `observe:edit`

Mark an observability incident (from list_observe_incidents) as acknowledged. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |

### dismiss_suggestion

*Dismiss an Observe suggestion* — **Write** · on by default · needs any of `observe:edit`

Hide an Observe suggestion (by its key) so it is not offered again. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | `string` | Yes |   |

### pin_table_criticality

*Set a table's criticality* — **Write** · on by default · needs any of `observe:edit`

Pin how critical a table is (critical, important, standard), or clear the pin with null so Observe infers it. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `criticality` | `critical | important | standard` | Yes |   |

### add_notebook_cell

*Add to an investigation notebook* — **Write** · on by default · needs any of `notebooks:edit`

Add a note or a query to the investigation notebook of an incident or Doctor report (created if it has none). Query cells run once when added. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `attachedTo` | `incident_data_health | incident_observe | doctor_report` | Yes |   |
| `ref` | `string` | Yes | The incident or report id |
| `kind` | `note | query` | Yes |   |
| `text` | `string` | No | Note text (kind note) |
| `sql` | `string` | No | Read-only SELECT (kind query) |
| `title` | `string` | No | Query cell title |

### update_cost_rates

*Set cost rates* — **Write** · on by default · needs any of `settings:update`

Set the prices Observe uses to estimate query cost: per TiB read and per CPU hour, in a currency. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `currency` | `string` | Yes |   |
| `perTibRead` | `number` | Yes |   |
| `perCpuHour` | `number` | Yes |   |

### update_collector_schedule

*Change the collection schedule* — **Write** · on by default · needs any of `connections:edit`

Change how often Observe collectors run on the active connection, or pause them. Keys are collector names (from get_collector_schedule); a null value inherits the default. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `collectors` | `record` | Yes |   |

### start_codec_trial

*Try a column codec* — **Write** · on by default · needs any of `upgrades:run`

Measure how a different compression codec would do on one column, by writing a sample to a scratch table on the active connection. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `database` | `string` | Yes |   |
| `table` | `string` | Yes |   |
| `column` | `string` | Yes |   |
| `candidateCodec` | `string` | Yes |   |

### run_doctor_scan

*Run a Doctor scan* — **Write** · on by default · needs any of `doctor:run`

Run the fleet Doctor now over the last hours of metrics (it uses the AI model and takes a while). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `hours` | `number` | No |   |
| `connectionIds` | `array` | No | Default: every connection |

### update_doctor_schedule

*Schedule the Doctor* — **Write** · on by default · needs any of `doctor:run`

Turn the scheduled Doctor scan on or off and set when it runs. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | Yes |   |
| `frequency` | `daily | weekly | monthly` | Yes |   |
| `hour` | `number` | Yes |   |
| `dayOfWeek` | `number` | No |   |
| `dayOfMonth` | `number` | No |   |
| `hours` | `number` | No | Hours of metrics each scan reads |
| `connectionIds` | `array` | No |   |
| `deliver` | `boolean` | No | Send each report to the alert channels |

### update_fleet_alert_config

*Change fleet alert thresholds* — **Write** · on by default · needs any of `settings:update`

Turn fleet threshold alerts on or off and set their thresholds. Notification channels and their secrets are left as they are. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | Yes |   |
| `memoryPercent` | `number` | Yes |   |
| `queryMemoryGb` | `number` | Yes |   |
| `longQueryMin` | `number` | Yes |   |
| `partsEtaMin` | `number` | No |   |

### run_upgrade_assessment

*Assess an upgrade* — **Write** · on by default · needs any of `upgrades:run`

Assess what would break upgrading the active connection's ClickHouse to a version (it scans settings, functions and recent queries). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `targetVersion` | `string` | Yes |   |

### run_canary_replay

*Replay queries on a canary* — **Write** · on by default · needs any of `upgrades:run`

Replay recent read queries from the active connection against a canary connection to compare results before an upgrade. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `canaryConnectionId` | `string` | Yes |   |
| `assessmentId` | `string` | No |   |
| `limit` | `number` | No |   |

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

### create_scheduled_query

*Schedule a query* — **Write** · on by default · needs any of `scheduled_queries:edit`

Create a scheduled report query (read-only SELECT, no materialization) on the active connection. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `description` | `string` | No |   |
| `query` | `string` | Yes | Read-only SELECT |
| `frequency` | `daily | weekly | monthly | cron` | Yes | How often it runs; for hourly or finer use cron with cronExpr (e.g. "0 * * * *") |
| `hour` | `number` | No | Hour of day (daily, weekly, monthly) |
| `dayOfWeek` | `number` | No | 0 = Sunday (weekly) |
| `dayOfMonth` | `number` | No | Day of month (monthly) |
| `cronExpr` | `string` | No | Cron expression (frequency cron) |
| `timezone` | `string` | No | IANA timezone, default UTC |

### update_scheduled_job

*Edit a scheduled query* — **Write** · on by default · needs any of `scheduled_queries:edit`

Change a scheduled query's name, description, SQL, schedule, row limit or timeout. Only the fields given change; its connection and output never do. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Scheduled query id (from list_scheduled_jobs) |
| `name` | `string` | No |   |
| `description` | `string` | No |   |
| `query` | `string` | No | Read-only SELECT |
| `frequency` | `daily | weekly | monthly | cron` | No | How often it runs; for hourly or finer use cron with cronExpr (e.g. "0 * * * *") |
| `hour` | `number` | No | Hour of day (daily, weekly, monthly) |
| `dayOfWeek` | `number` | No | 0 = Sunday (weekly) |
| `dayOfMonth` | `number` | No | Day of month (monthly) |
| `cronExpr` | `string` | No | Cron expression (frequency cron) |
| `timezone` | `string` | No | IANA timezone, default UTC |
| `maxRows` | `number` | No |   |
| `timeoutSecs` | `number` | No |   |

### pause_scheduled_job

*Pause a scheduled query* — **Write** · on by default · needs any of `scheduled_queries:edit`

Stop a scheduled query from running until it is resumed. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Scheduled query id (from list_scheduled_jobs) |

### resume_scheduled_job

*Resume a scheduled query* — **Write** · on by default · needs any of `scheduled_queries:edit`

Let a paused scheduled query run on its schedule again. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Scheduled query id (from list_scheduled_jobs) |

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

### get_action_status

*Check a write action* — **Write** · on by default · any token

Check a write action this token started (by the actionId a write tool returned). If the user has confirmed it since, it runs now and the result comes back.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action_id` | `string` | Yes | The actionId a write tool returned |

### undo_action

*Undo a write action* — **Write** · on by default · any token

Undo an undoable action this user made (within 24 hours). Refused when the object changed since, so nobody's later change is overwritten.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `action_id` | `string` | Yes | The actionId a write tool returned |

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

### list_ai_guardrails

*AI guardrails* — **Read** · on by default · needs any of `ai_guardrails:view`

The guardrails every CHouse AI run (and, where enabled, every MCP tool result) passes through: kind, stages, action, shadow or enforce mode, scope, order, whether it is on, and its triggers in the last 24 hours.

No parameters.

### list_ai_guardrail_triggers

*AI guardrail triggers* — **Read** · on by default · needs any of `ai_guardrails:view`

Recent guardrail triggers, newest first: guardrail, stage, action, mode, how many values matched, agent and tool, and the AI request. Returns the total too; page with limit and offset. Matched values are never stored.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `days` | `number` | No | Window in days (default 7; capped at the server's retention) |
| `guardrailId` | `string` | No | Only this guardrail's triggers (id from list_ai_guardrails) |
| `limit` | `number` | No | Rows to return (default 100) |
| `offset` | `number` | No | Rows to skip, for paging |

### draft_ai_agent

*Draft an AI agent* — **Write** · on by default · needs any of `ai_agents:manage`

Save a new custom chat agent as a disabled draft: a prompt and the catalog tools it may use. Nobody can chat with it until it is published. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `slug` | `string` | Yes |   |
| `name` | `string` | Yes |   |
| `description` | `string` | Yes |   |
| `systemPrompt` | `string` | Yes |   |
| `tools` | `array` | Yes | Catalog tool names |
| `subagents` | `array` | No | Agent ids |

### run_ai_eval

*Run an agent's evals* — **Write** · on by default · needs any of `ai_agents:manage`

Run an agent's eval cases and score them (it calls the AI model once per case). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | `string` | Yes |   |

### publish_ai_agent

*Publish an AI agent* — **Destructive** · on by default · needs any of `ai_agents:manage`

Turn a drafted (disabled) custom agent on so people can chat with it. If the agent has an eval threshold, its evals must pass first. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |

## Access

### create_user

*Create a user* — **Destructive** · on by default · needs any of `users:create`

Create a CHouse user with one role. CHouse generates their password and never shows it to the assistant: set it in Admin › Users, or the user signs in with SSO. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | `string` | Yes |   |
| `username` | `string` | Yes |   |
| `displayName` | `string` | No |   |
| `roleId` | `string` | No | Role id (from list_roles) |

### update_user

*Edit a user* — **Destructive** · on by default · needs any of `users:update`

Change a user's email, username or display name. Use assign_role to change their role, deactivate_user to block them. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | User id (from list_users) |
| `email` | `string` | No |   |
| `username` | `string` | No |   |
| `displayName` | `string` | No |   |

### deactivate_user

*Deactivate a user* — **Destructive** · on by default · needs any of `users:update`

Block a user from signing in (their sessions end); activate them again with active true. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |
| `active` | `boolean` | No |   |

### assign_role

*Assign a role* — **Destructive** · on by default · needs any of `roles:assign`

Give a user a role (a user has exactly one; this replaces it). You can only grant roles whose permissions you hold. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `userId` | `string` | Yes |   |
| `roleId` | `string` | Yes |   |

### create_role

*Create a role* — **Destructive** · on by default · needs any of `roles:create`

Create a role from permission ids (list_permissions) and at least one data access policy (list_data_access_policies). You can only include permissions you hold. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `displayName` | `string` | Yes |   |
| `description` | `string` | No |   |
| `permissionIds` | `array` | Yes |   |
| `dataAccessPolicyIds` | `array` | Yes |   |

### update_role

*Edit a role* — **Destructive** · on by default · needs any of `roles:update`

Change a role's name, description, permissions or data access policies. Lists replace what the role has. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |
| `displayName` | `string` | No |   |
| `description` | `string` | No |   |
| `permissionIds` | `array` | No |   |
| `dataAccessPolicyIds` | `array` | No |   |

### delete_role

*Delete a role* — **Destructive** · on by default · needs any of `roles:delete`

Delete a custom role (system roles and roles still assigned to users cannot be deleted). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |

### create_data_access_policy

*Create a data access policy* — **Destructive** · on by default · needs any of `data_access:create`

Create a data access policy: rules allowing or denying database/table patterns, on one connection or all. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `description` | `string` | No |   |
| `rules` | `array` | Yes |   |

### update_data_access_policy

*Edit a data access policy* — **Destructive** · on by default · needs any of `data_access:update`

Change a data access policy's name, description or rules (the rules list replaces the current one). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |
| `name` | `string` | No |   |
| `description` | `string` | No |   |
| `rules` | `array` | No |   |

### delete_data_access_policy

*Delete a data access policy* — **Destructive** · on by default · needs any of `data_access:delete`

Delete a data access policy (system policies cannot be deleted). Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |   |

### set_role_policies

*Set a role's data access policies* — **Destructive** · on by default · needs any of `data_access:assign`

Replace the data access policies attached to a role — which connections, databases and tables its users can reach. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `roleId` | `string` | Yes |   |
| `policyIds` | `array` | Yes |   |

### create_clickhouse_role

*Create a ClickHouse role* — **Destructive** · on by default · needs any of `clickhouse:roles:create`

Create a role in ClickHouse itself (on the active connection) with structured grants. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `cluster` | `string` | No |   |
| `grants` | `array` | Yes |   |

### update_clickhouse_role

*Change a ClickHouse role's grants* — **Destructive** · on by default · needs any of `clickhouse:roles:update`

Replace the grants of a ClickHouse role on the active connection. Write tool: CHouse decides per call how it is checked — undoable changes run at once, others wait for the user's confirmation in CHouse, and high-risk ones go to a second approver. When a call returns a pending actionId, tell the user and check it later with get_action_status.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | Yes |   |
| `cluster` | `string` | No |   |
| `grants` | `array` | Yes |   |
