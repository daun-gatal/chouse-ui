---
generated: packages/server/src/services/ai/registry (catalog, harness) and seeds
---
Everything an agent in **Agents › Assistant** is built from that is defined in code: the 47 catalog tools, the built-in DeepAgents tools a harness can hide, and the 14 skills CHouse ships. How to use them is in [AI agents](/docs/ai-agents/), [Harnesses](/docs/ai-harnesses/) and [Skills](/docs/ai-skills/).

Every catalog tool is read-only; the server rejects an agent that grants anything else. **Context** is what the run must provide — a tool whose context a feature doesn't provide is left out of that feature's runs (see [contexts](/docs/ai-features/)). **Needs any of** applies to the CHouse tools: the chat user must hold one of the permissions or the tool isn't offered, and the API behind it still checks every call as that user. Results of CHouse tools are capped at 100 rows, 2 KB per cell and 60 KB in all, and secrets are redacted.

## ClickHouse tools

| Tool | Title | Context | Needs any of | What it does | Built-in agents |
| --- | --- | --- | --- | --- | --- |
| `list_databases` | List databases | ClickHouse session | — | List all available database names. Results are filtered by user permissions. | 4 |
| `list_tables` | List tables | ClickHouse session | — | List all tables in a specific database. Results are filtered by user permissions. | 4 |
| `get_table_schema` | Table schema | ClickHouse session | — | Get column names and types for a specific table. | 7 |
| `get_table_ddl` | Table DDL | ClickHouse session | — | Get the CREATE TABLE statement (DDL) for a specific table. Use this to understand table engines, sorting keys, partition keys, and index settings. | 7 |
| `get_table_size` | Table size | ClickHouse session | — | Get row count and disk size for a specific table. | 3 |
| `get_table_sample` | Sample rows | ClickHouse session | — | Get first 5 rows of a table to preview the data. | 3 |
| `run_select_query` | Run SELECT | ClickHouse session | — | Execute a read-only SELECT query. Only SELECT and WITH queries are allowed. LIMIT 100 is added automatically if the query has no LIMIT. Results limited to 100 rows. NEVER include a FORMAT clause — the application handles formatting internally. | 3 |
| `explain_query` | EXPLAIN a query | ClickHouse session | — | Get the EXPLAIN plan for a query to understand how ClickHouse will execute it. Useful for understanding index usage, partition pruning, and join strategies. NEVER include a FORMAT clause in the sql parameter. | 4 |
| `get_database_info` | Database overview | ClickHouse session | — | Get table count and total size for a specific database. | 3 |
| `get_running_queries` | Running queries | ClickHouse session | — | List currently running queries on the ClickHouse server. | 3 |
| `get_server_info` | Server info | ClickHouse session | — | Get ClickHouse server version and uptime. | 3 |
| `search_columns` | Search columns | ClickHouse session | — | Search for columns by name pattern across all accessible tables. | 3 |
| `analyze_query` | Analyze a query | ClickHouse session | — | Analyze a SQL query for complexity, performance characteristics, and get optimization recommendations. | 6 |
| `validate_sql` | Validate SQL | ClickHouse session | — | Check if a SQL string is valid syntax. Does not execute the query. Use when the user wants to check syntax or validate a query before running. | 4 |
| `export_query_result` | Export a result | ClickHouse session | — | Run a read-only SELECT query and return the result as a CSV or JSON string. Use when the user explicitly asks to export, download, or get data as CSV/JSON. Limited to 1000 rows. NEVER include a FORMAT clause in the sql — the format parameter controls output format instead. | 3 |
| `get_slow_queries` | Slow queries | ClickHouse session | — | List recently executed queries that were slow (by duration). Useful for troubleshooting and finding heavy queries. Non-admin users see only their own queries. | 3 |
| `render_chart` | Render a chart | ClickHouse session | — | MANDATORY: Use this whenever the user asks to visualize, chart, plot, graph, or show trends. Execute a SELECT query and return an interactive chart specification. Available chartType values: bar, horizontal_bar, grouped_bar, stacked_bar, line, multi_line, area, stacked_area, pie, donut, scatter, radar, treemap, funnel, histogram, heatmap. xAxis and yAxis can be omitted — they will be inferred from the query result columns. | 1 |
| `generate_query` | Draft SQL from a description | — | — | Generate a SQL query based on a natural language description. Use this after gathering schema information from other tools. After calling this, you MUST output the generated query in a `sql` code block. If the user wants the query executed, call run_select_query with that SQL. | 1 |
| `optimize_query` | Optimize a query (runs the optimize-query feature) | ClickHouse session | — | Get AI-powered optimization suggestions for a SQL query. | 1 |
| `run_bounded_aggregate` | Run a bounded aggregate | ClickHouse session | — | Run one read-only aggregate SELECT for a health recommendation. Raw-row SELECTs and SELECT * are rejected. | 1 |
| `query_node` | Query a node's system tables | Fleet nodes | — | Run ONE read-only SQL SELECT against a node's system.* tables to investigate (processes, replicas, merges, mutations, query_log, parts, asynchronous_metrics, …). Read-only: writes/DDL/KILL are rejected. Returns up to 100 rows. | 5 |

