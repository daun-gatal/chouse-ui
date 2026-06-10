---
name: data-exploration
description: Rules and strategies for exploring databases, tables, schemas, and searching metadata.
when_to_use: User asks what data exists, wants to browse databases/tables/columns or schema details, or doesn't know which table a field lives in.
---

## WHEN TO USE
The user wants to discover or understand the data model: which databases/tables
exist, what columns a table has, where a particular field lives, how big a table
is, or what the data looks like. Not for live server health (use
system-troubleshooting) or running a query the user already described (use
sql-generation).

## TOOLS TO RUN (in order)
1. `list_databases` — find available databases.
2. `list_tables` — tables inside a chosen database.
3. `get_table_schema` / `get_table_ddl` — columns + types (DDL also shows engine, keys, indexes) before reasoning about a table.
4. `search_columns` — when the user wants a field but doesn't know the table (e.g. "where is revenue?" → search `%revenue%`).
5. `get_table_size` — row count + on-disk size.
6. `get_table_sample` — preview the first rows to verify contents.
7. `get_database_info` — a database overview (table count + total size).

## RULES
- Never guess database, table, or column names — confirm via tools.
- Prefer the cheapest tool that answers the question (schema before a full sample).
- Summarize findings; don't dump huge raw outputs.