type: patch

### Fixed
- **Monitoring table lists follow data access rules** — on Metrics, the largest tables, replication and parts pressure lists (and the same lists in the production overview) now show only the tables the signed-in user can read. Admins still see every table.
- **Mutation impact simulator checks data access** — the simulator now applies the user's data access rules to the table and to anything its predicate reads, the same way the SQL editor checks a query.
- **Notebook query cells keep their rows to permitted readers** — a query cell's saved rows are shown only to readers whose own data access rules allow that query. Other readers see the SQL and a note that the rows are withheld, in the notebook and in its Markdown export.
- **Sample error messages on Metrics** — sample error text is shown only to admins and holders of `query:history:view:all`; everyone else still sees the error counts.
- **AI tools list only your own queries** — for non-admins, the running-queries and slow-queries tools now return only queries run by the same CHouse account.
- **Stopping a query needs a confirmed owner** — without `live_queries:kill_all`, a query whose owner can't be confirmed is no longer stopped.
