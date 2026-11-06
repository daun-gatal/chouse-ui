# components/monitoring

## Overview
Panels and charts used by the Monitoring pages: query and resource timelines, duration/memory histograms, part-log timeline, parts pressure, connection breakdown, server memory breakdown, top resource-consuming queries, schema inventory, MergeTree projections and skip indexes, a read-only DDL impact simulator, an AI error-diagnosis button, and shared range-picker and pagination controls. Data comes from the hooks in `src/hooks/useMonitoringTimeline.ts` and from `src/api/metrics.ts`.

## Interface
- Charts: `QueryTimelineChart` [QueryTimelineChart.tsx:QueryTimelineChart], `QueryHistogramChart` [QueryHistogramChart.tsx:QueryHistogramChart], `PartLogTimelineChart` [PartLogTimelineChart.tsx:PartLogTimelineChart]
- Panels: `PartsPressureSummary`, `PartsPressureTable` [PartsPressurePanel.tsx:PartsPressureTable], `ConnectionBreakdownPanel` (default) [ConnectionBreakdownPanel.tsx:ConnectionBreakdownPanel], `ServerMemoryBreakdown` [ServerMemoryBreakdown.tsx:ServerMemoryBreakdown], `TopResourceQueriesPanel` [TopResourceQueriesPanel.tsx:TopResourceQueriesPanel], `SchemaInventory` (default) [SchemaInventory.tsx:SchemaInventory], `ProjectionsView`, `SkipIndexesView` [MergeTreeObjects.tsx:ProjectionsView]
- Tools: `DdlSimulator` [DdlSimulator.tsx:DdlSimulator], `AiDiagnoseButton` / `DiagnosisView` (prop `runDiagnosis(modelId?, signal?)`) [AiDiagnoseButton.tsx:AiDiagnoseButton]
- Controls: `RangePickerDrilldown` [RangePickerDrilldown.tsx:RangePickerDrilldown], `PaginationBar` [PaginationBar.tsx:PaginationBar]

## Invariants
- `DdlSimulator` is read-only: the server only parses and estimates the statement (rows, parts/bytes rewritten, duration, disk headroom) and never runs the mutation [DdlSimulator.tsx:DdlSimulator].
- Without the `AI_OPTIMIZE` permission `AiDiagnoseButton` renders nothing; closing its dialog aborts an in-flight diagnosis through its `AbortController` and resets the result [AiDiagnoseButton.tsx:AiDiagnoseButton].
- Charts take colours from `useChartColors` so they follow the theme [QueryTimelineChart.tsx:QueryTimelineChart].

## Side Effects
- ClickHouse reads through the `useMonitoringTimeline` hooks (e.g. `useQueryTimeline`, `useQueryHistogram`, `usePartLogTimeline`) [QueryTimelineChart.tsx:QueryTimelineChart], [QueryHistogramChart.tsx:QueryHistogramChart].
- `DdlSimulator` calls `simulateDdl` [DdlSimulator.tsx:DdlSimulator]; `AiDiagnoseButton` calls the caller's `runDiagnosis` (an AI request) [AiDiagnoseButton.tsx:AiDiagnoseButton].
- `ConnectionBreakdownPanel` polls every 15 s when `autoRefresh` is on (`refetchInterval`) and refetches when `refreshKey` changes [ConnectionBreakdownPanel.tsx:ConnectionBreakdownPanel].
- `TopResourceQueriesPanel` copies a row's query id to the clipboard and shows a success toast [TopResourceQueriesPanel.tsx:ResourceRow].

## Verification
- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/components`
