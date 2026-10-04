# Pipelines & lineage

## Pipelines

**Data › Pipelines** lists every way data gets into ClickHouse in one model:

| Kind | Evidence |
| --- | --- |
| Materialized views | `system.query_views_log` |
| Refreshable views | `system.view_refreshes` |
| Queue engines — Kafka, RabbitMQ, NATS | `system.kafka_consumers` (Kafka), the attached views' outcomes |
| Object storage queues — S3Queue, AzureQueue | `system.s3queue_log` / `azure_queue_log`, queue metadata in Keeper |
| Database replication — MaterializedPostgreSQL, MaterializedMySQL | `system.part_log` writes |
| External tables — PostgreSQL, MySQL, S3, URL, … | reads in `query_log` |
| Distributed inserts, dictionaries, async inserts, Buffer | their system tables |
| External writers and scheduled jobs | `query_log` by client, CHouse job runs |

Each pipeline gets one status:

| Status | Meaning |
| --- | --- |
| **healthy** | Progressing within its learned cadence |
| **lagging** | Behind its source, still progressing |
| **stalled** | No progress and work pending |
| **retrying** | Repeating the same work without committing — e.g. a Kafka consumer replaying a batch a view keeps rejecting |
| **failing** | Errors while some work still lands |
| **stopped** | Nothing succeeded for well beyond the usual cadence |
| **inefficient** | Healthy but creating merge pressure (tiny inserts) |
| **unsupported on this version** | The server version lacks the evidence (e.g. no `s3queue_log` on 23.8) |

Failures that clients never see are the point: a consumer stuck on a batch, a file that failed every retry, a view that rejects each insert. They stay visible until data flows again, and open an incident when the pipeline feeds a promised, critical or important table.

Open a pipeline for its samples (throughput, lag, backlog, errors, the latest error text). Error texts can quote data, so they are shown only to users with `query:history:view:all`.

## Lineage

**Data › Lineage** draws one graph built without instrumentation:

- views, queue and object-storage engines, replication, Distributed tables, dictionaries — from `system.tables`
- `INSERT … SELECT`, including column hints — from `query_log`
- scheduled jobs, saved queries, and agents that read tables

Focus a table and choose **upstream** (sources), **downstream** (blast radius) or both, with a depth. Broken nodes are coloured; edges leaving a broken node are animated. The scheduled-query job page keeps its runtime-lineage panel and links into this graph.

The CLI has the same view: `chouse lineage shop.orders --direction up`, and `--impact` for everything downstream.
