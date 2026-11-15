type: minor

### Added
- **Reads are sent read-only** — CHouse UI now asks ClickHouse itself to refuse a write. Every read (`SELECT`, `SHOW`, `DESCRIBE`, `EXISTS`, `CHECK`, `EXPLAIN`) is sent with `readonly = 2`, for administrators too, and so is every statement from a person whose roles hold no write permission. Whether a statement is a read comes from ClickHouse's parse of it. Dashboard panels, notebook cells, scheduled queries and data health checks are read-only for everyone.
- **Assign a job to yourself** — a scheduled query with no owner shows **No owner** in the list and on its page, with an **Assign to me** action for people who can edit it.
- **The connection switcher names the ClickHouse user** — each connection shows "Shared login <user>": the ClickHouse user every statement on it runs as.

### Changed
- **System tables that show other people's work need a permission** — a typed read of `system.query_log`, `system.processes`, `system.text_log` and the other statement and session logs needs `query:history:view:all`; a read of `system.users`, `system.grants` and the other access tables needs `clickhouse:users:view`. Other system tables stay open. Without the permission, the Logs page still lists your own statements, and the parts of Monitoring that read these tables say which permission they need.
- **A job runs as whoever last changed what it does** — saving a change to a scheduled query's SQL, output or notification channels makes the saver its owner, and later runs are checked against that person's access. The same holds for a data health check, and for a dashboard's alerts and reports when someone changes a panel's SQL or the dashboard's variables. Existing jobs keep their creator as owner.
- **Ownership is read from the query id** — Live Queries, the Logs page, lineage, table usage and the AI tools that list your own queries read the CHouse account from the query id CHouse UI set. A statement that sets its own `log_comment` no longer changes who it is shown for, and cannot hide itself from CHouse UI's reports.
- **The fleet AI checks the SQL it writes** — statements the Doctor and the other fleet AI features write for a person are parsed by ClickHouse, may read only system tables, and follow the same permission rule for the statement logs.
- **Clearer messages when ClickHouse refuses** — a refused write reads "You may only read here", a missing ClickHouse grant names the grant, and neither is reported as a sign-in failure any more. A connection whose stored login ClickHouse rejects reports `CONNECTION_AUTH_FAILED` instead of signing you out.

### Fixed
- **Typed text could reach ClickHouse without the check it was shown** — the server now sends a typed statement only as the exact text, parameters, connection and account the access check approved.
