# Observability Collectors

## Overview
The individual collectors run by the observability service (ADR 0016): each is a `ConnectionCollector` (per active connection) or `GlobalCollector` (once) that reads ClickHouse metadata/system tables read-only and writes evidence to the RBAC database.

## Interface
- `[fleet.ts:fleetCollector]` (global), `[fleet.ts:insertSnapshots]`, `[fleet.ts:FLEET_INTERVAL_MS]`.
- `[catalog.ts:catalogCollector]`, `[catalog.ts:buildStructuralGraph]` - tables, columns, dictionaries, structural lineage.
- `[lineage.ts:lineageCollector]`, `[lineage.ts:buildObservedGraph]` - observed lineage from `system.query_log`.
- `[pipelines.ts:pipelinesCollector]` - pipeline samples, status, incidents.
- `[tables.ts:tablesCollector]` - write cadence and volume baselines from `system.part_log`.
- `[usage.ts:usageCollector]` - readers, filter columns, criticality, known-good query patterns.
- `[queries.ts:queriesCollector]` - hourly query-shape rollups and regressions.
- `[profiles.ts:profilesCollector]` - sampled column profiles.
- `[capacity.ts:capacityCollector]`, `[capacity.ts:CAPACITY_THRESHOLD]` - disk samples and forecasts.
- `[changes.ts:changesCollector]` - DDL, version, settings-profile and client-version change timeline.

## Invariants
- Baselines come from metadata only, never table scans (`[tables.ts:tablesCollector]`).
- Pipeline incidents open only when the pipeline is upstream of important data (`[pipelines.ts:pipelinesCollector]`).
- Query rollups are bounded to the top `OBSERVE_MAX_FINGERPRINTS` shapes (`[queries.ts:queriesCollector]`).
- Lineage is incremental by watermark and aggregated in ClickHouse (`[lineage.ts:lineageCollector]`).
- Fleet output contract is unchanged from the former FleetPoller: one `fleet_snapshots` row per (connection, metric, tick), pruned after `FLEET_RETENTION_HOURS`, with alert rules evaluated every tick (`[fleet.ts:fleetCollector]`).

## Side Effects
- Writes `fleet_snapshots`; `obs_catalog_tables`, `obs_catalog_columns`, `obs_lineage_nodes`, `obs_lineage_edges`; `obs_pipelines`, `obs_pipeline_samples`; `obs_table_baselines`, `obs_table_samples`, `obs_table_write_times`; `obs_usage_rollups`, `obs_query_shape_days`, `ctx_patterns`; `obs_query_fingerprints`, `obs_fingerprint_rollups`, `obs_regressions`; `obs_column_profiles`; `obs_capacity_samples`, `obs_capacity_forecasts`; `obs_change_events`, `obs_settings` (`[changes.ts:putSetting]`).
- The fleet collector deletes `fleet_snapshots` rows older than the retention window (`[fleet.ts:pruneSnapshots]`) and runs `fleetAlerter.processTick` on every tick (`[fleet.ts:processTick]`).
- Opens/recovers incidents via `../incidents.ts` (`[pipelines.ts:pipelinesCollector]`, `[capacity.ts:capacityCollector]`).
- Env: `OBSERVE_FLEET_INTERVAL` (falls back to `FLEET_POLL_INTERVAL_SECONDS`, default 30), `FLEET_PRUNE_INTERVAL_MINUTES` (default 5), `FLEET_RETENTION_HOURS` (default 24), `FLEET_METRIC_TIMEOUT_SECONDS` (default 15) (`[fleet.ts:FLEET_INTERVAL_MS]`); `OBSERVE_CAPACITY_THRESHOLD`, `OBSERVE_RETENTION_DAYS`, `OBSERVE_INCIDENT_HOLD_SECONDS`, `OBSERVE_MAX_FINGERPRINTS`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
