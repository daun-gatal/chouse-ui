# 0001 — Data Health (scheduled column- and table-level checks)

- **Status:** Deprecated
- **Date:** 2026-06-17
- **Deciders:** CHouse UI maintainers
- **Tags:** data-health, observability, scheduling, clickhouse, rbac, ui, deployment

> This ADR is written to be **self-contained**: an engineer or AI agent should be
> able to implement the feature from this document alone, without the design
> conversation that produced it. Where it says "mirror X", read the cited file
> first — the existing pattern is the spec for that part.

> **Naming.** The user-facing feature is **Data Health**, surfaced under
> **Monitoring → Data Health**. We deliberately avoid "Data Quality": DQ is a
> broad discipline (governance, lineage, MDM, contracts…) that over-promises
> relative to what this is — *scheduled checks that make ClickHouse data
> observability easy*, which is CHouse UI's whole purpose. "Data Health" names the
> outcome (is my data healthy right now?) and stays in the observability lane next
> to the other Monitoring tabs.
>
> **Internal identifiers keep the `dataquality` / `dq_` naming on purpose** — the
> RBAC permissions (`dataquality:view|edit|delete|run|custom_sql`), the metadata
> tables (`dq_suites`, `dq_tests`, `dq_runs`, `dq_test_results`,
> `dq_suite_channels`, `dq_notification_outbox`), the API prefix
> (`/api/data-quality`), and this file's name. Renaming them would mean a churny,
> migration-heavy rename of a shipped schema for zero functional gain. Only the
> product surface (tab label, headings, copy) says "Data Health".

---

## Context

CHouse UI is a web interface for ClickHouse (frontend: React 19 + Vite SPA under
`src/`; backend: Bun + Hono v4 under `packages/server/`; metadata persisted via
Drizzle ORM to **SQLite or PostgreSQL**). We want a **Data Health** feature (see
the Naming note above): users define checks ("tests") over their ClickHouse tables
and columns, those checks run on a **schedule** (plus on-demand), and failures are
recorded and notified.

The forces that make this non-trivial:

1. **The compute engine is ClickHouse itself.** Unlike Airflow (dedicated scheduler
   + worker pool running Python), we have no separate execution tier and don't want
   to add one. CHouse UI must be the *orchestrator*; ClickHouse must be the
   *executor*. Tests must compile to SQL pushed down to ClickHouse so the server
   holds only scalar results.
2. **Deployment ranges from a single SQLite container to multi-replica K8s.** The
   scheduler must be correct under N replicas with no leader-election infra and no
   message broker.
3. **Processes die abruptly.** Rolling deploys (SIGTERM), OOMKills and `kill -9`
   (SIGKILL), node loss, and DB/ClickHouse blips must never cause double execution,
   lost slots without record, or duplicate/missed alerts. The design must be
   **crash-only**: recovery cannot depend on graceful-shutdown hooks.
4. **It must feel native.** Reuse the existing Monitoring page, RBAC, alerting
   channels, explorer tree, and the migration test harness — not parallel systems.

This crosses RBAC + ClickHouse + scheduler + UI, so per
[`.rules/ADR.md`](../../.rules/ADR.md) it warrants an ADR before implementation.

### Existing patterns this design builds on (read these first)

| Concern | Reference implementation to mirror |
|---------|-----------------------------------|
| Scheduled background loop + per-row atomic lease | `packages/server/src/services/doctorScheduler.ts` (`tick()`, `claimScheduledSlot()`) |
| Multi-instance poller registered at boot | `packages/server/src/services/fleetPoller.ts`; boot wiring in `packages/server/src/index.ts` (~line 316–321) |
| Normalized multi-table metadata + dialect-aware CRUD + secret encryption | `packages/server/src/services/alerting/{store,types,deliver}.ts` (the `1.39.0` `alerting_normalization` migration) |
| Notification channels + delivery | `notification_channels` table + `packages/server/src/services/alerting/deliver.ts` |
| Migration authoring + dual-dialect tests | `packages/server/src/rbac/db/migrations.ts`, `migrations.test.ts`, `migrationTestHarness.ts`; `./scripts/test-migrations.sh` |
| Migration concurrency guard (multi-pod boot) | `pg_advisory_lock` wrapper in `migrations.ts` |
| Permission catalog + default role grants | `packages/server/src/rbac/schema/base.ts` (`PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS`) |
| Nav permission gating | `src/lib/navAccess.ts` (`MONITORING_ACCESS_PERMISSIONS`) |
| Monitoring page tabs (TabPill, per-permission `availableTabs`) | `src/pages/Monitoring.tsx` |
| Frontend feature layout, API client + tests | `src/features/alerting/`, `src/api/alerting.ts` |

---

## Decision

Build Data Health as: a **normalized metadata schema** in the RBAC DB, an
**in-process scheduler** (per-suite atomic row lease) that **pushes test SQL down to
ClickHouse**, a **crash-only run lifecycle** with a reaper and a transactional
notification outbox, surfaced as a new **Monitoring → Data Health** tab with
**Overview / Suites / Runs** sub-tabs.

The numbered decisions below are the binding spec.

### D1 — Division of labor: CHouse UI orchestrates, ClickHouse executes

