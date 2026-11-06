# workspace/components

## Overview

Query workspace UI: a drag-sortable tab bar rendering Home, SQL, Info and Schema-Inventory tabs, the SQL tab with results/chart/statistics/EXPLAIN, and EXPLAIN visualizers.

## Interface

- `[WorkspaceTabs.tsx:default WorkspaceTabs]` - sortable tabs and context menus
- `[SqlTab.tsx:default SqlTab]` - editor plus results/chart/statistics/explain
- `[HomeTab.tsx:default HomeTab]` - landing tab
- `[ResultChart.tsx:ResultChart]` - chart with spec editor and pin to dashboard
- `[ExplainTab.tsx:default ExplainTab]`, `[VisualExplain.tsx:default VisualExplain]`, `[ASTView.tsx:default ASTView]`, `[PipelineView.tsx:default PipelineView]`, `[SyntaxView.tsx:default SyntaxView]`, `[ExplainInfoHeader.tsx:default ExplainInfoHeader]`
- `[StatisticsDisplay.tsx:default StatisticsDisplay]`, `[EmptyQueryResult.tsx:default EmptyQueryResult]`

### Subdirectories

- infoTab: [infoTab](./infoTab/README.md) - Information tab for a database or table: overview metadata with CREATE query, plus Schema and Data Sample tabs for tables.

## Invariants

- AI Debug/Optimize need `aiOptimizer` feature and AI_OPTIMIZE; Stop needs LIVE_QUERIES_KILL; Save needs SAVED_QUERIES_CREATE/UPDATE `[SqlTab.tsx:SqlTab]`
- Result cells sanitized with DOMPurify before `dangerouslySetInnerHTML` `[SqlTab.tsx:SqlTab]`
- Truncation banner when rows >= `maxResultRows` `[SqlTab.tsx:renderResultsTab]`
- Pin to dashboard gated by `PermissionGuard(DASHBOARDS_EDIT)` `[ResultChart.tsx:ResultChart]`
- Home tab cannot be dragged or closed `[WorkspaceTabs.tsx:WorkspaceTabs]`

## Side Effects

- `runQuery`; DDL/DML refreshes databases `[SqlTab.tsx:handleRunQuery]`
- `queryApi.checkQueryOptimization` and `explainQuery` `[SqlTab.tsx:checkOptimization]` `[SqlTab.tsx:handleExplain]`
- localStorage `explain_popout_data` and `window.open('/explain-popout')` `[SqlTab.tsx:handlePopout]`
- Workspace store tab mutations; reads explorer target from URL `[WorkspaceTabs.tsx:WorkspaceTabs]`

## Verification

- No co-located tests; covered by `bun run typecheck` and the `src/features/workspace` suite: `bunx vitest run src/features/workspace`
