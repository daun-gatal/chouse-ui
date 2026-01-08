/**
 * React Query Hooks for ClickHouse Studio
 * 
 * These hooks provide data fetching with caching, automatic refetching,
 * and proper error handling using TanStack Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryOptions,
  UseMutationOptions,
} from '@tanstack/react-query';
import { explorerApi, metricsApi, savedQueriesApi, queryApi } from '@/api';
import type {
  DatabaseInfo,
  TableDetails,
  SystemStats,
  RecentQuery,
  SavedQuery,
  IntellisenseData,
  QueryResult,
} from '@/api';

// ============================================
// Query Keys
// ============================================

export const queryKeys = {
  // Explorer
  databases: ['databases'] as const,
  tableDetails: (database: string, table: string) => ['tableDetails', database, table] as const,
  tableSample: (database: string, table: string, limit?: number) => 
    ['tableSample', database, table, limit] as const,

  // Metrics
  systemStats: ['systemStats'] as const,
  recentQueries: (limit?: number) => ['recentQueries', limit] as const,

  // Saved Queries
  savedQueriesStatus: ['savedQueriesStatus'] as const,
  savedQueries: ['savedQueries'] as const,

  // Intellisense
  intellisense: ['intellisense'] as const,
} as const;

// ============================================
// Explorer Hooks
// ============================================

/**
 * Hook to fetch all databases and tables
 */
export function useDatabases(options?: Partial<UseQueryOptions<DatabaseInfo[], Error>>) {
  return useQuery({
    queryKey: queryKeys.databases,
    queryFn: explorerApi.getDatabases,
    staleTime: 30000, // Consider data fresh for 30 seconds
    ...options,
  });
}

/**
 * Hook to fetch table details
 */
export function useTableDetails(
  database: string,
  table: string,
  options?: Partial<UseQueryOptions<TableDetails, Error>>
) {
  return useQuery({
    queryKey: queryKeys.tableDetails(database, table),
    queryFn: () => explorerApi.getTableDetails(database, table),
    enabled: !!database && !!table,
    staleTime: 60000, // Consider data fresh for 1 minute
    ...options,
  });
}

/**
 * Hook to fetch table data sample
 */
export function useTableSample(
  database: string,
  table: string,
  limit: number = 100,
  options?: Partial<UseQueryOptions<{ meta: any[]; data: any[]; statistics: any; rows: number }, Error>>
) {
  return useQuery({
    queryKey: queryKeys.tableSample(database, table, limit),
    queryFn: () => explorerApi.getTableSample(database, table, limit),
    enabled: !!database && !!table,
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to create a database
 */
export function useCreateDatabase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: explorerApi.createDatabase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}

/**
 * Hook to drop a database
 */
export function useDropDatabase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: explorerApi.dropDatabase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}

/**
 * Hook to create a table
 */
export function useCreateTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: explorerApi.createTable,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}

/**
 * Hook to drop a table
 */
export function useDropTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ database, table }: { database: string; table: string }) =>
      explorerApi.dropTable(database, table),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases });
    },
  });
}

// ============================================
// Metrics Hooks
// ============================================

/**
 * Hook to fetch system statistics
 */
export function useSystemStats(
  options?: Partial<UseQueryOptions<SystemStats, Error>>
) {
  return useQuery({
    queryKey: queryKeys.systemStats,
    queryFn: metricsApi.getSystemStats,
    refetchInterval: 5000, // Refetch every 5 seconds
    staleTime: 3000,
    ...options,
  });
}

/**
 * Hook to fetch recent queries
 */
export function useRecentQueries(
  limit: number = 10,
  options?: Partial<UseQueryOptions<RecentQuery[], Error>>
) {
  return useQuery({
    queryKey: queryKeys.recentQueries(limit),
    queryFn: () => metricsApi.getRecentQueries(limit),
    refetchInterval: 10000, // Refetch every 10 seconds
    staleTime: 5000,
    ...options,
  });
}

