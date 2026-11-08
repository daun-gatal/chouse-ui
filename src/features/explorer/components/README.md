# explorer/components

## Overview

Explorer sidebar (database tree plus pinned/recent/history/saved tabs) and modal dialogs for creating databases and tables, altering tables and uploading files; modal state comes from `useExplorerStore`, DDL goes through `@/hooks` mutations. Default exports, no barrel.

## Interface

- `[DataExplorer.tsx:default DatabaseExplorer]` - sidebar with tabs, filters and Cmd/Ctrl+K search
- `[TreeNode.tsx:default TreeNode]` / `TreeNodeData` - database/table node with context menu
- `[CreateDatabase.tsx:default CreateDatabase]`, `[CreateTable.tsx:default CreateTable]`, `[AlterTable.tsx:default AlterTable]`, `[UploadFile.tsx:default UploadFile]` - DDL and upload modals
- `[ManualCreationForm.tsx:default ManualCreationForm]`, `[FieldManagement.tsx:default FieldManagement]` / `Field` - table form pieces

### Subdirectories

- ImportWizard: [ImportWizard](./ImportWizard/README.md) - Three-step file import dialog (upload, preview schema, progress) that analyzes CSV/TSV/JSON server-side, creates a table or appends with column mapping, then streams the file to the upload endpoint.

## Invariants

- Create/upload menu items need DB_CREATE, TABLE_CREATE, TABLE_INSERT; saved queries need SAVED_QUERIES_VIEW/DELETE `[DataExplorer.tsx:DatabaseExplorer]`; context menu uses `PermissionGuard` for TABLE_* `[TreeNode.tsx:TreeNode]`
- AlterTable escapes names with `escapeIdentifier` and validates types with `validateColumnType` `[AlterTable.tsx:AlterTable]`; the Describe, Drop Table and Query tabs quote names with `quoteIdentifier` (they open as editable SQL tabs, not executed) `[TreeNode.tsx:TreeNode]`
- The Query tab opens `SELECT * FROM <db>.<table> LIMIT 100` for a table and `SHOW TABLES FROM <db>` for a database `[TreeNode.tsx:handleNewQuery]`
- CreateTable builds both the submitted statement and the preview with `buildCreateTableSql`: names quoted, comments as string literals, column types whole-string validated (an invalid type is a toast on submit and a comment in the preview); DEFAULT, PARTITION BY and TTL are user-written expressions passed through as typed `[CreateTable.tsx:CreateTable]`
- Database name must match `/^[a-zA-Z_][a-zA-Z0-9_]*$/` `[CreateDatabase.tsx:handleSubmit]`; MergeTree engines need >= 1 ORDER BY column `[CreateTable.tsx:handleSubmit]`
- SQL preview sanitized with DOMPurify `[ManualCreationForm.tsx:ManualCreationForm]`

## Side Effects

- `useDatabases`, `useSavedQueries`, `useDeleteSavedQuery`, workspace query history actions `[DataExplorer.tsx:DatabaseExplorer]`
- `useClusterNames` loads the cluster list for the optional ON CLUSTER choice `[CreateDatabase.tsx:CreateDatabase]` `[CreateTable.tsx:CreateTable]`
- `useCreateDatabase` and `useExecuteQuery` mutations, then refetch databases `[CreateDatabase.tsx:handleSubmit]` `[CreateTable.tsx:handleSubmit]`
- `addTab`, `toggleFavorite`, `addRecentItem`, `navigate(explorerPath(...))` `[TreeNode.tsx:TreeNode]`
- Toasts; global Cmd/Ctrl+K listener `[DataExplorer.tsx:DatabaseExplorer]`; clipboard `[ManualCreationForm.tsx:handleCopySQL]`

## Verification

- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/features` (from repo root; full suite: `bunx vitest run`)
