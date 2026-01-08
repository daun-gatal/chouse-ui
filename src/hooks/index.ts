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
  useSavedQueriesStatus,
  useSavedQueries,
  useSaveQuery,
  useUpdateSavedQuery,
  useDeleteSavedQuery,
  useActivateSavedQueries,
  useDeactivateSavedQueries,
  useIntellisense,
  useExecuteQuery,
  useInvalidateAll,
  usePrefetchTableDetails,
  useTableInfo,
  useDatabaseInfo,
  useTableSchema,
  useQueryLogs,
  useMetrics,
  useUsers,
  useUserDetails,
  useSettings,
  useClusters,
  useClusterNames,
} from './useQuery';

// Auth hooks
export {
  useAuth,
  useRequireAuth,
  useRequireAdmin,
  usePermission,
} from './useAuth';
