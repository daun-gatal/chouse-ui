---
name: error-diagnosis
description: Diagnose a ClickHouse server error (code/name/exception) and give a concrete, actionable fix.
when_to_use: User pastes or asks about a ClickHouse error, exception, or error code (e.g. TOO_MANY_PARTS, MEMORY_LIMIT_EXCEEDED) and wants the cause + fix.
---

## WHEN TO USE
The user reports or pastes a ClickHouse error and wants to know what it means,
why it's happening, and how to fix it. Investigate read-only, then give a
concrete solution — not generic advice.

## TOOLS TO RUN (in order)
1. `run_select_query` against `system.errors` — confirm the error and its count/last message: `SELECT name, code, value, last_error_time, last_error_message FROM system.errors WHERE name = '<NAME>' OR code = <CODE> ORDER BY last_error_time DESC`. (Never ORDER BY event_time — no such column.)
2. `run_select_query` to find the underlying cause, matched to the error family:
   - TOO_MANY_PARTS / merge pressure → `system.parts` (GROUP BY partition), `system.merges`, `system.mutations`.
   - MEMORY_LIMIT_EXCEEDED → `system.metrics` / `system.asynchronous_metrics`, and `get_slow_queries` for the offending query shape.
   - Replication → `system.replicas` (absolute_delay, is_readonly, queue_size).
   - Disk full → `system.disks` (free_space).
3. `get_server_info` — version context if the error is version-specific.

## REFERENCES TO LOAD
- `load_reference` "system-table-reference" — BEFORE any raw `system.*` SELECT (exact column names).
- `load_reference` "clickhouse-playbook" — when the fix implies a query/schema change.

## RULES
- Stay FAST: a few cheap lookups, then answer. Don't run heavy `system.query_log` scans.
- Make every solution ClickHouse-specific and actionable — the exact setting, command, or SQL to run.
- READ-ONLY: only SELECT/SHOW/DESCRIBE. Never append a `FORMAT` clause. A human applies any fix.