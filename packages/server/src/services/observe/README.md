# Data Observability Platform

## Overview
The observability platform (ADR 0016): a collector service with row leases, the evidence store helpers, source adapters and pipeline classification, baselines, lineage, incidents, deterministic RCA and blast radius, regressions, forecasts, suggestions, codec trials, collection schedule and read models for the API. Individual collectors live in [collectors](./collectors/README.md).

## Interface
- Bootstrap: `[index.ts:startObservability]`, `[index.ts:stopObservability]`, `[index.ts:ALL_COLLECTORS]`; `[collector.ts:ObserveService]`, `[collector.ts:OBSERVE_TICK_MS]`.
- Leases and DB: `[lease.ts:acquireLease]`, `[lease.ts:releaseAll]`; `[db.ts:all]`, `[db.ts:one]`, `[db.ts:run]`, `[db.ts:runBatch]`, `[db.ts:isSqlite]`.
- ClickHouse access: `[clickhouse.ts:observeClient]`, `[clickhouse.ts:selectRows]`, `[clickhouse.ts:observeLogComment]`, `[clickhouse.ts:measureRunCost]`, `[clickhouse.ts:OBSERVE_SOURCE]`.
- Capabilities: `[capabilities.ts:probeCapabilities]`, `[capabilities.ts:hasTable]`, `[systemTables.ts:OBSERVED_SYSTEM_TABLES]`.
- Adapters and status: `[adapters.ts:PIPELINE_KINDS]`, `[adapters.ts:materializedViews]`, `[adapters.ts:queueEngines]`; `[pipelineStatus.ts:classifyPipeline]`, `[pipelineStatus.ts:PIPELINE_STATUSES]`; `[catalogParse.ts:classifyObject]`, `[catalogParse.ts:parseMvTarget]`.
- Baselines and stats: `[baselines.ts:learnCadence]`, `[baselines.ts:learnVolumeBand]`, `[baselines.ts:classifyTable]`, `[baselines.ts:assignCriticality]`; `[stats.ts:theilSen]`, `[stats.ts:quantile]`; `[forecast.ts:forecastDisk]`; `[regressions.ts:detectRegressions]`, `[regressions.ts:linkChanges]`.
- Incidents and RCA: `[incidents.ts:openOrUpdateIncident]`, `[incidents.ts:recoverIncident]`, `[incidents.ts:acknowledgeObserveIncident]`, `[incidents.ts:feedsImportantData]`; `[rca.ts:computeRca]`, `[rca.ts:blastRadius]`; `[rcaService.ts:computeAndStoreRca]`, `[rcaService.ts:getStoredRca]`; `[errorClass.ts:classifyError]`.
- Lineage: `[jobLineage.ts:buildLineage]`; `[orphans.ts:pruneLineage]`; `[principals.ts:principalLabels]`, `[principals.ts:relabelPrincipalNodes]`.
- Suggestions and trials: `[suggestions.ts:computeSuggestions]`, `[suggestions.ts:dismissSuggestion]`, `[suggestions.ts:pinCriticality]`; `[codecTrials.ts:startCodecTrial]`, `[codecTrials.ts:setCostRates]`.
- Schedule: `[collectorSettings.ts:getCollectorSettings]`, `[collectorSettings.ts:saveSchedules]`, `[collectorSettings.ts:effectiveSchedule]`, `[collectorSettings.ts:COLLECTOR_INFO]`; `[scheduleView.ts:scheduleView]`.
- Read models: `[views.ts:overview]`, `[views.ts:listDatasets]`, `[views.ts:datasetDetail]`, `[views.ts:lineageGraph]`, `[views.ts:listPipelines]`, `[views.ts:listIncidents]`, `[views.ts:incidentDetail]`, `[views.ts:performance]`, `[views.ts:capacity]`, `[views.ts:collectorStatus]`.
- Subpackage: [collectors](./collectors/README.md).

## Invariants
- Every (collector, connection) run is claimed through a row lease so pods sharing the RBAC DB never double-collect (`[collector.ts:ObserveService]`); the claim is a single conditional UPSERT (`[lease.ts:acquireLease]`).
- Collector ClickHouse queries run with `readonly=1`, an execution cap and a `log_comment` of `{source:"observe"}` so CHouse's own collection is excluded from `system.query_log` analysis (`[clickhouse.ts:observeClient]`, `[clickhouse.ts:NOT_OBSERVE]`).
- A missing system table yields an explicit `unsupported_on_version`, never a silent gap (`[capabilities.ts:missingMessage]`).
- All observe modules read and write through the dialect-agnostic helpers so SQLite and PostgreSQL stay interchangeable (`[db.ts:run]`).
- Read models take the caller's table predicate so nothing about an unreadable table leaves the server (`[views.ts:listDatasets]` header).
- RCA is deterministic: ranking by layer, onset precedence and depth up to `[rca.ts:RCA_MAX_DEPTH]`.
- Codec trials are the only operator-started write besides remediation, confined to the scratch database (`[codecTrials.ts:SCRATCH_DATABASE]`).
- Principal names are resolved at read time so renames show everywhere (`[principals.ts:principalLabels]`).

## Side Effects
- Writes `obs_leases`, `obs_collector_status`, `obs_watermarks` (`[collector.ts:ObserveService]`, `[lease.ts:acquireLease]`), `obs_capabilities`, `obs_incidents`, `incident_rca`, `incident_blast_radius`, `obs_suggestion_dismissals`, `obs_table_baselines` (criticality pin, `[suggestions.ts:pinCriticality]`), `obs_codec_trials`, `obs_cost_rates`, `obs_settings`; prunes `obs_lineage_*` (`[orphans.ts:pruneLineage]`).
- `setInterval` scheduler loop; starts the remediation worker (`[index.ts:startObservability]`).
- Codec trials create and drop sample tables in `OBSERVE_SCRATCH_DATABASE` (default `chouse_scratch`) (`[codecTrials.ts:startCodecTrial]`, `[codecTrials.ts:SCRATCH_DATABASE]`).
- Env: `OBSERVE_MAX_PARALLEL` (default 4) and `OBSERVE_RUN_TIMEOUT_SECONDS` (default 120) (`[collector.ts:MAX_PARALLEL]`, `[collector.ts:RUN_TIMEOUT_MS]`); `FLEET_POLLER_ENABLED` deprecation warning (`[index.ts:warnDeprecatedConfig]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
