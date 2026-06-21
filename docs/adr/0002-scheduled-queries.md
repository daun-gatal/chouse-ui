# 0002 — Scheduled Queries (a scheduled-execution backbone for CHouse UI)

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** CHouse UI maintainers
- **Tags:** scheduling, clickhouse, rbac, alerting, ui, deployment, backbone

> This ADR is written to be **self-contained**: an engineer or AI agent should be able
> to implement the feature from this document alone, without the design conversation
> that produced it. Where it says "mirror X", read the cited file first — the existing
> pattern is the spec for that part.

> **Naming.** The user-facing feature is **Scheduled Queries**, surfaced as a **feature tab**
> of a **new top-level `DataOps` page** (a dedicated home for user-defined, scheduled data jobs
> and data observability — Scheduled Queries now, Data Health next, future data-quality/
> freshness/report features later). `DataOps` sits beside `Monitoring` in the nav, not
> inside it: Monitoring answers "is my *cluster* healthy?" (passive, read-only `system.*`);
> DataOps answers "are my *data jobs* running and is my *data* healthy?" (user-created,
> action-oriented, may write data). Internal identifiers use the `sq_` / `scheduled_query`
> prefix (tables `scheduled_queries`, `scheduled_query_runs`, `scheduled_query_channels`,
> `scheduled_query_outbox`; RBAC permissions `scheduled_queries:view|edit|delete|run|write`;
> API prefix `/api/scheduled-queries`).

> **Self-contained and independent.** This subsystem owns its **own** scheduler, lease,
> reaper, retry, and notification outbox. It does **not** depend on, reference, or modify
> the Chouse AI doctor scheduler (`packages/server/src/services/doctorScheduler.ts`). The
> doctor scheduler is a scheduled *task* (an AI fleet scan), not a scheduled *query*, and
> stays exactly as it is.

---

## Context

CHouse UI is a web interface for ClickHouse (frontend: React 19 + Vite SPA under `src/`;
backend: Bun + Hono v4 under `packages/server/`; metadata persisted via Drizzle ORM to
**SQLite or PostgreSQL**).

Several current and planned features need the *same* capability — "run this SQL on a
cadence, record the outcome, and notify someone when it matters":

- **Data Health (ADR [0001](0001-data-quality.md), Proposed)** specifies its *own*
  scheduler, runner, lease, reaper, and notification outbox.
- **Alerting** (`packages/server/src/services/alerting/`) already owns the "where it
  delivers" half (`notification_channels` + `deliver.ts`).

