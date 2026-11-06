# Data Health

## Overview
Data Health promises: check definitions compiled to ClickHouse SQL, evaluation of results, incident lifecycle, failing-row diagnostics and backtests, and chat-channel incident alerts. Promises execute as scheduled-query jobs.

## Interface
- `[types.ts:dataHealthCheckDefinitionSchema]`, `[types.ts:DATA_HEALTH_CHECK_TYPES]`, `[types.ts:DATA_HEALTH_PROMISE_STATES]`, `[types.ts:DATA_HEALTH_SEVERITIES]`.
- `[compiler.ts:compileDataHealthQuery]`, `[compiler.ts:eventTimeWindowPredicate]`, `[compiler.ts:DataHealthCompileError]`.
- `[evaluator.ts:evaluateDataHealth]`, `[evaluator.ts:evaluateDistribution]`, `[evaluator.ts:robustBounds]`.
- `[execution.ts:processDataHealthSuccess]`, `[execution.ts:processDataHealthError]`, `[execution.ts:processUpstreamFailure]`, `[execution.ts:currentDataHealthJob]`.
- `[diagnostics.ts:runFailingRowsDiagnostic]`, `[diagnostics.ts:buildFailingRowsQuery]`, `[diagnostics.ts:backtestDataHealth]`.
- `[notify.ts:incidentButtons]`, `[notify.ts:refreshIncidentMessages]`, `[notify.ts:withIncidentState]`.
- `[store.ts:listPromises]`, `[store.ts:createPromiseMetadata]`, `[store.ts:replaceChecks]`, `[store.ts:insertEvaluations]`, `[store.ts:listIncidents]`, `[store.ts:transitionDataIncident]`.
- Mutators: `[store.ts:updatePromiseMetadata]`, `[store.ts:updatePromiseEvaluation]`, `[store.ts:transitionExecutionIncident]` (opens and recovers execution incidents), `[store.ts:acknowledgeIncident]`, `[store.ts:snoozeIncident]`.

## Invariants
- Diagnostics and backtests run with `readonly: "1"` and execution/row caps (`[diagnostics.ts:runFailingRowsDiagnostic]`, `[diagnostics.ts:backtestDataHealth]`).
- Chat alerts for an open incident carry Acknowledge and Snooze 1h, and every message about it is refreshed when the incident changes (`[notify.ts:refreshIncidentMessages]`).

## Side Effects
- Writes `data_health_promises`, `data_health_promise_checks`, `data_health_samples`, `data_health_incidents`, `data_health_incident_events` (`[store.ts:createPromiseMetadata]`, `[store.ts:replaceChecks]`, `[store.ts:insertEvaluations]`, `[store.ts:transitionDataIncident]`, `[store.ts:transitionExecutionIncident]`, `[store.ts:acknowledgeIncident]`, `[store.ts:snoozeIncident]`); updates promise rows (`[store.ts:updatePromiseMetadata]`, `[store.ts:updatePromiseEvaluation]`).
- Enqueues incident notifications on the scheduled-query outbox, delivered through the shared notify layer (`[execution.ts:processDataHealthSuccess]`, `scheduledStore.enqueueOutbox`).
- Read-only ClickHouse queries (`[diagnostics.ts:runFailingRowsDiagnostic]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
