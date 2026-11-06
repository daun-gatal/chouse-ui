# ImportWizard

## Overview

Three-step file import dialog (upload, preview schema, progress) that analyzes CSV/TSV/JSON server-side, creates a table or appends with column mapping, then streams the file to the upload endpoint.

## Interface

- `[index.ts]` - `export *` from all four files
- `[ImportWizard.tsx:ImportWizard]` / `ImportMode` / `ENGINES` - main dialog
- `[StepUpload.tsx:StepUpload]` - dropzone (one .csv/.json/.tsv/.tab/.txt file)
- `[StepPreview.tsx:StepPreview]` / `ColumnDefinition` - destination, columns and engine settings
- `[StepProgress.tsx:StepProgress]` - status view

## Invariants

- Import button disabled unless table name, database and columns are set and the name matches `/^[a-zA-Z0-9_]*$/` `[ImportWizard.tsx:TABLE_NAME_REGEX]`; `StepPreview` keeps its own copy of the regex only for an "invalid" hint `[StepPreview.tsx:tableNameInvalid]`
- In create mode, `handleImport` refuses (toast) any `requiresOrderBy` engine, MergeTree included, without ORDER BY columns `[ImportWizard.tsx:handleImport]`; the `ORDER BY tuple()` fallback for MergeTree in the DDL builder is therefore not reachable from the UI `[ImportWizard.tsx:generateCreateTableQuery]`
- Dialog cannot close while uploading or creating `[ImportWizard.tsx:handleClose]`
- Column names normalised to `[a-z0-9_]` `[ImportWizard.tsx:normalizeColumnName]`
- Generated DDL interpolates PARTITION BY and TTL raw; no permission checks in this folder `[ImportWizard.tsx:generateCreateTableQuery]`

## Side Effects

- Raw `fetch` POST `/api/upload/preview` and `/api/upload/create`, both with `X-Requested-With` and a Bearer token from localStorage `rbac_access_token`; `/create` also sends `connectionIdentityHeaders()` `[ImportWizard.tsx:connectionIdentityHeaders]`
- CREATE TABLE via `api.post('/query/execute')` `[ImportWizard.tsx:handleImport]`
- Invalidates `['tables', db]`; `addTab` and navigate to `/explorer` `[ImportWizard.tsx:handleViewTable]`
- Toasts; clipboard copy of errors `[StepProgress.tsx:StepProgress]`

## Verification

- No co-located tests; covered by `bun run typecheck` and the `src/features` suite: `bunx vitest run src/features`
