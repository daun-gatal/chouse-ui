# What's new in 3.18

3.18 changes how CHouse UI talks to ClickHouse: one server module now sends every statement, and each statement says which CHouse account or background purpose it is for. It is the first step of a larger change to how a statement gets its ClickHouse identity ([ADR 0033](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0033-every-statement-gets-a-clickhouse-identity.md)).

## Highlights

**See which account ran a statement** — Every request to ClickHouse carries a query id of the form `chouse:p:<account id>:<random>`, or `chouse:s:<purpose>:<random>` for background work, and, on servers that accept it, a quota key with the same account or purpose. A ClickHouse administrator can read the account straight from `system.query_log`, and can create a keyed quota to limit each CHouse account separately. A statement cannot change its own query id. → [Who a statement runs as](/docs/security/#who-a-statement-runs-as)

**`EXECUTE AS` is refused, for administrators too** — CHouse UI decides which ClickHouse user a statement runs as. The check reads ClickHouse's own parse, so a comment or a wrapper cannot hide the keyword. To make this possible, statements typed by administrators are now parsed by ClickHouse before they run, like everyone else's. → [Who a statement runs as](/docs/security/#who-a-statement-runs-as)

**Reads are sent read-only** — CHouse UI now asks ClickHouse itself to refuse a write. Every read is sent with `readonly = 2`, for administrators too, and so is every statement from a person whose roles hold no write permission. Whether a statement is a read comes from ClickHouse's parse of it, so a mistake in CHouse UI's own check cannot turn a read into a write. → [Reads are sent read-only](/docs/security/#reads-are-sent-read-only)

**System tables that show other people's work need a permission** — Reading `system.query_log`, `system.processes` and the other statement logs needs `query:history:view:all`; reading `system.users`, `system.grants` and the other access tables needs `clickhouse:users:view`. Everyone still sees their own statements on the Logs page. → [System tables that show other people's work](/docs/data-access-rules/#system-tables-that-show-other-peoples-work)

**A job runs as whoever last changed what it does** — A scheduled query or data health check with no owner used to run with no access check. It now fails with a message that says why, shows **No owner**, and offers **Assign to me**. Saving a change to a job's SQL, output or channels makes you its owner, so nobody's job runs a statement someone else wrote under their name. → [Who a job runs as](/docs/scheduled-queries/#who-a-job-runs-as)

## Upgrading from 3.17

The RBAC database gains one column (`scheduled_queries.owner_id`, filled from each job's creator). It is added automatically at start-up. Check these:

| What changed | What to do |
| --- | --- |
| Query ids in `system.query_log` and `system.processes` now look like `chouse:p:<account id>:<random>` | If a script or alert of yours matches CHouse query ids by their old shape (a bare UUID, or the `chouse-ai-` prefix), update it. The AI id is now the last part: `chouse:p:<account id>:chouse-ai-<request id>-<n>` |
| A typed `KILL QUERY` needs `live_queries:kill_all` | Give that permission to roles that should stop other people's queries from the SQL editor. `live_queries:kill` still stops your own queries from Live Queries and the editor's Stop button |
| Statements typed by administrators are parsed by ClickHouse first | Nothing to do. An administrator's statement is refused when ClickHouse cannot parse it, or when the connection cannot be reached to parse it |
| `EXECUTE AS` is refused in every typed statement | Nothing to do unless someone relied on it; run such statements with a ClickHouse client instead |
| A scheduled job with no owner fails instead of running | Open the job and choose **Assign to me**, or save a change to it. The job list marks these jobs **No owner**, and failed runs say when this is the reason |
| Saving a change to a job's SQL, output or channels makes the saver its owner | Nothing to do. Expect the owner shown on a job to change after someone else edits it; the next run is checked against the new owner's access |
| A typed read of the statement logs (`system.query_log`, `system.processes`, `system.text_log`, …) needs `query:history:view:all`, and of the access tables (`system.users`, `system.grants`, …) needs `clickhouse:users:view` | Give the permission to roles whose saved queries, dashboard panels, scheduled queries or agents read these tables. The built-in `admin` and `super_admin` roles are not affected. A panel or job that reads them for someone without the permission now fails with a message naming it |
| Reads are sent with `readonly = 2` | Nothing to do for most installs. A statement CHouse UI used to send as a read that in fact writes is now refused by ClickHouse (error 164). A connection whose ClickHouse login has `readonly = 2` keeps working |
| Ownership in Live Queries, Logs, lineage and usage is read from the query id | Nothing to do. Statements logged before the upgrade are still attributed from `log_comment` |
| Every request sends an `X-ClickHouse-Quota` header, on servers that accept it (24.8 and 26.5 do; 23.8 does not and gets none) | Nothing to do. It has an effect only if you create a ClickHouse quota `KEYED BY client_key` |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
