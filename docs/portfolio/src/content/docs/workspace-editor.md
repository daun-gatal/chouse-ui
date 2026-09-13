# SQL editor

The workspace editor is a Monaco-based SQL editor with schema-aware completion, per-query execution statistics and full history. Requires `query:execute`; DDL/DML need the extra `query:execute:ddl` / `query:execute:dml` grants.

## Editing

- **Monaco editor** — the VS Code editing experience: syntax highlighting, bracket matching, multi-cursor
- **Schema-aware autocomplete** — tables and columns from the active connection's schema
- **Formatter-friendly** — run the whole editor or the current selection

## Running queries

- Execute runs through the server proxy: JWT → RBAC → SQL parse → [data access rules](/docs/data-access-rules/) → ClickHouse
- **Per-query execution statistics** accompany each result: duration, rows read/written, bytes
- Results render in a dense grid; export via the [download dialog](/docs/explorer-export/)

## Visual EXPLAIN

Before running, ask the planner what it will do — see [Visual EXPLAIN](/docs/workspace-explain/) for the estimate view and popout.

## Result handling

| Need | Tool |
| --- | --- |
| Keep the query | [Saved queries](/docs/workspace-saved-queries/) |
| Re-run later on a schedule | [Scheduled queries](/docs/scheduled-queries/) |
| Get the data out | [Exports](/docs/explorer-export/) |
| Debug a failure | [Visual EXPLAIN](/docs/workspace-explain/) + error diagnosis |

## History

Every execution is recorded:

- **Own history** — `query:history:view`
- **Everyone's history** — `query:history:view:all` (admin/debugging use)
- History entries link back into the editor for re-running

All activity lands in the [audit log](/docs/audit-log/).

## Keyboard workflow

The editor pairs with global shortcuts — `Cmd/Ctrl+K` opens the [command palette](/docs/workspace-command-palette/) to jump between databases, tables and saved queries without leaving the keyboard.

> **Tip:** DDL by hand is fine, but for repeated schema work prefer the [structured table editor](/docs/explorer-databases/) — it generates and shows the DDL for you.
