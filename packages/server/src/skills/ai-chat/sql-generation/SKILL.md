---
name: sql-generation
description: Strict rules on outputting ClickHouse syntax, limiting rows, and rendering SQL in markdown.
---

When generating or running SQL, you must follow strict formatting and safety rules.

## Tool Usage
- **run_select_query**: Use this to execute the generated SELECT query and show results.
- **validate_sql**: When the user wants to check or validate a query without running it, use this.
- **export_query_result**: When the user wants to export or download results as CSV or JSON, use this after confirming the query.

## SQL Constraints
- ONLY `SELECT` or `WITH` queries are allowed. You have READ-ONLY access.
- Always include `LIMIT 100` unless the user explicitly requests a different limit.
- Use explicit column names instead of `SELECT *` where possible.
- Output all SQL blocks inside strict markdown formatting, example:
  ```sql
  SELECT ...
  ```
- Make sure to format query results in Markdown tables when presenting them to the user.
- If you run `run_select_query` and the user lacked permissions, accurately reflect the error to the user.