// ============================================
// Saved Queries Hooks
// ============================================

/**
 * Hook to check if saved queries feature is enabled
 */
export function useSavedQueriesStatus(
  options?: Partial<UseQueryOptions<boolean, Error>>
) {
  return useQuery({
    queryKey: queryKeys.savedQueriesStatus,
    queryFn: savedQueriesApi.checkSavedQueriesStatus,
    staleTime: 60000,
    ...options,
  });
}

/**
 * Hook to fetch saved queries
 */
export function useSavedQueries(
  options?: Partial<UseQueryOptions<SavedQuery[], Error>>
) {
  const statusQuery = useSavedQueriesStatus();

  return useQuery({
    queryKey: queryKeys.savedQueries,
    queryFn: savedQueriesApi.getSavedQueries,
    enabled: statusQuery.data === true,
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to save a query
 */
export function useSaveQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savedQueriesApi.saveQuery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries });
    },
  });
}

/**
 * Hook to update a saved query
 */
export function useUpdateSavedQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name: string; query: string } }) =>
      savedQueriesApi.updateSavedQuery(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries });
    },
  });
}

/**
 * Hook to delete a saved query
 */
export function useDeleteSavedQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savedQueriesApi.deleteSavedQuery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries });
    },
  });
}

/**
 * Hook to activate saved queries feature
 */
export function useActivateSavedQueries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savedQueriesApi.activateSavedQueries,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesStatus });
    },
  });
}

/**
 * Hook to deactivate saved queries feature
 */
export function useDeactivateSavedQueries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savedQueriesApi.deactivateSavedQueries,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesStatus });
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries });
    },
  });
}

// ============================================
// Query Execution Hooks
// ============================================

/**
 * Hook to fetch intellisense data
 */
export function useIntellisense(
  options?: Partial<UseQueryOptions<IntellisenseData, Error>>
) {
  return useQuery({
    queryKey: queryKeys.intellisense,
    queryFn: queryApi.getIntellisenseData,
    staleTime: 300000, // Cache for 5 minutes
    ...options,
  });
}

/**
 * Hook to execute a SQL query
 */
export function useExecuteQuery<T = Record<string, unknown>>() {
  return useMutation({
    mutationFn: ({
      query,
      format = 'JSON',
    }: {
      query: string;
      format?: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated';
    }) => queryApi.executeQuery<T>(query, format),
  });
}

// ============================================
// Utility Hooks
// ============================================

/**
 * Hook to invalidate all cached data
 */
export function useInvalidateAll() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries();
  };
}

/**
 * Hook to prefetch table details
 */
export function usePrefetchTableDetails() {
  const queryClient = useQueryClient();

  return (database: string, table: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.tableDetails(database, table),
      queryFn: () => explorerApi.getTableDetails(database, table),
    });
  };
}

// ============================================
// Additional Hooks
// ============================================

/**
 * Hook to fetch table info (for InfoTab)
 */
export function useTableInfo(
  database: string,
  table: string,
  options?: Partial<UseQueryOptions<Record<string, unknown>, Error>>
) {
  return useQuery({
    queryKey: ['tableInfo', database, table] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT 
            database,
            name as table_name,
            engine,
            total_rows,
            total_bytes,
            formatReadableSize(total_bytes) as size,
            partition_key,
            sorting_key,
            primary_key,
            create_table_query
          FROM system.tables 
          WHERE database = '${database}' AND name = '${table}'
        `);
      return result.data[0] || {};
    },
    enabled: !!database && !!table,
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to fetch database info
 */
export function useDatabaseInfo(
  database: string,
  options?: Partial<UseQueryOptions<Record<string, unknown>, Error>>
) {
  return useQuery({
    queryKey: ['databaseInfo', database] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT 
            name as database_name,
            engine,
            comment,
            (SELECT count() FROM system.tables WHERE database = '${database}') as table_count,
            (SELECT sum(total_bytes) FROM system.tables WHERE database = '${database}') as total_bytes,
            formatReadableSize((SELECT sum(total_bytes) FROM system.tables WHERE database = '${database}')) as size
          FROM system.databases 
          WHERE name = '${database}'
        `);
      return result.data[0] || {};
    },
    enabled: !!database,
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to fetch table schema
 */
export function useTableSchema(
  database: string,
  table: string,
  options?: Partial<UseQueryOptions<Array<{
    name: string;
    type: string;
    default_type: string;
    default_expression: string;
    comment: string;
  }>, Error>>
) {
  return useQuery({
    queryKey: ['tableSchema', database, table] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`DESCRIBE TABLE ${database}.${table}`);
      return result.data as Array<{
        name: string;
        type: string;
        default_type: string;
        default_expression: string;
        comment: string;
      }>;
    },
    enabled: !!database && !!table,
    staleTime: 60000,
    ...options,
  });
}

