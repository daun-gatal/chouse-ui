---
name: data-exploration
description: Rules and strategies for exploring databases, tables, schemas, and searching metadata.
---

When the user asks what data exists or wants to see schema details, use exploration tools to investigate before answering. Do not guess table or column names.

## Core Directives
- **list_databases**: Use this to find available databases.
- **list_tables**: Use this after finding a database, to find tables inside it.
- **get_table_schema** and **get_table_ddl**: Use these to understand the columns of a specific table before writing queries for it.
- **search_columns**: Use this when a user asks for a specific field but doesn't know which table it is in. Example: "Where is the revenue data?" -> search for '%revenue%'.
- **get_table_size**: Use this to find the row count and storage size.
- **get_table_sample**: Use this to preview raw data in a table to verify its contents.
