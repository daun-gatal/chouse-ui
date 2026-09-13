# Overview dashboard

The overview dashboard (`/overview`) is the per-cluster home reached after picking a [connection](/docs/explorer-connections/) or drilling into a [fleet card](/docs/fleet-view/). It requires authenticated access; quick actions are admin-gated.

## What it shows

| Panel | Content |
| --- | --- |
| System stats | ClickHouse version, uptime, server-level counters for the active cluster |
| Recent queries | Latest executions from query history (respecting [`query:history:*`](/docs/permissions/) grants) |
| Quick actions | Shortcuts into the [SQL editor](/docs/workspace-editor/), [Monitoring](/docs/monitoring-overview/), [Explorer](/docs/explorer-databases/) |

## When to use it

- **Daily entry point** — glance at cluster health, then jump straight to work
- **After incidents** — recent queries give immediate context before opening full [query logs](/docs/monitoring-query-logs/)
- **Team landing** — admins see the cluster overview; the page adapts to permissions

## Relationship to other views

| View | Difference |
| --- | --- |
| [Fleet view](/docs/fleet-view/) | All clusters at once; overview is one cluster in detail |
| [Monitoring](/docs/monitoring-overview/) | Deep observability tabs; overview is the summary layer |
| [DataOps](/docs/scheduled-queries/) | Scheduled/data-health surfaces live in DataOps, not here |

> **Tip:** For a landing-by-role experience, note that users land on `/overview` (or `/fleet` for fleet-enabled admins) after login — role-based redirects keep non-admins away from pages they can't use.
