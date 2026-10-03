# 0015 — Cluster-Aware Materialize Destinations for Scheduled Queries

- **Status:** Accepted
- **Date:** 2026-10-03
- **Amends:** [0002](0002-scheduled-queries.md) D4b (create-if-missing, staging) — every other decision in 0002 stands.
- **Builds on:** [0002](0002-scheduled-queries.md) (materialize writer, D3a idempotency), [0007](0007-clear-and-rerun-for-scheduled-jobs-and-data-health.md) (clear & rerun relies on slot-scoped idempotency)

## Context

A materialize job (`outputMode` = `append` | `replace` | `upsert`) writes its read-only
SELECT into `destDatabase.destTable`. With `createIfMissing`, the runner issues
`CREATE TABLE IF NOT EXISTS` (`buildCreateTableDDL`, `materialize.ts`) before every
write. ADR 0002 D4b says to "use `ON CLUSTER` when the connection is configured for it",
but this was never built. Today's behaviour on a multi-node ClickHouse:

1. **The table exists on one node only.** The DDL has no `ON CLUSTER`, so only the node
   behind the connection gets it. Other replicas and shards don't have the table, and
   Data Health promises or queries routed to those nodes fail or see nothing.
2. **Adding `ON CLUSTER` alone would be wrong.** The runner writes through one
   connection. A plain `MergeTree` created `ON CLUSTER` exists everywhere but only the
   connected node receives rows — silently partial data. Cluster creation is only
   correct as:
   - **replicated** — one shard, N replicas, `Replicated*MergeTree`; or
   - **sharded** — a per-shard local table plus a `Distributed` table that routes rows.
3. **Per-run DDL becomes expensive.** `CREATE … IF NOT EXISTS` runs on every execution.
   Locally that is free; `ON CLUSTER` would enqueue a distributed-DDL task in Keeper for
   every host on every run.
4. **Replace-mode staging clones the destination engine.** `CREATE TABLE <staging> AS
   <dest>` copies a `Replicated*` engine including an explicit Keeper path, so staging
   collides with the destination's replica path. This bug already exists for non-cluster
   jobs that write into an existing replicated table.
5. **Staging statements may hit different nodes.** Replace runs `CREATE` → `TRUNCATE`
   → `INSERT` → `REPLACE PARTITION` as separate HTTP requests. Behind a load balancer they
   can land on different replicas, and local staging is then missing or empty.
6. **`REPLACE PARTITION` is shard-local.** No atomic cross-shard partition swap exists.
7. **`Distributed` destinations are rejected.** `checkEngineFit` requires a MergeTree
   family engine, so append/upsert into an existing `Distributed` table fails today.

The connection model has no cluster concept (`clientForConnection` → one host:port);
the Explorer's Create Table dialog already offers `ON CLUSTER` via `system.clusters`.

## Decision

Ship cluster-aware destinations as **one feature in one release** — replicated and
sharded topologies together. **No fallback:** if a precondition is not met, the save or
the run fails with an explicit error. Nothing degrades silently to single-node behaviour.

### 1. Config model (`outputConfig.cluster`, JSON — no DB migration)

```ts
cluster?: {
  name: string;                         // a cluster in system.clusters
  topology: "replicated" | "sharded";   // derived at save, re-verified every run
  shardingKey?: string;                 // sharded only — required
  localTable?: string;                  // sharded only — default `<destTable>_local`
}
```

- `topology` is derived from `system.clusters` at save time: 1 shard → `replicated`,
  more than 1 → `sharded`. It is stored so that a topology change later (shards added)
  fails the run instead of silently changing write semantics.
- `outputConfig` is already a JSON column in both dialects, so there is no
  `migrations.ts` change.
- The setting applies to existing destinations as well as `createIfMissing`. An
  existing `Distributed` destination is supported for append and upsert.

### 2. Save-time validation (`routes/scheduled-queries.ts`, against the job's connection)

All of the following are hard errors (`AppError.badRequest`):

| Check | Query / rule |
|---|---|
| Cluster exists | `system.clusters WHERE cluster = {c}` non-empty |
| Connected node is a member | `… AND is_local = 1` count ≥ 1 |
| Destination database exists | `system.databases` on the connected node. Other hosts are covered by the `ON CLUSTER` DDL failing in `throw` mode (§4). |
| Database engine is not `Replicated` | `system.databases.engine`. A Replicated database replicates DDL itself and rejects `ON CLUSTER` — use it without a cluster. |
| Engine is `Replicated*MergeTree` | Always, for both topologies (the local table when sharded). Retry dedup via `insert_deduplication_token` is on by default only for replicated engines, so a plain `MergeTree` would break the D3a retry contract. |
| Keeper path is per-replica | The replica name (explicit 2nd arg, or `default_replica_name`) must contain `{replica}`; when sharded the path (explicit 1st arg, or `default_replica_path`) must contain `{shard}`. Every non-builtin macro the path/name references must be defined in `system.macros` on the connected node. |
| Existing destination fits | Replicated → `Replicated*MergeTree`. Sharded → `Distributed('<cluster>', '<db>', '<localTable>', …)` (parsed from `system.tables.engine_full`) over a `Replicated*MergeTree` local table. A missing destination without create-if-missing is rejected. |
| `replace` is not sharded | `replace` + `sharded` → reject (rule 6 in Context) |
| Sharding key is deterministic | Required when sharded. It must reference ≥ 1 output column and must not call nondeterministic functions (`rand*`, `now*`, `today`, `generateUUID*`, `random*`, `rowNumberInAllBlocks`, …) — retries must route rows to the same shard for dedup. |
| Upsert key colocation | Upsert + sharded: the sharding key's columns ⊆ the `ORDER BY` columns. ReplacingMergeTree collapses only within a shard. |
| Identifiers | Cluster, local-table and staging names are validated and backtick-quoted (`ident()`); the cluster name is never interpolated as a string literal. |

