# observe

## Overview

Frontend for the Data Observability Platform (ADR 0016) and the Monitoring > Upgrades page (ADR 0029): Data page tabs (Overview, Incidents, Lineage, Pipelines, Datasets, Coverage, Context, plus the Scheduled queries tab owned by `features/scheduled-queries`), Monitoring Capacity/Performance/Upgrades views, remediation fixes, investigation notebooks, the collector schedule, and shared TanStack hooks, helpers and UI pieces. Observe, remediation, context and per-connection upgrade reads are scoped to the active connection; agent/MCP hooks, `useFleetUpgrades`, `useAssessment` and `useMyConnections` are not.

## Interface

- `[hooks.ts:observeKeys]` / `[hooks.ts:upgradeKeys]` - query-key factories for observe (status, overview, datasets, lineage, pipelines, incidents, performance, capacity, schedule) and upgrades (status, references, fleet, list, assessment)
- `[hooks.ts:useOverview]`, `useDatasets`, `useDataset`, `useLineage`, `usePipelines`, `useIncidents`, `useIncident`, `usePerformance`, `useCapacity`, `useCoverage`, `useCollectorStatus`, `usePipelineSamples`, `useFingerprintSeries` - observe read hooks over `@/api/observe`, the connection-scoped ones enabled only with an active connection
- `[hooks.ts:usePinCriticality]`, `useDismissSuggestion`, `useRecomputeRca`, `useAcknowledgeObserveIncident`, `useStartCodecTrial`, `useSetCostRates` - observe mutations
- `[hooks.ts:useRemediationCatalog]`, `useRemediationActions`, `useProposeAction`, `useDecideAction`, `useRunAction`, `useRollbackAction`, `useRemediationCredential`, `useSaveRemediationCredential` - remediation hooks over `@/api/remediation`
- `[hooks.ts:useAttachedNotebook]`, `useNotebookMutations` - notebook hooks; `useContextTables`, `useTableContext`, `useMetrics`, `useContextMutations` - context hooks
- `[hooks.ts:useUpgradeStatus]`, `useUpgradeReferences`, `useFleetUpgrades`, `useUpgrades`, `useAssessment`, `useUpgradeMutations` - upgrade hooks
- `[hooks.ts:useAgentSummary]`, `useAgentSessions`, `useAgentSession`, `useAgentPolicies`, `useAgentPolicyScopes`, `useAgentMutations`, `useMcpOverview`, `useMcpOAuth`, `useSetMcpOAuthClientStatus`, `useRevokeMcpOAuthGrant`, `useUpdateMcpSettings` - agent and MCP hooks
- `[hooks.ts:useCollectorSchedule]`, `useSaveCollectorSchedule`, `useConnectionName`, `useMyConnections` - schedule and connection hooks
- `[lib.ts:formatBytes]`, `formatCount`, `formatDuration`, `formatAgo`, `formatPercent`, `columnDrift`, `trustTone`, `TONE_CLASS`, `PIPELINE_STATUS`, `CRITICALITY_ORDER` (plus `TONE_TEXT`, `TRUST_TONE`, `PIPELINE_KIND_LABEL`, `LAYER_LABEL`, `nodeLabel`, `nodeKind`, `humanize`, `severityTone`, `relativeChange`) - pure formatters, vocabulary tables and column-drift calculation
- `[paths.ts:dataPaths]`, `DATA_TABS`, `isDataTab`, `legacyDataOpsPath` - `/data/*` URL builders (segments URI-encoded) and legacy `/dataops` mapping
- `[schedule.ts:schedulePayload]`, `scheduleDirty`, `initialDrafts`, `intervalChoices`, `inheritedInterval`, `scheduleSummary` - collector schedule draft helpers
- `[remediationForm.ts:ACTION_META]`, `buildParams`, `valuesFromParams` - closed remediation catalog field specs and form-to-params validation; `[contextDraft.ts:applyContextDraft]` - merge an AI context draft into the curated form
- `[ui.tsx:StatusPill]`, `Kpi`, `Panel`, `EmptyState`, `ErrorState`, `LoadingGrid`, `Sparkline`, `RatioBar`, `DataTable`, `Mono`, `OBS_LABEL` - shared presentational components and label
- `[CapacityView.tsx:pivotDisks]`, `[PerformanceView.tsx:pivotSeries]`, `[LineageTab.tsx:layoutGraph]` / `statusTone`, `[PipelinesTab.tsx:pipelineSummary]`, `[CoverageTab.tsx:suggestionDraft]` - pure helpers exported from the tab/view files
- `[OverviewTab.tsx:OverviewTab]`, `[IncidentsTab.tsx:IncidentsTab]`, `[LineageTab.tsx:LineageTab]`, `[PipelinesTab.tsx:PipelinesTab]`, `[DatasetsTab.tsx:DatasetsTab]`, `[CoverageTab.tsx:CoverageTab]`, `[ContextTab.tsx:ContextTab]` - Data page tabs
- `[CapacityView.tsx:CapacityView]`, `[PerformanceView.tsx:PerformanceView]`, `[UpgradesView.tsx:UpgradesView]` - Monitoring views taking a `refreshKey` prop
- `[RemediationPanel.tsx:ProposeActionDialog]` / `ActionList` / `ProposeDraft` - remediation proposal dialog and action list, also used outside the panel; `[UpgradeFinding.tsx:copyText]` - clipboard helper
- `[RemediationPanel.tsx:RemediationPanel]`, `[NotebookPanel.tsx:NotebookPanel]`, `[DoctorInvestigation.tsx:DoctorInvestigation]`, `[CollectorSchedule.tsx:CollectorSchedule]`, `[CollectorStatusChip.tsx:CollectorStatusChip]`, `[ConnectionObservability.tsx:ConnectionObservability]`, `[IncidentHeading.tsx:IncidentHeading]`, `[UpgradeFinding.tsx:UpgradeFinding]` - fixes, notebooks, schedule, connection-dialog section and finding widgets (no `index.ts` barrel)

