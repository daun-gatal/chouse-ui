# Investigate a stale table

*Someone says the dashboard shows yesterday's numbers.* This walk-through takes you from that report to the cause and a fix, using the [Data](/docs/data-observability/) pages. You need `observe:view` (and `data_health:view` for promises).

## 1. Confirm it's really stale

Open **Data › Datasets**, search the table and open it. Check:

- **Trust state** — *stale* means no write for longer than this table normally goes without one; *degraded* means writes arrive but the volume is off.
- **Rows per hour vs learned baseline · 48h** — when the writes stopped or dropped.
- **Promises on this table** — whether a promise has already opened an incident.

If the table is *trusted* and fresh, the problem is downstream (the dashboard query or a view) — skip to step 4.

## 2. Open the incident

Go to **Data › Incidents**. A stale critical or important table — or the pipeline feeding it — has usually opened an incident already. Open it and read the **root cause chain** from the bottom: the deepest step is the cause, for example *Kafka consumer retrying → view rejects every insert → table stale*. Each step names the system table its evidence came from.

No incident? Open **Data › Lineage**, focus the table, choose **Upstream (sources)**, and look for a node coloured as broken.

## 3. Check the pipeline

Click through to the pipeline in **Data › Pipelines** and **Inspect** it: the samples show when throughput stopped, the backlog growing and the latest error (visible with `query:history:view:all`). Typical causes:

| Status | Usual cause |
| --- | --- |
| *retrying* | A batch the target view keeps rejecting (bad data, schema change) |
| *stalled* | The source is unreachable or the consumer is stuck |
| *stopped* | The writer or job hasn't run at all |
| *unsupported on this version* | The server doesn't expose the evidence — check the engine's own logs |

## 4. See who is affected

Back on the incident, **Blast radius** lists everything downstream: tables, promises, scheduled jobs, saved queries and agents. Tell their owners — the table's **Owner** is on **Data › Context**.

## 5. Fix it

- If a catalog action fits — restart the engine table, refresh a view, reload a dictionary, flush a `Distributed` table — **Propose a fix** on the incident. See [Approve and roll back a fix](/docs/guide-approve-a-fix/).
- Otherwise fix the source (the producer, the schema), then watch the pipeline return to *healthy*. The incident moves to *recovered* by itself.

## 6. Record what happened

Add notes and query snapshots to the incident's **notebook**, then **Export postmortem** for the write-up. To catch it sooner next time, add a freshness [promise](/docs/guide-first-promise/).