CHouse UI never crunches data. Each test compiles to a **bounded-aggregate SQL
probe** (`countIf`, `uniqExact`, `max`, …) executed against the suite's ClickHouse
connection via the existing client manager. The server reads back a handful of
scalars per table. This is what makes a dedicated worker tier unnecessary and what
prevents a runaway query from OOMing the orchestrator (the heavy work lives in
ClickHouse, guarded by `SETTINGS`).

| Concern | Airflow | This design |
|---------|---------|-------------|
| Scheduler (when) | `airflow-scheduler` daemon | in-process `setInterval` tick in the API server |
| Executor (compute) | Celery/K8s Python workers | **ClickHouse** — push-down SQL |
| Metadata/state | Postgres | the RBAC SQLite/PG DB |
| Concurrency/lease | scheduler row locks | atomic conditional `UPDATE` on the suite row |

### D2 — Data model (normalized; migration `1.40.0`)

A single migration `1.40.0` named `data_quality` adds the tables below to the RBAC
DB. **Author both SQLite and PostgreSQL DDL** in the same migration `up()`
(switch on `getDatabaseType()`), idempotent (`IF NOT EXISTS`), mirroring the
`1.39.0` alerting migration exactly. PostgreSQL variants use `VARCHAR`/`TIMESTAMPTZ
DEFAULT NOW()`/`JSONB`/`BOOLEAN` where SQLite uses `TEXT`/`INTEGER unixepoch()`.

SQLite DDL (canonical; translate to PG per the convention above):

```sql
-- A schedulable collection of tests bound to one ClickHouse connection.
CREATE TABLE IF NOT EXISTS dq_suites (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  connection_id TEXT NOT NULL,                 -- ClickHouse connection id
  enabled       INTEGER NOT NULL DEFAULT 1,
  -- schedule (shape mirrors doctor_schedule)
  frequency     TEXT NOT NULL DEFAULT 'daily', -- daily|weekly|monthly|manual
  hour          INTEGER NOT NULL DEFAULT 8,    -- 0-23 UTC
  day_of_week   INTEGER NOT NULL DEFAULT 1,    -- 0 Sun .. 6 Sat (weekly)
  day_of_month  INTEGER NOT NULL DEFAULT 1,    -- 1-28 (monthly)
  -- scheduler lease + bookkeeping
  last_run_at   INTEGER NOT NULL DEFAULT 0,    -- unix ms; THE atomic slot lease
  last_run_by   TEXT,                          -- runner/pod id that claimed last
  max_attempts  INTEGER NOT NULL DEFAULT 2,    -- bounded retry per slot
  retention_days INTEGER NOT NULL DEFAULT 90,  -- run/result pruning window
  created_by    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- One row per test. scope='table' (column NULL) or scope='column'.
CREATE TABLE IF NOT EXISTS dq_tests (
  id         TEXT PRIMARY KEY NOT NULL,
  suite_id   TEXT NOT NULL REFERENCES dq_suites(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL,                    -- 'table' | 'column'
  database   TEXT NOT NULL,
  "table"    TEXT NOT NULL,
  column     TEXT,                             -- NULL for table-scope & multi-col
  test_type  TEXT NOT NULL,                    -- see D3 catalog
  config     TEXT NOT NULL DEFAULT '{}',       -- JSON; type-specific params (D3)
  severity   TEXT NOT NULL DEFAULT 'error',    -- 'error' | 'warn'
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS dq_tests_suite_idx ON dq_tests(suite_id);

-- One execution of a suite.
CREATE TABLE IF NOT EXISTS dq_runs (
  id           TEXT PRIMARY KEY NOT NULL,
  suite_id     TEXT NOT NULL REFERENCES dq_suites(id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL,                  -- 'scheduled' | 'manual'
  status       TEXT NOT NULL,                  -- 'running'|'passed'|'failed'|'error'
  slot_at      INTEGER NOT NULL,               -- the scheduled fire-time (ms) this
                                               -- run belongs to; for manual = started_at.
                                               -- Used to count attempts per slot.
  attempt      INTEGER NOT NULL DEFAULT 1,     -- 1-based attempt within slot_at
  runner_id    TEXT,                           -- pod/runner that owns this run
  deadline     INTEGER,                        -- started_at + maxDuration (ms); reaper key
  passed       INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  errored      INTEGER NOT NULL DEFAULT 0,
  started_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS dq_runs_suite_idx ON dq_runs(suite_id, started_at);
CREATE INDEX IF NOT EXISTS dq_runs_status_idx ON dq_runs(status, deadline); -- reaper scan
CREATE INDEX IF NOT EXISTS dq_runs_slot_idx ON dq_runs(suite_id, slot_at);   -- attempt count

-- Per-test outcome within a run.
CREATE TABLE IF NOT EXISTS dq_test_results (
  id             TEXT PRIMARY KEY NOT NULL,
  run_id         TEXT NOT NULL REFERENCES dq_runs(id) ON DELETE CASCADE,
  test_id        TEXT NOT NULL REFERENCES dq_tests(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,                -- 'pass' | 'fail' | 'error'
  observed_value TEXT,                         -- stringified metric (heterogeneous)
  threshold      TEXT,                         -- stringified expected/threshold
  failed_rows    INTEGER,                      -- count of offending rows when known
  message        TEXT,                         -- error text / human summary
  notified       INTEGER NOT NULL DEFAULT 0,   -- transition-alert dedup flag
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS dq_test_results_run_idx  ON dq_test_results(run_id);
CREATE INDEX IF NOT EXISTS dq_test_results_test_idx ON dq_test_results(test_id, created_at);

-- Suite -> notification channel (reuse alerting infra). M:N.
CREATE TABLE IF NOT EXISTS dq_suite_channels (
  suite_id   TEXT NOT NULL REFERENCES dq_suites(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (suite_id, channel_id)
);

-- Transactional outbox for crash-safe, at-least-once notification delivery.
CREATE TABLE IF NOT EXISTS dq_notification_outbox (
  id         TEXT PRIMARY KEY NOT NULL,
  run_id     TEXT NOT NULL REFERENCES dq_runs(id) ON DELETE CASCADE,
  suite_id   TEXT NOT NULL REFERENCES dq_suites(id) ON DELETE CASCADE,
  dedup_key  TEXT NOT NULL,                    -- e.g. run_id:summary ; unique
  payload    TEXT NOT NULL,                    -- JSON message body
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent'
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at    INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS dq_outbox_dedup_idx  ON dq_notification_outbox(dedup_key);
CREATE INDEX IF NOT EXISTS dq_outbox_status_idx ON dq_notification_outbox(status);
```

