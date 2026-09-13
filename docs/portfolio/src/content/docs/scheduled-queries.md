# Scheduled queries

Scheduled queries run SQL on a cron-style cadence — ingestion jobs, rollups, extracts — with run history, lineage and safety rails. They live in **DataOps** (`/dataops/scheduled-queries`, permissions `scheduled_queries:view`; edits need `scheduled_queries:edit`, deletes `scheduled_queries:delete`).

## Creating a job

1. **DataOps → Scheduled queries → New job** (wizard).
2. Define: SQL, connection, schedule (cron expression), retries and timeout.
3. Save — the job appears in the jobs list with its next run time.

## Jobs tab

The list view of all jobs: schedule, connection, last status, next run. Per-job actions: run now, edit, disable, delete.

## Macros

Jobs support macros for date-relative SQL — see the built-in **Macros help** in the job editor. Typical uses:

- Window suffixes/partition cuts (`{today}`, `{yesterday}` …)
- Incremental watermarks
- Per-run uniqueness in generated names

> **Tip:** Prefer macros over string-building SQL — they are evaluated server-side per run and show in lineage.

## Runs tab

Every execution is recorded: start/end, duration, status, rows affected, error text on failure. Failure alerting rides the general [alerting](/docs/alerting/) channels.

## Lineage tab

Lineage ties jobs to the tables they read and write — the dependency map for your scheduled SQL. Use it to answer "what breaks if I change this table?" before the [schema advisor](/docs/monitoring-schema-advisor/) or teammates do.

## Scheduling architecture

- The scheduler runs **in-process on every API pod** by default; per-job **atomic leases** make redundant ticks across pods harmless
- `SCHEDULED_QUERIES_ENABLED=false` disables scheduling on a pod (dedicated scheduler Deployment pattern)
- **HA caveat**: with SQLite + multiple replicas (`CHOUSE_HA=true`) the lease cannot span pods — multi-replica HA requires PostgreSQL; the server warns loudly at boot
- Jobs execute through the standard [security pipeline](/docs/security/) — RBAC and data access rules apply with the job owner's identity

## Config

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCHEDULED_QUERIES_ENABLED` | `true` | In-process scheduler on this pod |
| `CHOUSE_HA` | `false` | HA signal (set by orchestration) |

## History

| Version | Notes |
| --- | --- |
| 1.x | Introduced with the DataOps suite (see [ADR 0002](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0002-scheduled-queries.md)) |
| Clear & rerun | Per-run clear/rerun actions ([ADR 0007](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0007-clear-and-rerun-for-scheduled-jobs-and-data-health.md)) |
