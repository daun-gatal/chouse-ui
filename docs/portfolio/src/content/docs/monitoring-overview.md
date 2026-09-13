# Monitoring overview

Monitoring is CHouse UI's ClickHouse-native observability suite at `/monitoring/:tab` — no exporter required; everything reads `system.*` tables directly through the server proxy.

## The seven tabs

| Tab | Permission | Answers |
| --- | --- | --- |
| [Query logs](/docs/monitoring-query-logs/) | `logs:view` | What ran, how long, how expensive |
| [Metrics](/docs/monitoring-metrics/) | `metrics:view` (+`:advanced` for deeper tabs) | Server health over time |
| [Live queries](/docs/monitoring-live-queries/) | `live_queries:view` | What is running right now |
| [Parts](/docs/monitoring-parts/) | `parts:view` | Merge/mutation pressure on parts |
| [Schema advisor](/docs/monitoring-schema-advisor/) | `schema_advisor:view` | Which columns waste disk |
| [Cluster activity](/docs/monitoring-cluster-activity/) | `cluster:view` | Mutations, replication, replica lag |
| [Errors](/docs/monitoring-errors/) | `errors:view` | Recurring server-side failures |

Tabs the user lacks permission for simply don't appear — the tab strip is [RBAC](/docs/permissions/)-driven.

## Shared controls

- **Time range** — 15 m / 1 h / 6 h / 24 h presets plus a Grafana-style drill-down calendar (day → month → year) in one popover
- **Connection context** — every tab reads the active [connection](/docs/explorer-connections/)
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

## Deployment requirements

- The connection user must be able to read `system.*`
- `query_log` must be enabled (default on most installs)
- Version caveats on the [compatibility page](/docs/compatibility/)

## Not here, but related

- **Multi-cluster at a glance** → [Fleet view](/docs/fleet-view/)
- **Automated diagnosis** → [Fleet Doctor](/docs/ai-fleet-doctor/)
- **Page someone when it breaks** → [Alerting](/docs/alerting/)
