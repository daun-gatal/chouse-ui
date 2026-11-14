# Server Services

## Overview
Business logic for the CHouse UI API server (`packages/server`). Route handlers in `packages/server/src/routes/` call into these modules. The top level holds the ClickHouse service and client pool, per-request connection resolution, connection privilege checks, shared AI config and tools, fleet metrics/alerting, Doctor scheduling, chat history and query analysis; feature subsystems live in subdirectories.

## Interface
- ClickHouse: `[clickhouse.ts:ClickHouseService]` (queries, metadata, metrics, explain, `insertStream`, `getDdlImpact`), `[clientManager.ts:ClientManager]` (singleton pooled clients).
- Connections: `[connectionResolver.ts:resolveRequestedConnection]`, `[connectionResolver.ts:resolveDefaultConnection]`, `[connectionResolver.ts:getConnectionFacts]`, `[connectionResolver.ts:dropUserConnectionFacts]`; `[connectionPrivileges.ts:checkConnectionPrivileges]`, `[connectionPrivileges.ts:PRIVILEGE_FEATURES]`, `[connectionPrivileges.ts:privilegeReportMessage]`.
- AI shared: `[aiConfig.ts:getConfiguration]`, `[aiConfig.ts:validateConfiguration]`, `[aiConfig.ts:initializeDeepAgentModel]`, `[aiConfig.ts:isAIEnabled]`; `[agentTools.ts:createCoreTools]`, `[agentTools.ts:createChartTool]`, `[agentTools.ts:sanitizeLikePattern]`; `[chatHistory.ts:createThread]`, `[chatHistory.ts:addMessage]`, `[chatHistory.ts:listThreads]`, `[chatHistory.ts:cleanupOldThreads]`.
- Fleet: `[fleetMetrics.ts:FLEET_METRICS]`, `[fleetMetrics.ts:runFleetMetric]`, `[fleetMetrics.ts:buildFleetConfig]`; `[fleetAlerter.ts:processTick]`, `[fleetAlerter.ts:sendTestAlert]`, `[fleetAlerter.ts:deliverDoctorReport]`; `[fleetAlertConfig.ts:loadRawAlertConfig]`, `[fleetAlertConfig.ts:saveRawAlertConfig]`; `[fleetAlertLatchStore.ts:loadLatches]`, `[fleetAlertLatchStore.ts:persistLatches]`, `[fleetAlertLatchStore.ts:getLastAutoRcaAt]`, `[fleetAlertLatchStore.ts:setLastAutoRcaAt]`.
- Doctor: `[doctorScheduler.ts:DoctorScheduler]`, `[doctorScheduler.ts:claimScheduledSlot]`, `[doctorScheduler.ts:saveSchedule]`; `[doctorReports.ts:saveDoctorReport]`, `[doctorReports.ts:listDoctorReports]`, `[doctorReports.ts:pruneDoctorReports]`.
- Query tools: `[queryAnalyzer.ts:analyzeQuery]`, `[ddlSimulator.ts:parseMutationStatement]`, `[inference.ts:InferenceService]`, `[queryObserver.ts:observeQueries]`, `[queryObserver.ts:reportQuery]`.
- Subpackages:
  - [agents](./agents/README.md) - agent (PAT/MCP) query governance.
  - [ai](./ai/README.md) - AI engine, registry, capabilities, actions, guardrails, usage.
  - [alerting](./alerting/README.md) - channels, rules, events and the shared notify layer.
  - [chobi](./chobi/README.md) - Chobi briefing, Need You alerts, settings.
  - [context](./context/README.md) - table context engine and watchers.
  - [dashboards](./dashboards/README.md) - custom dashboards, alerts, reports, snapshots.
  - [dataHealth](./dataHealth/README.md) - Data Health promises and incidents.
  - [notebooks](./notebooks/README.md) - investigation notebooks.
  - [observe](./observe/README.md) - observability collectors, lineage, incidents, RCA.
  - [queryHistory](./queryHistory/README.md) - per-user query history.
  - [remediation](./remediation/README.md) - remediation action catalog and lifecycle.
  - [scheduledQueries](./scheduledQueries/README.md) - scheduled queries and materialize.
  - [schemaPreflight](./schemaPreflight/README.md) - DDL impact preflight.
  - [upgrades](./upgrades/README.md) - ClickHouse upgrade check.

## Invariants
- Connection choice is authorised per request against the RBAC DB; nothing depends on which replica serves it (`[connectionResolver.ts:resolveRequestedConnection]`). Pooling happens in `[clientManager.ts:ClientManager]`, keyed by connection config with 10-minute idle eviction.
- Saving a connection requires every *required* feature of the privilege check to pass (`ok`); an optional feature (`required: false`, ClickHouse access admin) only warns and is reported apart (`complete`, `optionalMissingCount`, `optionalGrantScript`). `otherDatabases` (information only, never blocks) lists access to the other visible databases from the grants already loaded; failing to list them leaves it empty. Missing privileges are reported as copyable GRANT statements (`[connectionPrivileges.ts:checkConnectionPrivileges]`, ADR 0031).
- Fleet alerts fire only on the healthy -> breach edge; the latch map is persisted so this holds across replicas and restarts (`[fleetAlerter.ts:processTick]`, `[fleetAlertLatchStore.ts:persistLatches]`).
- Doctor scheduling is multi-instance safe: one atomic conditional UPDATE on `last_run_at` claims each slot (`[doctorScheduler.ts:claimScheduledSlot]`).
- Doctor reports keep the newest `[doctorReports.ts:DOCTOR_REPORT_RETENTION]` (100) and prune the rest after each save.
- Agent tools are read-only and pass through data-access validation (`[agentTools.ts:createCoreTools]`, `validateQueryAccess`). The tools that list running and slow queries limit a non-admin to the queries recorded for their own CHouse account, not to the connection's ClickHouse user, which everyone shares.
- Chat threads are listed for the last 7 days by default (`[chatHistory.ts:listThreads]`).

## Side Effects
- ClickHouse queries/commands through pooled clients; `ClientManager` runs an unref'd cleanup `setInterval`.
- RBAC DB writes: `rbac_ai_chat_threads`/`rbac_ai_chat_messages` (`[chatHistory.ts:addMessage]`), `doctor_reports` (`[doctorReports.ts:saveDoctorReport]`), `doctor_schedule` (`[doctorScheduler.ts:saveSchedule]`), `fleet_alert_latches` (`[fleetAlertLatchStore.ts:persistLatches]`), `fleet_alerter_runtime` auto-RCA cooldown (`[fleetAlertLatchStore.ts:setLastAutoRcaAt]`), alert events (`recordEvent` from `alerting/store`, called in `[fleetAlerter.ts:processTick]`), legacy fleet alert config via alerting tables (`[fleetAlertConfig.ts:saveRawAlertConfig]`).
- Notification delivery via the shared notify layer (`[fleetAlerter.ts:processTick]`); auto-RCA runs the `fleetScanCapability` AI scan and saves the result as a Doctor report (`saveDoctorReport(..., "auto")`), throttled by `DOCTOR_AUTO_RCA_COOLDOWN_MINUTES` (`[fleetAlerter.ts:runAutoRca]`).
- Query observation uses AsyncLocalStorage (`[queryObserver.ts:observeQueries]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
