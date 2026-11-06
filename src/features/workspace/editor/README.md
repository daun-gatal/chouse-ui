# editor

## Overview

Monaco SQL editor (`SqlEditor`) and Monaco setup: themes, ClickHouse tokenizer, language config and completion/hover/signature/formatting providers; `sqlCompletionUtils` holds pure context parsing.

## Interface

- `[SqlEditor.tsx:default SQLEditor]` / `SqlEditorHandle` - editor with format/save/stop/getQuery handle
- `[monacoConfig.ts:initializeMonacoGlobally]`, `createMonacoEditor`, `createMonacoDiffEditor`, `getMonacoEditorOptions`, `updateMonacoEditorOptions`, `clearIntellisenseCache`, `retryInitialization`
- `[sqlCompletionUtils.ts:parseQueryContext]`, `getTablesInScope`, `parseCTEDefinitions`, `resolveTableAlias`, `buildDatabaseStructureFromColumns`
- `[clickhouseLanguage.ts:createClickHouseMonarchTokenizer]`, `createClickHouseLanguageConfig`, `CLICKHOUSE_KEYWORDS`, `CLICKHOUSE_DATA_TYPES`, `SQL_SNIPPETS`
- `[appQueries.ts:appQueries]` - intellisense and metadata SQL strings

## Invariants

- Run/Explain/Optimize refuse blank SQL; Ask Chobi fails closed when unavailable `[SqlEditor.tsx:SQLEditor]`
- Saving requires an active connection and non-empty name/SQL; `canSaveQuery`/`canOptimizeQuery` are computed but do not gate the shortcuts `[SqlEditor.tsx:SQLEditor]`
- Auto-save only for saved tabs, debounced by `AUTO_SAVE_DELAY` 2000ms `[SqlEditor.tsx:SQLEditor]`
- Language/provider registration runs once (`isInitialized`) `[monacoConfig.ts:initializeMonacoGlobally]`
- Completion contexts short-circuit (settings, engines, types) `[monacoConfig.ts:initializeMonacoGlobally]`

## Side Effects

- On import reads localStorage `app-storage` credentials to build a `@clickhouse/client-web` client and sets `window.MonacoEnvironment` `[monacoConfig.ts:retryInitialization]`
- Caches `getIntellisenseData()` module-wide `[monacoConfig.ts:clearIntellisenseCache]`
- Monaco theme/language/provider registrations `[monacoConfig.ts:initializeMonacoGlobally]`
- `rbacUserPreferencesApi.getPreferences/updatePreferences` `[monacoConfig.ts:getMonacoEditorOptions]`
- Keybindings, `updateTab` on every edit, `saveQuery`/`updateSavedQuery`, `useKillQuery` `[SqlEditor.tsx:SQLEditor]`

## Verification

- Run: `bunx vitest run src/features/workspace/editor` (from repo root; full suite: `bunx vitest run`)
