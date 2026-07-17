# 0007 — Clear & Rerun for Scheduled Jobs and Data Health

**Status:** Accepted

## Context

Scheduled Queries (ADR 0002) execute slot-keyed runs over deterministic windows
(`{{slot_start}}`/`{{slot_end}}`), and materialize writes are already idempotent per
slot (`insert_deduplication_token = jobId:slotAt` for append/upsert; staging +
atomic `REPLACE PARTITION` for replace). A recovery endpoint
(`POST /scheduled-queries/:id/recovery`) already backfills a `from..to` range with
plan-preview → confirm → execute, a `rerunSuccessful` flag, and a 30-slot cap.
Data Health (ADR 0003/0006) evaluates promises over injected windows
(`ExecuteOptions.window`) and records per-slot samples with a
`UNIQUE (check_id, slot_at, origin)` key; incident logic is computed from
slot-ordered streaks, so corrected history recomputes naturally.

What is missing is **Airflow-style "clear" semantics** — re-run a slot and have the
system converge on the re-run's result — end to end:

1. **Recovery never reaches chained Data Health.** `runner.execute()` skips
   `runChainedDataHealth` when `suppressNotifications` is set (which recovery always
   sets), and even without that gate `claimSlot` would reject an old slot because the
   job's `last_run_at` lease has moved on. A user who backfills a pipeline cannot
   re-verify the promises protecting its output over the same windows.
2. **Data Health re-evaluation is dedup-not-replace.** `insertEvaluations` uses
   `ON CONFLICT … DO NOTHING`, so re-running a slot silently keeps the stale sample.
   A "clear & rerun" must overwrite.
3. **Replaying an old slot would clobber current state.** `processDataHealthSuccess`
   unconditionally sets the promise's live status, transitions incidents, and
   enqueues notifications. Re-evaluating last Tuesday must not flip today's health
   state or page anyone. (This is a *latent* bug today: running the existing
   scheduled-query recovery against a `data_health_check` job's own cadence already
   takes the full-transition path with historical windows.)
4. **No range rerun for Data Health itself.** `/data-health/:id/run` always uses
   `slotAt = Date.now()`; there is no equivalent of the recovery range endpoint for
   promises. (`/backtest` runs historical slots but is deliberately ephemeral — it
   persists nothing.)

Everything ships as **one feature in one release** — no phasing. No schema change is
required: the samples unique key and the outbox `dedup_key` unique key already exist
in both dialects, so there is **no migration** (and therefore no
`migrations.ts`/`VERSION_CHECKS` obligation).

## Decision

### Product model

- **Per-run rerun is the primary surface.** Every run in a job's run history and a
  promise's evaluation timeline has a **Rerun** action (Airflow's "clear task
  instance"): `POST /scheduled-queries/runs/:runId/rerun` and
  `POST /data-health/:id/runs/:runId/rerun` re-execute exactly that run's slot
  over its deterministic window with replay semantics. A rerun of a materializing
  slot **always** replays its chained Data Health promises over the same window —
  re-verifying what the rerun rewrote is the point of the action, so it is not
  optional there.
