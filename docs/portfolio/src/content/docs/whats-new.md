# What's new in 3.15

3.15 makes data observability much cheaper to run on busy clusters, and lets you decide how often it reads each one.

## Highlights

**Collection schedule** — **Admin › Connections › Collection schedule** sets how often each observability collector runs, for every connection, and a connection's **Edit** dialog can set its own. Pause a collector you don't need; a paused one is named on the Data page so its stale pages are no surprise. Each collector shows what its last run read and what that adds up to per day at the interval you pick, so you can see where the load comes from before changing anything. Changes apply within seconds on every server. → [Collection schedule](/docs/connections/#collection-schedule)

**Lighter collection** — The *Usage* collector no longer scans 30 days of `system.query_log` — including every query's text — on every run: it reads only the rows since its last run and keeps daily rollups. On the lab clusters that scan was about 88% of everything collection read from ClickHouse, and it grew with every query the cluster ran. *Table baselines* reads only new `system.part_log` rows for write cadence. → [How often it runs](/docs/data-observability/#how-often-it-runs)

## Upgrading from 3.14

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| Usage rebuilds its 30 days of query shapes from the newest days back, 3 days per run | Nothing to do. Filter columns and query patterns come back on the first run and are complete after about 2½ hours |
| `OBSERVE_FLEET_INTERVAL` now sets only the built-in fleet interval | Nothing to do; an interval set in **Collection schedule** wins over it |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
