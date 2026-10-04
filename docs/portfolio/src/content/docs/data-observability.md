---
app: Data › Overview
route: /data/overview
permissions: observe:view
---
# Data observability

The **Data** page (`/data`) answers one question for every table on the active connection: *is the data right, right now?* It replaces DataOps — Scheduled Queries and Data Health live here too, unchanged — and adds learned baselines, pipelines, lineage, incidents with a root cause, coverage and context ([ADR 0016](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0016-data-observability-platform.md)). Old `/dataops/*` links redirect.

## Tabs and permissions

| Tab | Shows | Needs |
| --- | --- | --- |
| **Overview** | Trusted tables, critical coverage, open incidents with their root cause, pipelines needing attention, suggested monitors, recent schema changes | `observe:view` |
| **Incidents** | Data Health and pipeline/engine incidents in one list; the investigation view | `observe:view` or `data_health:view` |
| **Lineage** | The warehouse graph around any table | `observe:view` |
| **Pipelines** | Every ingestion source with one status vocabulary | `observe:view` |
| **Datasets** | Observed tables (trust, drift, schema history, usage) · Promises · Promise health | `observe:view` (tables), `data_health:view` (promises) |
| **Coverage** | Coverage by criticality, suggested promises, cold data | `observe:view` |
| **Context** | Curated table context, canonical metrics, dbt import, watchers | `observe:view` (read), `context:edit` (write) |
| **Scheduled queries** | Unchanged | `scheduled_queries:view` |

Every evidence query respects your data access rules: a table you cannot read never appears, not even as a lineage node or in someone else's query text.

## How tables are watched without scanning them

A collector on the server reads ClickHouse metadata on a cadence — `system.parts` and `part_log` for writes, `query_log` for reads — and learns, per table:

- **Freshness** — the normal gap between writes (p50/p99), so "stale" means stale *for this table*
- **Volume** — an hourly band; a quiet hour outside it marks the table **degraded**
- **Criticality** — from real read volume (pin it on the dataset page with `observe:edit`)

Tables move through **learning → trusted**, and to **degraded** or **stale** when the evidence says so. Critical and important tables are also profiled on a 0.1% sample (null ratio, distinct count, p50/p95) to catch distribution drift such as prices suddenly 100× larger.

The collector needs read access to the system tables it uses. Saving a connection never fails because of missing grants; **Admin › Connections › Edit › Check privileges** lists what is missing and the exact `GRANT` statements.

## Coverage and suggestions

Every table has a learned baseline from day one. **Promises** add explicit intent on top ([Data health](/docs/data-health/)). Coverage ranks read-heavy tables without a promise and turns each into a suggestion; **Accept** opens the promise wizard pre-filled (needs `data_health:edit`), **Dismiss** hides it (`observe:edit`).

## Context and watchers

Context tells people and agents what a table means: description, grain, owner, "use this instead", tags, and canonical metrics (`gmv = sumIf(amount, status = 'paid')`). Import descriptions from a dbt `manifest.json`. Agents read it through the MCP `get_table_context` and `get_metric` tools.

A **watcher** is a sentence — *"tell me when checkout orders drop more than 30% compared with the same hour last week"* — that Chouse AI compiles into a Data Health promise draft you review in the wizard (needs `data_health:edit` and `ai:optimize`).

See also: [Pipelines & lineage](/docs/data-pipelines-lineage/), [Incidents, root cause & fixes](/docs/data-incidents/).