- **Scheduled query recovery gains chained re-verification.** The existing recovery
  dialog/endpoint gets a flag (default-on in the UI, opt-in at the API): after each
  slot's successful materialize rerun, every enabled promise chained to the job
  re-evaluates **over the same window that rerun wrote**, in replay mode. The
  dialog also exposes the pre-existing `rerunSuccessful` flag ("clear & rerun
  slots that already succeeded"), which previously had no UI.
- **Data Health promises gain their own range rerun.** A new
  `POST /data-health/:id/recovery` mirrors the scheduled recovery contract
  (plan-preview → `execute` + `confirm` → capped execution) and re-evaluates the
  promise's slots in the range, replacing their samples.
- **Replay semantics (the core invariant).** A *replay* run:
  - re-executes with full RBAC/read-only re-validation, exactly like any run;
  - **replaces** the slot's live samples (upsert instead of `DO NOTHING`);
  - if the slot is **strictly older** than the newest previously evaluated live
    slot: writes samples only — no promise-status update, no incident transition,
    no notification;
  - if the slot **is** the newest slot: full semantics — status re-derives,
    streak-based incident transitions run over the (now corrected) slot history,
    and notifications flow through the existing `dedup_key` outbox, which caps them
    at one per incident transition.
  - a **failed** replay records its run row and stops — it never marks the promise
    `unknown`, never opens execution incidents, never notifies.

### Execution model (D1–D6)

- **D1 — `replay` is an `ExecuteOptions` flag,** threaded from the two recovery
  routes through `runner.execute()` into the Data Health processing functions. The
  live path (flag absent) is byte-for-byte unchanged.
- **D2 — Chained replays bypass `claimSlot`.** The lease exists to make *live*
  event fires at-most-once across replicas; a user-confirmed replay is explicitly
  re-running an already-claimed slot. The replay chain still re-checks
  `promise.enabled` and the health job's `enabled`/`kind`, and never touches
  `last_run_at` — the scheduler's cadence is unaffected. Concurrent recoveries can
  double-run a health slot; both runs are read-only and the sample upsert is
  last-write-wins, so this is benign.
- **D3 — Replayed chained runs are stamped `trigger: "manual"`** (like recovery
  runs today): the reaper never auto-retries them, and run history distinguishes
  them from live `event` fires.
- **D4 — Anomaly baselines must not peek at the future.** For replay runs,
  `metricHistory` is filtered to samples with `slot_at <` the replayed slot, so
  robust-bounds checks see only what a live run at that slot could have seen. Live
  runs keep the unfiltered history. Schema-contract checks evaluate the *current*
  schema even for historical slots (the historical schema is unknowable); accepted.
- **D5 — Slot derivation for `POST /data-health/:id/recovery`:**
  - *event-triggered promise* → the upstream job's **distinct successful run slots**
    in the range (ground truth of what the pipeline delivered), each evaluated over
    `resolveWindow(upstream, slot)`;
  - *cron/daily/weekly/monthly promise* → `fireTimesBetween(healthJob, from, to)`
    from the current cadence, each over `resolveWindow(healthJob, slot)`;
  - *manual-frequency promise* → the promise's own distinct recorded live sample
    slots in the range (there is no cadence to derive from).
  Windows are recomputed from the **current** schedule; if the cadence was edited
  since, historical ranges may differ — surfaced as a plan warning, same trade-off
  the existing scheduled recovery already makes.
- **D6 — Upstream-failure propagation stays suppressed during recovery.** A failed
  backfill of an old slot must not mark chained promises `unknown` or open
  execution incidents; the existing `suppressNotifications` gate on
  `processUpstreamFailure` already provides this and is kept.

### Notification matrix

| Event | Notification |
|---|---|
| Replay of an old slot (any outcome) | none |
| Replay of the newest slot causing a real incident transition | one, via existing outbox `dedup_key` |
| Replay run fails to execute | none (run row records the error) |
| Upstream recovery slot fails | none (unchanged recovery behavior) |

### Performance

No hot-path change. Replays run through the existing runner with all existing caps
(`priority 10`, 4 GiB memory cap, `max_execution_time`, result-row caps), recovery
stays sequential and capped at 30 executed slots per request, and each chained
health check is one single-row aggregate SELECT. New DB work is one indexed upsert
per check per replayed slot plus two indexed point lookups — negligible on SQLite
and PostgreSQL. The scheduler tick, claim path, and live run path are untouched.

## Consequences

- Backfilled pipelines can be re-verified end to end with one action, and corrected
  history recomputes incident streaks correctly (a fixed old slot can legitimately
  contribute to a recovery streak on the next newest-slot evaluation).
- The latent stale-state clobbering when recovering a health job's own cadence is
  fixed by the same mechanism.
- Sample rows for a slot are mutable under replay (run_id/values/evidence change;
  row `id` is stable). Anyone treating `data_health_samples` as append-only history
  must not — the run rows remain the immutable history.
- Replaying the newest slot can open/escalate/recover incidents. This is intended:
  the newest slot *defines* current health. The outbox dedup key bounds the noise.
- A promise whose upstream never succeeded in the range yields an empty plan — the
  UI must communicate "nothing to rerun" rather than erroring.

## Alternatives considered

- **Delete-then-insert instead of upsert for samples.** Loses row-id stability and
  needs a transaction to avoid a windowless gap under concurrent reads; the unique
  key already supports `DO UPDATE` on both dialects. Rejected.
- **Recompute promise status after every replayed slot** (not just the newest).
  Requires re-deriving state from the newest slot's samples inside every replay and
  reasoning about interleaving with live runs; the "newest slot wins, older slots
  are samples-only" rule gives the same converged result with far less machinery.
- **A new `replay` trigger enum value.** Would ripple through frontend types and
  run-history UI for cosmetic benefit; `manual` + replay flag on the request path
  is sufficient. Rejected.
- **Queue recovery through the scheduler instead of in-request.** Better for very
  large backfills but adds a persistent queue and progress UI; the existing 30-slot
  in-request contract is kept (already the shipped recovery behavior).
- **Deriving event-promise slots from the promise's own past runs** instead of the
  upstream's successful slots. Misses slots where the chain was skipped (disabled
  promise, pre-feature history) — the upstream's delivered slots are the ground
  truth of what can be verified.

