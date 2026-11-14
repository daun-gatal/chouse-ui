type: minor

### Added
- **Every ClickHouse statement names its account** — each request CHouse UI sends now carries a query id of the form `chouse:p:<account id>:<random>` (or `chouse:s:<purpose>:<random>` for background work) and a quota key with the same account or purpose. A ClickHouse administrator can read the account from `system.query_log`, and a ClickHouse quota `KEYED BY client_key` now counts each CHouse account separately.

### Changed
- **One module sends every statement** — all server code now reaches ClickHouse through a single executor that requires a person or a named background purpose for each request. A CI check fails when any other file imports the ClickHouse client. The design is ADR 0033.
- **`EXECUTE AS` is refused for everyone** — a typed statement that contains `EXECUTE AS` anywhere in ClickHouse's parse of it is not run, for administrators too.
- **Administrators' statements are parsed first** — a statement typed by an admin is parsed by ClickHouse before it runs. Permission and data access checks are still skipped for admins, but a statement ClickHouse cannot parse, or cannot parse right now, is refused.
- **Typed `KILL QUERY` needs `live_queries:kill_all`** — it can target anyone's query. `live_queries:kill` still stops your own queries from Live Queries and the editor's Stop button.
- **Scheduled jobs need an owner** — a scheduled query or data health check with no owner no longer runs; its runs fail with the reason. Saving such a job makes the person who saved it the owner.
- **Query id format** — ids CHouse UI sets are no longer bare UUIDs. AI queries are `chouse:p:<account id>:chouse-ai-<request id>-<n>`.
