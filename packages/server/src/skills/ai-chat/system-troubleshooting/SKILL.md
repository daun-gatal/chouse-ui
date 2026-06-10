---
name: system-troubleshooting
description: Diagnose server-state issues using running queries, slow-query history, and server info.
when_to_use: User reports lag, a stuck/slow server, high memory, or asks about current server health, running queries, or recent heavy/slow queries.
---

## WHEN TO USE
The user is asking about the live state of the ClickHouse server: it feels slow,
queries are stuck, memory looks high, or they want to know what's running now or
what ran heavy recently. Do NOT use this to optimize a specific SQL they gave you
(use query-optimization), or for storage/schema questions (use schema-diagnosis).

## TOOLS TO RUN (in order)
1. `get_server_info` — version + uptime context first.
2. `get_running_queries` — what's executing NOW (elapsed seconds, memory). Use for "stuck"/"slow right now".
3. `get_slow_queries` — recently FINISHED heavy/slow queries from system.query_log. Use for "what was slow earlier".
4. `run_select_query` against `system.metrics` / `system.asynchronous_metrics` — only when you need a specific live metric value.

## REFERENCES TO LOAD
- `load_reference` "system-table-reference" — BEFORE writing any raw `system.*` SELECT, so you use exact column names (e.g. system.errors has `last_error_time`, not event_time).

## RULES
- Summarize the longest-running queries; never dump massive JSON blobs.
- Flag any single query whose peak memory is a large share of server memory.
- READ-ONLY: only SELECT/SHOW/DESCRIBE/EXPLAIN. Never append a `FORMAT` clause.