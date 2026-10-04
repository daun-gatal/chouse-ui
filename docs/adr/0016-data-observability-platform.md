# 0016 — Data Observability Platform: Single Cut-over to Cross-Layer Observability

**Status:** Accepted

**Amends:** 0002 (scheduled-query lineage is replaced by the warehouse lineage
graph), 0004 (DataOps AI gains cross-layer RCA and executable action drafts),
0013 (new MCP tools, agent budgets and health notices).

**UI reference:** the 13-screen design canvas "CHouse UI Data Observability".
The canvas fixes content and hierarchy. Pixels come from the existing design
system (§14).

## Context

CHouse UI observes the ClickHouse **engine** (Monitoring, Fleet, Doctor) and
parts of the **data** (Data Health promises, Scheduled Queries, DataOps AI).
These halves do not talk to each other, and both have blind spots:

1. **Lineage only covers our own jobs.** `services/scheduledQueries/lineage.ts`
   attributes `system.query_log` rows by `log_comment.job_id`. Most production
   data moves through paths nothing reads today:
   - materialized views and refreshable materialized views
   - queue engines (Kafka, RabbitMQ, NATS)
   - object-storage queues (S3Queue, AzureQueue)
   - database replication (MaterializedPostgreSQL, MaterializedMySQL, and the
     PostgreSQL/MySQL table engines)
   - Distributed inserts and dictionaries
   - table functions (`s3()`, `url()`, `postgresql()`, …)
   - async inserts
   - external writers (dbt, Airflow, Vector, OTel collectors, apps)
2. **Pipelines fail invisibly.** A failing cascaded view, a stuck S3Queue file,
   a dictionary that stopped refreshing, a Distributed queue that keeps growing,
   or a refreshable view retrying all leave evidence only in `system.*` tables
   that nothing reads.
3. **Monitoring is opt-in per table.** A table without a promise is invisible.
4. **Data incidents stop at the data layer.** The operator correlates the
   pipeline error and the node under pressure by hand, even though Fleet already
   has the node snapshot.
5. **The Doctor diagnoses but cannot fix.** Every fix is a copy-paste into
   Explorer, with no approval trail and no verification.
6. **Agents read ClickHouse blind.** They cannot see freshness or meaning, and we
   cannot attribute or budget what they run.
7. **Performance, capacity and upgrades are reactive.**

The owner has decided this ships as **one complete migration, on one branch, in
one PR**: no phases, no feature flags, no legacy code paths kept beside the new
ones, and **no regression of any existing feature**.

## Decision

Replace DataOps, the scheduled-query lineage, the opt-in fleet poller and the
advisory-only Doctor with one **Data Observability Platform** built on:

- one collector
- one evidence store
- one source-agnostic pipeline model
- one lineage graph

It ships as a **minor** release (changelog fragment `type: minor`; the version
number is assigned by `auto-release.yml`) from branch
`feat/data-observability-platform`, as a single PR into `preview`.

**Backward compatibility is a requirement.** Every existing config key, env var,
REST endpoint, permission, MCP tool, CLI command and Helm value keeps working
(§15, §18). Navigation and layout changes are UX, not contract.

Principles:

- **Evidence comes from ClickHouse system tables only.** No sidecars, and no
  instrumentation of user pipelines.
- **Collection is read-only:** `readonly=1` and `max_execution_time` caps.
- **Writes happen only through the typed action catalog (§8),** after human
  approval, with a dedicated credential, a rollback where one exists, and a
  verification step.
- **AI never sits on a hot path.** Collection, baselines, detection, RCA ranking,
  budgets and approvals are deterministic. AI writes narratives and drafts on
  top of that evidence (as in 0004).
- **Fail closed** (0010). Missing privileges, leases or credentials show as
  explicit error states on the affected collector or action. They never block
  existing features such as connection CRUD or querying.
- **No source is privileged.** Kafka is one adapter among many. Every source
  maps onto the same model, statuses and RCA layers.

### 1. Observability collector

`packages/server/src/services/observe/` replaces `fleetPoller.ts`.

- **Where it runs:** in every server process. Each `(connection, collector)`
  pair is claimed through a row lease, so exactly one process collects it at a
  time (see "Changes during implementation").
- **Leases:** row leases in `obs_leases`, which replace `fleet_poller_lease`.
- **Watermarks:** each collector reads incrementally from an `event_time`
  watermark kept in `obs_watermarks`.

