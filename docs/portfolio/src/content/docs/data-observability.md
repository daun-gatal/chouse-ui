---
app: Data
route: /data
permissions: observe:view, data_health:view, scheduled_queries:view
---
# How data is watched

The **Data** page answers one question for every table on the active connection: *is the data right, right now?* This page explains where its answers come from. Each tab has its own page: [Overview](/docs/data-overview/), [Incidents](/docs/data-incidents/), [Lineage](/docs/data-lineage/), [Pipelines](/docs/data-pipelines/), [Datasets & promises](/docs/data-health/), [Coverage](/docs/data-coverage/), [Context](/docs/data-context/) and [Scheduled queries](/docs/scheduled-queries/).

Data replaced the DataOps page in 3.14; old `/dataops/*` links redirect.

## The collector

A collector runs inside every CHouse UI server pod. On a schedule it reads ClickHouse's own metadata for each connection and stores what it learns — the **evidence** — in the RBAC database:

| Collector | Reads | Feeds |
| --- | --- | --- |
| Catalog & tables | `system.tables`, `system.columns`, `system.parts`, `system.part_log` | Freshness, volume, schema history |
| Usage & queries | `system.query_log` | Criticality, read patterns, lineage from `INSERT … SELECT`, performance baselines |
| Pipelines | Engine-specific system tables (Kafka, S3Queue, views, …) | [Pipeline status](/docs/data-pipelines/) |
| Changes & capacity | Settings, versions, DDL, `system.disks` | Change timeline, [capacity forecasts](/docs/monitoring-capacity/) |
| Profiles | A 0.1% sample of critical tables | Column distribution drift |
| Fleet | `system.metrics`, `system.processes`, … | [Fleet](/docs/fleet/) and alerts |

It never runs `SELECT *` over your data; only the profiler reads table rows, and only a small sample of the tables that matter most. A lease per connection and collector means each piece of work runs on one pod at a time, however many replicas you run.

Evidence queries respect [data access rules](/docs/data-access-rules/): a table you can't read never appears, not even as a lineage node or inside someone else's query text.

## What every table gets, from day one

Without any setup, each table learns:

- **Freshness** — its normal gap between writes (p50 and p99), so *stale* means stale **for this table**.
- **Volume** — an hourly band of rows written; an hour well outside it marks the table *degraded*.
- **Criticality** — *critical*, *important* or *normal*, from how much it is actually read. Pin it by hand on the table's detail view (needs `observe:edit`).

Each table has a **trust state**:

| State | Meaning |
| --- | --- |
| **learning** | Not enough history yet to judge |
| **trusted** | Writes and volume are within the learned baseline |
| **degraded** | Volume is outside the learned band |
| **stale** | No write for longer than the table normally goes without one, outside its usual quiet hours |

A table written by a [scheduled query](/docs/scheduled-queries/) or a refreshable view follows that job instead. It is *stale* only when the job is failing or overdue. A run that succeeded with nothing new to write leaves the table *trusted*, and so does a paused job. Several parts written by one insert count as one write, and a quiet night or weekend that the table has already gone through this week is not *stale*.

[Promises](/docs/data-health/) add explicit expectations on top — "loaded by 07:00", "no duplicate order ids" — when the learned baseline isn't enough.

## Grant the collector what it needs

The connection's ClickHouse user must be able to read the system tables above. A connection is only saved once its user can, and **Admin › Connections › Edit › Test connection** lists anything missing with the exact `GRANT` statements to run — see [ClickHouse privileges](/docs/connection-privileges/). If a grant is revoked later, it shows up as *unsupported* or missing evidence for the features that need it.

Collector health is shown as a chip on the Data page header. Settings that tune it (`OBSERVE_*`) are on [Environment variables](/docs/configuration-env/#data-observability).

## How often it runs

Each collector has a built-in interval:

| Collector | Built-in interval | Fastest allowed |
| --- | --- | --- |
| Fleet health | 30 s (`OBSERVE_FLEET_INTERVAL`) | 10 s |
| Pipelines | 1 min | 30 s |
| Catalog, Table baselines, Observed lineage, Changes | 5 min | 1 min |
| Usage, Query performance, Capacity, Column profiles | 15 min | 5 min |

Every collector can run as slowly as once a day. Change the intervals in **Admin › Connections › Collection schedule**, for every connection or for one — see [Collection schedule](/docs/connections/#collection-schedule). The schedule shows what each collector read on its last run and what that adds up to per day, so you can see where the load comes from before you change anything. A slower interval means slower answers: a stale table is noticed later, a new reader appears later.

The collectors that read `system.query_log` and `system.part_log` read only the rows written since their last run. Usage keeps 30 days of query shapes as daily rollups in the RBAC database instead of scanning 30 days of `query_log` on every run; after an install or upgrade it reads the newest 3 days first and fills in the older days 3 days per run. Two numbers it keeps are approximate: a query shape's distinct users (the largest daily count) and its p95 duration (the run-weighted average of daily p95s).

## Permissions

| Tab | Needs any of |
| --- | --- |
| Overview, Lineage, Pipelines, Coverage, Context | `observe:view` |
| Incidents, Datasets | `observe:view`, `data_health:view` |
| Scheduled queries | `scheduled_queries:view` |

Changing things needs more: `observe:edit` (criticality, dismissing suggestions, pipeline incidents), `context:edit` (table context and metrics), `data_health:edit` (promises), and the `remediation:*` permissions for [fixes](/docs/data-incidents/#fixes-with-approval).
