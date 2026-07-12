# 0003 — Data Health Promises

**Status:** Accepted

## Context

Scheduled Queries already provide durable cadence, slot claiming, bounded ClickHouse
execution, immutable runs, current-owner data-access enforcement, notification delivery,
and runtime lineage. Data operators need a higher-level workflow that describes what must
remain true about a dataset without making them author and operate one scheduled SQL job
per expectation.

The feature must distinguish unhealthy data from a monitor that could not execute, avoid
repeated alerts for one continuing problem, provide evidence without persisting raw user
rows, and remain safe under multiple server replicas. It must work with both SQLite and
PostgreSQL application databases and preserve all existing Scheduled Queries behavior.

## Decision

### Product model

Data Health is built around an executable **promise** for one dataset. A promise records
the dataset identity, business owner, criticality, timezone, delivery expectation,
evaluation cadence, notification destinations, and a set of checks.

The supported checks are freshness/delivery, row volume, learned volume range,
completeness, uniqueness, validity, schema contract, and a custom scalar metric. Checks
sharing a source and window compile into one read-only aggregate query where possible.

Data Health has separate state layers:

- execution: `running | success | error`;
- check: `pass | breach | learning | not_evaluated`;
- promise: `healthy | degraded | unhealthy | unknown | paused`.

A successful query with breached expectations remains an execution success. Execution
errors make the promise `unknown`; they never claim that the data itself is unhealthy.

### Scheduled Queries ownership

Each promise owns one internal `scheduled_queries` row with
`kind = 'data_health_check'`. The shared scheduler remains responsible for cadence,
leases, retries after orphan recovery, cancellation, resource limits, runs, retention,
and the outbox. A producer-aware execution boundary delegates result evaluation and
notification transitions to Data Health.

Internal jobs are excluded from public Scheduled Queries list, overview, lookup, update,
delete, run, runs, and lineage routes. They are managed only through Data Health APIs.

### Evaluation and incidents

Static thresholds are evaluated directly. Learned ranges use a transparent median and
median-absolute-deviation baseline from comparable historical windows, with explicit
minimum sample requirements and optional hard floors/ceilings. A bounded backtest primes
the baseline and shows how the configuration would have behaved before activation.

Metric samples store scalar observations, expected bounds, window timestamps, and
structural evidence. Raw source rows are not persisted. An interactive, bounded
diagnostic query may display failing rows under the current viewer's permissions.

Breaches open or update one incident per promise. Consecutive-breach and
consecutive-pass rules provide hysteresis. Notifications occur only on incident open,
severity escalation, and recovery. Acknowledgement and snoozing affect operator workflow
and delivery, not continued evaluation.

### Time and security

The shared cadence supports IANA timezones for Scheduled Queries. Data Health always
uses `UTC` for firing, previous-window calculation, preview, and baseline grouping so
its slot macros have the same semantics as Scheduled Queries' execution parameters.
For table sources, Data Health inspects the ClickHouse partition key and adds a coarse
time-partition predicate when it recognizes a time-based style. Local calendar/date
partitions use a one-day boundary halo; the exact UTC event-time predicate remains the
authoritative filter. Native ClickHouse `DateTime` columns are compared as instants.
Day-only `Date`/`Date32` event-time columns require a calendar timezone; UTC slot
boundaries are mapped to local calendar dates, freshness is measured from the end of
the latest completed local day, and cadence is limited to daily, weekly, or monthly.
String timestamps require the timezone of offset-less stored text, and integer
timestamps require an explicit seconds, milliseconds, microseconds, or nanoseconds
unit before conversion to an instant.

Data Health has independent `view`, `edit`, `delete`, `run`, and `view_all` permissions.
Connection and table access are checked at configuration time and re-evaluated against
the promise owner's current access at every run. Diagnostic queries use the viewer's
current access. Mutations and operator actions are audited.

### Persistence

The application database adds:

- `data_health_promises` — dataset, ownership, state, cadence, and internal job link;
- `data_health_promise_checks` — typed, validated expectations and severity;
- `data_health_samples` — scalar observations and expected bounds;
- `data_health_incidents` — current and historical incident lifecycle;
- `data_health_incident_events` — immutable transitions, acknowledgements, snoozes,
  recoveries, and notes.

The promise-to-job relationship is one-to-one and owned by the promise. Creation,
replacement of compiled configuration, and deletion must be atomic in the application
database or compensated so orphaned internal jobs cannot remain user-manageable.

## Execution checklist

This is one shipping scope. Ordering expresses dependencies, not separate releases.

- [x] Add timezone-aware shared cadence with UTC compatibility and DST tests.
- [x] Add Data Health schema, indexes, permissions, audit actions, and dual-dialect
      migration coverage.
- [x] Add producer-scoped Scheduled Queries storage and route isolation.
- [x] Add promise/check/sample/incident stores and validated domain types.
- [ ] Add the check SQL compiler, schema snapshotting, preview, and bounded backtest.
- [x] Add static and learned evaluation with explicit zero-row semantics.
- [x] Add producer-aware run finalization and Data Health execution integration.
- [ ] Add incident grouping, hysteresis, acknowledgement, snoozing, escalation,
      recovery, and outbox messages.
- [ ] Add secured Data Health APIs, data-access revalidation, auditing, diagnostics,
      retention, and consistency repair.
- [x] Add DataOps Data Health Overview, Datasets, promise wizard/detail, and Incidents.
- [ ] Add runtime-lineage impact context and execution drill-down.
- [ ] Add unit, API, scheduler, migration, frontend, and ClickHouse end-to-end tests.
- [ ] Add operational documentation and an unreleased changelog fragment.

## Acceptance gates

- A common table can be protected without SQL and evaluated immediately.
- Preview shows historical outcomes and transparent learned bounds before activation.
- Bad data and failed monitoring are represented and alerted differently.
- A continuing failure creates one incident and one opening notification.
- Recovery closes the incident and sends one recovery notification.
- No raw source row is persisted as health evidence by default.
- Revoked owner access fails closed on the next evaluation.
- Internal health jobs cannot be manipulated through Scheduled Queries APIs.
- Multi-replica execution and outbox retries do not duplicate incident transitions.
- Existing Scheduled Queries behavior and UTC schedules remain compatible.
- SQLite, PostgreSQL, server, frontend, and end-to-end verification pass.

## Consequences

Users operate dataset promises and incidents instead of monitoring SQL. The application
database gains small time-series and incident tables, and the scheduled runner gains a
producer boundary. Generated SQL and baselines require careful cost controls and
explainability. Timezone support adds DST cases to a previously UTC-only scheduler, but
is necessary for business delivery promises.

## Alternatives considered

- **Expose condition fields in Scheduled Queries.** Rejected because it leaves users
  writing SQL and provides no dataset ownership, coverage, evidence, or incident model.
- **Create one visible scheduled job per check.** Rejected because it multiplies scans,
  creates alert noise, and makes one dataset problem look like unrelated job failures.
- **Store health history in ClickHouse.** Rejected because monitoring metadata must not
  require write access to the monitored connection and must work across connections.
- **Use an opaque anomaly model.** Rejected because operators need to understand and tune
  why an alert fired.