| Collector | Sources | Cadence |
|---|---|---|
| `fleet` | existing poller queries (unchanged output contract) | `OBSERVE_FLEET_INTERVAL` (30s) |
| `catalog` | `system.tables`, `system.columns`, `system.databases`, `system.dictionaries`, `create_table_query`, `dependencies_*`; per-version capability probe of `system.*` | 5 min |
| `lineage` | `query_log` (`INSERT … SELECT`, `tables`, `columns`, `used_table_functions`, `client_name`, `http_user_agent`, `log_comment`) | 5 min |
| `pipelines` | source adapters (§4) | 1 min |
| `tables` | `system.parts` per partition (rows, bytes, `modification_time`), `system.part_log` | 5 min |
| `usage` | `query_log` reads by principal kind, filter columns | 15 min |
| `queries` | `query_log` by `normalized_query_hash` per replica | 15 min |
| `changes` | DDL in `query_log`, per-node `version()`, settings-profile snapshots, writer `client_version` / `app_version` | 5 min |
| `capacity` | `system.disks`, part bytes growth | 15 min |
| `profiles` | sampled aggregates (`SAMPLE` when a sampling key exists, else bounded reads); only critical tables and tables with drift promises | 15 min |

**Privileges.** Saving a connection runs a privilege check over the system
tables that exist on that server version. **The save always succeeds**, so
existing least-privilege connections keep working. Missing grants produce a
warning with the exact `GRANT` statements, and only the collectors that need
them enter an explicit `missing_privileges` state (shown on the connection,
Data Overview and Pipelines). The same check re-runs on every collector cycle,
so granting the privileges clears the state without a re-save.

**Bounds per connection:**
- 5,000 fingerprints
- a 20,000-node graph
- pipeline samples for 48h; lineage, query-shape and table evidence for 90 days
  (`OBSERVE_RETENTION_DAYS`)

### 2. Evidence store (RBAC database)

All state lives in the existing RBAC database (SQLite or PostgreSQL), bounded by
§1:

- **Catalog and lineage:** `obs_catalog_tables`, `obs_catalog_columns`,
  `obs_capabilities` (per connection and server version: which system tables and
  columns exist), `obs_lineage_nodes`, `obs_lineage_edges`,
  `obs_lineage_column_edges`.
- **Pipelines and tables:** `obs_pipelines`, `obs_pipeline_samples`,
  `obs_table_baselines`, `obs_table_samples`, `obs_column_profiles`,
  `obs_usage_rollups`.
- **Performance:** `obs_query_fingerprints`, `obs_fingerprint_rollups`,
  `obs_regressions`, `obs_change_events`.
- **Capacity:** `obs_capacity_samples`, `obs_capacity_forecasts`,
  `obs_codec_trials`, `obs_cost_rates`.
- **Incidents:** `obs_incidents` for pipeline, freshness, part, replication and
  capacity incidents; `incident_rca` and `incident_blast_radius` keyed by
  `(source, id)` to either `obs_incidents` or `data_health_incidents`.
- **Remediation:** `remediation_actions`, `remediation_approvals`,
  `remediation_executions`.
- **Notebooks:** `notebooks`, `notebook_cells`.
- **Context:** `ctx_table_context`, `ctx_metrics`, `ctx_patterns`.
- **Agents:** `agent_sessions`, `agent_tool_calls`, `agent_policies`, plus the
  `agent_access_paused` setting.
- **Upgrades:** `upgrade_assessments`, `upgrade_findings`, `replay_runs`,
  `replay_results`.

### 3. Lineage graph (replaces scheduled-query lineage)

- **Structural edges** come from `system.tables` and `system.databases`:
  - view `TO` targets and their sources, for both materialized and refreshable
    views
  - each engine table and the view that reads it
  - Distributed → local tables
  - dictionary sources
  - replicated databases (MaterializedPostgreSQL / MySQL) → their tables
  - external-engine tables (PostgreSQL, MySQL, S3, URL, …)
- **Observed edges** come from `query_log`:
  - `INSERT … SELECT`, including from table functions
  - writers identified from `client_name`, `http_user_agent` and
    `log_comment.source`
- **Consumer nodes** are scheduled jobs, saved queries, agents and people.
- **Column edges** come from `query_log.columns` plus parsing each view's
  `SELECT`. Edges whose `SELECT` cannot be parsed are marked
  `granularity = table` and shown that way.

API:
- `GET /api/observe/lineage?node=&depth=&direction=&granularity=table|column`
- `GET /api/observe/lineage/impact?node=`

Kept for compatibility: `GET /api/scheduled-queries/:id/lineage` keeps its
route, permission and response shape (the `LineageTableNode` / `LineageJobNode`
graph). It is now served by the new graph as a view filtered to the job, so
PAT-authenticated scripts keep working. A contract test pins the response shape.

Deleted:
- `services/scheduledQueries/lineage.ts`: its `query_log` attribution moves
  into the `lineage` collector (`services/observe/jobLineage.ts` serves the
  kept endpoint from the stored edges).

Kept: the job detail's runtime-lineage panel stays on the endpoint above, so
users with only `scheduled_queries:view` keep it; users with `observe:view`
get a link into the global graph focused on the job node.

### 4. Source-agnostic pipelines

Every ingestion or transform path is an `obs_pipelines` row produced by a
**source adapter** (`services/observe/adapters/<kind>.ts`) implementing one
contract:

