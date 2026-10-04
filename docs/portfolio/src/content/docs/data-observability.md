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
| **stale** | No write for longer than the table normally goes without one |

[Promises](/docs/data-health/) add explicit expectations on top — "loaded by 07:00", "no duplicate order ids" — when the learned baseline isn't enough.

## Grant the collector what it needs

The connection's ClickHouse user must be able to read the system tables above. Saving a connection never fails because of a missing grant; instead, **Admin › Connections › Edit › Check privileges** lists what is missing and the exact `GRANT` statements to run. A missing grant shows up as *unsupported* or missing evidence for the features that need it.

Collector health is shown as a chip on the Data page header. Settings that tune it (`OBSERVE_*`) are on [Environment variables](/docs/configuration-env/#data-observability).

## Permissions

| Tab | Needs any of |
| --- | --- |
| Overview, Lineage, Pipelines, Coverage, Context | `observe:view` |
| Incidents, Datasets | `observe:view`, `data_health:view` |
| Scheduled queries | `scheduled_queries:view` |

Changing things needs more: `observe:edit` (criticality, dismissing suggestions, pipeline incidents), `context:edit` (table context and metrics), `data_health:edit` (promises), and the `remediation:*` permissions for [fixes](/docs/data-incidents/#fixes-with-approval).