## Invariants

- RBAC gating via `useRbacStore`: `ConnectionObservability` renders nothing without CONNECTIONS_VIEW and edits need CONNECTIONS_EDIT `[ConnectionObservability.tsx:ConnectionObservability]`; class-2 approvals need REMEDIATION_APPROVE_HIGH, Run/Roll back are approver-only and Run is hidden for windowOnly actions `[RemediationPanel.tsx:ActionCard]` (two-approver and proposer-cannot-approve rules are server-side)
- Acknowledging incidents needs OBSERVE_EDIT (source `observe`) or DATA_HEALTH_EDIT (`data_health`), Explain needs AI_OPTIMIZE `[IncidentsTab.tsx:IncidentDetailView]`; notebook query cells need NOTEBOOKS_EDIT + QUERY_EXECUTE and only `authorKind: 'user'` cells are deletable `[NotebookPanel.tsx:NotebookPanel]`; codec trials need UPGRADES_RUN and cost-rate editing needs COST_VIEW + SETTINGS_UPDATE `[CapacityView.tsx:CapacityView]`; regression Explain needs QUERY_HISTORY_VIEW_ALL `[PerformanceView.tsx:RegressionDetail]`
- Context edits need CONTEXT_EDIT and AI drafting CONTEXT_EDIT + AI_OPTIMIZE `[ContextTab.tsx:CuratedEditor]`; compiling watchers needs DATA_HEALTH_EDIT + AI_OPTIMIZE `[ContextTab.tsx:Watchers]`; coverage accept needs DATA_HEALTH_EDIT and dismiss OBSERVE_EDIT `[CoverageTab.tsx:CoverageTab]`; Datasets tab shows tables with OBSERVE_VIEW and promises with DATA_HEALTH_VIEW `[DatasetsTab.tsx:DatasetsTab]`, pinning criticality needs OBSERVE_EDIT `[DatasetsTab.tsx:CriticalityControl]` and creating a promise DATA_HEALTH_EDIT `[DatasetsTab.tsx:canCreatePromise]`
- Remediation proposals are limited to the closed catalog: `buildParams` requires every non-optional field and parses numbers/datetimes `[remediationForm.ts:buildParams]`; AI drafts with unknown action types are dropped `[IncidentsTab.tsx:IncidentDetailView]`
- Target version must match `VERSION_RE` (URL `?target=` and typed input) `[UpgradesView.tsx:UpgradesView]`; metric names must match `/^[A-Za-z_][A-Za-z0-9_]*$/` `[ContextTab.tsx:MetricsEditor]`; incident route only accepts sources `data_health` and `observe` `[IncidentsTab.tsx:IncidentsTab]`
- AI drafts never overwrite human-written text - only empty fields are filled `[contextDraft.ts:applyContextDraft]`; AI upgrade-note matching auto-starts at most once per assessment, only after a check started on the page `[UpgradesView.tsx:ImpactPanel]`
- Schedule payload only includes collectors with an interval or pause set; global collectors cannot be changed per connection `[schedule.ts:schedulePayload]`; `useConnectionName` never shows a raw connection id `[hooks.ts:useConnectionName]`

## Side Effects

- Network via `@/api/observe`, `remediation`, `notebooks`, `context`, `upgrades`, `agents`, `rbac` wrapped in TanStack Query `[hooks.ts:*]`; direct calls: `explainIncident` `[IncidentsTab.tsx:IncidentDetailView]`, `explainFingerprint` `[PerformanceView.tsx:RegressionDetail]`, `previewAction` `[RemediationPanel.tsx:ProposeActionDialog]`, `exportNotebook` `[NotebookPanel.tsx:NotebookPanel]`, `invokeAI('match-upgrade-notes')` `[UpgradesView.tsx:ImpactPanel]`
- Polling: 30s `REFRESH_MS` refetch on overview, pipelines, incidents, remediation actions and agent summaries; `useAssessment` polls every 1s while running `[hooks.ts:useAssessment]`
- Query invalidation after mutations (`observeKeys.all`, `remediationKeys.all`, `notebookKeys.attached`, `contextKeys.all`, `upgradeKeys.all`, `agentKeys.all`; `useUpdateMcpSettings` also invalidates `queryKeys.config`) and on `refreshKey` change `[hooks.ts:*]` `[UpgradesView.tsx:UpgradesView]`
- sonner toasts on mutation success/failure, e.g. `[RemediationPanel.tsx:ProposeActionDialog]`
- URL state via `useSearchParams` (`?node=`, `?status=`, `?view=`, `?table=`, `?target=`) and `navigate(dataPaths.*)` `[LineageTab.tsx:LineageTab]` `[ContextTab.tsx:ContextTab]`
- Browser APIs: Blob download of postmortem Markdown `[NotebookPanel.tsx:NotebookPanel]`, `navigator.clipboard.writeText` `[UpgradeFinding.tsx:copyText]`, dbt manifest `File.text()` `[ContextTab.tsx:DbtImport]`, ResizeObserver `[IncidentHeading.tsx:IncidentHeading]`; active connection read from `useAuthStore` `[hooks.ts:useConnection]`

## Verification

- Run: `bunx vitest run src/features/observe` (from repo root; full suite: `bunx vitest run`)
