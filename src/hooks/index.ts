/**
 * Hooks Index
 * 
 * Re-exports all custom hooks for convenient imports.
 */

// React Query hooks
export {
  queryKeys,
  useConfig,
  useDatabases,
  useTableDetails,
  useTableSample,
  useCreateDatabase,
  useDropDatabase,
  useCreateTable,
  useDropTable,
  useSystemStats,
  useRecentQueries,
  useSavedQueries,
  useSavedQueriesConnectionNames,
  useSaveQuery,
  useUpdateSavedQuery,
  useDeleteSavedQuery,
  useIntellisense,
  useExecuteQuery,
  useInvalidateAll,
  usePrefetchTableDetails,
  useTableInfo,
  useDatabaseInfo,
  useTableSchema,
  useQueryLogs,
  useMetrics,
  useProductionMetrics,
  useUsers,
  useUserDetails,
  useSettings,
  useClusters,
  useClusterNames,
  useTopTables,
} from './useQuery';

// Auth hooks
export {
  useAuth,
  useRequireAuth,
  useRequireAdmin,
  usePermission,
} from './useAuth';

// Utility hooks
export { useDebounce } from './useDebounce';
export { useWindowSize } from './useWindowSize';
export type { Breakpoint } from './useWindowSize';
export { useDeviceType } from './useDeviceType';

// Pagination preferences hook
export { usePaginationPreference, getDefaultPaginationSize } from './usePaginationPreferences';
export type { TablePaginationPreferences } from './usePaginationPreferences';

// Logs page preferences hook
export { useLogsPreferences } from './useLogsPreferences';
export type { LogsPagePreferences } from './useLogsPreferences';

// User management preferences hook
export { useUserManagementPreferences } from './useUserManagementPreferences';
export type { UserManagementPreferences } from './useUserManagementPreferences';
// Live queries hooks
export {
  useLiveQueries,
  useKillQuery,
} from './useLiveQueries';