The same checks run in the **preview** endpoint ("Check destination") and are reported
there as structured results rather than thrown.

### 3. DDL generation (`materialize.ts`)

`buildCreateTableDDL` becomes `buildCreateStatements(job, columns): string[]`:

- **No cluster:** unchanged single statement.
- **Replicated:**
  `CREATE TABLE IF NOT EXISTS db.t ON CLUSTER `c` (…) ENGINE = Replicated…MergeTree[(args)] [PARTITION BY] ORDER BY …`
- **Sharded:**
  1. `CREATE TABLE IF NOT EXISTS db.t_local ON CLUSTER `c` (…) ENGINE = … [PARTITION BY] ORDER BY …`
  2. `CREATE TABLE IF NOT EXISTS db.t ON CLUSTER `c` AS db.t_local ENGINE = Distributed(`c`, db, t_local, <shardingKey>)`

### 4. Run-time behaviour (`runner.ts` / `executeMaterialize`)

- **DDL only when missing.** `describeDestination` runs first. Statements are issued
  only when the destination (or, if sharded, the local table) is absent, so a healthy job
  enqueues zero distributed-DDL tasks. Concurrent pods stay safe through `IF NOT EXISTS`.
- **Cluster DDL settings:** `distributed_ddl_output_mode = 'throw'` and
  `distributed_ddl_task_timeout = 180`. A failure on any host fails the run.
- **Post-DDL verification:** the destination (and local table) are re-described on the
  connected node and must match the topology. Cross-host success is the DDL's own
  `throw`-mode result — no `clusterAllReplicas` probe, which would add a dependency on
  inter-server credentials for a check the DDL already performs.
- **Topology re-check every run:** the stored `topology` must still match the shard
  count, the connected node must still be `is_local`, and an existing destination's
  engine must match (`Distributed` pointing at `localTable` on `cluster` — parsed from
  `system.tables.engine_full` — when sharded; `Replicated*` when replicated with more
  than 1 replica).
- **Engine fit for `Distributed`:** `checkEngineFit` resolves a `Distributed`
  destination to its local table and applies the existing mode rules to that engine.
- **Sharded writes:** `INSERT INTO db.t (…) SELECT …` with
  `distributed_foreground_insert = 1` (synchronous, so errors and `written_rows` cover
  every shard) plus the existing slot-scoped `insert_deduplication_token`.
- **Run session pinning:** every statement in a materialize run shares one
  `session_id`, and statements after the first send `session_check = 1`. If a
  non-sticky load balancer moves a statement to another node, ClickHouse rejects the
  unknown session and the run fails. It never writes staging on one replica and swaps
  on another.

### 5. Replace-mode staging (fixes Context item 4 for every job, not just cluster jobs)

Staging is always a **local, non-replicated `MergeTree`**, never `ON CLUSTER`:

```sql
CREATE TABLE IF NOT EXISTS db.<staging> AS db.<dest>
ENGINE = MergeTree PARTITION BY <dest.partition_key> ORDER BY <dest.sorting_key>
[PRIMARY KEY <dest.primary_key>]
```

Keys come from `system.tables`, so staging stays structurally identical for
`REPLACE PARTITION`, which then copies parts from the local table into the replicated
destination, and the destination replicates them (verified on ClickHouse 26.5). A
non-replicated destination keeps the existing `AS dest` clone. No legacy replicated
staging table can exist: the old `AS dest` clone of a replicated destination always
failed with `REPLICA_ALREADY_EXISTS` (also verified), so there is nothing to migrate.

### 6. API and UI

- **New** `GET /scheduled-queries/clusters?connectionId=` (`scheduled_queries:edit` + `:write`,
  `assertConnectionAccess`) → `[{ name, shards, maxReplicasPerShard, hosts, isLocal }]`.
- **Preview** response: `createDDL: string` → `createStatements: string[]`, plus
  `cluster: { topology, shards, hosts, checks: [{ id, ok, message }] }`.
- **JobWizard → Output step:**
  - Add a "Create on cluster" toggle and a cluster select with "N shards × M replicas"
    labels, from the new endpoint for the job's connection. Clusters where
    `isLocal = false` are listed but disabled, with the reason.
  - Show the derived topology as a badge.
  - Sharded: add a required **Sharding key** input and a **Local table** input
    (prefilled `<table>_local`).
  - Turning the cluster option on changes a default `MergeTree` engine to
    `ReplicatedMergeTree`.
  - `Replace partition` is disabled for sharded clusters, with the reason in its
    help popover.
  - The DDL preview renders every statement, and the checks list shows pass/fail per
    precondition.
