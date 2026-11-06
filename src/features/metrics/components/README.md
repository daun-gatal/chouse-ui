# metrics/components

## Overview

A single uPlot-based, theme-aware, multi-series time-series chart with hover tooltip.

## Interface

- `[UPlotMetricItemComponent.tsx:default UPlotMetricItemComponent]` - props `data`, `title`, `colors?`, `fill?`, `unit?`, `height?`

## Invariants

- Value formatting depends on the title (Bytes, %, ms, Conn, etc.) `[UPlotMetricItemComponent.tsx:formatValue]`
- Y range clamped >= 0 with 10% padding `[UPlotMetricItemComponent.tsx:UPlotMetricItemComponent]`
- Chart rebuilt when data, title, colors, fill, height or theme change `[UPlotMetricItemComponent.tsx:UPlotMetricItemComponent]`

## Side Effects

- Window `resize` listener and `uplot.destroy()` on cleanup; no network `[UPlotMetricItemComponent.tsx:UPlotMetricItemComponent]`

## Verification

- No co-located tests; covered by `bun run typecheck` and the `src/features` suite: `bunx vitest run src/features`