```ts
interface SourceAdapter {
  kind: PipelineKind;
  matches(catalog: CatalogSnapshot): PipelineDef[];        // discovery
  requires: CapabilityProbe[];                            // system tables / columns it reads
  sample(ctx: CollectorContext, defs: PipelineDef[], since: Date): Promise<PipelineSample[]>;
}
```

**Normalized sample, shared by every kind:**

| Field | Meaning |
|---|---|
| `units_in` | rows, messages or files |
| `bytes_in` | bytes ingested |
| `last_success_at` | last successful run, file, batch or flush |
| `lag_seconds` | nullable |
| `backlog` | nullable; with `backlog_unit` (messages, files, rows, bytes) |
| `errors` | error count |
| `error_sample` | code and text of a recent error |
| `progressing` | whether there was forward progress in the window |
| `error_class` | `engine`, `external`, `config` or `data` |

`error_class` is classified from ClickHouse error codes. Example: S3 403 or
Postgres connection refused → `external`; `MEMORY_LIMIT_EXCEEDED` → `engine`;
parse errors → `data`.

**Adapters in this release:**

| Kind | Objects | Evidence |
|---|---|---|
| `materialized_view` | `MaterializedView` | `query_views_log` (status, exception, written rows, duration) |
| `refreshable_view` | `MaterializedView … REFRESH` | `system.view_refreshes` (status, last success, next refresh, exception, retry) |
| `queue_engine` | `Kafka`, `RabbitMQ`, `NATS` | engine-specific state where ClickHouse exposes it (`system.kafka_consumers` for Kafka). For every queue engine: attached-view outcomes from `query_views_log`, target write cadence, engine errors from `system.errors` deltas |
| `object_storage_queue` | `S3Queue`, `AzureQueue` | `system.s3queue` / `system.azure_queue` (in-flight files), `s3queue_log` / `azure_queue_log` (processed and failed files, exceptions) |
| `database_replication` | `MaterializedPostgreSQL`, `MaterializedMySQL` databases | replicated-table write cadence against the learned baseline, replication error-code deltas in `system.errors` |
| `external_table` | `PostgreSQL`, `MySQL`, `MongoDB`, `S3`, `URL`, `HDFS` engines and table functions used by views and jobs | `query_log` exceptions and durations of the reading queries |
| `distributed` | `Distributed` inserts | `system.distribution_queue` (files, bytes, errors, last exception, blocked) |
| `dictionary` | dictionaries | `system.dictionaries` (status, last successful update, last exception, loading duration) |
| `async_insert` | async inserts | `system.asynchronous_insert_log`, `system.asynchronous_inserts` |
| `buffer` | `Buffer` tables | buffered rows against destination flush cadence |
| `writer` | any native or HTTP client | `query_log` inserts by user, `client_name`, `http_user_agent`, `log_comment`, `client_version`: batch size, cadence, parts created (`part_log`) |
| `scheduled_job` | CHouse scheduled queries | `scheduled_query_runs` |

**Capability detection.** The `catalog` collector records which system tables
and columns exist per server version. An adapter whose required evidence is
missing on that version reports `unsupported_on_version` for those pipelines,
and the UI names the missing table and version. It does **not** silently switch
to a weaker signal. Weaker signals are always collected as part of the generic
contract, so a pipeline is never invisible.

**One status vocabulary for every kind:**

| Status | Meaning |
|---|---|
| `healthy` | none of the below |
| `lagging` | lag or backlog above the learned band |
| `stalled` | input pending, no progress (offsets not committed, files stuck in processing, queue not draining) |
| `retrying` | repeated errors with no progress |
| `failing` | units failing while others succeed |
| `stopped` | no activity beyond 3× the learned cadence |
| `inefficient` | small inserts, part explosion |
| `unsupported_on_version` | required evidence missing on this server version |

A status transition opens an `obs_incidents` row when the pipeline feeds a
promised, critical or important table within three hops.

### 5. Baselines, coverage, drift and usage

- **Baselines for every table**, from metadata only:
  - write cadence (p50/p99 of inter-write gaps)
  - an hour-of-week volume band (median ± MAD over 28 days)
  - state: `trusted`, `degraded`, `stale` or `learning`
- **Automatic criticality** from read volume and distinct-reader percentiles:
  `critical` (top 5%), `important` (next 15%), `standard`. Owners can pin a
  value.
- **Suggestions** become ordinary Data Health promise drafts when accepted.
- **New check type `distribution`:** p50/p95, null rate, distinct count and
  top-K share against a 14-day profile.
- **Usage:**
  - readers by kind (person, job, agent)
  - most-filtered columns compared with `sorting_key`, with a skip-index hint
    and granule estimate from `EXPLAIN indexes = 1` on sampled queries
  - cold data

### 6. Cross-layer RCA and blast radius

Deterministic RCA runs when any incident opens:

