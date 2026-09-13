# Data health

Data health lets your team write *promises* over datasets — freshness, volume and schema expectations — evaluated on a schedule, with incident tracking when reality drifts. Live in **DataOps** (`/dataops/data-health`).

## The three tabs

| Tab | Content |
| --- | --- |
| **Overview** | All promises with last status — the data-quality dashboard |
| **Datasets** | Register the datasets (db.table) promises are made over |
| **Incidents** | Timeline of breaches with acknowledge/resolve flow |

## Promises

A promise declares an expectation about a dataset:

| Kind | Example |
| --- | --- |
| **Freshness** | "The table is loaded by 07:00 UTC every day" |
| **Volume** | "Between 10k and 1M rows per day" |
| **Schema** | "Column X exists / hasn't changed type" |

Promises are created via a wizard (`PromiseWizard`) and evaluated on a schedule by the same evaluation machinery that powers [scheduled queries](/docs/scheduled-queries/) — safe across replicas via per-job leases ([ADR 0003](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0003-data-health-promises.md)).

## Evaluation & incidents

1. The evaluator runs the promise's checks against the [connection](/docs/explorer-connections/)
2. **Pass** → recorded to the promise's timeline
3. **Fail** → an **incident** opens: the promise, dataset, failed check and evidence
4. Incidents support **clear & rerun** semantics — acknowledge, fix the upstream job, re-evaluate ([ADR 0006](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0006-event-triggered-data-health.md), [ADR 0007](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0007-clear-and-rerun-for-scheduled-jobs-and-data-health.md))
5. Event-triggered evaluations can fire on job completion, not just on clocks

## The DataOps loop

```
Scheduled job loads data → promise validates it → incident if broken
   → DataOps AI summarizes what's wrong → fix job → rerun → promise green
```

See [DataOps AI](/docs/dataops-ai/) for the summarization layer and [Scheduled queries](/docs/scheduled-queries/) for the jobs.

## Permissions

Reading promises/datasets/incidents falls under the DataOps access set (`scheduled_queries:view`-family gates the suite). Manage permissions via the [permission catalog](/docs/permissions/).

> **Tip:** Start with one freshness promise per critical table — it catches the majority of silent ingestion failures (job succeeded, upstream data didn't arrive).
