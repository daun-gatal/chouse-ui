---
name: query-optimization
description: Rules for using explain/analyze/optimize tools to help the user tune their queries.
---

When the user wants to understand query performance, find bottlenecks, or rewrite queries for speed, you should:

- **get_slow_queries**: Use this to list recently executed slow queries from query_log when the user asks about slow queries, heavy queries, or what's been running slow.
- **analyze_query**: Use this to get general complexity metrics and lightweight recommendations.
- **explain_query**: Use this to see the execution plan ClickHouse generates for a query.
- **optimize_query**: Use this powerful tool to get an AI-generated rewritten SQL query with performance tips.

## Optimization Advice
If discussing query performance with the user, encourage them to define clear partition keys, push filters into `PREWHERE`, and avoid cross joins against massive tables.
