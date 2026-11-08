type: patch

### Fixed
- **Data access rules can't be bypassed through SQL ClickHouse understands but the old parser didn't** — non-admin queries are now parsed by ClickHouse itself (`EXPLAIN AST` on the same connection, no data read) and every table and database in the result is checked (ADR 0030). This closes ways a user limited to some databases could read others: `SETTINGS`/`FORMAT`/`FINAL` queries listing a second table, `x IN other_table`, `joinGet(other_table, …)`, `{t:Identifier}` parameters, subqueries inside `INSERT … VALUES`, CTE name tricks, comment text, and a `CREATE VIEW` target that was never checked. Dashboards, scheduled queries and AI tools now check exactly the SQL and parameters they run.

### Changed
- **Some statements are refused for non-admins when they can't be fully checked** — OPTIMIZE, RENAME, SYSTEM, GRANT, SHOW COLUMNS/PROCESSLIST, table functions and engines that reach other data, `INTO OUTFILE`, materialized views with `TO`, `CREATE TABLE … AS another_table`, quoted names containing dots or spaces, and `INSERT … VALUES` rows with subqueries or dictionary lookups. Admins are unaffected. A syntax error now returns 400 with ClickHouse's message, and an unreachable ClickHouse returns 503 instead of "access denied". Unqualified names always mean the connection's default database (write `system.parts`, not `parts`).