1. **Walk upstream** through the lineage graph, up to depth 6.
2. **Collect signals** within the incident window. These come from pipeline
   samples (§4), view and refresh errors, external-error classes, and the fleet
   snapshot of every host running the node's engine, consumers or views.
3. **Assign each signal a layer:**
   - `data`
   - `transform` (views, refreshable views, jobs)
   - `ingestion` (any source adapter)
   - `external` (an upstream system: Postgres, S3, a broker, an HTTP endpoint)
   - `engine` (node or cluster resources)
4. **Rank causes** by onset precedence, causal plausibility along the edge, and
   depth. Store the chain with evidence refs in `incident_rca`.
5. **Walk downstream** for the blast radius: tables, promises, scheduled jobs
   (at-risk runs), saved queries, agents and readers.
6. **Link incidents** that share a root cause, and find earlier incidents with
   the same chain signature.

DataOps AI (0004) receives the stored chain as evidence. It writes the brief and
drafts actions, but never chooses the root cause.

### 7. Investigation notebooks

Incidents and Doctor reports share one notebook model. Cells can be:

- AI findings
- read-only query cells (a stored SQL statement plus a snapshot result that can
  be re-run)
- notes
- charts
- actions

A notebook exports as a Markdown postmortem. Existing `doctor_reports` are
converted by a data migration (§12). Every old report stays readable.

### 8. Remediation: typed action catalog, approval, verification

Actions come from a closed catalog: a Zod discriminated union in
`services/remediation/catalog.ts`. Each type defines:

- preconditions, re-checked when it executes
- a preflight (§11)
- a parameter-only SQL generator
- an approval class: 1 approver, or 2 approvers (the proposer cannot approve)
- an execution window
- a rollback generator
- a verification probe

**Catalog:**

| Area | Action types |
|---|---|
| Queries | `kill_query` |
| Scheduled jobs | `pause_scheduled_job`, `resume_scheduled_job`, `delay_scheduled_job` |
| Settings | `set_profile_setting` |
| Merges and replicas | `optimize_partition`, `restart_replica` |
| Schema | `add_skip_index`, `modify_ttl`, `modify_column_codec` |
| Pipelines | `restart_engine_table` (detach/attach for any queue or object-storage engine table), `reload_dictionary`, `refresh_view` (`SYSTEM REFRESH VIEW`), `flush_distributed` (`SYSTEM FLUSH DISTRIBUTED`) |

**Lifecycle:** `proposed → approved → executing → executed → verified |
failed_verification | rolled_back`.

**Execution identity.** A per-connection **remediation credential**, encrypted
with AES-256-GCM, holds only the grants the enabled actions need. Without it,
actions show "cannot execute: no remediation credential". Nothing ever falls
back to another credential.

**Approval surfaces:**

- **UI.**
- **Slack interactive messages** through
  `POST /api/integrations/slack/interactions`. Requests are verified with
  `SLACK_SIGNING_SECRET`, and Slack users map to RBAC users by verified email.
- **CLI** (§13).
- **Email** carries links only and never approves anything.
- Every transition is audit-logged.
- The AI and MCP agents can **propose** actions but can **never approve** them.

### 9. Performance, capacity, cost and upgrades

- **Regressions:**
  - per-replica 14-day fingerprint baselines
  - a regression is p95 or `read_bytes` at least 1.5× baseline for at least
    20 runs
  - linked to `obs_change_events` in the onset window
  - a replica-version split for regressions caused by an upgrade
  - an `EXPLAIN` diff between replicas
  - "Optimize with Chouse AI" reuses the existing optimizer
- **Capacity:** a robust linear fit per node and disk gives days-to-threshold
  (85% by default) and the top growth tables.
- **Codec and TTL advisor:** operator-started trials in
  `OBSERVE_SCRATCH_DATABASE` copy a 1M-row sample, measure
  `system.parts_columns`, then drop the table. Trials use the remediation
  credential limited to that database.
- **Cost:** `read_bytes` and CPU time × operator rates, by role, user, job and
  agent. Gated by `cost:view`.
- **Upgrade readiness:**
  - a versioned rules pack in `services/upgrades/rules/*.json` covering
    deprecated and removed types, settings and functions, and changed defaults
  - rules matched against `query_log` (`used_functions`,
    `used_aggregate_functions`, `Settings`), catalog column types and settings
    profiles
  - plus regressions already seen on upgraded replicas
  - plus a **workload replay**: the top 500 read-only fingerprints run against
    an operator-designated canary connection with `readonly=1`, comparing
    result hashes and timings
  - plus a rollout tracker with per-replica gates
  - CHouse UI never performs the upgrade itself.

### 10. Agents

- **Tagging.** PAT- and MCP-authenticated queries are tagged in `log_comment`
  (`source`, `pat_id`, `session_id`, `tool`), extending the per-actor client
  tagging in `clientManager.ts`.
- **Budget preflight.** Before running, a query gets an `EXPLAIN ESTIMATE`,
  then `agent_policies` are enforced:
  - bytes per query
  - a daily budget from `query_log`
  - a partition filter required on large tables
  - warn or block when reading a table with an open critical incident
