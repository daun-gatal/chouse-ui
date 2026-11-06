# AI Capabilities

## Overview
The capability registry: the single source of truth for AI features. Each capability is a code contract (permission, input schema, evidence gathering, output schema) run by the engine against the agent bound to it in the registry.

## Interface
- `[index.ts:CAPABILITIES]`, `[index.ts:getCapability]`, `[index.ts:CAPABILITY_IDS]` - lookup used by the unified `/ai/invoke` route.
- `[chat.ts:chatCapability]` - the only invoked (conversational) feature.
- SQL editor: `[optimizeQuery.ts:optimizeQueryCapability]`, `[debugQuery.ts:debugQueryCapability]`, `[checkOptimize.ts:checkOptimizeCapability]`, `[optimizeLog.ts:optimizeLogCapability]`, shared schemas in `[optimizerShared.ts:QueryOptimizationOutputSchema]`.
- Fleet: `[diagnose.ts:diagnoseErrorCapability]`, `[diagnose.ts:diagnosePartsCapability]`, `[diagnose.ts:diagnoseSchemaCapability]`, `[fleetScan.ts:fleetScanCapability]`, helpers `[fleetShared.ts:queryNodeTool]`, `[fleetShared.ts:resolveNode]`, `[fleetShared.ts:fetchQueryById]`, `[fleetShared.ts:recentHeavyQueries]`, `[fleetShared.ts:explainEstimate]`.
- DataOps: `[dataOps.ts:summarizeScheduledQueryCapability]`, `[dataOps.ts:summarizeDataHealthCapability]`, `[dataOps.ts:diagnoseScheduledRunCapability]`, `[dataOps.ts:diagnoseHealthIncidentCapability]`, `[dataOps.ts:draftScheduledQueryCapability]`, `[dataOps.ts:assessScheduledQueryCapability]`, `[dataOps.ts:planScheduledRecoveryCapability]`, `[dataOps.ts:recommendHealthPromiseCapability]`, `[dataOps.ts:tuneHealthPromiseCapability]`, `[dataOps.ts:correlateHealthIncidentsCapability]`.
- Observe: `[observe.ts:explainIncidentCapability]`, `[observe.ts:compileWatcherCapability]`, `[observe.ts:draftTableContextCapability]`.
- Drafting: `[dashboards.ts:draftDashboardCapability]`, `[dashboards.ts:explainSpikeCapability]`, `[guardrails.ts:draftGuardrailCapability]`, `[authoring.ts:draftAiAgentCapability]`, `[authoring.ts:draftAiHarnessCapability]`, `[authoring.ts:draftAiSkillCapability]`.
- Other: `[triage.ts:triageIncidentCapability]`, `[memories.ts:suggestMemoriesCapability]`, `[upgrades.ts:matchUpgradeNotesCapability]`.

## Invariants
- Adding a feature means adding one entry to `[index.ts:CAPABILITIES]`; the route enforces its permission and validates input.
- Drafting capabilities never save: users accept drafts through the normal routes, which re-check them (`[dashboards.ts:draftDashboardCapability]`, `[guardrails.ts:draftGuardrailCapability]`, `[memories.ts:suggestMemoriesCapability]` headers).
- `[checkOptimize.ts:checkOptimizeCapability]` degrades gracefully and never throws.
- Fleet capabilities read a node's `system.*` tables read-only via `query_node` (`[fleetShared.ts:queryNodeTool]`).
- `[observe.ts:explainIncidentCapability]` narrates the stored deterministic RCA; the model never picks the root cause.
- `[upgrades.ts:matchUpgradeNotesCapability]`: every finding must cite a note.

## Side Effects
- Model calls via the engine; read-only ClickHouse queries via `[fleetShared.ts:queryNodeTool]`, `[fleetShared.ts:fetchQueryById]`, `[fleetShared.ts:recentHeavyQueries]` and `[fleetShared.ts:explainEstimate]` (`EXPLAIN ESTIMATE`).
- `[upgrades.ts:matchUpgradeNotesCapability]` writes `upgrade_findings` / `upgrade_assessments`.

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
