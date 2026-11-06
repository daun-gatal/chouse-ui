# hooks

## Overview
Shared React hooks: TanStack Query wrappers over the `src/api` modules (explorer, metrics, saved queries, intellisense, query logs), monitoring timelines and histograms that issue ClickHouse SQL through `queryApi.executeQuery`, fleet polling and client-side fleet alerts, live-query polling and kill, auth helpers, server-synced user preferences, and small viewport utilities. Barrel: `index.ts`, which does not re-export `useMonitoringTimeline.ts`, `useFleetAlerts.ts`, `useAppPreferences.ts`, `useChartColors.ts`, or `useLiveQueriesStats`/`liveQueriesKeys` — import those from their own files.

## Interface
- `useQuery.ts` - `queryKeys` (central TanStack key factory), `useConfig`, `useDatabases`, `useTableDetails`, `useTableSample`, `useCreateDatabase`, `useDropDatabase`, `useCreateTable`, `useDropTable`, `useSystemStats`, `useRecentQueries`, `useSavedQueries`, `useSaveQuery`, `useUpdateSavedQuery`, `useDeleteSavedQuery`, `useIntellisense`, `useExecuteQuery`, `useInvalidateAll`, `usePrefetchTableDetails`, `useTableInfo`, `useDatabaseInfo`, `useTableSchema`, `useQueryLogs`, `useMetrics`, `useProductionMetrics`, `useTopTables`, `usePartsPressure`, `useUsers`, `useSettings`, `useClusters`, `useSavedQueriesConnectionNames`, `useUserDetails`, `useClusterNames` [useQuery.ts:queryKeys], [index.ts:queryKeys]
- `useMonitoringTimeline.ts` - `useQueryTimeline`, `useQueryResourceTimeline`, `usePartLogTimeline`, `useQueryPatterns`, `useQueryByRedashId`, `useQueryViewsLog`, `useQueryByTable`, `useQueryHistogram`, `useDatabaseObjects`, `useTableDDL`, `HISTOGRAM_SPECS`; percentiles, mutations and replication (`useQueryPercentiles`, `useMutations`, `useReplicationQueue`, `useReplicaStatus`, `useBlockedTaskSummary`); memory/CPU (`useServerMemoryBreakdown`, `useTopMemoryQueries`, `useTopCpuQueries`, `useClusterMemoryTotal`, `useQueryProfileEvents`); schema lint (`useSchemaNullables`, `useSchemaOversized`, `useSchemaCompression`, `useProjections`, `useDataSkippingIndices`, `useSchemaInventory`); logs and cluster (`useConnectionBreakdown`, `usePartLog`, `useServerErrors`, `useCrashLog`, `useClusterTopology`, `useDistributionQueue`, `useDistributedDDLQueue`) [useMonitoringTimeline.ts:useQueryTimeline], [useMonitoringTimeline.ts:useDistributedDDLQueue]
- `useFleetMetrics.ts` - `useFleetConnections`, `useFleetSummary`, `useFleetLongestQuery`, `useFleetLastException`, `useFleetSnapshots`, `useFleetExceptions`, `useFleetHistory`, `computeFleetStatus`, `nodeStatusFromSnapshot`, `isSnapshotFresh`, `summaryFromSnapshot`, `flattenFleetExceptions`, `FLEET_STATUS_RANK`; also `fetchFleetSummary`, `fleetSummaryQueryKey`, `longestQueryFromSnapshot`, `topMemoryQueriesFromSnapshot`, `partsPressureFromSnapshot`, `lastExceptionFromSnapshot`, `aggregateFleetSchemaTotals`, `FLEET_TREND_FIELDS`, `pivotHistory`, `nodeSeries` [useFleetMetrics.ts:useFleetSummary], [useFleetMetrics.ts:aggregateFleetSchemaTotals]
- `useFleetAlerts.ts` - `useFleetAlerts`, types `AlertConfig`, `AlertEvent`, `ActiveBreach`, `UseFleetAlerts` [useFleetAlerts.ts:useFleetAlerts]
- `useLiveQueries.ts` - `useLiveQueries`, `useKillQuery`, `useLiveQueriesStats`, `liveQueriesKeys` [useLiveQueries.ts:useLiveQueries]
- `useAuth.ts` - `useAuth`, `useRequireAuth`, `useRequireAdmin`, `usePermission` (all deprecated) [useAuth.ts:useAuth]
- Preferences: `useAppPreferences`, `useLogsPreferences`, `usePaginationPreference` / `getDefaultPaginationSize`, `useUserManagementPreferences` [useAppPreferences.ts:useAppPreferences], [usePaginationPreferences.ts:usePaginationPreference]
- `useAiModelId` [useAiModelId.ts:useAiModelId]; `useChartColors` [useChartColors.ts:useChartColors]
- Utilities: `useDebounce`, `useWindowSize` / `Breakpoint`, `useDeviceType`, `useInView` [useDebounce.ts:useDebounce], [useInView.ts:useInView]

## Invariants
- TanStack keys come from `queryKeys`; per-user keys must also be cleared in `src/utils/sessionCleanup.ts` on user switch [useQuery.ts:queryKeys], [../utils/sessionCleanup.ts:cleanupUserSession].
- Identifiers interpolated into SQL go through `escapeQualifiedIdentifier` (e.g. `DESCRIBE TABLE` in `useTableSchema`) [useQuery.ts:useTableSchema]; string values in monitoring SQL escape `\` and `'` before quoting [useMonitoringTimeline.ts:useDatabaseObjects], [useMonitoringTimeline.ts:useTableDDL].
- Polling stops in background tabs: `useLiveQueries` (default 3 s) and `useFleetSummary` (default 30 s, `0` disables) set `refetchIntervalInBackground: false` [useLiveQueries.ts:useLiveQueries], [useFleetMetrics.ts:useFleetSummary].
- Fleet alerts are edge-triggered per (node, rule) and re-arm when the breach clears, with hysteresis on memory % [useFleetAlerts.ts:useFleetAlerts].
- Every hook in `useAuth.ts` is marked `@deprecated`; new code should use `useRbacStore` directly [useAuth.ts:useAuth], [useAuth.ts:usePermission].

## Side Effects
- Network: hooks call `src/api` modules; monitoring hooks run ClickHouse SQL via `queryApi.executeQuery` [useMonitoringTimeline.ts:useQueryTimeline]; `useKillQuery` kills a running query [useLiveQueries.ts:useKillQuery].
- `useAuth` listens for the `auth:unauthorized` window event, then logs out and navigates to `/login` [useAuth.ts:useAuth].
- `useFleetAlerts` reads/writes localStorage key `chouse-fleet:alert-config` and raises desktop notifications and toasts [useFleetAlerts.ts:useFleetAlerts].
- Preference hooks read and write `rbacUserPreferencesApi` (server-side user preferences) [useAppPreferences.ts:useAppPreferences], [useLogsPreferences.ts:useLogsPreferences].
- `useWindowSize` subscribes to window `resize` [useWindowSize.ts:useWindowSize].

## Verification
- Run: `bunx vitest run src/hooks`