- **Health notice.** Results carry a `dataHealth` notice for every touched table
  that is stale, degraded or has an open incident. Tables are resolved by the
  existing SQL parser middleware.
- **Pause.** `agent_access_paused` rejects every PAT-authenticated query.

### 11. Context, watchers and schema change preflight

- **Context.** Derived facts (sorting key, engine semantics, joins, known-good
  patterns) sit next to curated fields: description, grain, owner, canonical
  metrics, "instead of". A dbt `manifest.json` import fills curated fields. The
  context feeds every AI capability (`sharedInstructions.ts`) and MCP.
- **Plain-language watchers.** AI compiles a sentence into a Data Health promise
  draft anchored on the existing macro time variables, so it can be backtested
  before saving. The output is an ordinary promise, not a new type.
- **Schema change preflight.** Every DDL from Explorer, the API, the CLI or MCP
  passes impact analysis first:
  - the ddlSimulator, extended from mutations to `ALTER` / `RENAME` / `DROP` /
    `MODIFY`
  - a lineage downstream walk
  - reference scans of view `SELECT`s, jobs, saved queries, schema contracts and
    agent usage

  When a change breaks dependents, the user sees the impact and must confirm.
  Running it needs `schema:override`, which **Super admin and Admin hold by
  default**, so every role that can run DDL today still can (after one explicit
  confirmation). Overrides are audit-logged. Roles without `schema:override`
  can still run DDL that breaks nothing. AI suggests a staged plan.

### 12. Data model migrations

These follow the mandatory rules in CLAUDE.md:

- **`1.53.0` (additive):**
  - every table in §2 (`IF NOT EXISTS`)
  - the `distribution` check type
  - `obs_incidents` and the RCA tables
  - new permissions and default grants
- **`1.54.0` (data):**
  - copy `fleet_poller_lease` into `obs_leases`
  - convert `doctor_reports` into notebooks
  - map grants: `data_health:view` or `scheduled_queries:view` → `observe:view`;
    `doctor:run` → `remediation:propose`
  - idempotent, with seed-and-transform tests covering empty data, conflicts and
    re-runs
- **`1.55.0` (destructive):** drop `fleet_poller_lease`. This is kept separate so
  a failed transform never reaches a drop.

Each version gets a `VERSION_CHECKS` entry. Fresh, stepwise and skip-version
upgrades all pass on SQLite and PostgreSQL.

### 13. RBAC, MCP and CLI

**New permissions:**

| Permission | Covers |
|---|---|
| `observe:view` | Data overview, lineage, pipelines, datasets, coverage |
| `observe:edit` | Accepting suggestions, criticality pins |
| `context:edit` | Curated context and canonical metrics |
| `performance:view` | Performance |
| `capacity:view` | Capacity |
| `cost:view` | Cost |
| `upgrades:view` | Upgrade assessments |
| `upgrades:run` | Workload replay, codec trials |
| `remediation:propose` | Proposing actions |
| `remediation:approve` | Approving class-1 actions |
| `remediation:approve_high` | Approving class-2 actions |
| `schema:override` | Running DDL that breaks dependents |
| `agents:view` | Agents |
| `agents:manage` | Agent policies, pause all |

**Default grants:**

| Role | Gets |
|---|---|
| Super admin | All |
| Admin | All (including `schema:override`) |
| Developer | Every `:view`, plus `observe:edit`, `context:edit`, `remediation:propose` |
| Analyst / Viewer | `observe:view`, `performance:view` |

Every existing permission is kept unchanged. `DATAOPS_ACCESS_PERMISSIONS` becomes
`DATA_ACCESS_PERMISSIONS` (`observe:view` ∪ `scheduled_queries:view` ∪
`data_health:view`).

**MCP:**
- **New tools:** `get_dataset_health`, `get_lineage`, `get_table_context`,
  `get_metric`, `get_pipeline_status`, `list_incidents`, `propose_remediation`.
  There is no approve tool.
- **Extended:** `query` gains the budget preflight and health notices.
- **Unchanged:** every existing tool keeps its name and schema.

**CLI** (`changelogs/cli/unreleased/`):
- **New commands:** `chouse health <table>`, `chouse lineage <table>`,
  `chouse incidents`, `chouse remediation list|approve|reject`.
- **Unchanged:** existing commands.

### 14. UI: built inside the existing design system

The canvas defines content and hierarchy only. Implementation uses what the app
already ships, and **no existing screen changes appearance** except where this
ADR says so.

- **Shell.** The existing `FloatingDock` in all three modes (horizontal dock,
  vertical dock, sidebar rail), with auto-hide and pin behaviour, the
  `McpStatusDockItem`, notifications and the avatar. Two changes only:
  - "DataOps" is renamed **Data** (same `Workflow` icon, route `/data`)
  - **Agents** is added (lucide `Bot`), gated by `agents:view`
