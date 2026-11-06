# lib/viz

## Overview
Pure, framework-free logic for dashboard and chart visualisation: the viz spec schema and canvas geometry (ADR 0021, ADR 0023), turning a spec plus a query result into something drawable, time-zone handling for x values, unit formatting, and a suggested starting spec for a result set. Consumed by `src/components/charts`, the dashboards feature, and the SQL workspace's Chart tab.

## Interface
- `spec.ts` - `vizSpecSchema` / `VizSpec` (Zod), `vizSpecProblems`, `vizShapeProblems`, `vizExtrasProblems`, `linkSchema`, `thresholdSchema`, `baselineSchema`, enums `CHART_TYPES`, `UNITS`, `REDUCERS`, `COLOR_SCHEMES`, `ANNOTATION_SOURCES`, `RELATIVE_RANGES`/`RELATIVE_RANGE_KEYS`, `REFRESH_SECONDS`, `PANEL_WIDTHS`/`PANEL_HEIGHTS`, `THRESHOLD_SEVERITIES`, `DEFAULT_ANNOTATION_SOURCES`; chart-type sets `TIME_SERIES_TYPES`, `THRESHOLD_TYPES`; spec limits `MAX_Y_COLUMNS` (12), `MAX_LINKS` (6), `MAX_LINK_VALUES` (10), `MIN_BASELINE_WEEKS`/`MAX_BASELINE_WEEKS` (2/8); name patterns `IDENTIFIER_RE`, `VARIABLE_NAME_RE`; link helpers `linkValueSchema`, `linkColumns`; grid constants `GRID_COLUMNS`, `ROW_HEIGHT_PX`, `ROW_GAP_PX`, `MAX_PANEL_ROWS` (40), `MAX_PANELS`, `MAX_CHART_PANELS`, `MAX_VARIABLES`; layout helpers `sizeLimits`, `overlaps`, `rowsToPx`, `appendBelow`, `shiftDown`, `soloSize` [spec.ts:vizSpecSchema], [spec.ts:MAX_Y_COLUMNS], [spec.ts:sizeLimits]
- `resolve.ts` - `resolveChart`, `resolveStat`, `pivot`, `crossedThreshold`, `mergeFleet`, types `ResultColumn`, `ResultData`, `ResolvedChart`, `Resolved<T>`, constant `MAX_SERIES` [resolve.ts:resolveChart]
- `autodetect.ts` - `suggestSpec`, `isNumericType`, `isTimeType`, `unitFromName` [autodetect.ts:suggestSpec]
- `time.ts` - `zoneOfColumn`, `zoneOffsetMs`, `toUtcMs`, `bucketIndex`, `nearestIndex`, `isTimeType` [time.ts:toUtcMs]
- `units.ts` - `formatValue`, `toNumber`, `UNIT_LABELS` [units.ts:formatValue]

## Invariants
- `spec.ts` mirrors `packages/server/src/services/dashboards/spec.ts`; both are tested against `packages/server/src/services/dashboards/spec.fixture.json` and must be kept in sync [spec.ts:vizSpecSchema].
- `time.ts` mirrors `packages/server/src/services/dashboards/time.ts`; x values are converted to UTC ms using the column type's zone or the run's session zone, never the browser zone [time.ts:zoneOfColumn], [time.ts:toUtcMs].
- Resolution never guesses: a missing column, non-numeric measure, duplicate pivot cell, or more than `MAX_SERIES` (20) series returns `{ ok: false, error }` naming the fix, rather than throwing [resolve.ts:pivot], [resolve.ts:resolveChart].
- `stat` and `table` specs are rejected by `resolveChart` (they are not charts) [resolve.ts:resolveChart].
- `suggestSpec` always returns a valid spec; it is only a starting suggestion [autodetect.ts:suggestSpec].

## Side Effects
- None. All modules are pure functions and constants.

## Verification
- Run: `bunx vitest run src/lib/viz`
