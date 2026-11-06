# scheduled-queries

## Overview

Scheduled Queries (DataOps): overview and jobs tabs, job detail, create/edit wizard, runs history, lineage graph, Monaco SQL test-run editor, a `{{...}}` macro compiler and hooks over `@/api/scheduledQueries`.

## Interface

- `[index.ts]` - re-exports `ScheduledQueries`, `SUB_TABS`, `SubTab`, `JobWizard`
- `[ScheduledQueries.tsx:ScheduledQueries]` - sub-tab shell (`?job=<id>`)
- `[hooks.ts:sqKeys]`, `useClusters`, `useScheduledQueries`, `useScheduledQueriesOverview`, `useScheduledQueryRuns`, `useScheduledQueryLineage`, `useJobOwners` - reads
- `[hooks.ts:useCreateScheduledQuery]`, `useUpdateScheduledQuery`, `useDeleteScheduledQuery`, `useRunScheduledQuery`, `useRerunScheduledQueryRun`, `useDeleteRuns` - mutations
- `[JobWizard.tsx:JobWizard]` - multi-step wizard with server preview and AI draft/review
- `[JobsTab.tsx:JobsTab]`, `[JobDetail.tsx:JobDetail]`, `[RunsTab.tsx:RunsTab]`, `[LineageTab.tsx:LineageTab]`, `[OverviewTab.tsx:OverviewTab]`
- `[macros.ts:substituteMacros]`, `evalMacro`, `previewMacros`, `sampleWindow` - mirror of the server macro grammar
- `[lib.tsx:scheduledQueryToInput]`, `StatusBadge`, `scheduleLabel`; `[MonacoSqlInput.tsx:default MonacoSqlInput]`

## Invariants

- SCHEDULED_QUERIES_EDIT/RUN/DELETE/VIEW_ALL gate job actions `[JobsTab.tsx:JobsTab]` `[JobDetail.tsx:JobDetail]` `[RunsTab.tsx:RunsTab]`
- DATA_HEALTH_EDIT offers protecting a materializing job's output table with a Data Health promise (after create, and from job detail) `[JobsTab.tsx:offerProtection]` `[JobDetail.tsx:canProtect]`; lineage needs OBSERVE_VIEW and AI actions AI_OPTIMIZE `[JobDetail.tsx:JobDetail]`; "open in logs" needs LOGS_VIEW `[RunsTab.tsx:RunsTab]`
- Without SCHEDULED_QUERIES_WRITE the Output step is dropped and AI drafts forced to `outputMode: 'none'` `[JobWizard.tsx:JobWizard]`
- Wizard fails closed on server preview (read-only, data access, cluster checks) `[JobWizard.tsx:JobWizard]`
- Test-run rows capped by `maxResultRows` and `DISPLAY_CAP` 1000 `[MonacoSqlInput.tsx:MonacoSqlInput]`
- Invalid macros left verbatim `[macros.ts:substituteMacros]`

## Side Effects

- `@/api/scheduledQueries` calls; mutations invalidate `sqKeys.all` `[hooks.ts:useCreateScheduledQuery]`
- Opt-in auto-refresh (toggle, default off) invalidates `sqKeys.all` every 30s `[ScheduledQueries.tsx:ScheduledQueries]`
- Direct calls: `previewScheduledQuery` and alerting `listChannels` `[JobWizard.tsx:JobWizard]`; `recoverScheduledQuery` - recovery plan and backfill execution (`execute: true, confirm: true`) `[JobDetail.tsx:recoverScheduledQuery]`
- AI via `@/api/dataOpsAi`: `draftScheduledQuery`, `assessScheduledQuery` `[JobWizard.tsx:JobWizard]`; `assessScheduledQuery`, `planScheduledRecovery` `[JobDetail.tsx:JobDetail]`; `diagnoseScheduledRun` `[RunsTab.tsx:RunsTab]`
- Test-run via `executeQueryStream` `[MonacoSqlInput.tsx:MonacoSqlInput]`; toasts; navigation to `/monitoring/logs` `[RunsTab.tsx:RunsTab]`

## Verification

- Run: `bunx vitest run src/features/scheduled-queries` (from repo root; full suite: `bunx vitest run`)