Issue [#279](https://github.com/daun-gatal/chouse-ui/issues/279) questions whether Data
Health alone brings real value. The conclusion this ADR acts on: the *durable* value is
not a single feature — it is a **generic Scheduled Queries engine** that (a) is directly
useful to users on its own (schedule any read-only query; get history, alerts, and
scheduled digests), and (b) becomes the shared **backbone** that Data Health and future
features compile down onto, instead of each re-implementing scheduling, leasing, crash
recovery, and delivery.

The forces that make this non-trivial:

1. **The compute engine is ClickHouse itself.** We have no separate execution tier and
   do not want one. CHouse UI is the *orchestrator*; ClickHouse is the *executor*. Each
   scheduled query is a **read-only SELECT** pushed down to ClickHouse; the server holds
   only a bounded result snapshot and a few scalars. Jobs may also **materialize** their
   result back into a destination table — but via an **engine-generated, idempotent write**
   (D4a), never user-authored write SQL, so push-down and crash-safety still hold and the
   server still streams nothing.
2. **Deployment ranges from a single SQLite container to multi-replica K8s.** The
   scheduler must be correct under N replicas with no leader-election infra and no
   message broker.
3. **Processes die abruptly.** Rolling deploys (SIGTERM), OOMKills and `kill -9`
   (SIGKILL), node loss, and DB/ClickHouse blips must never cause double execution, lost
   slots without record, or duplicate/missed alerts. The design must be **crash-only**:
   recovery cannot depend on graceful-shutdown hooks.
4. **ClickHouse has correctness gotchas** (eventual consistency on `*MergeTree` /
   `Replicated*` / `Distributed`, floating-`now()` windows, queries that outlive their
   socket). A robust scheduled-query feature must address these explicitly (D3a), not
   pretend a scheduled `SELECT` is a transactional snapshot.
5. **It must feel native.** Reuse the existing nav/layout, RBAC, alerting channels, SQL
   editor, the Monitoring tab pattern, and the migration test harness — not parallel
   systems. (The surface is a new top-level `DataOps` page, but it reuses the same
   `TabPill`/sub-tab pattern Monitoring uses.)

This crosses RBAC + ClickHouse + scheduler + UI, so per [`.rules/ADR.md`](../../.rules/ADR.md)
it warrants an ADR before implementation.

### Existing patterns this design builds on (read these first)

| Concern | Reference implementation to mirror |
|---------|-----------------------------------|
| Multi-instance singleton service, registered at boot behind an opt-in env flag | `packages/server/src/services/fleetPoller.ts`; boot wiring in `packages/server/src/index.ts` (~line 311–321) |
| Normalized multi-table metadata + dialect-aware CRUD (`all`/`run` helpers) + secret handling | `packages/server/src/services/alerting/store.ts`, `types.ts` (the `1.39.0` `alerting_normalization` migration) |
| Notification channels + delivery (reused verbatim — no new delivery code) | `notification_channels` table + `packages/server/src/services/alerting/deliver.ts` |
| ClickHouse execution with `SETTINGS` guardrails + `AbortController` | `packages/server/src/services/clientManager.ts`, `clickhouse.ts` |
| Read-only SQL validation (`node-sql-parser`) | the validation already used for the query routes (`packages/server/src/routes/query.ts`) |
| Migration authoring + dual-dialect tests + concurrency guard | `packages/server/src/rbac/db/migrations.ts`, `migrations.test.ts`, `migrationTestHarness.ts`; `pg_advisory_lock` wrapper; `./scripts/test-migrations.sh` |
| Permission catalog + default role grants | `packages/server/src/rbac/schema/base.ts` (`PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS`) |
| Top-level nav entry (icon + label + permission gate) | `src/components/common/FloatingDock.tsx` (`navItems`, ~line 350) |
| Nav permission gating pattern | `src/lib/navAccess.ts` (`MONITORING_ACCESS_PERMISSIONS` — add a parallel `DATAOPS_ACCESS_PERMISSIONS`) |
| Page-with-sub-tabs pattern (`TabPill`, per-permission `availableTabs`) | `src/pages/Monitoring.tsx` (copy the pattern into the new `src/pages/DataOps.tsx`) |
| **Multi-step wizard pattern** (create/edit) — `STEPS` array, `Dialog` shell, stepper header, per-step validation gating *Next*, final *Review* step, editing pre-fills | `src/features/admin/components/clickhouse/ClickHouseUserWizard.tsx` (and `ClickHouseRoleWizard.tsx`) |
| **Design system** — shadcn/ui primitives + house Tailwind tokens (`ink-*` surfaces/borders, `paper`/`paper-muted`/`paper-faint` text, `rounded-xs`, mono-uppercase micro-labels) | `src/components/ui/*` (`button`, `dialog`, `card`, `tabs`, `select`, `input`, `switch`, `badge`, …); tokens as used across the wizards/alerting dialogs |
| Saved-query CRUD + frontend feature/API layout | `packages/server/src/routes/saved-queries.ts`, `src/features/alerting/`, `src/api/alerting.ts` |

Migration HEAD is **`1.39.1`**. This feature takes migration **`1.40.0`** (it ships
before Data Health; Data Health would then take a later version).

---

## Decision

Build Scheduled Queries as: a **normalized metadata schema** in the RBAC DB, an
**in-process scheduler** (per-job atomic row lease) that **pushes a read-only SELECT down
to ClickHouse** and optionally **materializes the result back into a destination table via
an engine-generated, idempotent write** (D4a), a **crash-only run lifecycle** with a reaper
and a transactional notification outbox, surfaced as the first **feature tab** of a new
top-level **DataOps** page, the Scheduled Queries tab itself having **Overview / Jobs /
Runs** sub-tabs. The engine is generic so Data
Health and future features become *producers of jobs* rather than re-implementing the
machinery.

The numbered decisions below are the binding spec.

### D1 — Data model (normalized; migration `1.40.0`, name `scheduled_queries`)

A single migration `1.40.0` named `scheduled_queries` adds the tables below to the RBAC
DB. **Author both SQLite and PostgreSQL DDL** in the same migration `up()` (switch on
`getDatabaseType()`), idempotent (`IF NOT EXISTS`), mirroring the `1.39.0` alerting
migration exactly. PostgreSQL variants use `VARCHAR`/`TIMESTAMPTZ`/`JSONB`/`BOOLEAN`
where SQLite uses `TEXT`/`INTEGER unixepoch()`/`INTEGER` (0/1 booleans).

SQLite DDL (canonical; translate to PG per the convention above):

```sql
-- A schedulable read-only query bound to one ClickHouse connection.
CREATE TABLE IF NOT EXISTS scheduled_queries (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  kind          TEXT NOT NULL DEFAULT 'sql_query', -- job-type discriminator (D2)
  connection_id TEXT NOT NULL,                     -- ClickHouse connection id
  query         TEXT NOT NULL,                     -- read-only SQL (validated SELECT-only)
  enabled       INTEGER NOT NULL DEFAULT 1,
  -- schedule (D5a)
  frequency     TEXT NOT NULL DEFAULT 'daily',     -- daily|weekly|monthly|cron|manual
  hour          INTEGER NOT NULL DEFAULT 8,        -- 0-23 UTC (fixed presets)
  day_of_week   INTEGER NOT NULL DEFAULT 1,        -- 0 Sun .. 6 Sat (weekly)
  day_of_month  INTEGER NOT NULL DEFAULT 1,        -- 1-28 (monthly)
  cron_expr     TEXT,                              -- 5-field cron, evaluated in UTC; required iff frequency='cron'
  -- result actions (D4)
  alert_config    TEXT,                            -- JSON condition or NULL (no alerting)
  export_enabled  INTEGER NOT NULL DEFAULT 0,      -- send a result digest to channels
  severity        TEXT NOT NULL DEFAULT 'warning', -- info|warning|critical (for alerts)
  -- output / materialize (D4a). output_mode='none' ⇒ pure read-only job.
  output_mode     TEXT NOT NULL DEFAULT 'none',    -- none|append|replace|upsert
  dest_database   TEXT,                            -- destination DB (required iff output_mode<>'none')
  dest_table      TEXT,                            -- destination table (required iff output_mode<>'none')
  output_config   TEXT,                            -- JSON (D4a/D4b/D4c): { partitionExpr, createIfMissing, engine, orderBy, partitionBy, staging, expectedSchema }
  -- execution guardrails + ClickHouse semantics (D3, D3a)
  max_rows        INTEGER NOT NULL DEFAULT 100,    -- rows kept in the snapshot
  timeout_secs    INTEGER NOT NULL DEFAULT 60,     -- ClickHouse max_execution_time
  use_final       INTEGER NOT NULL DEFAULT 0,      -- inject FINAL for *MergeTree dedup/collapse
  seq_consistency INTEGER NOT NULL DEFAULT 0,      -- select_sequential_consistency=1 on Replicated*
  -- scheduler lease + bookkeeping (the row IS the lease)
  last_run_at     INTEGER NOT NULL DEFAULT 0,      -- unix ms; THE atomic slot lease
  last_run_by     TEXT,                            -- runner/pod id that claimed last
  max_attempts    INTEGER NOT NULL DEFAULT 2,      -- bounded retry per slot
  retention_days  INTEGER NOT NULL DEFAULT 90,     -- run pruning window
  created_by      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS sq_enabled_idx ON scheduled_queries(enabled);

-- One execution of a scheduled query.
CREATE TABLE IF NOT EXISTS scheduled_query_runs (
  id            TEXT PRIMARY KEY NOT NULL,
  query_id      TEXT NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL,                  -- 'scheduled' | 'manual'
  status        TEXT NOT NULL,                  -- 'running'|'success'|'failed'|'error'
  slot_at       INTEGER NOT NULL,               -- the scheduled fire-time (ms) this run
                                                -- belongs to; for manual = started_at.
                                                -- Used to count attempts per slot.
  attempt       INTEGER NOT NULL DEFAULT 1,     -- 1-based attempt within slot_at
  runner_id     TEXT,                           -- pod/runner that owns this run
  deadline      INTEGER,                        -- started_at + timeout_secs*2 (ms); reaper key
  row_count     INTEGER,                        -- true result-row count (from response stats, pre-cap)
  truncated     INTEGER NOT NULL DEFAULT 0,     -- 1 if the snapshot hit max_rows (got max_rows+1)
  written_rows  INTEGER,                        -- rows written to dest for materialize jobs (D4a); NULL for read-only
  result_json   TEXT,                           -- bounded *display* snapshot (<= max_rows) as JSON
  condition_value TEXT,                         -- the value the condition was evaluated against (D4)
  condition_met INTEGER,                        -- 1 if alert_config matched (=> failed), else 0/NULL
  duration_ms   INTEGER,
  message       TEXT,                           -- error text / human summary
  notified      INTEGER NOT NULL DEFAULT 0,     -- transition-alert dedup flag
  started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at   INTEGER
);
CREATE INDEX IF NOT EXISTS sq_runs_query_idx  ON scheduled_query_runs(query_id, started_at);
CREATE INDEX IF NOT EXISTS sq_runs_status_idx ON scheduled_query_runs(status, deadline); -- reaper scan
CREATE INDEX IF NOT EXISTS sq_runs_slot_idx   ON scheduled_query_runs(query_id, slot_at); -- attempt count

-- Query -> notification channel (reuse alerting infra). M:N.
CREATE TABLE IF NOT EXISTS scheduled_query_channels (
  query_id   TEXT NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (query_id, channel_id)
);

-- Transactional outbox for crash-safe, at-least-once notification/export delivery.
CREATE TABLE IF NOT EXISTS scheduled_query_outbox (
  id         TEXT PRIMARY KEY NOT NULL,
  run_id     TEXT NOT NULL REFERENCES scheduled_query_runs(id) ON DELETE CASCADE,
  query_id   TEXT NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                     -- 'alert' | 'recovery' | 'export'
  dedup_key  TEXT NOT NULL,                     -- e.g. run_id:kind ; unique
  payload    TEXT NOT NULL,                     -- JSON message body
  status     TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'sending' | 'sent'
  locked_by  TEXT,                              -- pod/runner that claimed this row for sending
  locked_at  INTEGER,                           -- ms when claimed; reaper key for stuck 'sending'
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at    INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sq_outbox_dedup_idx  ON scheduled_query_outbox(dedup_key);
CREATE INDEX IF NOT EXISTS sq_outbox_status_idx ON scheduled_query_outbox(status, locked_at);
```

Modeling rationale:

- **Definitions vs. history separated.** `scheduled_queries` is the live definition;
  `scheduled_query_runs` is immutable history. Editing a job never rewrites past runs.
- **Result actions are a few typed columns + one `alert_config` JSON** (D4), not a wide
  sparse table.
- **The job row is the lease** (`last_run_at`); `slot_at` + `attempt` drive crash
  recovery and bounded retry (D6).
- **FKs cascade** job → runs → outbox, and job/channel, so deleting a job is one clean
  operation.

### D2 — Backbone shape (why this is reusable, not just a feature)

The service layer is self-contained and generic over *one job that produces a result*.
`scheduled_queries.kind` is a discriminator present from day one so additional job types
can share the same table, scheduler, and runner dispatch **without a schema change**.

- **Phase 1 implements only `kind='sql_query'`**: read-only SELECT → bounded result
  snapshot → optional alert condition + optional export digest + optional materialize to a
  destination table (D4a).
- **Data Health (later)** becomes a *producer* of `scheduled_queries` rows
  (`kind='data_health_check'`, `query` = the compiled probe SQL, `alert_config` = the
  threshold), inheriting scheduling, leasing, reaper, retry, and the outbox for free.
  When that happens, this ADR **supersedes the scheduler/runner/outbox portions of ADR
  0001**; ADR 0001's test catalog and compiler remain.

`runner.execute(job, {trigger, slotAt, attempt})` (D5) is the single entry point both the
scheduler and the manual-run route call; internally it is composed of the phases
`enqueueRun` (insert the `running` row) → run query + `evaluateCondition(alertConfig,
value)` → `finalizeRun(runId, outcome)` (the finalize transaction). These phase functions
are exported so a future producer (Data Health) can drive the lifecycle directly without
the HTTP layer — they are the same code the route uses, not a parallel path.

**In this effort we ship: the scheduler + the `sql_query` runner + the generic UI.**

### D3 — Execution: read-only push-down with guardrails

`runner.ts` executes the job's `query` against its connection via the existing
`clientManager`. Every query runs with hard ClickHouse guardrails and under an
`AbortController` keyed to the run:

```
SETTINGS
  max_execution_time   = <timeout_secs>,
  max_result_rows      = <max_rows + 1>,   -- +1 row to *detect* truncation (see below)
  result_overflow_mode = 'break',          -- CRITICAL: truncate at the cap instead of THROWING
  max_memory_usage     = <M>,              -- e.g. a few GB cap
  max_rows_to_read     = <R>,              -- bound the scan
  priority             = <low>             -- yield to interactive queries (D3a #5)
```

**`result_overflow_mode = 'break'` is mandatory.** ClickHouse's default behavior when
`max_result_rows` is exceeded is to *throw*, not truncate — without `'break'` every query
returning more than the cap would fail with `TOO_MANY_ROWS`. With `'break'`, ClickHouse
stops emitting rows at the cap. The runner requests `max_rows + 1`: if it receives
`max_rows + 1` rows it knows the snapshot was truncated (sets a `truncated` flag and
stores only the first `max_rows`); otherwise it got the full result.

**Snapshot vs. condition value — distinct concerns.** `result_json` is a *display*
snapshot (≤ `max_rows`); it is **not** the source of truth for a condition (D4). Because
the snapshot may be truncated, conditions never count `result_json` rows. Instead:
- `scalar` / `row_count` conditions expect the job query to be an **aggregate** (e.g.
  `SELECT count() …`, `SELECT sum(x)/count() …`) returning a handful of rows; the runner
  reads the value from the **first cell of the first row**, well under the cap.
- `rows_returned` / `no_rows` are evaluated from ClickHouse's **response statistics**
  (`response.summary` / `x-clickhouse-summary` `result_rows`), which report the true
  pre-`'break'` result-row count even when the returned rows were capped — so "any rows?"
  is correct regardless of `max_rows`.
The Runs UI shows both the (possibly truncated) snapshot and the condition's sourced value.

**The job's source query is validated SELECT-only** with the existing `node-sql-parser`
read-only validation — at create/update *and* re-checked immediately before execution. The
read-only source is what keeps re-execution analyzable and safe; when a job also
materializes, the *write* is engine-generated and made idempotent separately (D4a). Users
never author write SQL.

### D3a — Correctness & ClickHouse semantics (binding contracts)

These are first-class contracts of the feature, not optional polish:

1. **Idempotent re-execution (the foundation).** The job's **source query is always a
   validated read-only SELECT**, so re-running the read itself has zero ClickHouse side
   effects. When a job also **materializes** its result (D4a), the *write* is engine-
   generated (never user-authored DDL) and made idempotent under at-least-once retry:
   - `append`/`upsert` → `INSERT … SETTINGS insert_deduplication_token = '<query_id>:<slot_at>'`.
     The token is **slot-scoped, not run-scoped** — every attempt of the same slot (a retry
     is a *new* `run_id`) shares one token, so a reaped retry dedups to a no-op. (On
     non-Replicated MergeTree this requires `non_replicated_deduplication_window` enabled;
     Replicated dedups by default.)
   - `replace` → atomic `ALTER TABLE … REPLACE PARTITION` from staging, **idempotent by
     construction** because the SELECT covers the fixed `{{slot_start}}`–`{{slot_end}}`
     window (D3b): re-running replaces the same partition with the same data.
2. **Deterministic time windows (Airflow-style `data_interval`, `t-1 ≤ time < t`).** The
   runner injects slot-bound template params so a run covers a **fixed, reproducible
   window** instead of a floating `now()`. This is the direct equivalent of Airflow's
   `data_interval_start` / `data_interval_end` macros: a job firing at slot `t` is given
   the **half-open interval `[previous slot, t)`** — one cadence period back, i.e.
   `t-1period ≤ time < t`. Placeholders are substituted **after** read-only validation
   and bound as **query parameters** (never string-concatenated, to avoid injection):

   | Placeholder | Value | Airflow analogue |
   |---|---|---|
   | `{{slot_start}}` | the previous slot fire-time = `slot_at - one period` (the interval's inclusive lower bound) | `data_interval_start` |
   | `{{slot_end}}` | this run's slot fire-time `slot_at` (the interval's exclusive upper bound) | `data_interval_end` / logical date |
   | `{{prev_run_at}}` | the prior *successful* run's `slot_at` (for catch-up-aware incremental loads where a slot may have been skipped) | `prev_data_interval_start` |

   `{{slot_start}}` is the **previous fire-time of the same schedule before `slot_at`**,
   so the interval auto-sizes to the cadence: fixed presets give daily ⇒ `[t-1d, t)`,
   weekly ⇒ `[t-7d, t)`, monthly ⇒ `[t-1month, t)`; **custom cron** (D5a) gives whatever
   the expression implies — e.g. `* * * * *` ⇒ `[t-1min, t)`, `0 * * * *` ⇒ `[t-1h, t)`,
   `0 0 * * 1` ⇒ `[t-7d, t)`. The previous-occurrence computation lives in
   `compiler`/`runner`, is computed in UTC, and for cron reuses the same parser as the
   scheduler (D5a) so the window and the firing schedule can never disagree.

   Example job SQL: `... WHERE event_time >= {{slot_start}} AND event_time < {{slot_end}}`.
   Because the window is anchored to `slot_at` (not wall-clock), a reaped/retried run of
   the same slot gets the **same** interval ⇒ the same verdict. The substituted values
   are recorded on the run for auditability and shown in the Runs drill-down.
3. **Eventual-consistency awareness.** ClickHouse reads are not transactional. The
   builder exposes two opt-in toggles persisted in D1, and the UI documents the
   trade-off:
   - `use_final` → apply `FINAL` semantics so `ReplacingMergeTree` / `CollapsingMergeTree`
     / `AggregatingMergeTree` do not report not-yet-merged duplicates as real ones.
   - `seq_consistency` → add `SETTINGS select_sequential_consistency = 1` so reads on
     `Replicated*MergeTree` are read-your-writes (avoids false freshness/volume failures
     from a lagging replica), at a latency cost.

   `Distributed` skew (a shard down under `skip_unavailable_shards`) is surfaced in run
   metadata rather than hidden. **Principle: a run reflects ClickHouse's
   eventually-consistent state at run time — never presented as a transactional snapshot.**
4. **Traceable + truly cancellable.** Every execution sets `query_id = <run_id>` and a
   `log_comment = "chouse:scheduled_query:<query_id>"`, so each run correlates with
   `system.query_log`. Real cancellation on timeout / SIGTERM / reap is
   `KILL QUERY WHERE query_id = '<run_id>'` (best-effort, issued on the same connection).
   The `AbortController` only drops the HTTP socket; the `KILL QUERY` is what actually
   frees ClickHouse resources.
5. **Resource governance.** Beyond per-query `SETTINGS`, scheduled queries should run
   under a constrained ClickHouse **settings profile / quota with a lowered `priority`**
   (operator-configurable on the connection or via a documented CH user) so a fleet of
   jobs cannot starve interactive users. The scheduler additionally caps **global**
   in-flight concurrency (~4), not just per-job.
6. **No backfill (documented contract).** `lastScheduledFireMs` fires **once for the
   most recent missed slot**; a multi-slot outage does **not** stampede catch-up runs.
   For windowed rollups a skipped slot is a visible gap, surfaced in Runs. True backfill
   is a deliberate later feature.
7. **Snapshot sensitivity = source sensitivity.** Result snapshots live in the RBAC'd
   app DB, are bounded by `max_rows`, and are pruned by `retention_days`; they inherit
   the access controls of the data they read and have a finite lifetime.
8. **Fail-soft on schema drift.** A query that breaks (dropped column, unreachable
   table, etc.) yields a per-run `status='error'` — surfaced and alertable — and never
   wedges the scheduler.

### D3b — Template parameter binding (how `{{…}}` becomes ClickHouse SQL)

This is the concrete mechanism behind D3a #2; it is binding, not illustrative.

- **Placeholder syntax (what the user types):** double-brace `{{name}}` tokens —
  `{{slot_start}}`, `{{slot_end}}`, `{{prev_run_at}}`. Double braces are chosen so they do
  **not** collide with ClickHouse's own native parameter braces `{name:Type}`. Only this
  fixed, known set is recognized; an unknown `{{token}}` is a **validation error** at
  create/update (fail closed — never sent to ClickHouse).
- **Rewrite step (server-side, in `runner.ts`, after read-only validation):** the runner
  replaces each `{{name}}` with a **native ClickHouse query parameter** of the form
  `{sq_name:DateTime64(3, 'UTC')}` (e.g. `{{slot_start}}` → `{sq_slot_start:DateTime64(3, 'UTC')}`)
  and passes the values via `@clickhouse/client`'s `query_params`. **No string
  concatenation of values into SQL** — ClickHouse binds them, so injection is impossible
  and types are explicit.
- **Value type & timezone:** each window value is a **UTC millisecond instant** rendered
  as a `DateTime64(3,'UTC')` parameter. Comparing a `DateTime` column to a
  `DateTime64(3,'UTC')` param is well-defined in ClickHouse (the column is promoted). If a
  user needs `Date`/`DateTime` granularity they wrap the param (`toDate({{slot_start}})`,
  `toStartOfHour({{slot_end}})`) — the rewrite still produces a bound param inside their
  expression.
- **Values supplied per run** (all derived from `slot_at` + cadence via the shared
  `cadence.ts`, so the window and the firing schedule are always consistent):
  - `slot_end`   = `slot_at` (this run's fire-time; exclusive upper bound).
  - `slot_start` = the **scheduled occurrence immediately before `slot_at`** for this
    job's cadence (inclusive lower bound). Independent of run history — a backfill/retry of
    the same `slot_at` always yields the same `slot_start`.
  - `prev_run_at` = `slot_at` of the **last `status='success'` run** of this job, or
    `slot_start` if there is none. This differs from `slot_start` only after a skipped/
    failed slot (no-backfill, D3a #6): use `{{slot_start}}` for a fixed per-slot window,
    `{{prev_run_at}}` for a gap-filling incremental load.
- **Worked example.** Daily job, `slot_at = 2026-06-20 08:00Z`, user SQL
  `SELECT count() FROM events WHERE event_time >= {{slot_start}} AND event_time < {{slot_end}}`
  is executed as
  `SELECT count() FROM events WHERE event_time >= {sq_slot_start:DateTime64(3,'UTC')} AND event_time < {sq_slot_end:DateTime64(3,'UTC')}`
  with `query_params = { sq_slot_start: '2026-06-19 08:00:00.000', sq_slot_end: '2026-06-20 08:00:00.000' }`.
  The substituted values are persisted on the run (e.g. in `result_json` metadata) and
  shown in the Runs drill-down.
- **Templating is optional.** A job with no `{{…}}` tokens runs verbatim (after read-only
  validation). Non-`sql_query` producers (Data Health) may pass the same params.

### D4 — Result actions (`alert_config` JSON, Zod-validated; server uses Zod v3)

A job optionally carries an alert condition (`alert_config`) and/or an export flag
(`export_enabled`). Phase-1 condition shapes:

```jsonc
// no_rows        — fail if the query returns ZERO rows ("expected something, got nothing")
{ "type": "no_rows" }
// rows_returned  — fail if the query returns ANY rows (classic alert query: rows = problems)
{ "type": "rows_returned" }
// row_count      — fail when the row count crosses a bound
{ "type": "row_count", "operator": "gt", "value": 1000 }
// scalar         — first column of the first row vs a threshold (count/ratio/value probes)
{ "type": "scalar", "operator": "gte", "value": 0.01 }
```

`operator ∈ gt | gte | lt | lte | eq | neq`. The value each type is evaluated against is
**sourced per D3** (scalar/row_count from the aggregate's first cell / response stats, not
from the truncated snapshot), stored stringified in `scheduled_query_runs.condition_value`
for display, and compared to produce `condition_met`. **Run-status resolution:**
- `error` — the query timed out, was unreachable, or otherwise failed (D3a #8).
- else `failed` — `alert_config` is present **and** the condition matched
  (`condition_met = 1`).
- else `success`.

**Export** (`export_enabled = 1`) enqueues a digest **every run** regardless of
pass/fail (D7). This `{no_rows, rows_returned, row_count, scalar}` set is exactly what
Data Health probes need, which is why it doubles as the backbone condition model.

### D4a — Output / materialize modes (write-back to ClickHouse)

A job may **materialize** its result into a destination table. The **source stays a
validated read-only SELECT** (D3) — users never write the `INSERT`/DDL themselves; the
runner **generates** the write statement from `output_mode` + `dest_database`/`dest_table`
(+ `output_config`). This preserves read-only validation, deterministic templated windows
(D3b), and the idempotency contract (D3a #1). Writing requires the
`scheduled_queries:write` permission (D8).

`output_mode`:

- **`none`** (default) — pure read-only job; behaves exactly as D1–D4.
- **`append`** — `INSERT INTO dest <SELECT> SETTINGS insert_deduplication_token = '<query_id>:<slot_at>'`.
  The slot-scoped token (D3a #1) makes a reaped retry a no-op. Typical use: incremental
  rollups appended each slot, with a `{{slot_start}}`/`{{slot_end}}` window so each run
  contributes exactly its interval.
- **`replace`** — overwrite the slot's partition(s) atomically:
  1. `INSERT INTO <staging> <SELECT>` (staging = a per-job table with the **same engine/
     schema** as `dest`; name from `output_config.staging` or defaulted
     `<dest_table>__sq_staging`), preceded by `TRUNCATE TABLE <staging>` so the step is
     self-cleaning and retry-safe.
  2. For each partition the SELECT produced, `ALTER TABLE dest REPLACE PARTITION <id> FROM <staging>`
     — an **atomic** swap. The partitions are computed from
     `output_config.partitionExpr` (e.g. `toYYYYMMDD({{slot_end}})`) applied to the window,
     so a job's run replaces only its own slot's partition(s), never the whole table.
  Idempotent by construction: re-running replaces the same partition with the same data.
- **`upsert`** — `append` (with the dedup token) into a destination that is a
  **`ReplacingMergeTree`** (or `Aggregating`/`Collapsing`) keyed on the business key.
  Dedup-by-key happens **eventually on merge** (or at read time with `FINAL`), per
  ClickHouse semantics — this is not a synchronous OLTP upsert, and the builder documents
  that. No engine-side mutation (`ALTER … UPDATE`) is used.

Execution & bookkeeping:
- For `output_mode<>'none'`, the **write is the primary action**: ClickHouse executes the
  `INSERT … SELECT` (full push-down — the server never streams the rows), and the runner
  records `written_rows` from the response summary. A small display snapshot (`result_json`)
  is **optionally** produced via a separate `… LIMIT max_rows` preview only if cheap;
  otherwise `result_json` holds the write summary (mode, dest, partitions replaced).
- **Alert conditions still apply** to materialize jobs. For `output_mode<>'none'` the
  condition is evaluated against **`written_rows`** (the rows ClickHouse reported writing),
  so `row_count`/`no_rows`/`rows_returned`/`scalar` map naturally onto the load — e.g.
  `{ "type": "row_count", "operator": "eq", "value": 0 }` alerts on an **empty load**, and
  `no_rows` ⇔ `written_rows = 0`. (For `output_mode='none'` the condition is sourced from
  the SELECT result as in D4/D3.) Whichever is used is stored in `condition_value`.
- **Crash safety:** a death between the staging insert and the `REPLACE PARTITION` (replace
  mode), or mid-`INSERT` (append/upsert), is reaped → the slot retries → the staging
  `TRUNCATE`+insert and the atomic replace (or the dedup-token append) make the retry
  converge to the same end state. Re-execution is safe for **all** modes.
- **Validation (create/edit):** `dest_database`/`dest_table` required when
  `output_mode<>'none'`; verify the connection's CH user has `INSERT` (and, for `replace`,
  `ALTER`) on the destination (D8); `partitionExpr` required for `replace`. The destination
  must not equal a `system.*` table; the source SELECT is still read-only-validated. The
  exists/not-exists and schema-compatibility handling is D4b.

### D4b — Destination table lifecycle (exists vs. not-exists)

The result schema of the source SELECT is discovered **without running the query** via
`DESCRIBE (SELECT … )` (binding the D3b window params with the current slot's values), and
the destination is introspected via `system.tables` / `system.columns`. `output_config`
carries the creation knobs: `{ createIfMissing, engine, orderBy, partitionBy, staging }`.

**If the destination already exists** — validate compatibility at create/edit (and
fail-soft at run time, D3a #8, if it drifts later):
- **Columns:** every column the SELECT produces must exist in `dest` with a compatible
  type (matched by **name**; the generated `INSERT INTO dest (col1,col2,…) SELECT …` names
  columns explicitly so it never relies on positional order). Extra nullable/defaulted
  columns in `dest` are fine; a missing or type-incompatible column is a **hard validation
  error** with the offending column named.
- **Engine fit per mode:** `upsert` requires `dest` be a `ReplacingMergeTree`
  (or `Aggregating`/`Collapsing`) — reject otherwise; `replace` requires `dest` be a
  `MergeTree`-family table **with a `PARTITION BY`** and that `partitionExpr` matches the
  table's partition key — reject otherwise; `append` accepts any `MergeTree`-family table.
- We **never auto-`ALTER`** an existing destination; drift is surfaced as a run error, not
  silently reconciled.

**If the destination does not exist** — governed by `output_config.createIfMissing`:
- **`false` (default, safe):** saving the job is **rejected** with "destination does not
  exist", and the builder shows a **generated `CREATE TABLE` DDL** (inferred columns from
  `DESCRIBE` + the user-supplied `engine`/`orderBy`/`partitionBy`) that the user can copy/run
  explicitly. No implicit schema creation.
- **`true` (opt-in):** before the first write the runner ensures the table with an
  **idempotent** `CREATE TABLE IF NOT EXISTS dest (<inferred cols>) ENGINE=<engine>
  [PARTITION BY <partitionBy>] ORDER BY <orderBy>` — `engine`/`orderBy` required,
  `partitionBy` required for `replace`. It runs every execution but is a no-op once the
  table exists, and is safe under concurrent pods (`IF NOT EXISTS`; use `ON CLUSTER` when the
  connection is configured for it — an operator concern noted in the builder).

**Staging (replace mode) is automatic.** The runner always does
`CREATE TABLE IF NOT EXISTS <staging> AS <dest>` (clones `dest`'s exact structure **including
the partition key**, which `REPLACE PARTITION` requires) then `TRUNCATE`+insert — so staging
can never diverge from `dest`, and it needs no separate user config beyond an optional name.
This also means `replace` requires `dest` to exist (or `createIfMissing=true`) **first**,
since staging clones it.

### D4c — Schema evolution & drift (the data contract)

Governing principle: **named-column writes + a pinned schema contract; fail-closed on
edit, fail-soft on run, additive-only auto-evolution, never destructive, never silent.**

- **Named-column writes (from D4b) are the first line of defence.** Because the generated
  statement is `INSERT INTO dest (col1,col2,…) SELECT …`, a SELECT↔dest mismatch can never
  positionally corrupt data — at worst the statement errors and nothing commits.
- **Pinned schema contract.** On create — and on every *accepted* edit — the job stores the
  SELECT's output schema, `output_config.expectedSchema = [{name,type}, …]`, captured via
  `DESCRIBE (SELECT …)`. Before each materialize run the runner recomputes
  `DESCRIBE (SELECT …)` and diffs it against the pin:
  - identical → write.
  - **drift** (a column added / removed / retyped vs. the pin — e.g. from a `SELECT *`
    picking up an upstream column, or an upstream type change) → **do not write**; the run is
    `status='error'` with message `"source schema changed since configuration: <diff>"` and
    an operational alert fires (D3a #8). This turns silent drift into an explicit, auditable
    signal instead of a cryptic ClickHouse type error — or, worse, a wrong write.
- **Edit-time (the user changes the SELECT)** re-runs the D4b compatibility check against
  `dest` and classifies the diff:
  - **compatible** (same or a subset of columns, types still assignable) → accept and
    **re-pin** `expectedSchema`.
  - **additive** (new output columns not yet in `dest`) → offer a generated
    **`ALTER TABLE dest ADD COLUMN …` DDL preview** (requires `scheduled_queries:write` +
    `ALTER`); applying it then re-pins. **Additive only.**
  - **destructive** (a column `dest` relies on is dropped or retyped incompatibly) →
    **blocked**. The safe path is a **new destination/table version** (a deliberate manual
    migration), not an in-place `DROP COLUMN`/`MODIFY COLUMN`. The engine **never generates
    destructive DDL**.
- **`SELECT *` is flagged** (save-time lint warning) for materialize jobs because it makes
  the output schema depend on upstream DDL; an explicit column list is recommended and keeps
  the pin stable.
- **External `ALTER` of `dest`** (e.g. someone adds a nullable column) is harmless: the
  named-column INSERT ignores it, and dest-compatibility is re-checked each run via the same
  diff — so the table can evolve ahead of the job without breaking it.

Net: schema changes are always **surfaced and gated**, additive evolution is one
explicit confirmation away, and a headless scheduler can never silently reshape or
mis-populate a production table.

### D5 — Scheduler: in-process tick + per-job atomic lease

Implement `packages/server/src/services/scheduledQueries/scheduler.ts` as a **singleton**
service: `getInstance()`, `start()` with `setInterval(tick, 60_000)` + `timer.unref()`,
`stop()`, and a `running` re-entry flag. Register it at boot in
`packages/server/src/index.ts` (in the post-`initializeRbac` block, alongside the fleet
poller), behind an opt-in env flag mirroring `FLEET_POLLER_ENABLED`:

```ts
if (process.env.SCHEDULED_QUERIES_ENABLED !== "false") {
  const { ScheduledQueryScheduler } = await import("./services/scheduledQueries/scheduler");
  ScheduledQueryScheduler.getInstance().start();
}
```

Because there are **many jobs** (unlike a single-row config), the tick iterates enabled
jobs and claims **per job** with an atomic conditional UPDATE — the job row itself is the
lease:

```
tick()  // guarded by the `running` flag; skip if already running
  reaperPass()                 // D6 — finalize orphaned runs first
  outboxDeliverPass()          // D7 — send pending alerts/exports
  jobs = SELECT * FROM scheduled_queries WHERE enabled = 1   // live config, re-read each tick
  for job in jobs (bounded concurrency, e.g. 4 in flight):
    if job.frequency == 'manual': continue
    fireAt = lastScheduledFireMs(job, now)        // most recent due slot <= now
    if job.last_run_at >= fireAt: continue         // fast path: slot already ran
    // ATOMIC CLAIM — the row IS the lease:
    claimed = UPDATE scheduled_queries
              SET last_run_at = :now, last_run_by = :runnerId
              WHERE id = :job.id AND last_run_at < :fireAt   // rowsAffected==1 means we won
    if not claimed: continue                       // another pod/tick took it
    runner.execute(job, { trigger:'scheduled', slotAt:fireAt, attempt:1 })
  pruneOldRuns()               // delete runs older than retention_days (cascade to outbox)
```

`lastScheduledFireMs(job, now)` (in `cadence.ts`) returns the most recent slot ≤ now in ms
from the job's cadence (fixed presets from `frequency`/`hour`/`day_of_week`/`day_of_month`,
or `cron_expr` — see D5a; all UTC), or `null`/`0` if none is due yet. A sibling
`previousFireMs(job, slotAt)` returns the occurrence immediately before a given slot — this
is what produces `{{slot_start}}` for the window (D3b), so the firing schedule and the
window come from one source. The `UPDATE ... WHERE last_run_at < fireAt` is
atomic under both SQLite (single writer) and PostgreSQL (row lock + MVCC re-evaluation
under READ COMMITTED): with concurrent pods the first commits `last_run_at = now`; the
second's `WHERE` re-evaluates against the committed value and affects 0 rows. **No leader
election, no broker.** We key off the affected-row count (1 = we won), not on reading the
holder back, so it is correct even when the same holder retries.

`runner.execute()` first **records the run atomically**: `INSERT scheduled_query_runs`
with `status='running'`, `started_at`, `deadline = started_at + timeout_secs*2*1000`,
`runner_id`, `slot_at`, `attempt`, and uses `run.id` as the ClickHouse `query_id` (D3a
#4). Then: if `output_mode='none'` it runs the SELECT (D3, D3a) and snapshots; if
`output_mode<>'none'` it runs the **engine-generated write** (D4a) against ClickHouse and
records `written_rows`. It evaluates the condition (D4), and within a single DB
transaction writes `result_json`/`row_count`/`written_rows`/`condition_value`/
`condition_met`/`status`/`duration_ms`/`finished_at`, flips `notified` as needed, and
inserts any `scheduled_query_outbox` rows. The ClickHouse write is committed by ClickHouse
*before* this transaction; if the pod dies between the two, the reaper + idempotent write
(D4a, D6) make the retry converge. Delivery happens separately (D7).

The **manual run** route (`POST /:id/run`) calls the same `runner.execute(job, {
trigger:'manual', slotAt: now, attempt: 1 })`; manual runs do not consume the scheduled
lease slot (their `slot_at` is `now`), so a manual run and a scheduled run can coexist.

### D5a — Cadences: fixed presets + custom cron

A job's cadence is one of `frequency ∈ daily | weekly | monthly | cron | manual`. The
first three are the simple presets (existing `hour`/`day_of_week`/`day_of_month` columns);
`manual` never auto-fires; **`cron` is a custom 5-field cron expression** (`cron_expr`)
for everything the presets can't express (every minute, every 15 min, hourly, "weekdays
at 06:30", "1st and 15th", …).

- **Parsing / next-and-previous-fire math** uses a single small, well-tested cron library
  — **`croner`** (zero-dependency, TypeScript, Bun-compatible, handles next/previous
  occurrence) — used by **both** `lastScheduledFireMs()` (most recent fire ≤ now) **and**
  the `{{slot_start}}` previous-occurrence computation (D3a #2), so the firing schedule and
  the templated window are always derived from the *same* source and can never disagree.
- **All cron is evaluated in UTC.** This matches the preset `hour` semantics and sidesteps
  DST ambiguity (no skipped/duplicated fires around clock changes). A per-job timezone is a
  possible later extension; phase 1 is UTC-only and the builder labels it as such.
- **Tick granularity & minimum interval.** The tick runs every 60 s, so the finest
  *effective* cadence is **1 minute**; cron fields finer than a minute are not supported.
  Validation **rejects** sub-minute expressions and (configurably) caps very-high-frequency
  schedules; `lastScheduledFireMs` returns only the **most recent** missed slot, so even if
  several cron occurrences elapsed between ticks (a slow/delayed tick), the job fires
  **once**, never a burst — consistent with the no-backfill contract (D3a #6).
- **The slot model is unchanged.** `cron` plugs in purely at `lastScheduledFireMs()`; the
  atomic lease, the `running`/reaper lifecycle, retry, the outbox, and at-least-once
  semantics (D5–D7) are identical to the preset cadences. Switching a job between presets
  and cron is a normal `PATCH` — no schema change, effective next tick.
- **Validation (D8/D9):** `cron_expr` is required iff `frequency='cron'`, must parse under
  `croner`, must not be sub-minute, and is normalized before persist. The builder shows the
  parse error inline and a **preview of the next N fire times** (also from `croner`) so the
  user sees exactly when it will run before saving.

### D6 — Crash-only resilience (force-kill / sudden termination)

Governing principle: **SIGKILL gives no chance to clean up**, so correctness must not
depend on shutdown handlers. State is recoverable and recovery runs on the next tick from
*any* pod.

- **Claim + `running` row are written together** ⇒ you can never get a consumed slot with
  no record.
- **Reaper** (runs each tick, before claiming): one idempotent conditional UPDATE
  ```sql
  UPDATE scheduled_query_runs
  SET status='error', message='reaped: runner lost (deadline exceeded)', finished_at=:now
  WHERE status='running' AND deadline < :now
  ```
  Survives SIGKILL / OOMKill / node-loss; double-reap-safe (first writer wins). On reap,
  also issue the best-effort `KILL QUERY WHERE query_id='<run_id>'` (D3a #4) on the job's
  connection.
- **Bounded retry within slot:** after reaping an orphaned scheduled run, re-open the
  slot (`UPDATE scheduled_queries SET last_run_at = 0 WHERE id=:id AND last_run_at = :slot`)
  **only if** `COUNT(runs WHERE query_id=:id AND slot_at=:slot) < max_attempts` (default
  2). The retry creates a new run with `attempt = count+1`. After `max_attempts`, leave
  the slot errored and surface it (do not loop). The next cadence proceeds normally.
  **Manual runs are reaped but never auto-retried** (their `slot_at = now` is unique, so the
  re-open/retry logic — keyed on the scheduled slot — does not apply); a reaped manual run is
  simply left `error` for the user to re-trigger.
- **Re-execution is safe** because the **source read is read-only** (no side effects) and
  any **materialize write is idempotent** (slot-scoped dedup token / atomic `REPLACE
  PARTITION`, D4a) — so at-least-once execution converges to the same state.
- **Push-down protects the orchestrator:** heavy work + memory live in ClickHouse
  (`max_memory_usage`, `max_result_rows`, `max_rows_to_read`), so a runaway query fails
  the *run*, not the pod.
- **Graceful path is best-effort only:** a SIGTERM handler calls `scheduler.stop()` (stop
  claiming new jobs), aborts in-flight ClickHouse queries via `AbortController`, and
  issues `KILL QUERY` for their `query_id`s; anything not drained within
  `terminationGracePeriodSeconds` falls back to the reaper.
- **Watchdog:** if the `running` flag has been set longer than `max(timeout_secs)*2`, log
  an error and reset it so one wedged tick can't silently stop scheduling (other pods
  keep ticking regardless).

Failure taxonomy and handling:

| Failure | Handling |
|---------|----------|
| SIGTERM (rolling deploy / scale-down) | stop claiming, abort + `KILL QUERY`, drain within grace; remainder → reaper |
| SIGKILL / `kill -9` / OOMKill | stuck `running` row → reaper next tick; slot lease prevented double-fire |
| Node crash / network partition | same as SIGKILL — durable state is the Postgres lease row |
| Died after CH query, before persisting | reaped → bounded retry; read-only source + idempotent write (D4a) make re-run safe |
| Postgres failover mid-run | run left `running` → reaped on recovery; pool timeouts keep the event loop free |
| ClickHouse unreachable / restart mid-query | run → `error`; one operational notification |
| Liveness probe kills a wedged pod | other pods keep scheduling; watchdog resets the stuck flag |
| Poison run (repeatedly kills its pod) | `max_attempts` bound + CH resource caps stop the reap→retry→crash loop |
| Re-entrant tick double-fire | `running` flag + atomic claim → second attempt affects 0 rows |

### D7 — Notifications & exports: reuse alerting, transactional outbox, transition-based

- **Delivery reuses the alerting infra** — `notification_channels` +
  `packages/server/src/services/alerting/deliver.ts`. **No new delivery code.** Jobs link
  channels via `scheduled_query_channels` (M:N).
- **Alerts are transition-based** (anti-flapping): notify only when a job flips
  `success → failed/error` (and send a single "recovered" note on the reverse),
  determined by comparing the current run to the previous run for that job (the
  `notified` flag + a prior-row lookup). Sustained failures stay quiet.
- **Exports** (`export_enabled = 1`) enqueue an `export` outbox row each run — a digest
  with the row count, a small result preview, and a deep link to the run.
- **Transactional outbox for crash-safe at-least-once delivery:** outbox rows are written
  inside the run's finalize transaction (each with a `dedup_key`, e.g. `run_id:alert`,
  `run_id:export`). A delivery pass each tick (runnable by any pod) claims and sends rows
  with a **per-row atomic claim** so two pods never deliver the same row:
  1. **Claim** (atomic, the row is the lease — mirrors the suite-claim pattern):
     ```sql
     UPDATE scheduled_query_outbox
     SET status='sending', locked_by=:podId, locked_at=:now
     WHERE id=:id AND status='pending'      -- rowsAffected==1 ⇒ this pod owns it
     ```
     Only the pod whose UPDATE flips the row proceeds; others get 0 rows and skip it.
  2. **Send** via `deliver.ts`, then `UPDATE … SET status='sent', sent_at=:now WHERE id=:id`.
     On failure, `UPDATE … SET status='pending', locked_by=NULL, attempts=attempts+1`
     (bounded; past a cap, leave it for inspection).
  3. **Stuck-`sending` reaper** (same delivery pass): rows in `sending` with
     `locked_at < now - <leaseTtl>` (a pod died mid-send) are reset to `pending` so another
     pod retries.

  Survives a hard kill between commit and send (the row persists `pending`); a kill between
  send and the `sent` mark may re-deliver once on the next pass — that rare duplicate is the
  accepted at-least-once tradeoff, bounded by the unique `dedup_key` (which prevents
  duplicate *rows*; the claim prevents *concurrent* double-send).

Notification payload sketch:

```
[Scheduled Query] "errors_last_hour" on prod-ch — ALERT
Condition: rows_returned (got 42 rows, expected 0)
Window: 2026-06-20 09:00 .. 10:00 UTC
Sample: 2026-06-20 10:02  500  /api/checkout  ...
[View run →]
```

### D8 — RBAC

Add to `PERMISSIONS` in `packages/server/src/rbac/schema/base.ts` and seed them in
migration `1.40.0` (granted to `SUPER_ADMIN` automatically via `Object.values`, and to
`ADMIN` explicitly in `DEFAULT_ROLE_PERMISSIONS`):

```
scheduled_queries:view     // see the tab, jobs, runs, overview
scheduled_queries:edit     // create/update jobs (includes the read-only SQL body)
scheduled_queries:delete   // delete jobs
scheduled_queries:run      // trigger a manual run
scheduled_queries:write    // create/edit jobs with output_mode<>'none' (materialize) — higher bar
```

`scheduled_queries:write` is granted to `ADMIN` (not to lower roles by default): a
materialize job writes into ClickHouse, so it is a deliberately higher bar than authoring a
read-only job. The `view/edit/delete/run` set follows the saved-queries/alerting default
grants.

Server routes use `rbacAuthMiddleware` + `requirePermission`. No separate `custom_sql`
permission is needed: *every* scheduled query is user SQL, gated by `:edit` plus read-only
validation.

**How the data-access boundary is actually enforced** (there is no request user at
scheduled run time, so this must be concrete):

- **The boundary is the ClickHouse connection.** A scheduled run executes against its
  `connection_id` using **that connection's stored ClickHouse credentials** — exactly the
  same credentials an interactive query on that connection uses. So a scheduled query has
  **no more ClickHouse privilege than any interactive query on the same connection**: if
  the connection's CH user has table/row grants, ClickHouse enforces them on the scheduled
  run identically (we add nothing and bypass nothing).
- **Connection access is checked at create/edit time, not run time.** On `POST`/`PATCH`,
  verify the **creating user can access `connection_id`** under the existing connection
  RBAC (mirror how `saved-queries`/`query` routes authorize a connection). A user therefore
  cannot schedule a job on a connection they could not use interactively. `created_by` is
  recorded for audit; the run itself carries no user identity.
- **Read-only is re-validated every run** (D3) on the **source** SELECT, so an edit can
  never smuggle a write into the source past the create-time check.
- **Materialize writes (D4a)** require `scheduled_queries:write` **and** that the
  connection's ClickHouse user holds `INSERT` (plus `ALTER` for `replace`) on
  `dest_database.dest_table` — verified at create/edit and ultimately enforced by ClickHouse
  at run time. The write statement is engine-generated, so it cannot target anything but the
  declared destination (no arbitrary DDL).

This is the honest guarantee: **connection-scoped**, enforced at edit time + by ClickHouse
at run time. (If finer, per-user CH grants are ever needed, the follow-up is a "run-as"
that stores the creator's CH role/user on the job — explicitly out of phase 1.)

### D9 — API surface

New `packages/server/src/routes/scheduled-queries.ts` (+ client
`src/api/scheduledQueries.ts`), both with co-located tests per `CLAUDE.md`. Service layer
under `packages/server/src/services/scheduledQueries/`: `types.ts` (enums `SqKind`,
`SqTrigger`, `SqStatus`, `SqSeverity`, `SqConditionType`, `SqOperator`, `SqOutputMode` +
row types),
`store.ts` (dialect-aware CRUD mirroring `alerting/store.ts`'s `all`/`run` helpers),
`runner.ts`, `scheduler.ts`. Mount the router in `packages/server/src/routes/index.ts`.

```
GET    /api/scheduled-queries                    // list jobs (+ last-run summary)
POST   /api/scheduled-queries                    // create (validates read-only SQL)
GET    /api/scheduled-queries/:id
PATCH  /api/scheduled-queries/:id
DELETE /api/scheduled-queries/:id
POST   /api/scheduled-queries/:id/run            // manual run (runner.execute, trigger='manual')
GET    /api/scheduled-queries/:id/runs           // run history (paginated)
GET    /api/scheduled-queries/runs/:runId        // one run + bounded result snapshot
GET    /api/scheduled-queries/overview?window=14d// dashboard aggregation (D10)
POST   /api/scheduled-queries/preview            // builder helper (no persist): validate read-only +
                                                 //   {{…}} tokens, return next-N fire times (D5a),
                                                 //   and for materialize: DESCRIBE-based output schema,
                                                 //   dest compatibility/engine-fit (D4b/D4c) + generated
                                                 //   CREATE/ALTER DDL preview. Requires :edit (+ :write for output)
```

### D10 — Frontend: new top-level `DataOps` page → feature tabs → per-feature sub-tabs

The IA is **three levels**:

```
DataOps (top-level page)                                   /dataops
 ├─ Scheduled Queries (feature tab, phase 1)               /dataops/scheduled-queries
 │    ├─ Overview (sub-tab, default)                       /dataops/scheduled-queries/overview
 │    ├─ Jobs     (sub-tab)                                /dataops/scheduled-queries/jobs
 │    └─ Runs     (sub-tab)                                /dataops/scheduled-queries/runs
 ├─ Data Health (feature tab, ADR 0001, later)             /dataops/data-health
 └─ … future data-quality / observability features
```

- **Level 1 — the page & nav:** add a new top-level **`DataOps`** entry to `navItems` in
  `src/components/common/FloatingDock.tsx` (~line 350, beside `Monitoring`) — icon + label
  `"DataOps"` + route `/dataops`, gated on a new `canViewDataOps` derived from a
  `DATAOPS_ACCESS_PERMISSIONS` set in `src/lib/navAccess.ts` (parallel to
  `MONITORING_ACCESS_PERMISSIONS`; phase-1 membership = `scheduled_queries:view`, growing as
  features land). Add the `/dataops/:feature?/:sub?` route in `src/App.tsx` and a new page
  `src/pages/DataOps.tsx`.
- **Level 2 — feature tabs:** `DataOps.tsx` renders a **`TabPill` bar of feature tabs**
  (copying the Monitoring `TabPill` + per-permission `availableTabs` pattern), one per data
  feature. **Phase 1 has a single feature tab, `Scheduled Queries`**; **Data Health** (ADR
  0001) becomes a sibling feature tab here when built (moving off "Monitoring → Data
  Health" — see Consequences). DataOps is a category home, not a one-feature page; this is
  what keeps it from launching as a lonely page and gives future features an obvious slot.
  Each feature tab is permission-gated, so a user only sees the features they can access.
- **Level 3 — the Scheduled Queries feature** lives in `src/features/scheduled-queries/`
  and owns its own **inner sub-tab bar** (Overview / Jobs / Runs). Data via TanStack Query
  (`useScheduledQueries`, `useScheduledQueryRuns`, `useScheduledQueriesOverview`); builder
  draft state local (`useState` / small Zustand slice); mutations invalidate query keys.
  Tests co-located.
- **Sub-tabs of the Scheduled Queries feature** (route segment
  `/dataops/scheduled-queries/:sub?`, `:sub ∈ overview|jobs|runs`, for deep-linking/
  back-button):
  - **Overview** (default) — KPI row (jobs enabled, **failing now**, **errored**,
    last-24h run count), **pass-rate trend** (group `scheduled_query_runs` by day), and
    **top failing jobs** ranked by failure streak (consecutive failed runs). Deep-link a
    failing job → its Runs drill-down.
  - **Jobs** — status-sorted list (failing floats up): name, connection, schedule,
    last-run verdict, next-run countdown; row actions Run-now / Edit / Disable / Delete;
    `+ New job`. Create **and** Edit open the **builder wizard** (D10a) — Edit pre-fills
    every step from the existing job.
  - **Runs** — reverse-chronological feed of `scheduled_query_runs` (failed/errored
    shaded), showing trigger (`scheduled` vs `manual · user`), row count, duration, and
    condition outcome; filter by job and status. Expanding a run loads its bounded
    `result_json` snapshot in AG Grid plus the substituted window params.
- **Editor entry point:** add a **"Schedule this query"** action in the SQL editor /
  saved-queries surface (`src/features/workspace`, `src/api/saved-queries`) that opens the
  builder prefilled with the current query + connection — the natural on-ramp that makes
  the feature discoverable.
- **`GET /overview`** is read-only aggregation over existing tables (no new storage):
  KPIs, the daily trend series, and the streak ranking (consecutive `failed/error` runs
  per job).

### D10a — Builder: a multi-step wizard (create & edit)

Creating and editing a job both use a **multi-step wizard**, not one long form —
**mirroring `src/features/admin/components/clickhouse/ClickHouseUserWizard.tsx`** (a
`STEPS` array + `type Step`, a `Dialog` shell with a stepper in the header, per-step
validation that gates **Next**, a final **Review** step, and Edit pre-filling every step).
Reuse that pattern verbatim; do not invent a new wizard shell.

Steps (each maps to the D-sections that define its rules):

1. **Source** — name, description, connection picker, and the **Monaco SQL editor** (reuse
   the existing editor) with the `{{slot_start}}`/`{{slot_end}}`/`{{prev_run_at}}` params
   surfaced. Read-only validation + `{{…}}` token validation run here (D3/D3b); **Next** is
   gated on a valid SELECT.
2. **Schedule** — cadence picker: preset daily/weekly/monthly **or** a **Custom cron** mode
   with a `cron_expr` input that validates inline and shows the **next N fire times** (via
   the `POST /preview` endpoint, D9/D5a); plus the `FINAL` / sequential-consistency toggles
   (D3a #3).
3. **Actions** — alert-condition builder (D4) + export toggle + notification-channel
   multiselect (reuse the alerting channel selector).
4. **Output** *(conditional — shown only with `scheduled_queries:write`)* — `output_mode`
   `none|append|replace|upsert`, destination DB/table picker, `partitionExpr` for `replace`;
   live destination check via `POST /preview` (D4b/D4c): existing-table column/engine
   compatibility, or **Create-if-missing** (engine/orderBy/partitionBy) with a generated
   `CREATE TABLE` DDL preview; schema-drift surfaced inline. **Next** gated on a compatible
   (or to-be-created) destination.
5. **Review** — read-only summary of all steps + a **Run-now dry-run** (preview the result/
   write plan without persisting) before **Save**.

The wizard holds draft state locally (`useState` / a small Zustand slice); **Save** issues a
single `POST`/`PATCH` (D9). Per-step validation reuses the same Zod schemas the server uses,
so client and server agree.

### D10b — Visual design: follow the existing house style (no bespoke styling)

The whole DataOps surface must be visually indistinguishable from the rest of the app —
**reuse the design system, do not introduce new fonts, spacing scales, or component
styles:**

- **Primitives:** build exclusively from `src/components/ui/*` (`Button`, `Dialog`, `Card`,
  `Tabs`, `Select`, `Input`, `Textarea`, `Switch`, `Checkbox`, `Badge`, `Table`,
  `ScrollArea`, …) — the same primitives the wizards and alerting dialogs use. No raw
  `<button>`/`<input>` with ad-hoc classes.
- **Tokens:** use the house Tailwind tokens already in those components — `ink-*` for
  surfaces/borders, `paper`/`paper-muted`/`paper-faint` for text, `rounded-xs` corners, and
  the mono-uppercase micro-label treatment (`font-mono text-[10px] uppercase tracking-…`)
  for section/step labels. Match type sizes/weights to the wizard (`text-[16px]
  font-semibold` titles, `text-[12px]` body) rather than picking new sizes.
- **Layout parity:** the `TabPill` bars (feature + sub-tabs), the Jobs/Runs lists, and the
  Overview KPI cards should look and space like Monitoring's tabs and the alerting
  list/cards. Tables use the shared `data-table`/`Table` styling; AG Grid (Runs snapshot)
  follows the theme already used in the workspace results grid.
- **States:** loading = the shared `Skeleton`/`multi-step-loader`; empty/error states reuse
  the existing empty-state and `toast.error()` patterns; icons from the same `lucide-react`
  set/size conventions as the rest of the app.

### D11 — Deployment topology (single-node and multi-replica K8s)

- **Default topology:** the scheduler runs **in-process on every API pod**; correctness
  comes from the per-job atomic lease (D5), so redundant ticks across pods are harmless
  (one indexed `SELECT scheduled_queries WHERE enabled=1` per pod per minute). The env
  flag `SCHEDULED_QUERIES_ENABLED` (mirroring the opt-in `FLEET_POLLER_ENABLED` pattern in
  `index.ts`) lets operators disable the scheduler on API pods and run a dedicated
  `replicas: 1` scheduler Deployment instead — both correct because the lease is
  idempotent; the choice is operational isolation only.
- **Shared metadata DB is mandatory for HA:** the lease only works if all replicas share
  one database. **Multi-replica ⇒ PostgreSQL.** With SQLite each pod has its own file, so
  every pod would run every job (duplicate runs + notifications). **Guardrail:** at boot,
  if the scheduler is enabled, the backend is SQLite, and an HA signal is set
  (`CHOUSE_HA=true`, which the Helm chart sets when `replicas > 1`), log a **loud startup
  warning** that the lease cannot span pods. Keep it a hard warning (not a refuse) so
  single-node SQLite installs are untouched; the chart may flip it to refuse for a strict
  guarantee.
- **Migrations under concurrent pod boot** are already safe via the `pg_advisory_lock`
  wrapper in `migrations.ts` — late pods wait and no-op.
- **K8s `CronJob` is rejected** as the scheduling mechanism: schedules are per-job, stored
  in the DB, and edited live in the UI; a static cluster CronJob can't express them without
  redeploys and would need cluster RBAC. The in-process loop keeps schedules live-editable
  with zero cluster coupling (see Alternatives).

### D12 — Migration testing (MANDATORY per CLAUDE.md)

Migration `1.40.0` MUST ship with tests in `packages/server/src/rbac/db/migrations.test.ts`
that pass on **both SQLite and PostgreSQL** via `./scripts/test-migrations.sh` (Docker
required):

- A `VERSION_CHECKS` entry for `1.40.0` asserting every table (`scheduled_queries`,
  `scheduled_query_runs`, `scheduled_query_channels`, `scheduled_query_outbox`), every
  index, and each of the **5** seeded permissions/grants
  (`view/edit/delete/run/write`) exists.
- The three install/upgrade shapes (fresh, stepwise, skip-version) must all land in the
  same final state. Ensure the migration is idempotent (`IF NOT EXISTS`, guarded) so it
  applies cleanly on top of an existing DB.
- The migration is purely additive (no row transformation), so no data-migration test is
  required; if any future step transforms rows, add a seeded data-migration test per
  `CLAUDE.md`.

---

## Consequences

**Easier / better:**

- No new infra: no scheduler daemon, no worker tier, no broker. ClickHouse is the
  executor; the orchestrator holds only a bounded snapshot + scalars.
- Correct under N replicas with no leader election (the per-job row is the lease).
- Crash-only: SIGKILL/OOMKill/node-loss recover via the reaper from any pod; reads are
  idempotent; notifications and exports are at-least-once via the outbox.
- Live-editable schedules (re-read each tick) — toggling a job in the UI takes effect next
  minute, no redeploy.
- ClickHouse-correct by construction: deterministic windows, FINAL/consistency toggles,
  real `KILL QUERY` cancellation, resource governance.
- **Scheduled rollups/ETL without raw write SQL:** materialize (append/replace/upsert,
  D4a) is engine-generated and idempotent, with a schema contract (D4c) that surfaces drift
  instead of silently mis-populating a table.
- Reuses alerting channels, RBAC, the SQL editor, the Monitoring tab pattern, and the
  migration harness — and becomes the backbone Data Health later compiles onto (no
  duplicate scheduler).
- Establishes a **`DataOps` home** for user-defined data jobs / data observability, keeping
  `Monitoring` focused on cluster/infra health. Data Health (ADR 0001) should move here as a
  sibling sub-tab when built (its "Monitoring → Data Health" placement in ADR 0001 is
  superseded by this; behavior unchanged, only the nav location).

**Harder / accepted trade-offs:**

- **HA requires PostgreSQL.** SQLite multi-replica is unsupported (guarded with a startup
  warning).
- **At-least-once everything:** a reaped slot may re-run — safe because reads are read-only
  and materialize writes are idempotent (slot-scoped dedup token / atomic partition
  replace, D4a) — and a hard kill may produce a rare duplicate notification/export (bounded
  by `dedup_key`). We accept rare duplicates over missed alerts.
- **Materialize correctness depends on table engine.** Idempotent `append` needs a
  Replicated engine (or `non_replicated_deduplication_window` enabled); `upsert` dedups
  only *eventually* on merge/`FINAL`. The builder surfaces these caveats; they are inherent
  ClickHouse semantics, not feature bugs.
- **No backfill:** a crashed slot beyond `max_attempts`, or a multi-slot outage, is
  skipped until the next cadence (surfaced, not silently lost).
- The scheduler ticks on every pod (small redundant DB reads) unless an operator opts into
  a dedicated scheduler Deployment.
- Every scheduled query is user-supplied SQL; mitigated by `scheduled_queries:edit` +
  read-only source validation + the connection-access constraint. Materialize is a higher
  bar still — gated by `scheduled_queries:write` + a destination write-access check, with
  the write engine-generated (never raw user DDL).

**Follow-up / explicitly out of scope for phase 1** (schema leaves room):

- **Data Health onto the backbone** — compile suites/probes to `kind='data_health_check'`
  rows; supersedes the scheduler/runner/outbox of ADR 0001.
- **Raw write-SQL / synchronous OLTP upsert / engine-side mutations** (`ALTER … UPDATE`) —
  out of scope; materialize is structured (D4a), and key-dedup upsert is the eventual
  `ReplacingMergeTree` pattern, not a synchronous update.
- **Per-job cron timezone** (cron is UTC-only in phase 1, D5a) and **sub-minute
  cadences** (capped by the 60 s tick).
- **Per-run (not per-job) channel routing** and **true backfill/catch-up** (the
  no-backfill contract, D3a #6, means cron occurrences missed during an outage are not
  replayed).

---

## Alternatives considered

1. **Reuse / extend the doctor scheduler.** Rejected: the doctor scheduler runs an AI
   fleet scan (not a SQL query), is a single-row config, and works. Folding scheduled
   queries into it would couple two unrelated concerns; this subsystem is self-contained.
2. **Dedicated scheduler/worker tier (Airflow-style).** Rejected: ClickHouse is already
   the compute engine; a scheduled query is a handful of scalar reads. A worker tier +
   broker is infrastructure for work that doesn't need distributing, and conflicts with
   the single-container deployment model.
3. **K8s `CronJob` per schedule.** Rejected (see D11): schedules are per-job, live in the
   DB, and are edited at runtime; static cluster cron can't express them without redeploys
   and needs cluster RBAC.
4. **External job queue (Redis/Celery/BullMQ).** Rejected: no fan-out compute to
   distribute; adds a stateful dependency. The DB-row lease covers dedup.
5. **Leader election (single elected scheduler pod).** Rejected as unnecessary for
   correctness: the per-job lease is finer-grained and spreads work across pods. Left
   available as the optional `SCHEDULED_QUERIES_ENABLED=false` + dedicated Deployment
   pattern for operators who want isolation.
6. **Let users write raw `INSERT INTO … SELECT` / write SQL for materialize.** Rejected in
   favor of **structured destination + engine-generated write** (D4a): raw writes would
   force relaxing read-only validation, widen the headless-DDL security surface, and break
   at-least-once safety unless the engine still injected a slot-scoped dedup token anyway.
   Declaring `output_mode` + destination keeps the source read-only and analyzable while the
   engine emits the safe, idempotent `INSERT`/`REPLACE PARTITION`. (Synchronous OLTP upsert
   and `ALTER … UPDATE` mutations are also rejected — not how ClickHouse works at this
   cadence; `upsert` is the `ReplacingMergeTree` pattern.)
7. **Best-effort notifications (no outbox).** Rejected: a hard kill between commit and
   send drops the alert/export. The outbox makes delivery survive crashes.
8. **Store result snapshots in a ClickHouse table** instead of the app DB. Rejected for
   phase 1: couples results to a specific connection and complicates RBAC; the app DB is
   transactional and consistent with alerting. Revisit if snapshot volume demands it.
9. **Ignore ClickHouse consistency (treat a scheduled `SELECT` as a transactional
   snapshot).** Rejected: would produce false duplicate/freshness alerts on
   `*MergeTree`/`Replicated*`. The D3a contracts (deterministic windows, FINAL/sequential
   toggles) are what make the feature trustworthy.

---

## Implementation checklist (for the build PR(s))

1. Migration `1.40.0` (`scheduled_queries`) — 4 tables (D1, incl. output + outbox-claim
   columns) + indexes + **5** permissions/grants (D8), dual-dialect, idempotent;
   `VERSION_CHECKS` + dual-dialect tests (D12).
2. Service layer `packages/server/src/services/scheduledQueries/` — `types.ts`,
   `store.ts`, `runner.ts` (D3 incl. `result_overflow_mode='break'` + condition-value
   sourcing; **D3b template-param rewrite** to native `{name:DateTime64}` params via
   `query_params`; D3a, D4), `scheduler.ts` (D5) + a `cadence.ts` helper wrapping
   **`croner`** for `lastScheduledFireMs` + `previousFireMs` (D5a, D3b) shared by scheduler
   and window-templating; co-located tests (presets, cron, sub-minute rejection,
   no-burst-on-delayed-tick, `{{…}}` rewrite + unknown-token rejection, truncation flag).
   Add the `croner` dependency. Implement the **materialize writer** (D4a): generated
   `append` (slot-scoped dedup token), `replace` (staging `TRUNCATE`+insert →
   `REPLACE PARTITION`), `upsert` (append into `ReplacingMergeTree`), with `written_rows`
   capture + tests for idempotent retry per mode. Implement **destination lifecycle** (D4b):
   `DESCRIBE`-based schema discovery, exists-compatibility + engine-fit checks, and
   `createIfMissing` / staging `CREATE … AS dest`. Implement the **schema contract** (D4c):
   pin `expectedSchema`, per-run drift diff → fail-soft, edit-time additive
   `ALTER ADD COLUMN` preview, block destructive changes, `SELECT *` lint. Tests for
   exists/missing/drift + additive/destructive edits. Register the scheduler in `index.ts`
   behind `SCHEDULED_QUERIES_ENABLED`; SIGTERM stop + KILL.
3. Reaper + bounded-retry + outbox-delivery passes inside the tick — including the
   **per-row outbox claim** (`pending → sending → sent`, `locked_by`/`locked_at`) and the
   stuck-`sending` reaper (D6, D7).
4. Routes `packages/server/src/routes/scheduled-queries.ts` + overview aggregation + the
   `POST /preview` builder helper (D9, D10) with `requirePermission`, read-only-SQL
   validation, **connection-access check at create/edit** (D8), **`scheduled_queries:write`
   + destination `INSERT`/`ALTER` check for `output_mode<>'none'`** (D4a/D8), and `{{…}}`
   token validation (D3b); mount in `routes/index.ts`.
5. Client `src/api/scheduledQueries.ts` + hooks (+ tests).
6. Frontend: new top-level **`DataOps`** page (`src/pages/DataOps.tsx` with a feature-tab
   bar + `/dataops/:feature?/:sub?` route in `App.tsx` + `navItems` entry in
   `FloatingDock.tsx` + `DATAOPS_ACCESS_PERMISSIONS` in `navAccess.ts`), then
   `src/features/scheduled-queries/` as its first **feature tab** with Overview / Jobs / Runs
   sub-tabs. Create/Edit use a **multi-step wizard** (D10a) mirroring `ClickHouseUserWizard.tsx`
   (Source → Schedule → Actions → Output[write-gated] → Review). Build **only** from
   `src/components/ui/*` + house Tailwind tokens — no bespoke styling (D10b). Add the
   "Schedule this query" editor entry point (D10).
7. HA startup guardrail (SQLite + `CHOUSE_HA` → warning) (D11).
8. Changelog fragment `changelogs/unreleased/<pr>-scheduled-queries.md` (`type: minor`).
9. Lint, typecheck, `bunx vitest run`, `./scripts/test-isolated-server.sh`,
   `./scripts/test-migrations.sh`.
