# Cluster activity

Cluster activity (`/monitoring/cluster`, permission `cluster:view`) answers "is the machinery stuck?" — mutations, replication queues and replica health at a glance.

## The three panels

### Mutations (`system.mutations`)

- Every mutation with status chips (done / pending / failed)
- Sortable by age — stuck mutations bubble to the top

### Replication queue (`system.replication_queue`)

- Pending replication tasks per table
- Long-lived queue entries indicate a replica falling behind or a ZooKeeper/Keeper issue

### Per-replica status (`system.replicas`)

- Lag per replica (absolute and relative to the leader)
- Queue depth per replica

## Blocked-task indicator strip

A compact strip aggregates the four "cluster is struggling" signals:

| Signal | Threshold behavior |
| --- | --- |
| Long queries | Queries running past a threshold |
| Long merges | Merges taking too long |
| Open mutations | Mutations pending too long |
| Max replica lag | The worst replica lag in the cluster |

A non-empty strip means: look at [parts](/docs/monitoring-parts/) and the tables below before trusting dashboards.

## Typical reads

| Strip state | Meaning | First check |
| --- | --- | --- |
| Empty | Machinery healthy | Nothing |
| Long merges + many parts | Ingest rate outpacing merges | Parts view, [schema advisor](/docs/monitoring-schema-advisor/) |
| Open mutations | Someone ran heavy ALTERs | Mutations table |
| Max replica lag | A replica is behind | Per-replica panel; Keeper health in [Metrics → ZooKeeper](/docs/monitoring-metrics/) |

## Underlying data

| Table | Used for |
| --- | --- |
| `system.mutations` | Mutations panel |
| `system.replication_queue` | Queue panel |
| `system.replicas` | Replica lag/depth |
| `system.query_log` | Long-query signal in the strip |

> **Tip:** Pair this tab with a [threshold alert](/docs/alerting/) on replica lag — the strip tells you when you're on the page; the alert tells you when to open the page.
