# Fleet view

The fleet view (`/fleet`, permission `fleet:view`) shows every configured [connection](/docs/explorer-connections/) side by side — one pane for the whole estate.

## The grid

Layouts: **grid** or **rows**. Each card polls its own connection independently, so a slow or down cluster never blocks the rest of the page.

Per card:

| Signal | Source |
| --- | --- |
| Status | healthy / degraded / down |
| Memory % | Server RAM usage |
| Active queries | Current running count |
| Longest-running | The oldest live query |
| Exceptions feed | Recent errors |
| Inventory strip | Databases/tables at a glance |
| Per-node trend sparklines | Memory/lag direction over recent polls |

## Drill-down

Click any card → that cluster's [monitoring](/docs/monitoring-overview/) with the connection pre-selected. Fleet is the map; monitoring is the street view.

## The fleet poller

A backend worker caches per-cluster metric snapshots to SQLite on a schedule:

- `FLEET_POLL_INTERVAL_SECONDS` (default `30`) — see [Environment variables](/docs/configuration-env/)
- **HA-safe**: a single-instance advisory lease ensures one poller does the work even with multiple replicas
- Toggle: `FLEET_POLLER_ENABLED`

Why it exists: without it, every open browser tab hammers every cluster. With it, the fleet page reads **one fast endpoint** backed by cached snapshots. Enable it in any multi-user deployment — see the [production checklist](/docs/production-checklist/).

## Who sees the fleet

`fleet:view` typically maps to admin-type roles. Regular users land on the [overview dashboard](/docs/workspace-overview/) of their assigned connection instead.

## Underlying data

| Table | Used for |
| --- | --- |
| `system.metrics` / `asynchronous_metrics` | Memory, status |
| `system.processes` | Active/longest queries |
| `system.errors` | Exceptions feed |
| `system.replicas` | Lag signals |

> **Tip:** Combine the fleet view with [threshold alerts](/docs/alerting/) — the grid is for humans browsing; alerts are for the pager.
