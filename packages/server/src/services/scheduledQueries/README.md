# Scheduled Queries

## Overview
Scheduled Queries (ADR 0002, ADR 0015): read-only SELECT jobs on a cadence, with window macros, engine-generated materialize write-back (including cluster destinations), a lease-based scheduler, run history and an outbox for notifications.

## Interface
- `[scheduler.ts:ScheduledQueryScheduler]`.
- `[runner.ts:enqueueRun]`, `[runner.ts:execute]`, `[runner.ts:resolveWindow]`, `[runner.ts:chainActionFor]`.
- `[cadence.ts:cadenceToCron]`, `[cadence.ts:lastScheduledFireMs]`, `[cadence.ts:previousFireMs]`, `[cadence.ts:nextFireTimes]`, `[cadence.ts:validateCron]`.
- `[validation.ts:validateReadOnlySelect]`, `[validation.ts:buildExecutableQuery]`, `[validation.ts:KNOWN_TOKENS]`.
- `[materialize.ts:executeMaterialize]`, `[materialize.ts:buildCreateStatements]`, `[materialize.ts:diffSchema]`, `[materialize.ts:checkEngineFit]`.
- `[cluster.ts:inspectClusterJob]`, `[cluster.ts:destinationChecks]`, `[cluster.ts:listClusters]`.
- `[runner.ts:jobActor]`. Sessions and the ClickHouse handle come from the statement executor (`[../chExecutor/session.ts:pinnedSession]`, `[../chExecutor/executor.ts:executorForConnection]`).
- `[store.ts:createJob]`, `[store.ts:updateJob]`, `[store.ts:claimSlot]`, `[store.ts:insertRun]`, `[store.ts:finalizeRun]`, `[store.ts:reapOrphanedRuns]`, `[store.ts:enqueueOutbox]`, `[store.ts:claimOutboxRow]`, `[store.ts:pruneOldRuns]`.
- `[types.ts:SQ_FREQUENCIES]`, `[types.ts:SQ_OUTPUT_MODES]`, `[types.ts:outputConfigSchema]`, `[types.ts:clusterConfigSchema]`.

## Invariants
- The source query is validated SELECT-only at create/edit and re-checked before every run; macros become native query parameters (`[validation.ts:validateReadOnlySelect]`, `[validation.ts:buildExecutableQuery]`).
- Users never author write SQL: materialize generates `INSERT ... SELECT` / `REPLACE PARTITION` idempotently (`[materialize.ts:executeMaterialize]`).
- Firing schedule and `{{slot_start}}` lower bound share one cadence source (croner) so they never drift (`[cadence.ts:lastScheduledFireMs]`, `[cadence.ts:previousFireMs]`).
- The scheduler is correct under N replicas with no leader election: the job row is the lease; recovery is crash-only (`[scheduler.ts:ScheduledQueryScheduler]`, `[store.ts:claimSlot]`).
- Jobs run on the stored connection's own login, sent for the job's owner (`owner_id`); a job with no owner is refused and its run records `[runner.ts:NO_OWNER]` (`[runner.ts:jobActor]`, ADR 0033 §4). `created_by` only records who created the job. Without view-all a job is visible to its owner, or to its creator while it has no owner (`[store.ts:isJobOf]`): its results are read with the owner's access.
- The owner is whoever last changed what the job does: the routes call `[store.ts:setJobOwner]` when a save changes the SQL, the output or the channels, and for "assign to me" only when the job has no owner.
- A read-only run sends the owner's `CheckedStatement`, checked on the text and the parameter values of that run, with `readonly = 2`; a materialize run wraps the checked SELECT in CHouse-built statements.
- Limits: `MAX_CONCURRENCY = 4` runs, outbox batches of 20 rows with a 5 min lease and at most 5 attempts (`[scheduler.ts:MAX_CONCURRENCY]`, `[scheduler.ts:OUTBOX_BATCH]`, `[scheduler.ts:OUTBOX_LEASE_TTL_MS]`, `[scheduler.ts:OUTBOX_MAX_ATTEMPTS]`).
- A pinned session sends `session_check = 1` after the first statement so a moved session fails instead of silently splitting (`[../chExecutor/session.ts:pinnedSession]`).

## Side Effects
- Writes `scheduled_queries`, `scheduled_query_runs`, `scheduled_query_channels`, `scheduled_query_outbox` (`[store.ts:createJob]`, `[store.ts:insertRun]`, `[store.ts:setJobChannels]`, `[store.ts:enqueueOutbox]`).
- ClickHouse reads and engine-generated writes/DDL to destination tables (`[materialize.ts:executeMaterialize]`); `KILL QUERY` from the scheduler.
- 60 s `setInterval` tick; alert events and notify delivery from the outbox pass (`[scheduler.ts:ScheduledQueryScheduler]`).
- Every tick also deletes the jobs of expired Data Health watches, cascading to their promises (`[scheduler.ts:expireWatchesPass]`), and prunes old run history (`[store.ts:pruneOldRuns]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