## CHouse tools

| Tool | Title | Context | Needs any of | What it does | Built-in agents |
| --- | --- | --- | --- | --- | --- |
| `whoami` | Who am I | Your CHouse access | — | The signed-in CHouse user: id, email, username, roles and effective permissions. | 3 |
| `list_users` | List users | Your CHouse access | `users:view` | List CHouse users with their roles and status. Optional search text and role filter. | 1 |
| `get_user` | Get a user | Your CHouse access | `users:view` | One CHouse user by id, with roles and permissions. | 1 |
| `list_roles` | List roles | Your CHouse access | `roles:view` | List CHouse roles with their permissions and user counts. | 1 |
| `get_role` | Get a role | Your CHouse access | `roles:view` | One CHouse role by id with its permission list. | 1 |
| `list_permissions` | Permission catalog | Your CHouse access | `roles:view` | Every CHouse permission grouped by category, with display names. | 1 |
| `list_data_access_policies` | Data access policies | Your CHouse access | `data_access:view` | Data access policies (which roles may read/write which databases and tables, per connection). | 1 |
| `list_my_access_tokens` | My access tokens | Your CHouse access | — | Your personal access tokens: name, scopes, expiry and last use (never the secret). | 1 |
| `list_clickhouse_users` | ClickHouse users | Your CHouse access | `clickhouse:users:view` | Users defined in ClickHouse itself on the active connection. | 1 |
| `list_clickhouse_roles` | ClickHouse roles | Your CHouse access | `clickhouse:roles:view` | Roles defined in ClickHouse itself on the active connection. | 1 |
| `get_sso_settings` | SSO settings | Your CHouse access | `sso:view` | Single sign-on settings and configured identity providers (secrets redacted). | 1 |
| `list_connections` | Connections | Your CHouse access | `connections:view` | ClickHouse connections registered in CHouse (host, port, status; never passwords). | 1 |
| `list_ai_models` | AI models | Your CHouse access | `ai_models:view` | Configured AI models and providers, which one is the default, and their runtime parameters (API keys redacted). | 1 |
| `audit_log` | Audit log | Your CHouse access | `audit:view` | Recent audit log entries, newest first. Filter by action (e.g. user.update), username or status. | 1 |
| `list_scheduled_jobs` | Scheduled jobs | Your CHouse access | `scheduled_queries:view` | Scheduled queries you can see: schedule, owner, last run status and next run. | 1 |
| `get_scheduled_job` | Scheduled job | Your CHouse access | `scheduled_queries:view` | One scheduled query by id with its definition. | 1 |
| `list_scheduled_runs` | Scheduled runs | Your CHouse access | `scheduled_queries:view` | Recent runs of one scheduled query: status, duration, rows, error. | 1 |
| `list_health_checks` | Data health promises | Your CHouse access | `data_health:view` | Data Health promises you can see with their current status. | 1 |
| `get_health_check` | Data health promise | Your CHouse access | `data_health:view` | One Data Health promise by id with its checks. | 1 |
| `list_health_incidents` | Data health incidents | Your CHouse access | `data_health:view` | Open and recent Data Health incidents you can see. | 1 |
| `list_alerting` | Alerting | Your CHouse access | `alerting:view` | Alert notification channels or alert rules (channel secrets redacted). | 1 |
| `list_observe_incidents` | Observability incidents | Your CHouse access | `observe:view` | Data observability incidents with their root-cause summaries. | 1 |
| `list_doctor_reports` | Doctor reports | Your CHouse access | `doctor:view` | Recent fleet Doctor reports: verdict, summary, model and when they ran. | 1 |
| `fleet_snapshots` | Fleet snapshot | Your CHouse access | `fleet:view` | Latest health snapshot of every ClickHouse node (memory, CPU, queries, replication). | 1 |
| `list_agent_sessions` | Agent sessions | Your CHouse access | `agents:view` | External agents (MCP / access tokens) active in the last N days: queries, bytes read, warnings, blocks. | 1 |
| `get_agent_governance` | Agent governance | Your CHouse access | `agents:view` | Agent budget policies or the MCP endpoint settings and enabled tools. | 1 |

## Built-in DeepAgents tools

DeepAgents gives every agent these tools on top of its catalog tools. A harness hides the ones its agents should not see — here is what each built-in harness keeps:

