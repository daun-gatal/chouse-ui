# lib

## Overview
Shared client-side utilities with no UI of their own: logging, class-name and number formatting, SSE parsing, concurrency limiting, base-path handling, the floating-layer z-index scale, navigation-permission maps, connection switching, schema-preflight retries, and helpers for the AI chat, Chobi assistant, and upgrade-check UIs. Most modules are pure; a few (listed under Side Effects) touch storage, the API, or window events.

## Interface
- [viz](./viz/README.md) - dashboard viz spec, chart resolution, time and unit helpers.
- `log.ts` - `log.error|warn|info|debug`; the required client logger [log.ts:log]
- `password.ts` - `generatePassword(length = 16)` (Web Crypto, at least one upper/lower/digit/symbol, no look-alikes) and `secureRandomInt(max)` (rejection sampling, no modulo bias); the only password generator for admin "generate" buttons [password.ts:generatePassword], [password.ts:secureRandomInt]
- `utils.ts` - `cn`, `formatBytes`, `formatDate`, `formatNumber`, `formatCompactNumber`, `redactSecrets` [utils.ts:redactSecrets]
- `activateConnection.ts` - `activateConnection({ connectionId, connectionName?, queryClient })` [activateConnection.ts:activateConnection]
- `schemaPreflight.ts` - `withSchemaOverride(statement, run)`, `SCHEMA_PREFLIGHT_CODE` [schemaPreflight.ts:withSchemaOverride]
- `navAccess.ts` - `ADMIN_TAB_PERMISSIONS`, `ADMIN_ACCESS_PERMISSIONS`, `MONITORING_ACCESS_PERMISSIONS`, `DASHBOARDS_ACCESS_PERMISSIONS`, `EXPLORER_ACCESS_PERMISSIONS`, `DATA_ACCESS_PERMISSIONS`, `AGENTS_ACCESS_PERMISSIONS`, `AdminTabKey` [navAccess.ts:ADMIN_TAB_PERMISSIONS]
- `permissionCategories.ts` - `permissionCategory`, `groupPermissionsByCategory`, `OTHER_PERMISSION_CATEGORY` [permissionCategories.ts:groupPermissionsByCategory]
- `sse.ts` - `parseSseChunk`, `readSse(response, signal)` async generator, `SseEvent` [sse.ts:readSse]
- `limiter.ts` - `createLimiter(size)` returning a `Limiter` [limiter.ts:createLimiter]
- `basePath.ts` - `getBasePath`, `withBasePath` [basePath.ts:withBasePath]
- `layers.ts` - `LAYERS` z-index scale, `FloatingLayerContext`, `useLayerProps`, `useLayerStyle`, `isInsideChobi`, `escapeDeferredToChobi`, `leftOfRail`, `CHOBI_ROOT_ATTRIBUTE`, `DOCK_RAIL_WIDTH_VAR` [layers.ts:LAYERS]
- `onboardingSurfaces.ts` - `prepareSurfacesForOnboarding`, `hasActiveOnboardingSurfaces`, `waitForOnboardingSurfacesToSettle`, `useOnboardingSurfaceDismiss`, `useOnboardingSurfaceDismissAction`, `useOnboardingSurfaceRef`, `ONBOARDING_PREPARE_EVENT` [onboardingSurfaces.ts:prepareSurfacesForOnboarding]
- `devicePreferences.ts` - `getDeviceType`, `DOCK_DEFAULT_PREFERENCES_BY_DEVICE`, `EXPLORER_DIALOG_DEFAULT_POSITION_AND_SIZE_BY_DEVICE`, `getDockPrefsFromWorkspace`, `mergeDockPrefsIntoWorkspace`, `getExplorerDialogPrefsFromWorkspace`, `mergeExplorerDialogPrefsIntoWorkspace` [devicePreferences.ts:getDeviceType]
- `explorerPath.ts` - `explorerPath`, `readExplorerTarget` [explorerPath.ts:explorerPath]
- `formatSql.ts` - `formatClickHouseSQL` [formatSql.ts:formatClickHouseSQL]
- AI chat helpers: `chatComposer.ts` (`MAX_ATTACHMENTS`, `MAX_ATTACHMENT_BYTES`, `attachmentMimeType`, `attachmentKind`, `attachmentAccept`, `attachmentHint`, `attachmentProblem`, `readAsBase64`, `parseSkillCommands`, `skillQueryAt`, `insertSkillCommand`), `aiApprovals.ts` (`formatCountdown`, `expiresIn`, `argsToText`, `parseArgsText`, `argRows`), `aiActionReceipts.ts` (`actionReceipts`), `aiMemories.ts` (`savedMemories`, `memoryExportFile`, `SavedMemoryNote`) [chatComposer.ts:attachmentProblem], [aiApprovals.ts:parseArgsText]
- Chobi assistant helpers: `chobiUi.ts` (`safeAppPath`, `uiActionFor`, `UI_TOOL_NAMES`, `UiAction`), `chobiNudges.ts` (`nextNudge`, `NUDGE_MIN_GAP_MS`, `NUDGE_MAX_PER_HOUR`, `INITIAL_NUDGE_STATE`), `chobiHandoff.ts` (`handoffMarkdown`, `handoffMessage`, `HANDOFF_NOTE_MAX`, `HANDOFF_MESSAGE_MAX`) [chobiUi.ts:safeAppPath], [chobiNudges.ts:nextNudge]
- `upgrades.ts` - upgrade-check display helpers: `checkSteps`, `stepState`, `checkVerdict`, `checkMarkdown`, `mainFindings`, `notesToJudge`, `findingCounts`, `versionTone`, `versionStatusText`, `SEVERITY_LABEL`; date/label helpers `formatDay`, `formatMonth`, `daysSince`, `agoText`, `supportWindowText`, `targetKindLabel`, `targetTag`, `prUrl` [upgrades.ts:checkVerdict], [upgrades.ts:targetTag]
- `alertEvents.ts` - `eventSummary` [alertEvents.ts:eventSummary]