- **Page anatomy.** Reuse the DataOps/Monitoring header:
  - icon box, mono uppercase eyebrow, 18px semibold title
  - a feature-pill row and a sub-tab row with the 1px brand underline
  - right-side status, refresh and run controls

  The duplicated `TabPill` (Monitoring) and `FeaturePill` (DataOps) become one
  shared `src/components/common/PageShell/` with **no visual change**, proven by
  screenshot diff (§Testing).
- **Placement:**
  - `/data/:tab`: Overview, Incidents, Lineage, Pipelines, Datasets, Coverage,
    Context, Scheduled queries
  - `/monitoring/:tab` gains Performance, Capacity, Upgrades after the existing
    seven tabs, which are untouched
  - `/doctor/:reportId?` renders the notebook and remediation panel
  - `/agents/:tab` holds Sessions, Policies, MCP tools
  - Explorer gains the preflight result tab next to Results and Visual EXPLAIN
- **Tokens only:** `ink-*`, `paper-*`, `brand-*`, `chart-*`, `rounded-xs`, Geist
  and Geist Mono. No raw hex values in components. Every new screen works in
  light, dark and auto themes and in container-query layouts.
- **Components:**
  - shadcn/ui primitives, `data-table` / AG Grid for tables, `sonner` toasts
  - lucide-react icons
  - recharts with the existing chart tokens
  - **reactflow** (already a dependency) for the lineage graph
  - TanStack Query hooks and Zustand stores following the existing patterns
- **Also updated:**
  - command palette entries for every new route
  - onboarding chapters (anchors renamed from `dataops-*` to `data-*`)
  - `PermissionGuard` on every new surface
  - Old `/dataops/*` URLs map statically to `/data/*` (URL compatibility only;
    no old screen remains).

### 15. Feature parity (no regression)

Every existing capability keeps working after the cut-over and is covered by a
test that exists before the refactor starts:

| Existing feature | After this release |
|---|---|
| Scheduled Queries: wizard, macros, runs, outbox/channels, materialize (incl. cluster-aware, 0015), clear & rerun (0007), DataOps AI briefs, `GET /:id/lineage` | `/data/scheduled-queries`, behaviour unchanged; lineage tab replaced by the focused global graph; lineage endpoint keeps its contract |
| Data Health: promises, all check types, event-triggered (0006), incidents, samples, ack/snooze | `/data/datasets`, `/data/incidents`, unchanged; adds `distribution`, RCA and blast radius |
| Fleet page, fleet API contract, threshold alerts with hysteresis, Slack/email, auto-RCA on breach | unchanged; the snapshot producer moves into the `fleet` collector with an identical output contract |
| Doctor scans, schedule, history, auto-RCA | notebook view of the same reports; all historical reports migrated |
| Monitoring's seven tabs, Explorer, Visual EXPLAIN, AI optimize/debug/chat, Admin, RBAC, SSO, PATs, audit | unchanged (Explorer adds DDL preflight; every role that can run DDL today still can) |
| Connections: create/edit with least-privilege users | unchanged; missing grants only warn |
| `/dataops/*` bookmarks | redirect to the matching `/data/*` page |
| MCP tools and CLI commands | unchanged names and schemas; new ones added |
| Config and Helm values | every existing key still accepted; new keys optional with defaults (§16) |

### 16. Helm chart and configuration

Per `.rules/HELM_CHART.md`, in the same PR:

