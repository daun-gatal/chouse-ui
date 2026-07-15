# 0006 — Event-Triggered Data Health (pipeline-chained promises)

**Status:** Accepted

## Context

Scheduled Queries (ADR 0002) can materialize a SELECT into a destination table
(`append` / `replace` / `upsert`), and Data Health (ADR 0003) monitors datasets by
compiling promises into read-only jobs that run on a cron-style cadence. Today the two
are connected only by infrastructure — every promise is backed by a
`kind = "data_health_check"` job in the same store, executed by the same
`runner.execute()` and the same scheduler — but not by product workflow:

- A user who materializes a table with a scheduled query must separately create a Data
  Health promise for that table and **guess a cron cadence** that fires "hopefully after"
  the pipeline finishes. Clock-based coupling races the pipeline: evaluate too early and
  freshness/volume checks breach spuriously; pad the schedule and incidents are detected
  hours late.
- Nothing tells the promise that its upstream pipeline failed. The health job keeps
  evaluating a table nobody refilled, or (with `manual` cadence) silently never runs.

The architecture already contains every seam this needs:

- `runner.execute()` is the **single entry point** for scheduled and manual runs; the
  Data Health routes already call it directly, and the ADR 0002 runner header explicitly
  reserved the exported phases for "a future producer (Data Health)".
- The chained run inherits multi-replica correctness for free: the pod that won the
  upstream slot claim is the only pod that reaches the post-success hook.
- A materializing job's output table is authoritative on the job row
  (`destDatabase` / `destTable`); runtime lineage already marks such tables `produced`.
- `frequency` is a plain `TEXT` column (no CHECK constraint) and the scheduler already
  has a skip path for non-cron jobs (`manual`).

This ADR designs the full end-to-end integration — schema, execution, failure
semantics, API, and UI — as **one feature shipped in one release**, not a phased
rollout.

## Decision

### Product model

A Data Health promise gains a third run mode next to cron cadence and manual:
**event-triggered**. An event-triggered promise is linked to exactly one upstream
scheduled query (a `sql_query` job with `outputMode != "none"`) and evaluates
**after every successful upstream run** — scheduled or manual — over **exactly the
window that run wrote**. It never fires from the clock.

Two creation flows converge on the same thing:

1. **From the scheduled query** — when a job writes to a table, the UI offers an
   optional "protect the output table" step that opens the existing promise wizard
   pre-filled (connection, source table = destination, event trigger, upstream job).
2. **From Data Health** — the promise wizard's cadence step offers
   "After a scheduled query succeeds" with an upstream job picker; when the chosen
   source table is produced by a job, that job is auto-suggested.

### Data model

One RBAC migration (next version, both dialects, forward-only, idempotent):

- `data_health_promises.upstream_job_id TEXT NULL` — the linked upstream
  `scheduled_queries.id`, plus an index on it. `NULL` for cron/manual promises. The link
  is **explicit**, not inferred from table names (see Alternatives).

Two app-level enum extensions (no DDL — both columns are plain `TEXT`):

- `SqFrequency` gains `"event"` — stored on the promise's backing
  `data_health_check` job. Like `manual`, it produces no fire times.
- `SqTrigger` gains `"event"` — stamped on runs started by the upstream hook, so run
  history distinguishes *scheduled | manual | event*.

Invariant: a promise has `upstream_job_id` **iff** its backing job has
`frequency = "event"`. The promise routes are the only writer of both, and enforce it.

### Execution

**Scheduler** — `claimAndRunPass` skips `"event"` jobs exactly as it skips `"manual"`;
`cadenceToCron` / `nextFireTimes` / `lastScheduledFireMs` return null/empty for it.
No other scheduler change: reaper, outbox, and pruning already operate on runs and are
kind-agnostic.

**Trigger hook** — at the end of `runner.execute()`, after `finalizeRun`, when the job
is `kind = "sql_query"` with `outputMode != "none"`:

- **On success** → `triggerLinkedPromises(job, run)`: look up enabled promises with
  `upstream_job_id = job.id`, and for each, run its backing health job via the existing
  phases with `trigger: "event"` and `slotAt = upstreamRun.slotAt`.
  - **Dedup / idempotency**: the hook first calls `claimSlot(healthJob.id,
    upstreamRun.slotAt, …)`. `lastRunAt` is a monotonic lease, so a re-fired upstream
    slot (reaper reopen, late-success race) cannot double-run the health check.
  - **Window semantics**: the health run evaluates the **upstream run's window** —
    `resolveWindow` gains an override so `{{sq_slot_start}} / {{sq_slot_end}}` are the
    upstream job's slot boundaries (for a manual upstream run, its collapsed window).
    The check therefore sees precisely the data the pipeline just wrote, which is the
    entire point of chaining.
  - Chained runs execute after the upstream run is finalized, inside the same worker
    slot (bounded by the scheduler's existing `MAX_CONCURRENCY`); health jobs are
    `outputMode = "none"` by construction, so chains cannot recurse.
  - A health-run failure is recorded on the health run and promise (existing
    `processDataHealthError` path) and **never affects the upstream run's status**.
- **On error** → `processUpstreamFailure(job, runId, message)`: for each enabled linked
  promise, set state `unknown` and open/refresh an **execution incident**
  ("upstream pipeline failed: …") via the existing `transitionExecutionIncident`
  machinery, alerting the promise's channels with the existing dedup keys. This reuses
  ADR 0003's core distinction — a pipeline that didn't deliver makes health *unknown*,
  it does not claim the data is unhealthy. The next successful chained run auto-recovers
  through the existing `executionRecovery` branch in `processDataHealthSuccess`.

**Manual "Run now"** on an event-triggered promise stays available (`trigger:
"manual"`). It evaluates the upstream job's most recent successful slot window, falling
back to the collapsed now-window if the upstream has never succeeded — so operators can
re-check on demand without waiting for the next pipeline run.

### Lifecycle guards (fail closed, no silent decay)

- **Deleting** an upstream job with linked promises → `409 Conflict` listing the
  dependent promise names. The user first deletes each promise or switches it to a
  cron/manual cadence. (No cascade, no orphaned `unknown` monitors.)
- **Editing** an upstream job's `outputMode` to `"none"` with linked promises → same
  `409 Conflict`; a non-materializing job has no output table to protect.
- **Disabling** an upstream job is a deliberate pause, not an error: linked promises
  keep their state, and the UI shows a "waiting on disabled upstream" badge derived at
  read time. No state is mutated, so re-enabling needs no bookkeeping.
- **Date-only event time** (`Date`/`Date32`): allowed with the event trigger only when
  the upstream cadence is daily/weekly/monthly — the same reason cron/manual are
  rejected today: sub-day windows cannot map to calendar days.

### API

- `promiseBodySchema`: `frequency` accepts `"event"`; new `upstreamJobId: string`,
  required iff `frequency === "event"`, rejected otherwise. Create/update validate that
  the upstream job exists, is `kind = "sql_query"`, materializes
  (`outputMode != "none"`), and is on the **same connection** as the promise.
- Promise responses embed an upstream summary (`{ id, name, frequency, enabled,
  lastRunAt }`) so the UI never joins client-side.
- The promise **preview** endpoint, for event promises, returns "runs after *job*"
  (upstream cadence echoed) instead of `nextFireTimes`.
- Job list endpoint accepts a `producesTable=db.table` filter so the wizard can suggest
  the upstream for a chosen source table (authoritative `destDatabase`/`destTable`
  match — lineage's `produced` flag corroborates in the UI, but suggestion never
  depends on query-log history existing).
- RBAC: unchanged surfaces — promise routes keep their Data Health permissions, and the
  chained run executes under the existing owner data-access re-check
  (`ownerDataAccessDenial`) of the **health** job, exactly as any other run.

### Frontend

- **PromiseWizard** (cadence step): "After a scheduled query succeeds" option; when
  selected, the UTC-hour/cron inputs are replaced by an upstream job combobox (reusing
  `JobCombobox`, filtered to materializing jobs on the active connection). Choosing a
  source table that a job produces pre-selects that job. Review step and preview show
  the event trigger instead of fire times.
- **JobWizard**: when the created/edited job materializes, the success path offers
  "Protect the output table with Data Health", opening `PromiseWizard` pre-filled
  (source = destination table, event trigger, upstream job, recommended checks). The
  same CTA lives permanently on `JobDetail` for existing jobs, and flips to a link once
  a linked promise exists.
- **Data Health surfaces**: promises and dataset cards show an `event · after <job>`
  chip (linking to the job); run history renders the `event` trigger; upstream-failure
  incidents render as execution incidents with the upstream run linked; the
  "waiting on disabled upstream" badge appears when applicable.

## Consequences

**Positive**

- Health evaluation is causally ordered after the write and scoped to the written
  window — no cadence guesswork, no evaluate-before-write races, breaches detected
  minutes after the pipeline lands instead of at the next cron slot.
- Upstream failures surface as promise execution incidents instead of silent staleness —
  the "monitor never ran" blind spot of `manual` cadence is closed.
- Zero new infrastructure: no event bus, no new scheduler, no leader election. The
  feature is a column, two enum values, one hook, and UI — everything else reuses the
  ADR 0002/0003 machinery (slot lease for dedup, outbox for delivery, incidents for
  state).

**Negative / accepted trade-offs**

- Tighter coupling: the scheduled-queries runner now knows about Data Health beyond the
  existing `data_health_check` branch. Accepted — the dependency direction (runner →
  dataHealth/execution) already exists.
- Deletion friction: removing a materializing job with dependents takes an extra step.
  Accepted deliberately over cascade or orphaning.
- A chained health run extends the upstream worker's wall-clock time (bounded by the
  health job's own `timeoutSecs`, under the same global concurrency cap). Accepted;
  health queries are single-row aggregates by construction.
- One promise chains to one upstream job. Multi-parent fan-in (evaluate after N jobs)
  is out of scope and would be a superseding ADR.

## Alternatives considered

- **Implicit linking via lineage / table-name matching** — chain any promise whose
  source table equals a job's destination. Rejected: renames silently detach monitors,
  several jobs can write one table, and observed lineage depends on `query_log`
  retention. The explicit FK is boring and correct; lineage stays a *suggestion* input.
- **Reusing `frequency = "manual"` plus the link column** — zero scheduler changes.
  Rejected: run history, previews, and the UI would all claim "manual" for runs no
  human started; the semantic deserves its own value, and the scheduler cost is one
  skip condition.
- **An outbox-style event queue between jobs** — enqueue "job X succeeded", let a
  consumer fire health runs. Rejected: the in-process post-finalize call is already
  single-winner (slot lease) and crash-safe (a crashed hook leaves the health slot
  unclaimed; the upstream slot is spent, matching at-most-once per slot, and the next
  upstream run re-triggers). A queue adds delivery machinery for no additional
  guarantee.
- **Running the health check inline before finalizing the upstream run** (one combined
  run). Rejected: a monitoring failure must never fail the pipeline run, and the two
  runs have different owners, histories, and retention.

## Testing plan (gates the implementation PR)

- **Migration** (mandatory per repo rules): `VERSION_CHECKS` entry for the new version
  asserting the `upstream_job_id` column + index; fresh/stepwise/skip-version paths via
  `./scripts/test-migrations.sh` on SQLite and PostgreSQL; idempotent re-run.
- **Runner/hook** (`runner`/`execution` tests): success fires linked promises with
  `trigger: "event"` and the upstream window; `claimSlot` dedups a re-fired slot;
  upstream error marks promises `unknown` and opens one execution incident (dedup on
  repeat failures); recovery on next success; disabled promises are skipped; health-run
  failure does not alter the upstream run.
- **Routes**: validation matrix for `frequency: "event"` + `upstreamJobId` (missing,
  wrong kind, `outputMode: "none"`, cross-connection, date-only event time vs upstream
  cadence); `409` on upstream delete / de-materialize with dependents; upstream summary
  in responses.
- **Frontend**: API-module and hook tests for the new fields; wizard gating logic
  (event option hides hour/cron, requires upstream selection).
- **Release**: one `changelogs/unreleased/<pr>-event-triggered-data-health.md`
  fragment, `type: minor`, in the implementation PR (this ADR itself needs none).