Modeling rationale:

- **Definitions vs. results separated.** `dq_tests` is the live definition;
  `dq_test_results` references an immutable `dq_runs` row, so editing a test never
  rewrites history.
- **Type-specific knobs in one `config` JSON column**, not sparse typed columns —
  avoids a wide, mostly-NULL table as the catalog grows (D3).
- **Multi-column keys** (`duplicate_key`) don't fit the single `column` field: for
  that test, `dq_tests.column` is `NULL` and the columns live in
  `config.keyColumns`. Single-column tests populate `column` for clean
  filtering/UI.
- **`observed_value`/`threshold` are `TEXT`** because metrics are heterogeneous
  (counts, ratios, timestamps); the UI formats per `test_type`.
- **FKs cascade** suite → tests → runs → results, and suite/channel/outbox, so
  deleting a suite is one clean operation.
- **`slot_at` + `attempt`** support crash recovery and bounded retry (D7).

### D3 — Test catalog, phase 1

The catalog has two layers. **Headline tests** target pains that are acute
*specifically because it is ClickHouse*. **Standard structured tests** are the
familiar column/table assertions every data-health user expects — included as first-class,
discoverable test types (not buried as config of another test) so the builder reads
naturally. Each `test_type` + `config` compiles to a SQL fragment; "Foldable" tests
fold into one batched `SELECT` per table (D4), non-foldable run as their own small
query.

**Headline tests (ClickHouse-specific):**

| `test_type` | scope | Foldable | ClickHouse pain it solves | Probe / fragment |
|-------------|-------|:-------:|---------------------------|------------------|
| `freshness` | table | no | "Did ingestion stall?" CH is the event/log sink; a stalled pipeline is the #1 incident. | `now() - max(<column>)` vs `maxAgeMinutes` |
| `volume` | table | yes | Ingestion drop/spike; a partition that never loaded. (Subsumes a plain "row_count" bounds check.) | `count()` (optionally over a recent window) within `{min,max}` |
| `duplicate_key` | column(s) | yes | The CH trap: `ReplacingMergeTree`/`*MergeTree` inserts are at-least-once; dedup only happens *eventually* on merge (or never). Real dups sit in SELECTs for hours. | `count() - uniqExact((k1,k2,…))` → fail if `> 0` |
| `null_or_default_rate` | column | yes | CH silently fills defaults (`0`,`''`,epoch) on bad ETL — looks like data, isn't. | `countIf(col IS NULL OR col = <default>) / count()` vs `maxPct` |
| `partition_completeness` | table | no | Missing day/hour partitions — a gap unnoticed until a dashboard is empty. | distinct `toStartOf*(<expr>)` vs expected contiguous range over `lookback` |

**Standard structured tests:**

