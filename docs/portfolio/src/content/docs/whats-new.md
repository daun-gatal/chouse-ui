# What's new in 3.18

3.18 changes how CHouse UI talks to ClickHouse: one server module now sends every statement, and each statement says which CHouse account or background purpose it is for. It is the first step of a larger change to how a statement gets its ClickHouse identity ([ADR 0033](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0033-every-statement-gets-a-clickhouse-identity.md)).

## Highlights

**See which account ran a statement** — Every request to ClickHouse carries a query id of the form `chouse:p:<account id>:<random>`, or `chouse:s:<purpose>:<random>` for background work, and a quota key with the same account or purpose. A ClickHouse administrator can read the account straight from `system.query_log`, and can create a keyed quota to limit each CHouse account separately. A statement cannot change its own query id. → [Who a statement runs as](/docs/security/#who-a-statement-runs-as)

**`EXECUTE AS` is refused, for administrators too** — CHouse UI decides which ClickHouse user a statement runs as. The check reads ClickHouse's own parse, so a comment or a wrapper cannot hide the keyword. To make this possible, statements typed by administrators are now parsed by ClickHouse before they run, like everyone else's. → [Who a statement runs as](/docs/security/#who-a-statement-runs-as)

**Scheduled jobs need an owner** — A scheduled query or data health check whose owner no longer exists used to run with no access check. It now fails with a message that says why, and saving the job makes the person who saved it the owner. → [Who a job runs as](/docs/scheduled-queries/#who-a-job-runs-as)

## Upgrading from 3.17

There is no migration in this release. Check these:

| What changed | What to do |
| --- | --- |
| Query ids in `system.query_log` and `system.processes` now look like `chouse:p:<account id>:<random>` | If a script or alert of yours matches CHouse query ids by their old shape (a bare UUID, or the `chouse-ai-` prefix), update it. The AI id is now the last part: `chouse:p:<account id>:chouse-ai-<request id>-<n>` |
| A typed `KILL QUERY` needs `live_queries:kill_all` | Give that permission to roles that should stop other people's queries from the SQL editor. `live_queries:kill` still stops your own queries from Live Queries and the editor's Stop button |
| Statements typed by administrators are parsed by ClickHouse first | Nothing to do. An administrator's statement is refused when ClickHouse cannot parse it, or when the connection cannot be reached to parse it |
| `EXECUTE AS` is refused in every typed statement | Nothing to do unless someone relied on it; run such statements with a ClickHouse client instead |
| A scheduled job with no owner fails instead of running | Open the job as someone who can see every job and save it: saving a job that has no owner makes you its owner. Failed runs say when this is the reason |
| Every request sends an `X-ClickHouse-Quota` header | Nothing to do. It has an effect only if you create a ClickHouse quota `KEYED BY client_key` |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