---

## Implementation plan (single PR, end to end)

Every touch point, in dependency order. No migrations; no `VERSION_CHECKS` entry
needed.

### 1. Data Health store — `packages/server/src/services/dataHealth/store.ts`

- `insertEvaluations(promiseId, runId, slotAt, evaluations, opts?)` — replace the
  positional `origin` default parameter with
  `opts: { origin?: "live" | "backtest"; replace?: boolean }` (single caller:
  `execution.ts`). When `replace` is true, use one dialect-shared statement:
  `INSERT … ON CONFLICT (check_id, slot_at, origin) DO UPDATE SET run_id = excluded.run_id,
  outcome = excluded.outcome, observed_value = excluded.observed_value,
  expected_lower = excluded.expected_lower, expected_upper = excluded.expected_upper,
  evidence = excluded.evidence, created_at = excluded.created_at`
  (valid on SQLite ≥ 3.24 and PostgreSQL; the `UNIQUE (check_id, slot_at, origin)`
  constraint exists in both dialects since the samples table was created). The
  non-replace branches stay exactly as they are.
- `latestLiveSlotAt(promiseId): Promise<number | null>` —
  `SELECT MAX(slot_at) … WHERE promise_id = ? AND origin = 'live'` (covered by
  `dh_samples_promise_slot_idx`).
- `listLiveSlotsBetween(promiseId, fromMs, toMs, limit): Promise<number[]>` —
  `SELECT DISTINCT slot_at … WHERE promise_id = ? AND origin = 'live' AND slot_at
  BETWEEN ? AND ? ORDER BY slot_at ASC LIMIT ?` (manual-frequency path, D5).
- `metricHistory(promiseId, limitPerCheck = 100, beforeSlot?: number)` — add the
  optional strict upper bound `AND slot_at < ?` (D4). Existing callers pass nothing
  and are unchanged.

### 2. Scheduled Queries store — `packages/server/src/services/scheduledQueries/store.ts`

- `listSuccessfulSlotsBetween(queryId, fromMs, toMs, limit = 100): Promise<number[]>`
  — `SELECT DISTINCT slot_at FROM scheduled_query_runs WHERE query_id = ? AND
  status = 'success' AND slot_at BETWEEN ? AND ? ORDER BY slot_at ASC LIMIT ?`
  (event-promise slot derivation, D5).

### 3. Data Health execution — `packages/server/src/services/dataHealth/execution.ts`

- `processDataHealthSuccess(job, runId, slotAt, observed, client, params, opts?: { replay?: boolean })`:
  - When `opts.replay`: read `latestLiveSlotAt(promise.id)` **before** inserting
    this run's samples; fetch history via `metricHistory(promise.id, 100, slotAt)`.
  - Evaluate checks exactly as today (including schema-contract handling).
  - Insert samples with `{ replace: true }` when replaying.
  - If `opts.replay && latest != null && slotAt < latest`: return
    `{ conditionMet, conditionValue, message, notified: false }` immediately —
    skipping `updatePromiseEvaluation`, both incident transitions, and all outbox
    enqueues. The run row still records the evaluation outcome.
  - Otherwise (live run, or replay of the newest slot) the existing full path runs
    unchanged — `transitionDataIncident`'s slot-streak logic now sees the corrected
    samples, and the outbox `dedup_key` (`data-health:<incidentId>:<type>`) already
    dedupes notifications.