| `test_type` | scope | Foldable | Use |
|-------------|-------|:-------:|-----|
| `not_null` | column | yes | Column must have no NULLs (the common case; simpler/more discoverable than `null_or_default_rate` with `maxPct:0`). Fails if any NULL. |
| `unique` | column | yes | Single-column uniqueness (the single-key special case of `duplicate_key`). Populates `dq_tests.column`. |
| `accepted_values` | column | yes | Enum / `LowCardinality` drift — unexpected category values. |
| `range` | column | yes | Out-of-bounds numerics (negative durations, impossible timestamps). |
| `regex` | column | yes | Format/pattern conformance (emails, ids, codes). Use sparingly on very large tables — `match()` is per-row. |
| `string_length` | column | yes | Truncation / garbage from bad ETL — value char length within `{min,max}`. `countIf(length(col) < min OR length(col) > max)`. |
| `cardinality` | column | yes | Distinct-value count within `{min,max}`. **CH-specific value:** catches `LowCardinality` explosion (perf cliff) and dimension collapse (lost variety = upstream break). `uniqExact(col)` within bounds. |
| `expression` | column | yes | **Generic gated predicate** — a user-supplied boolean ClickHouse expression evaluated as `countIf(NOT (<expr>)) [/ count()]` vs threshold. Covers the long tail (cross-column `a <= b`, date sanity `ts <= now()`, format fns `isValidJSON`/`isIPv4String`, custom predicates) without enumerating named rules. Cheaper/safer than `custom_sql` (no `FROM`/joins; single-column-scan foldable). **Permission-gated** — reuses `dataquality:custom_sql` + read-only validation (D9). |
| `schema_match` | table | no | Schema/contract drift — expected columns (and optionally types) present, no unexpected adds/drops. Checked against `system.columns`. Complements the read-only Schema Advisor with a scheduled, asserting check. |
| `mv_reconciliation` | table | no | Source ↔ Materialized View row-count parity. MVs are insert-triggers; an insert path that bypasses the trigger silently desyncs the MV. **The only two-table test in phase 1** (deliberately included). |
| `custom_sql` | table | no | Escape hatch. **Permission-gated** (`dataquality:custom_sql`) and run through the existing read-only SQL validation (`node-sql-parser`). |

**`config` JSON shapes** (validated with Zod before persist; server uses Zod v3):

```jsonc
freshness:              { "column": "event_time", "maxAgeMinutes": 60 }
volume:                 { "min": 1000, "max": 5000000, "window": "1 DAY" }   // window optional
duplicate_key:          { "keyColumns": ["user_id", "event_id"] }            // column field NULL
null_or_default_rate:   { "maxPct": 1.0, "default": 0 }                       // default optional; NULL-only if omitted
partition_completeness: { "partitionExpr": "toDate(event_time)", "granularity": "day", "lookback": 30 }
not_null:               {}                                                    // uses dq_tests.column; fails if countIf(col IS NULL) > 0
unique:                 {}                                                    // uses dq_tests.column; fails if count() - uniqExact(col) > 0
accepted_values:        { "values": ["web","ios","android"] }
range:                  { "min": 0, "max": 120 }
regex:                  { "pattern": "^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$" } // countIf(NOT match(col, pattern)) > 0
string_length:          { "min": 3, "max": 64 }                                  // either bound optional
cardinality:            { "min": 1, "max": 10000 }                               // uniqExact(col) within bounds
expression:             { "predicate": "amount <= balance", "maxPct": 0 }        // countIf(NOT (predicate)); maxPct optional (0 = none may violate)
schema_match:           { "columns": [{"name":"id","type":"UInt64"}], "allowExtra": false } // type optional per column
mv_reconciliation:      { "sourceTable": "db.events", "tolerancePct": 0.5 }   // target = the test's table
custom_sql:             { "query": "SELECT countIf(...) FROM ...", "operator": "eq", "expected": 0 }
```

Relationship notes: `not_null`/`unique` are deliberately separate from
`null_or_default_rate`/`duplicate_key` — same SQL family, but the simple forms are
far more discoverable in the builder and cover the overwhelmingly common case; the
advanced forms exist for rate thresholds and multi-column keys. `volume` subsumes a
plain row-count bounds check. Still **out of phase 1** (schema leaves room):
cross-table referential tests beyond `mv_reconciliation`, anomaly/ML thresholds, and
lineage.

### D4 — Execution: batch-per-table push-down

A `compiler.ts` maps each foldable test on a given table into one column of a
single `SELECT`. The `runner.ts` reads one row and evaluates each `t_<id>` against
its test's threshold. Example for one table:

```sql
SELECT
  countIf(email IS NULL)              AS t_<id1>,   -- not_null / null_or_default_rate
  count() - uniqExact(user_id)        AS t_<id2>,   -- unique / duplicate_key
  countIf(age < 0 OR age > 120)       AS t_<id3>,   -- range
  countIf(source NOT IN ('web','ios','android')) AS t_<id4>, -- accepted_values
  countIf(NOT match(email, '<pattern>'))         AS t_<id5>, -- regex
  count()                             AS t_rowcount -- volume + denominator
FROM db.table
SETTINGS max_execution_time = <N>, max_result_rows = 1, max_memory_usage = <M>
```

Foldable types (`not_null`, `unique`, `null_or_default_rate`, `duplicate_key`,
`range`, `accepted_values`, `regex`, `string_length`, `cardinality`, `expression`,
`volume`) collapse into the single scan above. The `expression` predicate is parsed
and validated read-only before it is templated into the scan (D9).
`freshness`, `partition_completeness`, `schema_match`, `custom_sql`, and
`mv_reconciliation` do not fold into the row scan and run as their own small
queries (`schema_match` reads `system.columns`, not the data). **Every query carries
the `SETTINGS` guardrails above** and is run under an `AbortController` timeout.

### D5 — Severity model (per-test)

- Each test is `severity = 'error' | 'warn'`.
- Failed **error** test → counts toward `failed`, **fails the run**, eligible for
  notification.
- Failed **warn** test → recorded in `dq_test_results`, **run still passes**, no
  notification (UI-only).
