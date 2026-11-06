# data-health

## Overview

Data Health UI scoped to the active connection: KPI overview and coverage gaps, dataset promises with detail view, incidents, and a 3-step `PromiseWizard`; hooks wrap `@/api/dataHealth`, AI features use `@/api/dataOpsAi`.

## Interface

- `[index.ts]` - re-exports `PromiseWizard`, `PromiseWizardDraft`, `DatasetsTab` as `PromisesTab`, `OverviewTab` as `PromiseHealthOverview`
- `[PromiseWizard.tsx:PromiseWizard]` - Dataset > Health promise > Review dialog
- `[draft.ts:PromiseWizardDraft]` / `draftToFormPatch` - prefill shape and mapping
- `[DatasetsTab.tsx:DatasetsTab]`, `[OverviewTab.tsx:OverviewTab]`, `[IncidentsTab.tsx:IncidentsTab]`, `[PromiseDetail.tsx:PromiseDetail]` - views
- `[hooks.ts:dhKeys]`, `useDataHealthOverview`, `useDataHealthPromises`, `useDataHealthPromise`, `useDataHealthTimeline`, `useDataHealthIncidents`, `useCreateDataHealthPromise`, `useUpdateDataHealthPromise`, `useDeleteDataHealthPromise`, `useRunDataHealthPromise`, `useAcknowledgeIncident`, `useSnoozeIncident`
- `[RuleEditors.tsx:RuleEditors]` - multi-rule check editors
- `[lib.tsx:HealthBadge]`, `formatSchedule`, `formatHealthTime`, `formatMetric`, `stateTone`, `detectEventTimeColumn`, `eventTimeSupport`, `suggestEventTimeEncoding`, column-type predicates, `DH_PRIMARY` / `DH_LABEL` class strings

## Invariants

- DATA_HEALTH_EDIT gates edit actions (datasets, overview, detail, incidents); DATA_HEALTH_RUN gates runs (datasets, detail); DATA_HEALTH_DELETE gates delete in the datasets list only; AI_OPTIMIZE gates AI actions in the detail view `[DatasetsTab.tsx:DatasetsTab]` `[OverviewTab.tsx:OverviewTab]` `[PromiseDetail.tsx:PromiseDetail]` `[IncidentsTab.tsx:IncidentsTab]`
- Rule validation blocks Continue (percentages 0-100, uniqueness 1-10 columns, distribution limits, windowed checks need event time and timezone) `[PromiseWizard.tsx:canContinue]`
- Date-only event time forces freshness >= 1440 min and no cron/manual `[PromiseWizard.tsx:canContinue]`
- Unique rule check keys avoiding reserved keys `[PromiseWizard.tsx:createRuleKey]`
- Rerun execute only for 0 < runnable <= 30 after a preview `[PromiseDetail.tsx:executeRerun]`
- Queries keyed by `activeConnectionId` `[hooks.ts:useDataHealthOverview]`

## Side Effects

- Mutations invalidate `['data-health']` `[hooks.ts:useInvalidateDataHealth]`
- Wizard fetches databases, channels, scheduled queries, table details, previews and recommendations; a custom query source is described via `describeDataHealthColumns` after a 600ms debounce `[PromiseWizard.tsx:PromiseWizard]`
- AI diagnose/tune/correlate and backtest/recover/rerun calls `[PromiseDetail.tsx:PromiseDetail]`
- Snooze sets until = now + 1h `[IncidentsTab.tsx:handleSnooze]`; toasts; new promises submitted with `runNow: true` `[PromiseWizard.tsx:buildInput]`

## Verification

- Run: `bunx vitest run src/features/data-health` (from repo root; full suite: `bunx vitest run`)
