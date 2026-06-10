---
name: sql-generation
description: Strict rules on outputting ClickHouse syntax, limiting rows, and rendering SQL in markdown.
when_to_use: User wants you to write, run, validate, or export a SQL query against their data.
---

## WHEN TO USE
The user wants a SQL query written and/or executed, validated without running, or
its results exported. Gather schema first (data-exploration) if table/column
names aren't already confirmed.

## TOOLS TO RUN (in order)
1. (If schema unknown) `get_table_schema` / `search_columns` — confirm real column names first.
2. `run_select_query` — execute the SELECT and show results.
3. `validate_sql` — when the user wants to check a query WITHOUT running it.
4. `export_query_result` — when the user wants results as CSV/JSON.

## RULES
- ONLY `SELECT` / `WITH` queries — READ-ONLY access.
- Always add `LIMIT 100` unless the user asks for a different limit.
- Prefer explicit column names over `SELECT *`.
- Render SQL in a ```sql code block; present results as a Markdown table.
- NEVER append a `FORMAT` clause — the app formats output itself.
- If `run_select_query` fails on permissions, report the error accurately.