- A **query error** (timeout/unreachable) → that test's result `status = 'error'`,
  the run's `status = 'error'`, eligible for an operational notification (it is an
  operational problem, not a data verdict).

Run `status` resolution: `error` if any test errored; else `failed` if any
error-severity test failed; else `passed`.

### D6 — Scheduler: in-process tick + per-suite atomic lease

Implement `packages/server/src/services/dataQuality/scheduler.ts` as a **singleton**
mirroring `DoctorScheduler` (`getInstance()`, `start()` with
`setInterval(tick, 60_000)` + `timer.unref()`, `stop()`, a `running` re-entry
flag). Register it at boot in `packages/server/src/index.ts` right after
`DoctorScheduler.getInstance().start()`:

```ts
const { DataQualityScheduler } = await import("./services/dataQuality/scheduler");
DataQualityScheduler.getInstance().start();
```

The crucial difference from `doctorScheduler` (single `id=1` config row): Data Health has
**many suites**, each with its own cadence and `last_run_at`, so the tick iterates
enabled suites and claims **per suite**. Pseudocode:

```
tick()  // guarded by a `running` flag; skip if already running
  reaperPass()                  // D7 — finalize orphaned runs first
  outboxDeliverPass()           // D8 — send pending notifications
  suites = SELECT * FROM dq_suites WHERE enabled = 1   // live config, re-read each tick
  for suite in suites (bounded concurrency, e.g. 4 in flight):
    if suite.frequency == 'manual': continue
    fireAt = lastScheduledFireMs(suite, now)           // last due slot <= now
    if suite.last_run_at >= fireAt: continue            // fast path: slot already ran
    // ATOMIC CLAIM — the row IS the lease:
    claimed = UPDATE dq_suites
              SET last_run_at = :now, last_run_by = :runnerId
              WHERE id = :suite.id AND last_run_at < :fireAt   // rowsAffected==1 means we won
    if not claimed: continue                            // another pod/tick took it
    runner.execute(suite, { trigger:'scheduled', slotAt:fireAt, attempt:1 })
```

`lastScheduledFireMs(suite, now)` reuses the doctor scheduler's slot math
(`lastScheduledFireMs` in `doctorScheduler.ts`) generalized per-suite. The
`UPDATE ... WHERE last_run_at < fireAt` is atomic under both SQLite (single writer)
and PostgreSQL (row lock + MVCC re-evaluation): with concurrent pods, the first
commits `last_run_at=now`; the second's `WHERE` re-evaluates against the committed
value and affects 0 rows. **No leader election, no broker.**

`runner.execute()` first **claims and records the run atomically** — stamp
`dq_suites.last_run_at` (done in the claim above) and `INSERT dq_runs` with
`status='running'`, `started_at`, `deadline = started_at + maxDuration`,
`runner_id`, `slot_at`, `attempt` — so a death is always a visible stuck row (D7).
Then it groups tests by table, runs the batched + non-foldable queries (D4), writes
`dq_test_results`, computes run status (D5), and within a single DB transaction:
writes results + flips `notified` flags + inserts any `dq_notification_outbox`
rows + sets `dq_runs.status`/counts/`finished_at`. Delivery happens separately
(D8).

**Retention:** at the end of a tick, prune `dq_runs` (cascade to results) older
than the suite's `retention_days` (default 90).

### D7 — Crash-only resilience (force-kill / sudden termination)

Governing principle: **SIGKILL gives no chance to clean up**, so correctness must
not depend on shutdown handlers. State is recoverable and recovery runs on the next
tick from *any* pod.

- **Claim + `running` row are written together**, so you can never get a consumed
  slot with no record.
- **Reaper** (runs each tick, before claiming): one idempotent conditional UPDATE
  ```sql
  UPDATE dq_runs SET status='error', message='reaped: runner lost (deadline exceeded)'
  WHERE status='running' AND deadline < :now
  ```
  Survives SIGKILL/OOMKill/node-loss; double-reap-safe (first writer wins).
- **Bounded retry within slot:** after reaping an orphaned run, re-open the slot
  (`UPDATE dq_suites SET last_run_at = 0 ... ` so `last_run_at < slot_at` again)
  **only if** `COUNT(dq_runs WHERE suite_id=:s AND slot_at=:slot) < suite.max_attempts`
  (default 2). The retry creates a new `dq_runs` row with `attempt = count+1`.
  After `max_attempts`, leave the slot errored and surface it (do not loop). The
  next cadence's `fireAt` proceeds normally regardless.
- **Re-execution is safe** because probes are **read-only** against ClickHouse —
  at-least-once execution has no ClickHouse side effects. (`custom_sql` is validated
  read-only.)
- **Push-down protects the orchestrator:** heavy work + memory live in ClickHouse
  (`max_memory_usage`, `max_result_rows`), so a runaway query fails the *test*, not
  the pod — removing the most common OOMKill trigger.
- **Graceful path is best-effort only:** a SIGTERM handler calls `scheduler.stop()`
  (stop claiming new suites), aborts in-flight ClickHouse queries via
  `AbortController`, and lets running queries drain within
  `terminationGracePeriodSeconds`. Anything not drained falls back to the reaper.
- **Watchdog:** if a tick's `running` flag has been set longer than
  `maxDuration × 2`, log an error and reset it so one wedged tick can't silently
  stop scheduling (other pods keep ticking regardless).

