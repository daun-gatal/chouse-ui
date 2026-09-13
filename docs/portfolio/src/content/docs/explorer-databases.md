# Databases & tables

The Explorer (`/explorer`, requires explorer access) is the tree-view home for schema work: inspect structure, create/drop databases, and manage tables across MergeTree engine families.

## Database tree

- Databases expand to their tables; each table expands to columns
- Schema inspection shows column types, defaults and codecs where available
- The tree reflects the active [connection](/docs/explorer-connections/) and your [data access rules](/docs/data-access-rules/) — hidden databases simply don't appear

## Database operations

| Action | Permission | Notes |
| --- | --- | --- |
| Create database | `database:create` | Engine `Atomic` by default |
| Drop database | `database:drop` | Confirmation dialog; drops everything inside |

## Table management

| Action | Permission | Notes |
| --- | --- | --- |
| Create table | `table:create` | Editor for columns, order/granularity, engines |
| Alter table | `table:alter` | Add/modify columns, settings |
| Drop table | `table:drop` | Confirmation dialog |
| Select data | `table:select` | Opens a preview/sample |

### Engines

Supported across the MergeTree family and friends:

- `MergeTree`, `ReplacingMergeTree`, `SummingMergeTree`, `AggregatingMergeTree`, `CollapsingMergeTree`, `VersionedCollapsingMergeTree`, `GraphiteMergeTree`
- `Replicated*` variants (with ZooKeeper/Keeper path + replica name params)
- `Distributed`, `Log`, `TinyLog`, `StripeLog`, external wrappers where ClickHouse supports them

Partition key, ORDER BY and settings are exposed in the create/alter editor — the generated DDL is always shown before execution.

## Preview & sample data

Click a table to sample rows with pagination — bounded, paginated reads rather than full scans. From the preview you can jump into the [SQL editor](/docs/workspace-editor/) or [export](/docs/explorer-export/) the sample.

## Upload

Existing tables accept file loads — CSV, TSV and JSON. See [Upload & preview](/docs/explorer-upload/).

## Guardrails

- Every DDL/DML goes through the [security pipeline](/docs/security/) (parse → RBAC → data access rules)
- Destructive actions (drop database/table) require explicit confirmation
- `query:execute:ddl` gates DDL beyond the explorer's structured flows