/**
 * Hook to fetch query logs
 */
export function useQueryLogs(
  limit: number = 100,
  options?: Partial<UseQueryOptions<Array<{
    type: string;
    event_date: string;
    event_time: string;
    query_id: string;
    query: string;
    query_duration_ms: number;
    read_rows: number;
    read_bytes: number;
    memory_usage: number;
    user: string;
    exception?: string;
  }>, Error>>
) {
  return useQuery({
    queryKey: ['queryLogs', limit] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT 
            type,
            event_date,
            formatDateTime(event_time, '%H:%i:%S') as event_time,
            query_id,
            query,
            query_duration_ms,
            read_rows,
            read_bytes,
            memory_usage,
            user,
            exception
          FROM system.query_log
          WHERE event_date >= today() - 1
          ORDER BY event_time DESC
          LIMIT ${limit}
        `);
      return result.data as Array<{
        type: string;
        event_date: string;
        event_time: string;
        query_id: string;
        query: string;
        query_duration_ms: number;
        read_rows: number;
        read_bytes: number;
        memory_usage: number;
        user: string;
        exception?: string;
      }>;
    },
    staleTime: 10000,
    refetchInterval: 30000,
    ...options,
  });
}

/**
 * Hook to fetch metrics data
 */
export function useMetrics(
  timeRange: string = "1h",
  options?: Partial<UseQueryOptions<{
    queriesPerSecond?: { timestamps: number[]; values: number[] };
    memoryUsage?: { timestamps: number[]; values: number[] };
    cpuUsage?: { timestamps: number[]; values: number[] };
    diskIO?: { timestamps: number[]; values: number[] };
  }, Error>>
) {
  return useQuery({
    queryKey: ['metrics', timeRange] as const,
    queryFn: async () => {
      // Convert timeRange to interval and sampling for query
      const config: Record<string, { interval: string; sample: number }> = {
        '15m': { interval: '15 MINUTE', sample: 10 },
        '1h': { interval: '1 HOUR', sample: 30 },
        '6h': { interval: '6 HOUR', sample: 60 },
        '24h': { interval: '24 HOUR', sample: 300 },
      };
      const { interval, sample } = config[timeRange] || config['1h'];
      
      // Fetch queries per second from query_log
      const queriesResult = await queryApi.executeQuery(`
        SELECT 
          toUnixTimestamp(toStartOfMinute(event_time)) as ts,
          count() / 60 as qps
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL ${interval}
          AND type = 'QueryFinish'
        GROUP BY ts
        ORDER BY ts
      `);
      
      // Fetch memory usage - sample every N seconds to reduce data points
      let memoryResult;
      try {
        memoryResult = await queryApi.executeQuery(`
          SELECT 
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${sample} SECOND)) as ts,
            avg(value) / 1073741824 as memory_gb
          FROM system.asynchronous_metric_log
          WHERE event_time >= now() - INTERVAL ${interval}
            AND metric = 'MemoryResident'
          GROUP BY ts
          ORDER BY ts
        `);
      } catch {
        memoryResult = { data: [] };
      }
      
      // Fetch CPU usage - use OSUserTimeNormalized which is 0-1 scale
      let cpuResult;
      try {
        cpuResult = await queryApi.executeQuery(`
          SELECT 
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${sample} SECOND)) as ts,
            avg(value) * 100 as cpu_percent
          FROM system.asynchronous_metric_log
          WHERE event_time >= now() - INTERVAL ${interval}
            AND metric = 'OSUserTimeNormalized'
          GROUP BY ts
          ORDER BY ts
        `);
      } catch {
        cpuResult = { data: [] };
      }
      
      // Fetch disk I/O wait time
      let diskResult;
      try {
        diskResult = await queryApi.executeQuery(`
          SELECT 
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${sample} SECOND)) as ts,
            avg(value) / 1000000 as io_wait_sec
          FROM system.asynchronous_metric_log
          WHERE event_time >= now() - INTERVAL ${interval}
            AND metric = 'OSIOWaitTime'
          GROUP BY ts
          ORDER BY ts
        `);
      } catch {
        diskResult = { data: [] };
      }
      
      // Transform results to chart format
      const transformData = (data: Array<{ ts: number; [key: string]: number }>, valueKey: string) => {
        if (!data || data.length === 0) return undefined;
        return {
          timestamps: data.map(d => d.ts * 1000), // Convert to milliseconds
          values: data.map(d => d[valueKey] || 0),
        };
      };
      
      return {
        queriesPerSecond: transformData(queriesResult.data as Array<{ ts: number; qps: number }>, 'qps'),
        memoryUsage: transformData(memoryResult.data as Array<{ ts: number; memory_gb: number }>, 'memory_gb'),
        cpuUsage: transformData(cpuResult.data as Array<{ ts: number; cpu_percent: number }>, 'cpu_percent'),
        diskIO: transformData(diskResult.data as Array<{ ts: number; io_wait_sec: number }>, 'io_wait_sec'),
      };
    },
    staleTime: 5000,
    ...options,
  });
}

/**
 * Hook to fetch users list
 */
export function useUsers(
  options?: Partial<UseQueryOptions<Array<{
    name: string;
    id: string;
    host_ip: string;
    host_names: string;
    default_roles_all: number;
    default_roles_list: string;
    default_roles_except: string;
  }>, Error>>
) {
  return useQuery({
    queryKey: ['users'] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT 
            name,
            id,
            host_ip,
            host_names,
            default_roles_all,
            default_roles_list,
            default_roles_except
          FROM system.users
        `);
      return result.data as Array<{
        name: string;
        id: string;
        host_ip: string;
        host_names: string;
        default_roles_all: number;
        default_roles_list: string;
        default_roles_except: string;
      }>;
    },
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to fetch user details
 */
export function useUserDetails(
  username: string,
  options?: Partial<UseQueryOptions<{
    name: string;
    host_ip: string;
    host_names: string;
    default_roles_all: number;
    default_roles_list: string;
  }, Error>>
) {
  return useQuery({
    queryKey: ['userDetails', username] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT 
            name,
            host_ip,
            host_names,
            default_roles_all,
            default_roles_list
          FROM system.users
          WHERE name = '${username}'
        `);
      return result.data[0] as {
        name: string;
        host_ip: string;
        host_names: string;
        default_roles_all: number;
        default_roles_list: string;
      };
    },
    enabled: !!username,
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to fetch server settings
 */
export function useSettings(
  options?: Partial<UseQueryOptions<Array<{
    name: string;
    value: string;
    changed: number;
    description: string;
    type: string;
  }>, Error>>
) {
  return useQuery({
    queryKey: ['settings'] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT 
            name,
            value,
            changed,
            description,
            type
          FROM system.settings
          ORDER BY name
        `);
      return result.data as Array<{
        name: string;
        value: string;
        changed: number;
        description: string;
        type: string;
      }>;
    },
    staleTime: 60000,
    ...options,
  });
}

