# Watch a Kafka pipeline

CHouse UI watches ingestion without any setup: once a Kafka table and its materialized view exist on a connection, they appear on **Data › Pipelines**. This guide shows what to check so a broken consumer gets noticed quickly.

## 1. Make sure the collector can see it

The pipeline evidence comes from `system.kafka_consumers`, `system.query_views_log` and `system.part_log`. Open **Admin › Connections › Edit**: if the observability grants panel lists missing grants, run them. (On versions without `system.kafka_consumers` the status shows *unsupported on this version*.)

## 2. Find it

**Data › Pipelines**, filter **Pipeline type** to the queue engines. Each Kafka table → view → target table chain is one pipeline with one status. **Inspect** it for 48 hours of throughput, lag, backlog and errors.

## 3. Know what the statuses mean

| You see | It means |
| --- | --- |
| *healthy* | Messages land within the learned cadence |
| *lagging* | Behind, but catching up |
| *retrying* | The consumer re-reads the same batch because the view rejects it — nothing is committed |
| *stalled* | Messages are waiting but nothing moves |
| *stopped* | Nothing has landed for far longer than usual |
| *inefficient* | Healthy, but many tiny inserts are creating merge pressure |

*Retrying* is the one ClickHouse clients never see: the consumer looks busy while no data arrives.

## 4. Get told when it breaks

A pipeline incident opens automatically when the pipeline feeds a table that is *critical* or *important* (from read volume), or that has a promise. To be sure, either:

- pin the target table's criticality on **Data › Datasets** (needs `observe:edit`), or
- add a freshness [promise](/docs/guide-first-promise/) on the target table with a notification channel.

## 5. When it breaks

Open the incident: the root cause chain shows whether the problem is the view (data → transform), the consumer (ingestion) or the broker (external). The usual fixes — **restart the engine table** after correcting the view, or fixing the producer — are in [Approve and roll back a fix](/docs/guide-approve-a-fix/).