| Built-in tool | What it does | Focused | Delegating | Router |
| --- | --- | --- | --- | --- |
| `task` | Delegate work to a subagent. Required for agents with subagents. | hidden | ✓ | ✓ |
| `write_todos` | Plan multi-step work as a todo list. | hidden | hidden | hidden |
| `ls` | List files in the agent's virtual filesystem (skills live under /skills/). | hidden | hidden | hidden |
| `read_file` | Read a file — how the agent opens a skill's SKILL.md and reference files. | ✓ | ✓ | hidden |
| `glob` | Find files by pattern. | hidden | hidden | hidden |
| `grep` | Search file contents. | hidden | hidden | hidden |
| `write_file` | Write a scratch file in the run's in-memory filesystem (never to disk; skills stay read-only). | hidden | hidden | hidden |
| `edit_file` | Edit a scratch file in the run's in-memory filesystem. | hidden | hidden | hidden |
| `execute` | Run a shell command — only available with a sandbox backend; CHouse never provides one. | hidden | hidden | hidden |
| `start_async_task` | Start a remote async subagent (not used by CHouse). | hidden | hidden | hidden |
| `check_async_task` | Check a remote async subagent (not used by CHouse). | hidden | hidden | hidden |
| `update_async_task` | Update a remote async subagent (not used by CHouse). | hidden | hidden | hidden |
| `cancel_async_task` | Cancel a remote async subagent (not used by CHouse). | hidden | hidden | hidden |
| `list_async_tasks` | List remote async subagents (not used by CHouse). | hidden | hidden | hidden |

Agents run with an in-memory scratch filesystem that is discarded after the run; skills are mounted read-only under `/skills/`. Nothing an agent writes reaches disk.

## Built-in skills

| Skill | Path | Files | Use it for |
| --- | --- | --- | --- |
| `data-exploration` | `/skills/ai-chat/data-exploration/` | `SKILL.md` | Rules and strategies for exploring databases, tables, schemas, and searching metadata. |
| `data-visualization` | `/skills/ai-chat/data-visualization/` | `SKILL.md` | Complex rules for calling render_chart, inferring axes, and choosing chart types based on user intent. |
| `error-diagnosis` | `/skills/ai-chat/error-diagnosis/` | `SKILL.md` | Diagnose a ClickHouse server error (code/name/exception) and give a concrete, actionable fix. |
| `parts-diagnosis` | `/skills/ai-chat/parts-diagnosis/` | `SKILL.md` | Diagnose part/partition health of a MergeTree table — too many parts, slow/stuck merges, bad partition key. |
| `query-optimization` | `/skills/ai-chat/query-optimization/` | `SKILL.md` | Rules for using explain/analyze/optimize tools to help the user tune their queries. |
| `schema-diagnosis` | `/skills/ai-chat/schema-diagnosis/` | `SKILL.md` | Diagnose a column/table schema issue — Nullable overhead, oversized integer, or weak compression — and propose an ALTER. |
| `sql-generation` | `/skills/ai-chat/sql-generation/` | `SKILL.md` | Strict rules on outputting ClickHouse syntax, limiting rows, and rendering SQL in markdown. |
| `system-troubleshooting` | `/skills/ai-chat/system-troubleshooting/` | `SKILL.md` | Diagnose server-state issues using running queries, slow-query history, and server info. |
| `query-debugger` | `/skills/ai-optimizer/debugger/` | `SKILL.md` | Detailed instructions and rules for debugging and fixing failed ClickHouse SQL queries. Focuses on diagnosing syntax errors, type mismatches, and ClickHouse-specific issues using all available schema and query tools. |
| `query-evaluator` | `/skills/ai-optimizer/evaluator/` | `SKILL.md` | Lightweight rules for determining if a ClickHouse SQL query has obvious inefficiencies or if it is already optimal and should be skipped for optimization. |
| `query-optimizer` | `/skills/ai-optimizer/optimizer/` | `SKILL.md` | Detailed instructions and rules for optimizing ClickHouse SQL queries. Focuses on performance tuning, data pruning, and ClickHouse-specific strategies using all available schema and query tools. |
| `clickhouse-playbook` | `/skills/references/clickhouse-playbook/` | `SKILL.md`, `reference.md` | ClickHouse optimization and operational playbook with concrete patterns for query rewrites, MergeTree design, joins, PREWHERE, argMax, mutations, merges, and memory pressure. |
| `system-table-reference` | `/skills/references/system-table-reference/` | `SKILL.md`, `reference.md` | Exact ClickHouse system table and column reference for safe system.* diagnostics. |
| `types-codecs-compression` | `/skills/references/types-codecs-compression/` | `SKILL.md`, `reference.md` | ClickHouse type sizing, Nullable, LowCardinality, codec, compression, and column storage guidance. |