- `src/api/scheduledQueries.ts` `OutputConfig` gains `cluster`. The form state gains
  `clusterEnabled`, `clusterName`, `shardingKey` and `localTable`. `buildInput` and
  `formFromJob` round-trip them. Leaving the Output step requires every cluster check
  in the preview to pass.

### 7. Operator requirements (documented in the wizard hint and `docs/`)

- Keeper/ZooKeeper must be configured, and `{shard}`/`{replica}` macros defined when
  using `Replicated*` with default paths.
- The connection's ClickHouse user needs the `CLUSTER` grant plus `CREATE TABLE` /
  `INSERT` / `ALTER` on the destination database on every host. A missing grant fails
  the DDL through `distributed_ddl_output_mode = 'throw'`.
- The connection must point at a cluster member: a direct node, or a load balancer
  with sticky sessions (enforced by session pinning in §4).

## Testing

- **Unit (`materialize.test.ts`, new):** statement generation for none, replicated and
  sharded topologies; identifier quoting; staging DDL from system keys; `engine_full`
  parsing for `Distributed`; sharding-key determinism and colocation validators;
  `checkEngineFit` through a `Distributed` destination.
- **Route tests (`scheduled-queries` route, Bun Test with a mocked client):** every
  §2 rejection; the preview shape; the clusters endpoint permission and connection access.
- **Runner tests:** no DDL when the destination exists; failure when the topology
  changed; settings passed (`distributed_foreground_insert`, `session_check`).
- **Frontend (Vitest):** wizard round-trip of cluster fields; replace is disabled when
  sharded; `api/scheduledQueries` contract.
- **Docker e2e (`scripts/e2e-scheduled-cluster.sh`,
  `cluster.e2e.test.ts`)** on an isolated stack: 3 ClickHouse nodes + Keeper on their
  own Docker network (`sqe2e-*`, no published ports, safe next to the existing
  testbed), configured from `testbed/scheduled-cluster-e2e/` with `{shard}`/`{replica}`
  macros, inter-server credentials (Distributed needs them), `fleet_cluster`
  (3 shards × 1 replica) and `fleet_replicated` (1 shard × 3 replicas). The test is
  bundled with `bun build` and run in a Bun container on that network. The following are
  **merge-gating**, because idempotency is the contract (0002 D3a, 0007):
  1. Replicated append/upsert/replace: rows are visible on all 3 replicas, and a retry
     of the same slot is a no-op.
  2. Replicated replace: the swap from local `MergeTree` staging into
     `ReplicatedMergeTree` succeeds and replicates.
  3. Sharded append/upsert: rows land on the expected shards, and a retry through
     `Distributed` with `distributed_foreground_insert = 1` and the slot token does not
     duplicate on any shard.
  4. Second run on an existing table issues no `ON CLUSTER` DDL (checked via
     `system.distributed_ddl_queue`).
  5. Session pinning: a statement with `session_check = 1` against another node fails.

## Consequences

- **Easier:** materialize jobs work on real clusters end to end, with data visible on
  every replica or shard. Existing `Distributed` destinations work for append and upsert.
  The staging/Keeper-path collision is fixed for all jobs.
- **Harder / accepted:**
  - Replace is unavailable on sharded clusters.
  - Jobs on a cluster fail on topology drift until an operator re-saves them. This is
    deliberate fail-closed behaviour.
  - A non-sticky load balancer in front of a cluster now fails replace runs explicitly,
    where before they were silently incorrect.
  - The preview, save and every cluster run do a handful of extra `system.*` reads on
    the connected node (clusters, databases, macros, server settings, tables).
  - The ClickHouse nodes need inter-server credentials (or a cluster `secret`) for
    `Distributed` writes. That is standard for sharded clusters, but it is a new
    dependency for this feature.
- No RBAC schema change, no DB migration, and no Helm chart change.

## Alternatives considered

- **Add `ON CLUSTER` to the existing DDL only.** Rejected: silently partial data
  (Context item 2) and a per-run DDL queue load.
- **Ship replicated first, sharded later.** Rejected: the owner asked for one release,
  and the sharded design shares all the plumbing (validation, DDL-only-when-missing,
  session pinning).
- **Auto-skip `ON CLUSTER` for Replicated databases / ClickHouse Cloud (fallback).**
  Rejected per the no-fallback requirement: such databases are rejected with a clear
  message to run without a cluster, which already replicates there.
- **Replicated staging table `ON CLUSTER`.** Rejected: it adds a Keeper path per job
  and depends on replication lag before `REPLACE PARTITION`. Local staging plus
  session pinning is simpler and deterministic.
- **Cross-shard replace through per-shard swaps.** Rejected: not atomic across shards,
  so it would break the "destination reflects exactly the latest run" contract.
- **A cluster field on the connection itself.** Deferred: a per-job setting matches
  the Explorer's Create Table UX and needs no RBAC migration. A connection-level default
  can build on this later.