- `processDataHealthError` — untouched; the runner simply does not call it for
  replays (step 4).

### 4. Runner — `packages/server/src/services/scheduledQueries/runner.ts`

- `ExecuteOptions` gains `replay?: boolean` and `chainReplay?: boolean` (JSDoc:
  set only by the recovery routes; absent on every live path).
- In `execute()`:
  - success + `kind === "data_health_check"` → pass `{ replay: opts.replay }` to
    `processDataHealthSuccess`;
  - error + `kind === "data_health_check"` → call `processDataHealthError` only
    when `!opts.replay`;
  - the post-finalize chain block becomes:
    - `status === "success" && !opts.suppressNotifications` → live chain
      (unchanged);
    - `status === "success" && opts.suppressNotifications && opts.chainReplay` →
      `runChainedDataHealth(job, opts.slotAt, window, { replay: true })`;
    - error path unchanged (`processUpstreamFailure` still gated by
      `!opts.suppressNotifications`, D6).
- `runChainedDataHealth(upstream, slotAt, window, opts?: { replay?: boolean })`:
  - live (no flag): identical to today, including `claimSlot`;
  - replay: skip `claimSlot` (D2), keep the `promise.enabled` / health-job
    `enabled`/`kind` guards, compute `attempt = countRunsForSlot + 1`, and execute
    with `{ trigger: "manual", slotAt, attempt, window, replay: true,
    suppressNotifications: true }` (D3).

### 5. Scheduled recovery route — `packages/server/src/routes/scheduled-queries.ts`

- `recoverySchema` gains `rerunChainedHealth: z.boolean().default(false)` (Zod v3).
- Plan response (both preview and execute) gains
  `chainedPromises: Array<{ id, name, enabled }>` from
  `listPromisesByUpstreamJobId(job.id)`, and one more conditional warning: when
  `job.query` contains `{{prev_run_at}}`, note that the recomputed window depends
  on prior successes and may not reproduce the original range.
- The execute loop passes `replay: true` and
  `chainReplay: body.rerunChainedHealth` in the `ExecuteOptions`. (`replay: true`
  is inert for `sql_query` jobs and fixes the latent stale-state clobbering when
  the target is a `data_health_check` job.)
- Audit details gain `rerunChainedHealth`.

### 6. Data Health recovery route — `packages/server/src/routes/data-health.ts`

New `POST /data-health/:id/recovery`, `requirePermission(PERMISSIONS.DATA_HEALTH_RUN)`,
body (Zod v3): `{ from: int, to: int, execute: bool = false, confirm: bool = false }`
with the same `from <= to` refinement as the scheduled route.

1. `loadVisiblePromise` (owner scoping identical to `/run`), load the backing job,
   `AppError.internal` if missing / wrong kind.
2. Derive `slots: Array<{ slotAt, window, hasSamples }>` per D5 (event → upstream
   successful slots via `listSuccessfulSlotsBetween` + `resolveWindow(upstream, slot)`;
   cadence → `fireTimesBetween` + `resolveWindow(healthJob, slot)`; manual →
   `listLiveSlotsBetween`); `hasSamples` from comparing against the promise's live
   slots in range. Cap the preview at 100 slots (same constant as scheduled).
3. Warnings: 100-slot preview cap; "windows recomputed from the current schedule";
   for event promises with zero upstream successes, the plan is empty (not an
   error).
4. `!execute` → return `{ plan, runnable, warnings }`. `execute && !confirm` →
   `AppError.badRequest`. More than 30 runnable slots → `AppError.badRequest`
   (same contract as scheduled recovery).
5. Execute sequentially: `runner.execute(healthJob, { trigger: "manual", slotAt,
   attempt: 1, window, replay: true, suppressNotifications: true })`, collecting
   run rows.
6. Audit: `AUDIT_ACTIONS.DATA_HEALTH_PROMISE_RUN` with
   `details: { recovery: true, from, to, slots: runs.length }`.

### 7. Frontend API clients (tests required — `src/api/*` rule)