- **Deprecated (still accepted):** `FLEET_POLLER_ENABLED` and the config.yaml
  `poller_enabled` key. Fleet collection is now always on. If
  either key is set, startup logs one warning ("deprecated, ignored; see ADR
  0016") and continues. The chart README marks it deprecated. Removing the key
  is left to a future major release.
- **Added (all optional, with defaults):** `OBSERVE_FLEET_INTERVAL`, `OBSERVE_RETENTION_DAYS`,
  `OBSERVE_MAX_FINGERPRINTS`, `OBSERVE_SCRATCH_DATABASE`,
  `REMEDIATION_MAINTENANCE_WINDOW`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`
  (with existing-secret support).
- **Scheduler resources:** unchanged; the collector runs on every pod under
  leases, so no single deployment carries it.
- **Ingress and NetworkPolicy:** allow Slack to reach the interactions endpoint.
- **Chart version:** bump `version`; `appVersion` is left to automation.
- **Chart README:** regenerated.
- **Chart tests:** updated.

### 17. Removed in the cut-over (internal only)

Nothing below is a public contract. Every removed user-facing entry point has a
compatible replacement (§18).

- `src/pages/DataOps.tsx` (the `/dataops/*` URLs redirect statically to `/data/*`).
- `services/scheduledQueries/lineage.ts` (the REST endpoint
  stays, §3).
- `services/fleetPoller.ts` (its env and config keys stay accepted, §16).
- "Advisory only" wording and code paths in the Doctor.
- `fleet_poller_lease` (migration `1.55.0`).

### 18. Compatibility contract (why this is a minor release)

| Surface | Guarantee | Enforced by |
|---|---|---|
| Env vars and config.yaml keys | All existing keys accepted; `FLEET_POLLER_ENABLED` / `poller_enabled` deprecated, warned, ignored | config loader unit test |
| REST API | No route removed or reshaped; `GET /api/scheduled-queries/:id/lineage` keeps its shape | contract tests snapshotting existing response shapes |
| Permissions and roles | No permission removed or renamed; default roles keep every ability they have today (Admin gets `schema:override`) | RBAC default-grant test |
| Connections | Saving never newly fails; missing grants only warn | route test with a least-privilege user |
| MCP tools and CLI | Existing names, schemas and flags unchanged | MCP and CLI e2e suites |
| Helm chart | Every existing value renders the same; new values optional | `helm unittest` against the previous values file |
| URLs | `/dataops/*` redirects to `/data/*` | UI e2e |

If any implementation step cannot meet this table, the ADR must be amended
before merge, and the fragment type re-evaluated.

## Delivery: one branch, one PR, proven before every commit

All work lands on `feat/data-observability-platform` and merges as **one PR into
`preview`**, using the PR template. It includes:

- a `type: minor` changelog fragment
- a CLI fragment
- the chart bump
- README and portfolio docs updates

### Order of work inside the branch

This is not a set of release phases: nothing merges until everything is done.

1. **Safety net first.** Capture the baseline before touching code (see
   "Baseline capture" below) and add missing parity tests for §15.
2. **Shared `PageShell` refactor**, proven pixel-identical.
3. **Migrations `1.53.0`–`1.55.0`**, stores and permissions.
4. **Collector and leases.** The `fleet` collector replaces the poller, with
   contract tests.
5. **Catalog, capabilities, all source adapters, lineage.**
6. **Baselines, coverage, drift, usage.**
7. **RCA engine, blast radius, notebooks.**
8. **Remediation catalog, executor, approvals (UI, Slack, CLI).**
9. **Performance, capacity, cost, upgrades.**
10. **Context, watchers, schema preflight.**
11. **Agents, MCP and CLI.**
12. **UI routes and screens.**
13. **Removals, Helm, docs, changelog.**

### Gates

A new `scripts/verify-all.sh` runs the gates in order and stops at the first
failure.

| # | Gate | Command | When |
|---|---|---|---|
| 1 | Install | `bun install --frozen-lockfile` (root + server) | every commit |
| 2 | Lint & types | `bun run lint`, `bun run typecheck`, server `typecheck` | every commit |
| 3 | Frontend tests | `bunx vitest run` (full suite, not only the CI subset) | every commit |
| 4 | Server tests | `./scripts/test-isolated-server.sh` | every commit |
| 5 | Build | `bun run build` | every commit |
| 6 | Migrations | `./scripts/test-migrations.sh` (SQLite + PostgreSQL via Docker) | every commit touching migrations; before push |
| 7 | Cluster e2e (existing) | `e2e-scheduled-cluster.sh`, `e2e-oncluster-ddl.sh`, `e2e-mcp.sh`, `e2e-pat.sh`, `e2e-cli.sh` | before push |
| 8 | Observability e2e (new) | `scripts/e2e-observe.sh` (below) | before push |
| 9 | UI e2e (new) | `scripts/e2e-ui.sh`: Playwright (below) | before push |
| 10 | Helm | `helm lint`, `helm unittest`, template render with new values | before push |
| 11 | Image | Docker build and Trivy scan (CI) | PR |

**`e2e-observe.sh`** builds a testbed from the existing
`testbed/scheduled-cluster-e2e` (3 nodes plus Keeper). It adds Redpanda (Kafka
API), RabbitMQ, NATS, an S3-compatible store (S3Queue), Azurite (AzureQueue) and PostgreSQL
(MaterializedPostgreSQL and the PostgreSQL engine). It creates:

- one healthy pipeline and one injected failure per adapter
- a refreshable view
- a Distributed table with an unreachable shard
- a dictionary with a broken source
- a small-insert writer

It then asserts:

- discovery and lineage edges
- each status in the vocabulary
- `unsupported_on_version` on a second ClickHouse version
- one RCA chain per layer (`transform`, `ingestion`, `external`, `engine`)
- blast radius
- an end-to-end remediation for each layer, including approval, execution,
  verification and rollback
- DDL preflight blocking a breaking change
- workload replay against a canary running a different version

**`e2e-ui.sh`** runs Playwright against the built app, seeded by the observe
testbed:

- every route
- light and dark themes
- each default role, checking permission gating
- all three dock modes
- phone, tablet and desktop widths
- keyboard navigation
- axe accessibility checks

**Baseline capture.** Before any code changes, Playwright screenshots every
existing page from `preview`. Pages §14 leaves unchanged (Login, Home, Explorer,
the existing Monitoring tabs, Fleet, Admin, Preferences) must stay within a 0.1%
pixel-diff threshold. Changed pages are reviewed against the canvas.

**CI.** `ci.yml` gains `observe-e2e` and `ui-e2e` jobs, so the PR itself proves
every gate.

**Commit rules:**
- every commit passes gates 1–5
- the branch is pushed only after gates 1–10 pass locally
- no commit disables, skips or loosens an existing test

## Consequences

**Easier:**

- **One product story** across data, pipelines of any source, and the engine:
  detect, explain to the root cause, fix with approval, verify.
- Every table is observed on install.
- Agents get context and budgets.
- Fixes leave an approval and verification trail.

**Harder / accepted:**

- **A very large single PR.** It is mitigated by the gates, the parity tests
  written first, and pixel baselines.
- **Forward-only migrations,** as in every release. Downgrading to an earlier
  version after upgrading is unsupported, the same as for any 3.x release that
  adds migrations.
- **Full coverage needs more grants.** Existing connections keep working, but
  collectors show `missing_privileges` until the extra system-table grants are
  added. Remediation and codec trials need a second credential.
- **One deprecated config key** (`FLEET_POLLER_ENABLED` / `poller_enabled`)
  remains accepted and ignored until a future major release.
- **The RBAC database grows** (bounded). PostgreSQL is recommended for more
  than 10 connections.
- **Ongoing maintenance:** the upgrade rules pack and adapter capability
  manifests need updating per ClickHouse release.
- **The Doctor and fix drafts can now change clusters.** Safety rests on the
  closed catalog, re-checked preconditions, a separate credential, approval
  classes and verification.

## Alternatives considered

- **Phased rollout behind feature flags.** Rejected by the owner: it doubles the
  test matrix and keeps two lineage models and two shells.
- **One bespoke integration per source** (a Kafka module, an S3 module, …).
  Rejected: it would give each source its own statuses and UI, and RCA would
  need per-source logic. The adapter contract keeps one model, and adding a
  source is one file plus its e2e fixture.
- **Store observability data in ClickHouse.** Rejected: it needs write grants on
  every production cluster and couples observability to the cluster being
  observed.
- **OpenLineage as the primary source.** Rejected: ClickHouse views and engine
  tables emit no events, and it needs pipeline instrumentation. Exporting our
  graph as OpenLineage stays possible later.
- **Let the AI execute fixes directly.** Rejected: free-form model SQL is not
  reviewable or reversible.
- **A new visual shell matching the canvas pixel-for-pixel.** Rejected: it would
  regress established layouts and the three dock modes. The canvas is a content
  reference; the existing design system is the visual source of truth.

## Changes during implementation

Recorded before merge so the merged ADR matches what ships. None changes the
compatibility contract (§18) or the release type.

| Area | Planned | Shipped | Why |
|---|---|---|---|
| Collector placement (§1) | Scheduler deployment only | Every process, one lease per `(connection, collector)` | SQLite installs have no separate scheduler; leases already make collection single-writer on PostgreSQL. |
| Incidents (§2, §4) | `incident_kind` on `data_health_incidents` | Separate `obs_incidents`; RCA keyed by `(source, id)` | Pipeline and engine incidents have no promise; overloading the promise table would break its constraints. |
| Retention (§1) | 1-minute samples 48h, hourly rollups 90 days | Pipeline samples 48h, no rollups | Statuses and charts only read the last 48h; rollups had no reader. |
| Remediation catalog (§8) | `retry_failed_files` | Dropped | ClickHouse has no statement to retry individual failed S3Queue/AzureQueue files; `restart_engine_table` covers re-reading. |
| Maintenance window (§8) | Unspecified format | `HH:MM-HH:MM` in UTC (`REMEDIATION_MAINTENANCE_WINDOW`) | Validated by the server and the Helm chart. |
| Permissions (§13) | — | `notebooks:edit` added | Writing notebook cells needed its own gate (read follows the attached incident/report). |
| Scheduled-query lineage (§3, §17) | `LineageTab.tsx` removed | Kept on the compatible endpoint, plus a link to the global graph | `observe:view` is not granted to every `scheduled_queries:view` role; removing it would regress those users. |
| Header layout (§14) | Pills share the title row | Same, and the pill row scrolls on one line from `lg` up | Ten Monitoring tabs no longer fit; wrapping pushed every page down. |
| Testbed (§Gates) | MinIO for S3Queue | S3Mock | MinIO no longer publishes public images. |
| Pipeline status (§4) | — | Queue views count progress only from runs that wrote rows; failed batches and permanently failed queue files stay visible | Found by the multi-source e2e: RabbitMQ/NATS views log empty polls as successes, and failures appear only once in the logs. |
| RCA (§6) | — | Unknown errors no longer default to the engine layer; driver errors are external; a pipeline's engine error joins only its own chain | Found by the multi-source e2e: unrelated incidents were attributed to one view's failure. |

