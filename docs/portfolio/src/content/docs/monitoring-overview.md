---
app: Monitoring
route: /monitoring
---
# Monitoring overview

**Monitoring** (`/monitoring/<tab>`) shows what your ClickHouse servers are doing, read straight from their `system.*` tables through the CHouse UI server — no exporter or agent needed. Each tab needs its own permission, so a role can open some and not others.

## The tabs

| Tab | Route | Needs | Answers |
| --- | --- | --- | --- |
| [Live queries](/docs/monitoring-live-queries/) | `/monitoring/live-queries` | `live_queries:view` | What is running right now, and can I stop it? |
| [Query logs](/docs/monitoring-query-logs/) | `/monitoring/logs` | `logs:view` | What ran, how long it took, what it cost |
| [Metrics](/docs/monitoring-metrics/) | `/monitoring/metrics` | `metrics:view` (`metrics:view:advanced` for the deeper views) | How the server is doing over time |
| [Parts](/docs/monitoring-parts/) | `/monitoring/parts` | `parts:view` | Merges, mutations and part movements |
| [Schema advisor](/docs/monitoring-schema-advisor/) | `/monitoring/schema` | `schema_advisor:view` | Which columns waste disk |
| [Cluster](/docs/monitoring-cluster-activity/) | `/monitoring/cluster` | `cluster:view` | Replication, mutations, topology, insert backlog and DDL |
| [Errors](/docs/monitoring-errors/) | `/monitoring/errors` | `errors:view` | Recurring server errors and crashes |
| [Performance](/docs/monitoring-performance/) | `/monitoring/performance` | `performance:view` | Which query shapes got slower, and what changed |
| [Capacity](/docs/monitoring-capacity/) | `/monitoring/capacity` | `capacity:view` | When disks fill up, what to reclaim, what reads cost |
| [Upgrades](/docs/monitoring-upgrades/) | `/monitoring/upgrades` | `upgrades:view` | Whether an upgrade is safe for your workload |

The first seven read system tables live. Performance, Capacity and Upgrades read the evidence the [collector](/docs/data-observability/#the-collector) stored, so they show history even for things ClickHouse has already rotated out.

Tabs the user lacks permission for simply don't appear — the tab strip is [RBAC](/docs/permissions/)-driven.

## Shared controls

- **Time range** — 15 m / 1 h / 6 h / 24 h presets plus a Grafana-style drill-down calendar (day → month → year) in one popover
- **Connection context** — every tab reads the active [connection](/docs/connections/)
- **Chouse AI hooks** — with `ai:optimize`, rows in logs/errors/parts expose Optimize / Fix / Diagnose actions (see [Chouse AI in-tab](/docs/ai-in-tab/))

## System tables behind the suite

| Table | Used by |
| --- | --- |
| `system.query_log` | Query logs (all sub-views), timeline chart |
| `system.query_views_log` | Views-triggered drill-down |
| `system.part_log` | Parts |
| `system.parts_columns` | Schema advisor |
| `system.mutations`, `system.replication_queue`, `system.replicas` | Cluster activity |
| `system.metrics`, `system.events`, `system.asynchronous_metrics` | Metrics tabs |
| `system.errors`, crash log | Errors |
| Stored evidence (`query_log`, `system.disks`, `part_log`, versions and settings over time) | Performance, Capacity, Upgrades |

## Deployment requirements

- The connection user must be able to read `system.*`
- `query_log` must be enabled (default on most installs)
- Version caveats on the [compatibility page](/docs/compatibility/)

## Not here, but related

- **Multi-cluster at a glance** → [Fleet view](/docs/fleet/)
- **Automated diagnosis** → [Doctor](/docs/doctor/)
- **Page someone when it breaks** → [Alerting](/docs/alerting/)