Failure taxonomy and handling:

| Failure | Handling |
|---------|----------|
| SIGTERM (rolling deploy / scale-down) | stop claiming, abort queries, drain within grace; remainder → reaper |
| SIGKILL / `kill -9` / OOMKill | stuck `running` row → reaper next tick; slot lease prevented double-fire |
| Node crash / network partition | same as SIGKILL — durable state is the Postgres lease row |
| Died after CH query, before persisting results | reaped → bounded retry; read-only probe makes re-run safe |
| Postgres failover mid-run | run left `running` → reaped on recovery; pool timeouts keep event loop free |
| ClickHouse unreachable / restart mid-query | tests → `error`, run → `error`; one operational notification |
| Liveness probe kills a wedged pod | other pods keep scheduling; watchdog resets the stuck flag |
| Poison run (repeatedly kills its pod) | `max_attempts` bound + CH resource caps stop the reap→retry→crash loop |
| Re-entrant tick double-fire | `running` flag + atomic claim → second attempt affects 0 rows |

### D8 — Notifications: reuse alerting channels, transactional outbox, transition-based

- **Delivery reuses the alerting infra** — `notification_channels` +
  `packages/server/src/services/alerting/deliver.ts`. No new delivery code. Suites
  link channels via `dq_suite_channels`.
- **Transition-based alerting** (anti-flapping): notify only when a test flips
  `pass → fail` (and send a single "recovered" note on `fail → pass`), determined by
  comparing the current result to the test's previous result
  (`dq_test_results.notified` flag + prior row lookup). Quiet for sustained
  failures.
- **Transactional outbox for crash-safe at-least-once delivery:** in the run's
  finalize transaction, insert `dq_notification_outbox` rows (with a `dedup_key`,
  e.g. `run_id:summary`). A delivery pass each tick (claimed via the same
  conditional-UPDATE lease pattern, runnable by any pod) sends `pending` rows via
  `deliver.ts` and marks them `sent`. Survives a hard kill between commit and send
  — never miss an alert; rare duplicates bounded by `dedup_key`.

Notification payload sketch:

```
[Data Health] Suite "events_quality" — 2 failed, 1 error
Connection: prod-ch
✗ events.user_id — duplicate_key: 1,240 duplicate rows (threshold 0)
✗ events.event_time — freshness: 95m stale (max 60m)
⚠ events.custom_sql — query timeout
[View run →]
```

### D9 — RBAC

Add to `PERMISSIONS` in `packages/server/src/rbac/schema/base.ts` and seed them in
migration `1.40.0` (grant to `SUPER_ADMIN` automatically via `Object.values`, and
to `ADMIN` explicitly in `DEFAULT_ROLE_PERMISSIONS`):

```
dataquality:view        // see the tab, suites, runs, dashboard
dataquality:edit        // create/update suites & tests, run-now
dataquality:delete      // delete suites/tests
dataquality:run         // trigger manual runs
dataquality:custom_sql  // create/edit user-supplied-SQL tests (custom_sql + expression); higher bar
```

Server routes use `rbacAuthMiddleware` + `requirePermission`. Test targets are
**additionally constrained by the user's existing data-access rules** so Data Health cannot
read tables the user otherwise couldn't see. The two test types that accept
user-supplied SQL — `custom_sql` and the column-level `expression` predicate — both
require `dataquality:custom_sql` and pass through the read-only SQL/expression
validation (`node-sql-parser`) before execution.

### D10 — API surface

