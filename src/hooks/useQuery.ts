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
import { explorerApi, metricsApi, savedQueriesApi, queryApi, configApi } from '@/api';
import type {
  DatabaseInfo,
  TableDetails,
  SystemStats,
  RecentQuery,
  SavedQuery,
  IntellisenseData,
  QueryResult,
  AppConfig,
} from '@/api';

// ============================================
// Query Keys
// ============================================

export const queryKeys = {
  // Config
  config: ['config'] as const,

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
// Config Hooks
// ============================================

/**
 * Hook to fetch public app configuration
 * This fetches server-side environment variables for use in the frontend
 */
export function useConfig(options?: Partial<UseQueryOptions<AppConfig, Error>>) {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: configApi.getConfig,
    staleTime: Infinity, // Config doesn't change during session
    gcTime: Infinity,
    retry: 1,
    ...options,
  });
}

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
 * @param limit - Number of queries to fetch
 * @param username - Optional username to filter by (for non-admin users)
 */
export function useRecentQueries(
  limit: number = 10,
  username?: string,
  options?: Partial<UseQueryOptions<RecentQuery[], Error>>
) {
  return useQuery({
    queryKey: ['recentQueries', limit, username] as const,
    queryFn: () => metricsApi.getRecentQueries(limit, username),
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
/**
 * Hook to fetch query logs
 * @param limit - Number of logs to fetch
 * @param username - Optional username to filter by (for non-admin users)
 */
export function useQueryLogs(
  limit: number = 100,
  username?: string,
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
  // Build user filter clause
  const userFilter = username ? `AND user = '${username}'` : '';
  
  return useQuery({
    queryKey: ['queryLogs', limit, username] as const,
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
          ${userFilter}
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
 * Uses simple, stable queries that work across ClickHouse versions
 */
export function useMetrics(
  timeRange: string = "1h",
  options?: Partial<UseQueryOptions<{
    // Time series data
    queriesPerSecond?: { timestamps: number[]; values: number[] };
    selectQueries?: { timestamps: number[]; values: number[] };
    insertQueries?: { timestamps: number[]; values: number[] };
    failedQueries?: { timestamps: number[]; values: number[] };
    // Current values
    currentStats?: {
      memoryUsage: number;
      activeQueries: number;
      connections: number;
      uptime: number;
      totalQueries: number;
      failedQueries: number;
      partsCount: number;
      databasesCount: number;
      tablesCount: number;
      replicasOk: number;
      replicasTotal: number;
    };
  }, Error>>
) {
  return useQuery({
    queryKey: ['metrics', timeRange] as const,
    queryFn: async () => {
      // Convert timeRange to interval for query
      const config: Record<string, { interval: string; limit: number }> = {
        '15m': { interval: '15 MINUTE', limit: 15 },
        '1h': { interval: '1 HOUR', limit: 60 },
        '6h': { interval: '6 HOUR', limit: 100 },
        '24h': { interval: '24 HOUR', limit: 100 },
      };
      const { interval, limit } = config[timeRange] || config['1h'];
      
      // Helper to safely execute queries
      const safeQuery = async (query: string): Promise<Record<string, unknown>[]> => {
        try {
          const result = await queryApi.executeQuery(query);
          return (result.data as Record<string, unknown>[]) || [];
        } catch (error) {
          console.warn('Metrics query failed:', error);
          return [];
        }
      };
      
      // Fetch query counts by type per minute
      const queriesData = await safeQuery(`
        SELECT 
          toUnixTimestamp(toStartOfMinute(event_time)) as ts,
          countIf(query_kind = 'Select') as select_count,
          countIf(query_kind = 'Insert') as insert_count,
          countIf(exception_code != 0) as failed_count,
          count() as total_count
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL ${interval}
          AND type = 'QueryFinish'
        GROUP BY ts
        ORDER BY ts DESC
        LIMIT ${limit}
      `);
      
      // Reverse to get chronological order
      const sortedData = [...queriesData].reverse();
      
      // Transform to individual metrics
      const qpsData = sortedData.map((d) => ({
        ts: Number((d as { ts: number }).ts),
        qps: Number((d as { total_count: number }).total_count) / 60,
      }));
      
      const selectData = sortedData.map((d) => ({
        ts: Number((d as { ts: number }).ts),
        count: Number((d as { select_count: number }).select_count) / 60,
      }));
      
      const insertData = sortedData.map((d) => ({
        ts: Number((d as { ts: number }).ts),
        count: Number((d as { insert_count: number }).insert_count) / 60,
      }));
      
      const failedData = sortedData.map((d) => ({
        ts: Number((d as { ts: number }).ts),
        count: Number((d as { failed_count: number }).failed_count),
      }));
      
      // Fetch current server stats (single values, very lightweight)
      let currentStats = {
        memoryUsage: 0,
        activeQueries: 0,
        connections: 0,
        uptime: 0,
        totalQueries: 0,
        failedQueries: 0,
        partsCount: 0,
        databasesCount: 0,
        tablesCount: 0,
        replicasOk: 0,
        replicasTotal: 0,
      };
      
      try {
        // Memory from asynchronous_metrics
        const memResult = await safeQuery(`
          SELECT value / 1073741824 as val
          FROM system.asynchronous_metrics
          WHERE metric = 'MemoryResident'
          LIMIT 1
        `);
        if (memResult.length > 0) {
          currentStats.memoryUsage = Number((memResult[0] as { val: number }).val) || 0;
        }
        
        // Active queries from system.processes
        const activeResult = await safeQuery(`SELECT count() as cnt FROM system.processes`);
        if (activeResult.length > 0) {
          currentStats.activeQueries = Number((activeResult[0] as { cnt: number }).cnt) || 0;
        }
        
        // Connections from system.metrics
        const connResult = await safeQuery(`
          SELECT value as val FROM system.metrics WHERE metric = 'TCPConnection' LIMIT 1
        `);
        if (connResult.length > 0) {
          currentStats.connections = Number((connResult[0] as { val: number }).val) || 0;
        }
        
        // Uptime from system.uptime
        const uptimeResult = await safeQuery(`SELECT value as val FROM system.asynchronous_metrics WHERE metric = 'Uptime' LIMIT 1`);
        if (uptimeResult.length > 0) {
          currentStats.uptime = Number((uptimeResult[0] as { val: number }).val) || 0;
        }
        
        // Database and table counts
        const dbResult = await safeQuery(`SELECT count() as cnt FROM system.databases WHERE name NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')`);
        if (dbResult.length > 0) {
          currentStats.databasesCount = Number((dbResult[0] as { cnt: number }).cnt) || 0;
        }
        
        const tableResult = await safeQuery(`SELECT count() as cnt FROM system.tables WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')`);
        if (tableResult.length > 0) {
          currentStats.tablesCount = Number((tableResult[0] as { cnt: number }).cnt) || 0;
        }
        
        // Parts count (for MergeTree health)
        const partsResult = await safeQuery(`SELECT count() as cnt FROM system.parts WHERE active`);
        if (partsResult.length > 0) {
          currentStats.partsCount = Number((partsResult[0] as { cnt: number }).cnt) || 0;
        }
        
        // Calculate totals from time series
        currentStats.totalQueries = sortedData.reduce((sum, d) => sum + Number((d as { total_count: number }).total_count), 0);
        currentStats.failedQueries = sortedData.reduce((sum, d) => sum + Number((d as { failed_count: number }).failed_count), 0);
        
      } catch {
        // Ignore - will use defaults
      }
      
      // Transform results to chart format
      const transformData = (data: Array<{ ts: number; [key: string]: number }>, valueKey: string) => {
        if (!data || data.length === 0) return undefined;
        return {
          timestamps: data.map(d => Number(d.ts)),
          values: data.map(d => Number(d[valueKey]) || 0),
        };
      };
      
      return {
        queriesPerSecond: transformData(qpsData, 'qps'),
        selectQueries: transformData(selectData, 'count'),
        insertQueries: transformData(insertData, 'count'),
        failedQueries: transformData(failedData, 'count'),
        currentStats,
      };
    },
    staleTime: 30000,
    gcTime: 60000,
    retry: false,
    refetchOnWindowFocus: false,
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

/**
 * Hook to fetch available clusters
 */
export function useClusters(
  options?: Partial<UseQueryOptions<Array<{
    cluster: string;
    shard_num: number;
    replica_num: number;
    host_name: string;
    host_address: string;
    port: number;
  }>, Error>>
) {
  return useQuery({
    queryKey: ['clusters'] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT DISTINCT
            cluster,
            shard_num,
            replica_num,
            host_name,
            host_address,
            port
          FROM system.clusters
          ORDER BY cluster, shard_num, replica_num
        `);
      return result.data as Array<{
        cluster: string;
        shard_num: number;
        replica_num: number;
        host_name: string;
        host_address: string;
        port: number;
      }>;
    },
    staleTime: 60000,
    ...options,
  });
}

/**
 * Hook to fetch unique cluster names
 */
export function useClusterNames(
  options?: Partial<UseQueryOptions<string[], Error>>
) {
  return useQuery({
    queryKey: ['clusterNames'] as const,
    queryFn: async () => {
      const result = await queryApi.executeQuery(`
          SELECT DISTINCT cluster FROM system.clusters ORDER BY cluster
        `);
      return (result.data as Array<{ cluster: string }>).map((row) => row.cluster);
    },
    staleTime: 60000,
    ...options,
  });
}