## Invariants
- Client code logs through `log`, never raw `console.*`; `debug`/`info` only emit when `import.meta.env.DEV` [log.ts:log].
- `activateConnection` is the single connection-switch routine: it must call `setConnectionId` and `setSessionId` on the API client, otherwise queries keep the previous `X-Connection-Id`/`X-Session-ID` headers [activateConnection.ts:activateConnection].
- `withSchemaOverride` retries at most once, and only when the error is an `ApiError` with code `SCHEMA_PREFLIGHT_BREAKS`, the details parse, and the user confirms; otherwise the original error is rethrown [schemaPreflight.ts:withSchemaOverride].
- `navAccess.ts` is the single source of truth for which permissions unlock each top-level area; holding any one of an area's permissions reveals that area [navAccess.ts:ADMIN_ACCESS_PERMISSIONS].
- Chobi UI tools may only navigate to allow-listed CHouse paths or put SQL (max 20,000 chars) in a new editor tab; never run, save, or leave the app [chobiUi.ts:safeAppPath], [chobiUi.ts:uiActionFor].
- Chobi nudges are data-driven and rate limited (`NUDGE_MIN_GAP_MS` = 2 min, `NUDGE_MAX_PER_HOUR` = 6) [chobiNudges.ts:nextNudge].
- `createLimiter` requires an integer size of at least 1 and a task whose signal aborts while queued never starts [limiter.ts:createLimiter].
- `redactSecrets` masks `IDENTIFIED ... BY '...'` and `PASSWORD '...'` literals [utils.ts:redactSecrets].
- `LAYERS` is the one z-index scale for floating UI (dialog 50, dock 70, dock flyout 80, review 90, Chobi 95-97, onboarding top) [layers.ts:LAYERS].

## Side Effects
- `activateConnection` calls `rbacConnectionsApi.connect`, writes `clickhouse_selected_connection_id` to localStorage, updates `workspacePreferences.lastConnectionId` via `rbacUserPreferencesApi`, updates `useAuthStore`, invalidates all TanStack queries, and dispatches the `clickhouse:connected` window event [activateConnection.ts:activateConnection].
- `withSchemaOverride` opens the schema-preflight prompt through `useSchemaPreflightStore.ask` [schemaPreflight.ts:withSchemaOverride].
- `log` writes to the browser console [log.ts:log].
- `readSse` consumes a fetch `Response` body stream [sse.ts:readSse].
- `prepareSurfacesForOnboarding` dispatches the `onboarding:prepare` event [onboardingSurfaces.ts:prepareSurfacesForOnboarding].

## Verification
- Run: `bunx vitest run src/lib`
