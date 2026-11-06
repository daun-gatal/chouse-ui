# components/charts

## Overview
Shared chart rendering and viz-spec editing UI for dashboards and the SQL workspace's Chart tab. Rendering logic lives in `src/lib/viz`; these components draw the resolved result and edit the spec.

## Interface
- `PanelVisual` / `PanelVisualProps` - renders a `VizSpec` against `ResultData` (chart, stat, or table) with optional extra lines, decoration, and `onDatumClick` [PanelVisual.tsx:PanelVisual]
- `PanelMessage` - error or muted placeholder shown in place of a visual [PanelVisual.tsx:PanelMessage]
- `THRESHOLD_COLORS` - colour per threshold severity [PanelVisual.tsx:THRESHOLD_COLORS]
- `VizSpecEditor` - form for editing a spec against the available result columns (`hideProblems` hides validation output) [VizSpecEditor.tsx:VizSpecEditor]
- `retype(spec, type, columns)` - switches chart type while keeping a usable spec [VizSpecEditor.tsx:retype]
- `controlStyles.ts` - house-style class strings `BTN_PRIMARY`, `BTN_OUTLINE`, `BTN_GHOST`, `BTN_INLINE`, `BTN_ICON`, `FIELD`, `TEXTAREA`, `FIELD_LABEL` [controlStyles.ts:BTN_PRIMARY]

## Invariants
- Specs and results are resolved with `src/lib/viz` (`resolveChart`, `resolveStat`, `formatValue`); a failed resolution is shown as a message, not guessed around [PanelVisual.tsx:PanelVisual].
- Chart and dashboard controls use the `controlStyles.ts` classes instead of stock shadcn sizes [controlStyles.ts:BTN_PRIMARY].

## Side Effects
- None beyond rendering; `onChange` / `onDatumClick` callbacks are owned by the caller [VizSpecEditor.tsx:VizSpecEditor], [PanelVisual.tsx:PanelVisual].

## Verification
- Run: `bunx vitest run src/components/charts`
