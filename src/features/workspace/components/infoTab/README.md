# workspace/components/infoTab

## Overview

Information tab for a database or table: overview metadata with CREATE query, plus Schema and Data Sample tabs for tables.

## Interface

- `[InfoTab.tsx:default InfoTab]` - props `database`, `tableName?`
- `[SchemaSection.tsx:default SchemaSection]` - column schema table
- `[DataSampleSection.tsx:default DataSampleSection]` - sample rows table

## Invariants

- Schema/Data Sample only when `tableName` is set `[InfoTab.tsx:InfoTab]`
- Sample cells are plain text from `formatResultCell`, never HTML `[DataSampleSection.tsx:DataSampleSection]` `[../../../../lib/resultCells.ts:formatResultCell]`
- Sample columns read each row by the exact column name through `resultColumnAccessors`, never a TanStack `accessorKey`, so dotted names (`device.name`, Nested `n.a`) show their values (#444) `[DataSampleSection.tsx:DataSampleSection]` `[../../../../lib/resultColumns.ts:resultColumnAccessors]`

## Side Effects

- `useTableInfo`, `useDatabaseInfo`, `useTableSchema`, `useTableSample` from `@/hooks` `[InfoTab.tsx:InfoTab]` `[SchemaSection.tsx:SchemaSection]` `[DataSampleSection.tsx:DataSampleSection]`
- Clipboard and toasts `[InfoTab.tsx:copyToClipboard]`

## Verification

- `bunx vitest run src/features/workspace/components/infoTab` (`DataSampleSection.test.tsx`: dotted column names render their values; HTML-looking values render as text)