New `packages/server/src/routes/dataQuality.ts` (+ client `src/api/dataQuality.ts`),
both with co-located tests per `CLAUDE.md`. Service layer under
`packages/server/src/services/dataQuality/`: `types.ts` (enums `DqScope`,
`DqTestType`, `DqStatus`, `DqSeverity` + row types), `store.ts` (dialect-aware CRUD,
mirror `alerting/store.ts`'s `all`/`run` helpers), `compiler.ts`, `runner.ts`,
`scheduler.ts`.

```
GET    /api/data-quality/suites
POST   /api/data-quality/suites
PATCH  /api/data-quality/suites/:id
DELETE /api/data-quality/suites/:id
GET    /api/data-quality/suites/:id/tests
POST   /api/data-quality/suites/:id/tests
PATCH  /api/data-quality/tests/:id
DELETE /api/data-quality/tests/:id
POST   /api/data-quality/suites/:id/run          // manual run; takes the lease too
GET    /api/data-quality/suites/:id/runs         // run history
GET    /api/data-quality/runs/:runId/results     // per-test results
GET    /api/data-quality/overview?window=14d     // dashboard aggregation (D11)
```

### D11 — Frontend: Monitoring → Data Health tab with sub-tabs + dashboard

- **Nav:** add a new Monitoring tab pill in `src/pages/Monitoring.tsx`
  (`TabKey` add `"data-quality"`, `TAB_CONFIG` entry, route segment), and add
  `dataquality:view` to `MONITORING_ACCESS_PERMISSIONS` in `src/lib/navAccess.ts`
  and to the page's `availableTabs` gating. Reuse the existing `TabPill` component.
- **Feature dir:** `src/features/data-quality/`. Data via TanStack Query
  (`useSuites`, `useSuiteRuns`, `useDataQualityOverview`); builder draft state local
  (`useState` / small Zustand slice); mutations invalidate query keys. Tests
  co-located.
- **Sub-tabs** under the tab (own route segment `/monitoring/data-quality/:sub?`
  for deep-linking/back-button):
  - **Overview** (default) — the insight dashboard:
    - KPI row: current **pass rate**, **failing now**, **errored** (operational),
      and **coverage** (tables with ≥1 test vs total tables on the connection —
      answers "what am I *not* watching?").
    - **Pass-rate trend** over 14/30/90 days (group `dq_runs` by day), dips
      annotated by the suite/test that caused them.
    - **Failures by type** (which categories fail most — e.g. `duplicate_key`
      dominating signals a structural merge/at-least-once issue).
    - **Top failing tests**, ranked by severity + **failure streak** (consecutive
      red runs, derived from the transition-state comparison). Deep-links: a
      failing test → its Runs drill-down; a coverage number → the builder
      pre-filtered to untested tables.
  - **Suites** — status-sorted list (failing floats up) with connection, test
    count, last-run verdict, next-run countdown, `+ New suite`, row actions
    (Run now / Edit / Disable / Delete). Opening one enters the **builder**:
    explorer-tree target picker (reuse `src/features/explorer`) as a breadcrumb →
    Column/Table test tabs with **CH-aware suggestions** (e.g. pre-suggest
    `duplicate_key` on the sorting key when the engine is `ReplacingMergeTree`;
    suggest `freshness` when a `DateTime` column exists) → schedule + channel
    selection + Run-now footer.
  - **Runs** — reverse-chronological feed of `dq_runs` (failing/errored shaded),
    showing trigger (`scheduled` vs `manual · user`), passed/failed/error tally,
    duration; filter by suite and status. Expanding a run loads its
    `dq_test_results` (target, type, observed-vs-threshold, severity) with passing
    tests collapsed behind "+ N more".

- **`GET /overview` endpoint** is read-only aggregation over existing tables (no new
  storage): KPIs, trend series (group `dq_runs` by day), failures-by-type (group
  current-failing results by `dq_tests.test_type`), top-failing + streak
  (consecutive results), coverage (`COUNT(DISTINCT database||table)` in `dq_tests`
  vs `system.tables` for the connection).

### D12 — Deployment topology (single-node and multi-replica K8s)

- **Default topology:** the scheduler runs **in-process on every API pod**;
  correctness comes from the per-suite atomic lease (D6), so redundant ticks across
  pods are harmless (one indexed `SELECT dq_suites` per pod per minute). An env flag
  `DQ_SCHEDULER_ENABLED` (mirroring the opt-in `FLEET_POLLER_ENABLED` pattern in
  `index.ts`) lets operators disable the scheduler on API pods and run a dedicated
  `replicas: 1` scheduler Deployment instead — both are correct because the lease is
  idempotent; the choice is operational isolation only.
- **Shared metadata DB is mandatory for HA:** the lease only works if all replicas
  share one database. **Multi-replica ⇒ PostgreSQL.** With SQLite each pod has its
  own file, so every pod would run every suite (duplicate runs + notifications).
  **Guardrail:** at boot, if the scheduler is enabled, the backend is SQLite, and an
  HA signal is set (e.g. an explicit `CHOUSE_HA=true` env the Helm chart sets when
  `replicas > 1`), log a **loud startup warning** that the lease cannot span pods.
  Keep it a hard warning (not a refuse) so single-node SQLite installs are
  untouched; the chart may flip it to refuse for a strict guarantee.
- **Migrations under concurrent pod boot** are already safe via the
  `pg_advisory_lock` wrapper in `migrations.ts` — late pods wait and no-op.
- **K8s `CronJob` is rejected** as the scheduling mechanism: schedules are
  per-suite, stored in the DB, and edited live in the UI; a static cluster CronJob
  can't express them without redeploys and would need cluster RBAC to shell into a
  one-shot job. The in-process loop keeps schedules live-editable with zero cluster
  coupling.

### D13 — Migration testing (MANDATORY per CLAUDE.md)

Migration `1.40.0` MUST ship with tests in
`packages/server/src/rbac/db/migrations.test.ts` that pass on **both SQLite and
PostgreSQL** via `./scripts/test-migrations.sh` (Docker required):

- A `VERSION_CHECKS` entry for `1.40.0` asserting every table, index, and each of
  the 5 seeded permissions/grants exists.
- The three install/upgrade shapes (fresh, stepwise, skip-version) must all land in
  the same final state. Ensure the migration is idempotent (`IF NOT EXISTS`,
  guarded) so it applies cleanly on top of an existing DB.
- If any step transforms existing rows (none expected in phase 1 — this is purely
  additive), add a dedicated data-migration test (seed via
  `runMigrations({ through: '<prev>' })`, assert transformation + idempotency).

---

## Consequences

**Easier / better:**

- No new infra: no scheduler daemon, no worker tier, no broker. ClickHouse is the
  executor; the orchestrator holds only scalars.
- Correct under N replicas with no leader election (the per-suite row is the lease).
- Crash-only: SIGKILL/OOMKill/node-loss recover via the reaper from any pod; reads
  are idempotent; notifications are at-least-once via the outbox.
- Live-editable schedules (re-read each tick) — toggling a suite in the UI takes
  effect next minute, no redeploy.
- Reuses alerting channels, RBAC, explorer tree, Monitoring tabs, migration harness.

**Harder / accepted trade-offs:**

- **HA requires PostgreSQL.** SQLite multi-replica is unsupported (guarded with a
  startup warning).
- **At-least-once everything:** a reaped slot may re-run (safe — read-only) and a
  hard kill may produce a rare duplicate notification (bounded by `dedup_key`). We
  accept rare duplicates over missed alerts.
- A crashed slot beyond `max_attempts` is skipped until the next cadence (surfaced,
  not silently lost).
- The scheduler ticks on every pod (small redundant DB reads) unless an operator
  opts into a dedicated scheduler Deployment.
- The user-supplied-SQL test types (`custom_sql` and the column-level `expression`
  predicate) are powerful surfaces; mitigated by the `dataquality:custom_sql`
  permission + read-only validation, but they remain the highest-risk test types.
  `expression` is the lower-risk of the two (a bare boolean predicate, no `FROM`/joins).

**Follow-up / explicitly out of scope for phase 1** (schema leaves room):

- Cron-expression cadences (`frequency:'cron'` + `cron_expr`; only
  `lastScheduledFireMs()` changes — tick/lease unchanged).
- Cross-table referential tests beyond `mv_reconciliation`; anomaly/ML thresholds;
  lineage; per-test (not per-suite) channel routing.

---

## Alternatives considered

1. **Dedicated scheduler/worker tier (Airflow-style).** Rejected: ClickHouse is
   already the parallel compute engine; tests are a handful of scalar queries. A
   worker tier + broker is infrastructure for work that doesn't need distributing,
   and conflicts with the single-container deployment model.
2. **K8s `CronJob` per schedule.** Rejected (see D12): schedules are per-suite, live
   in the DB, and are edited at runtime; static cluster cron can't express them
   without redeploys and needs cluster RBAC.
3. **External job queue (Redis/Celery/BullMQ).** Rejected: no fan-out compute to
   distribute; adds a stateful dependency. The DB-row lease covers dedup.
4. **Leader election (single elected scheduler pod).** Rejected as unnecessary for
   correctness: the per-suite lease is finer-grained and spreads work across pods.
   Left available as the optional `DQ_SCHEDULER_ENABLED=false` + dedicated
   Deployment pattern for operators who want isolation.
5. **Results in a ClickHouse table** instead of the app DB. Rejected for phase 1:
   couples Data Health to a specific connection and complicates RBAC; the app DB is
   transactional and consistent with alerting. Revisit if history volume demands it.
6. **One SQL query per test** instead of batch-per-table. Rejected: N queries per
   table is heavier load on production clusters; batching is one bounded scan.
7. **Best-effort notifications (no outbox).** Rejected: a hard kill between commit
   and send drops the alert. The outbox makes delivery survive crashes.
8. **Sparse typed result columns / a column per test type.** Rejected: a wide,
   mostly-NULL table that grows with the catalog. A single `config` JSON +
   stringified `observed_value` is cleaner.
9. **Enumerate the full ecosystem rule set (Great Expectations / dbt-expectations /
   Soda parity — 30+ named rules).** Rejected: rule count is a vanity metric. Most
   such rules are parameterizations of two primitives we already have (a row
   predicate `countIf(<pred>)` and an aggregate-vs-bounds check), so enumerating them
   adds UI + maintenance surface, not capability. We instead add a few genuinely
   distinct foldable primitives (`string_length`, `cardinality`) plus one generic
   gated `expression` predicate that covers the long tail (cross-column comparisons,
   date sanity, format functions) without naming each case — keeping the catalog
   opinionated and the builder readable.

---

## Implementation checklist (for the build PR(s))

1. Migration `1.40.0` (`data_quality`) — tables (D2) + 5 permissions/grants (D9),
   dual-dialect, idempotent; `VERSION_CHECKS` + dual-dialect tests (D13).
2. Service layer `packages/server/src/services/dataQuality/` —
   `types.ts`, `store.ts`, `compiler.ts`, `runner.ts`, `scheduler.ts` (+ co-located
   tests). Register scheduler in `index.ts` behind `DQ_SCHEDULER_ENABLED` (D6, D12).
3. Reaper + outbox delivery passes inside the tick (D7, D8).
4. Routes `packages/server/src/routes/dataQuality.ts` + overview aggregation (D10,
   D11) with `requirePermission` + data-access constraint (D9).
5. Client `src/api/dataQuality.ts` + hooks (+ tests).
6. Frontend `src/features/data-quality/` — Overview / Suites (builder) / Runs;
   Monitoring tab + `navAccess` wiring (D11).
7. HA startup guardrail (SQLite + HA → warning) (D12).
8. Changelog fragment `changelogs/unreleased/<pr>-data-quality.md` (`type: minor`).
9. Lint, typecheck, `bunx vitest run`, `./scripts/test-isolated-server.sh`,
   `./scripts/test-migrations.sh`.