- `src/api/scheduledQueries.ts` — `recoverScheduledQuery` input gains
  `rerunChainedHealth?: boolean`; `ScheduledRecoveryResult` gains
  `chainedPromises?: Array<{ id: string; name: string; enabled: boolean }>`.
- `src/api/dataHealth.ts` — new
  `DataHealthRecoveryResult { plan: Array<{ slotAt: number; hasSamples: boolean }>;
  runnable: number; warnings: string[]; runs?: DataHealthRun[] }` and
  `recoverDataHealthPromise(id, input: { from: number; to: number;
  execute?: boolean; confirm?: boolean })`.
- Extend `src/api/scheduledQueries.test.ts` and `src/api/dataHealth.test.ts` with
  MSW handlers covering both preview and execute shapes.

### 8. Frontend UI

- `src/features/scheduled-queries/JobDetail.tsx` — in the existing recovery
  dialog: when the preview returns `chainedPromises.length > 0`, render a checkbox
  ("Also rerun linked Data Health promises over the same windows") listing the
  promise names, default unchecked; pass the flag on execute; surface the new
  warnings verbatim.
- `src/features/data-health/PromiseDetail.tsx` — a "Rerun range" action next to
  "Run now" (gated by `PermissionGuard` on `DATA_HEALTH_RUN`), opening a dialog
  that mirrors the JobDetail recovery flow: from/to datetime-local inputs
  (default: last 7 days), Plan → slot list with an "already evaluated" marker and
  warnings, then Confirm & Execute; on completion, toast the run count and refetch
  the promise + timeline queries. Empty plan renders "No slots to rerun in this
  range", with the execute button disabled.
- Client errors follow the standard pattern (`toast.error` + `log.error`).

### 9. Server tests (Bun, via `./scripts/test-isolated-server.sh`)

- `dataHealth/store.test.ts` — replace-mode upsert: insert a slot, replay it with
  different values, assert one row per (check, slot), updated values/run_id,
  stable row id; `latestLiveSlotAt` (empty → null, ignores `backtest` origin);
  `listLiveSlotsBetween` bounds/ordering/dedup; `metricHistory` `beforeSlot`
  filtering (and unfiltered default unchanged).
- New `dataHealth/execution.test.ts` (mock the store/client boundaries as the
  existing evaluator/diagnostics tests do):
  - replay of an old slot: samples replaced, `updatePromiseEvaluation` /
    incident transitions / outbox never invoked;
  - replay of the newest slot: full path invoked;
  - live run: behavior identical with the new signature defaults.
- `scheduledQueries/store.test.ts` — `listSuccessfulSlotsBetween` (status filter,
  range bounds, DISTINCT, ordering, limit).
- Runner chain gating: unit-test the decision table (live chain / replay chain /
  no chain) — extract the gate condition into a small pure helper if needed to
  keep it testable without a ClickHouse client.

### 10. Housekeeping

- Changelog fragment `changelogs/unreleased/<pr>-clear-and-rerun.md`, `type: minor`,
  `### Added` (chained recovery + Data Health range rerun).
- Update the ADR index in `docs/adr/README.md` (done alongside this ADR).
- Pre-merge gate: `bun run lint`, `bun run typecheck`, `bunx vitest run`,
  `./scripts/test-isolated-server.sh`; dead-code scan of touched files per
  `.rules/DEAD_CODE.md`.

### No-regression invariants (each is asserted by a test above)

1. Live scheduled/manual/event runs never set `replay`/`chainReplay` — with both
   flags absent, `execute()`'s behavior is unchanged, including notifications.
2. Replays never call `claimSlot` and never write `last_run_at` — scheduler cadence
   and the multi-replica lease are untouched.
3. Every replay goes through `execute()`'s existing read-only re-validation and
   owner data-access re-check — recovery cannot become a privilege bypass.
4. Old-slot replays cannot change promise status, incidents, or notify.
5. Sample uniqueness per (check, slot, origin) is preserved under replay; `backtest`
   origin rows are never touched.
6. Outbox `dedup_key` uniqueness bounds notifications from newest-slot replays.
7. No change to `rbac/db/migrations.ts` — schema is untouched.
