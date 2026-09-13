# Live queries

Live queries (`/monitoring/live-queries`, permission `live_queries:view`) shows what is running on the cluster *right now* — with the tools to intervene.

## What you see per running query

| Field | Notes |
| --- | --- |
| Duration | Wall-clock so far, sortable |
| Memory | Bytes used so far, sortable |
| Rows | Rows produced so far |
| CPU time + thread count | Where the query actually spends cycles |
| Query text | Full statement |

## Server-memory pressure strip

A strip puts per-query totals in context: resident memory and total memory as a percentage of server RAM. A query that looks big in isolation may be nothing on a 256 GB node — and vice versa. This is the same memory-pressure signal used in [query logs](/docs/monitoring-query-logs/).

## Sorting & triage

Default triage flow:

1. Sort by **duration** (find the long-runner) or **memory** (find the hog)
2. Check the pressure strip for how much the cluster cares
3. Inspect the statement — often the fix is obvious

## Killing queries

| Action | Permission | Effect |
| --- | --- | --- |
| Kill one query | `live_queries:kill` | Sends `KILL QUERY` for that query_id |
| Kill all | `live_queries:kill_all` | Sweep the running set (confirmation dialog) |

Every kill lands in the [audit log](/docs/audit-log/).

## Who is running what

The list reflects all ClickHouse activity, not just CHouse UI queries — cron jobs, BI tools, anything connected to the server. To attribute load back to dashboards, use the [By Redash](/docs/monitoring-query-logs/) sub-view; for pattern-level cost, use [Patterns](/docs/monitoring-query-logs/).

> **Tip:** For a standing rule ("kill anything over 10 min"), configure a long-running-query [alert](/docs/alerting/) and let the fleet watch it — humans kill only what alerts escalate.
