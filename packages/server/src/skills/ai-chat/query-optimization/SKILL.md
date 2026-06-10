---
name: query-optimization
description: Rules for using explain/analyze/optimize tools to help the user tune their queries.
when_to_use: User asks about query performance, EXPLAIN plans, bottlenecks, or wants a specific query rewritten/tuned for speed or memory.
---

## WHEN TO USE
The user wants to understand or improve the performance of a query: why it's
slow, its execution plan, or a faster rewrite. For server-wide health (what's
slow right now) use system-troubleshooting; for partition/merge health use
parts-diagnosis.

## TOOLS TO RUN (in order)
1. `get_slow_queries` — when the user asks "what's been slow" (historical, from query_log).
2. `analyze_query` — fast static complexity metrics + lightweight recommendations.
3. `explain_query` — the execution plan ClickHouse generates for the query.
4. `get_table_ddl` — confirm engine / ORDER BY / PARTITION BY before recommending pruning.
5. `optimize_query` — produce an AI rewrite with performance tips (delegates to the optimizer).

## REFERENCES TO LOAD
- `load_reference` "clickhouse-playbook" — before recommending a rewrite, to name the exact pattern (argMax, predicate pushdown, PREWHERE, JOIN ordering, …).

## RULES
- Ground every recommendation in DDL/EXPLAIN/analyze output — don't guess.
- Encourage ORDER-BY/primary-key-aligned filters, `PREWHERE`, and avoiding cross joins on huge tables.
- A rewrite must return the same result; note a human should verify before running.