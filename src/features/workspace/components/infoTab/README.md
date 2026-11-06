# workspace/components/infoTab

## Overview

Information tab for a database or table: overview metadata with CREATE query, plus Schema and Data Sample tabs for tables.

## Interface

- `[InfoTab.tsx:default InfoTab]` - props `database`, `tableName?`
- `[SchemaSection.tsx:default SchemaSection]` - column schema table
- `[DataSampleSection.tsx:default DataSampleSection]` - sample rows table

## Invariants

- Schema/Data Sample only when `tableName` is set `[InfoTab.tsx:InfoTab]`
- Sample cells sanitized with DOMPurify `[DataSampleSection.tsx:DataSampleSection]`

## Side Effects

- `useTableInfo`, `useDatabaseInfo`, `useTableSchema`, `useTableSample` from `@/hooks` `[InfoTab.tsx:InfoTab]` `[SchemaSection.tsx:SchemaSection]` `[DataSampleSection.tsx:DataSampleSection]`
- Clipboard and toasts `[InfoTab.tsx:copyToClipboard]`

## Verification

- No co-located tests; covered by `bun run typecheck` and the `src/features/workspace` suite: `bunx vitest run src/features/workspace`
