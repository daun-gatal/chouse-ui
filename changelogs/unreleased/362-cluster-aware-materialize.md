type: minor

### Added
- **Cluster-aware scheduled query destinations** — materialize jobs can now create and write their destination across a ClickHouse cluster. A single-shard cluster gets a `Replicated*MergeTree` table on every replica; a sharded cluster gets a per-shard local table plus a `Distributed` table routed by a deterministic sharding key. The builder lists the connection's clusters, shows the generated `ON CLUSTER` DDL, and blocks saving until every precondition passes (cluster membership, database, Keeper macros, engine, sharding key). Each run re-checks the topology and fails instead of writing partial data.

### Fixed
- **Replace-mode staging for replicated destinations** — the staging table is now a plain local `MergeTree` with the destination's keys instead of a clone that reused the destination's Keeper path and failed with `REPLICA_ALREADY_EXISTS`. Every statement of a materialize run is also pinned to one ClickHouse session, so a non-sticky load balancer can no longer split staging and the partition swap across nodes.
