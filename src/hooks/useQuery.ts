/**
 * React Query Hooks for CHouse UI
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
import { log as appLog } from '@/lib/log';
import { escapeQualifiedIdentifier } from '@/helpers/sqlUtils';
import { useAuthStore } from '@/stores';
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
  systemStats: (connectionId?: string) => ['systemStats', connectionId] as const,
  recentQueries: (limit?: number, username?: string, connectionId?: string) => ['recentQueries', limit, username, connectionId] as const,
  productionMetrics: (interval: number, connectionId?: string) => ['productionMetrics', interval, connectionId] as const,
  topTables: (limit: number, connectionId?: string) => ['topTables', limit, connectionId] as const,

  // Saved Queries
  savedQueries: (connectionId?: string) => connectionId ? ['savedQueries', connectionId] as const : ['savedQueries'] as const,
  savedQueriesConnectionNames: ['savedQueriesConnectionNames'] as const,

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
 * Only fetches when there's an active ClickHouse connection
 */
export function useSystemStats(
  options?: Partial<UseQueryOptions<SystemStats, Error>>
) {
  // Check if there's an active connection (both connection ID and session)
  const { activeConnectionId, sessionId } = useAuthStore();
  const hasConnection = !!(activeConnectionId && sessionId);

  return useQuery({
    queryKey: queryKeys.systemStats(activeConnectionId || undefined),
    queryFn: metricsApi.getSystemStats,
    enabled: hasConnection, // Only fetch when connected
    refetchInterval: false,
    staleTime: 10000,
    ...options,
  });
}

/**
 * Hook to fetch recent queries
 * Only fetches when there's an active ClickHouse connection
 * @param limit - Number of queries to fetch
 * @param username - Optional username to filter by (for non-admin users)
 */
export function useRecentQueries(
  limit: number = 10,
  username?: string,
  options?: Partial<UseQueryOptions<RecentQuery[], Error>>
) {
  // Check if there's an active connection (both connection ID and session)
  const { activeConnectionId, sessionId } = useAuthStore();
  const hasConnection = !!(activeConnectionId && sessionId);

  return useQuery({
    queryKey: queryKeys.recentQueries(limit, username, activeConnectionId || undefined),
    queryFn: () => metricsApi.getRecentQueries(limit, username),
    enabled: hasConnection, // Only fetch when connected
    refetchInterval: false,
    staleTime: 5000,
    ...options,
  });
}

// ============================================
// Saved Queries Hooks
// ============================================

/**
 * Hook to fetch saved queries
 * Optionally filter by connection ID - if not provided, fetches all user's queries
 * Returns user's own queries and public queries from other users
 */
export function useSavedQueries(
  connectionId?: string,
  options?: Partial<UseQueryOptions<SavedQuery[], Error>>
) {
  return useQuery({
    queryKey: queryKeys.savedQueries(connectionId),
    queryFn: () => savedQueriesApi.getSavedQueries(connectionId),
    staleTime: 30000,
    ...options,
  });
}

/**
 * Hook to fetch unique connection names from user's saved queries
 * Used for the connection filter dropdown
 */
export function useSavedQueriesConnectionNames(
  options?: Partial<UseQueryOptions<string[], Error>>
) {
  return useQuery({
    queryKey: queryKeys.savedQueriesConnectionNames,
    queryFn: savedQueriesApi.getQueryConnectionNames,
    staleTime: 60000,
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
    onSuccess: (_data, variables) => {
      // Invalidate both the specific connection query and the general query
      if (variables.connectionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(variables.connectionId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries() });
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesConnectionNames });
    },
  });
}

/**
 * Hook to update a saved query
 */
export function useUpdateSavedQuery(connectionId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; query?: string; description?: string; isPublic?: boolean; connectionId?: string | null; connectionName?: string | null } }) =>
      savedQueriesApi.updateSavedQuery(id, input),
    onSuccess: () => {
      // Invalidate both the specific connection query and the general query
      if (connectionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(connectionId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries() });
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesConnectionNames });
    },
  });
}

/**
 * Hook to delete a saved query
 */
export function useDeleteSavedQuery(connectionId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savedQueriesApi.deleteSavedQuery,
    onSuccess: () => {
      // Invalidate both the specific connection query and the general query
      if (connectionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(connectionId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries() });
      queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesConnectionNames });
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
      // Validate and escape identifiers to prevent SQL injection
      const escapedTable = escapeQualifiedIdentifier([database, table]);
      const result = await queryApi.executeQuery(`DESCRIBE TABLE ${escapedTable}`);
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
 * @param username - Optional ClickHouse username to filter by (legacy, for backward compatibility)
 * @param rbacUserId - Optional RBAC user ID to filter by (for non-super-admin users)
 */
export function useQueryLogs(
  limit: number = 100,
  username?: string,
  rbacUserId?: string,
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
    rbacUser?: string | null;
    rbacUserId?: string | null;
    connectionId?: string | null;
    connectionName?: string;
    exception?: string;
  }>, Error>>
) {
  // Check if there's an active connection
  const { activeConnectionId } = useAuthStore();

  // Build user filter clause (legacy support for ClickHouse username)
  const userFilter = username ? `AND user = '${username}'` : '';

  return useQuery({
    queryKey: ['queryLogs', limit, username, rbacUserId, activeConnectionId] as const,
    queryFn: async () => {
      // Fetch query logs
      const result = await queryApi.executeQuery(`
          SELECT 
            type,
            event_date,
            formatDateTime(event_time, '%H:%i:%S') as event_time,
            toUnixTimestamp(__table1.event_time) as event_timestamp,
            query_id,
            query,
            query_duration_ms,
            read_rows,
            read_bytes,
            memory_usage,
            user,
            exception,
            Settings['log_comment'] as log_comment_json
          FROM system.query_log AS __table1
          WHERE event_date >= today() - 1
          AND type != 'QueryStart'
          ${userFilter}
          ORDER BY __table1.event_time DESC
          LIMIT ${limit}
        `);

      const logs = result.data.map((log: any) => ({
        type: log.type,
        event_date: log.event_date,
        event_time: log.event_time,
        event_timestamp: Number(log.event_timestamp),
        query_id: log.query_id,
        query: log.query,
        query_duration_ms: log.query_duration_ms,
        read_rows: log.read_rows,
        read_bytes: log.read_bytes,
        memory_usage: log.memory_usage,
        user: log.user,
        exception: log.exception,
        log_comment_json: log.log_comment_json,
      })) as Array<{
        type: string;
        event_date: string;
        event_time: string;
        event_timestamp: number;
        query_id: string;
        query: string;
        query_duration_ms: number;
        read_rows: number;
        read_bytes: number;
        memory_usage: number;
        user: string;
        exception?: string;
        log_comment_json?: string;
      }>;

      // Fetch audit logs for query execution to get RBAC users
      try {
        const { rbacAuditApi, rbacUsersApi, rbacConnectionsApi } = await import('@/api/rbac');

        // Fetch connections to map IDs to names
        // We fetch all connections to ensure we can resolve names even for connections the user might not currently have access to but were used in logs
        // Fetch connections to map IDs to names
        // We fetch all connections to ensure we can resolve names even for connections the user might not currently have access to but were used in logs
        // This is safe as we only display the name
        let connectionMap = new Map<string, string>();
        try {
          // Try to list all connections (requires super_admin)
          const { connections } = await rbacConnectionsApi.list({ limit: 1000 });
          connectionMap = new Map(connections.map(c => [c.id, c.name]));
        } catch (error) {
          // If listing all fails (e.g. not super_admin), try fetching user's accessible connections
          try {
            const myConnections = await rbacConnectionsApi.getMyConnections();
            connectionMap = new Map(myConnections.map(c => [c.id, c.name]));
          } catch (innerError) {
            appLog.warn('[QueryLogs] Failed to fetch connections for name resolution', innerError);
          }
        }

        // Fetch audit logs from the last 2 days to ensure we catch all queries
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

        // Fetch audit logs - optimize by fetching in larger batches
        // If rbacUserId is provided, only fetch audit logs for that user
        // Use a single large fetch instead of pagination to reduce API calls
        const auditResult = await rbacAuditApi.list({
          page: 1,
          limit: 5000, // Fetch up to 5k logs in one call (covers most use cases)
          action: 'clickhouse.query_execute',
          userId: rbacUserId, // Filter by RBAC user ID if provided
          startDate: twoDaysAgo.toISOString(),
        });

        const allAuditLogs = auditResult.logs;

        // Create a map of timestamp -> Array<{ userId, connectionId, query, usernameSnapshot, emailSnapshot, displayNameSnapshot }>
        // Match audit logs with query logs by timestamp (within 60 seconds for better matching)
        // Use the timestamp from audit log details if available, otherwise use createdAt
        const auditMap = new Map<number, Array<{
          userId: string | null,
          connectionId: string | null,
          query: string | null,
          usernameSnapshot?: string,
          emailSnapshot?: string,
          displayNameSnapshot?: string
        }>>();

        const userMap = new Map<string, { username: string; email: string; displayName: string | null }>();

        for (const auditLog of allAuditLogs) {
          if (auditLog.userId) {
            // Populate userMap from snapshots if available
            if (auditLog.usernameSnapshot && auditLog.emailSnapshot) {
              userMap.set(auditLog.userId, {
                username: auditLog.usernameSnapshot,
                email: auditLog.emailSnapshot,
                displayName: auditLog.displayNameSnapshot || null,
              });
            }
            // Prefer timestamp from details (stored when query was executed)
            // Fall back to createdAt if details.timestamp is not available
            const detailsTimestamp = auditLog.details?.timestamp as number | undefined;
            const connectionId = auditLog.details?.connectionId as string | undefined;
            const queryText = auditLog.details?.query as string | undefined;

            const auditTime = detailsTimestamp
              ? Math.floor(detailsTimestamp / 1000) // Convert from milliseconds to seconds
              : Math.floor(new Date(auditLog.createdAt).getTime() / 1000);

            // Store multiple timestamps around the audit time for better matching
            // Use a wider range (60 seconds) to account for query execution time and clock skew
            // Optimize: Only store every 5 seconds to reduce memory usage while maintaining accuracy
            // This reduces map entries from 121 to ~25 per audit log
            const data = {
              userId: auditLog.userId,
              connectionId: connectionId || null,
              query: queryText || null,
              usernameSnapshot: auditLog.usernameSnapshot || undefined,
              emailSnapshot: auditLog.emailSnapshot || undefined,
              displayNameSnapshot: auditLog.displayNameSnapshot || undefined
            };

            // Helper to add data to map array
            const addToMap = (time: number) => {
              const existing = auditMap.get(time) || [];
              existing.push(data);
              auditMap.set(time, existing);
            };

            for (let offset = -60; offset <= 60; offset += 5) {
              addToMap(auditTime + offset);
            }
            // Also store exact timestamp for precise matching
            addToMap(auditTime);
          }
        }

        // Debug logging (can be removed in production or made conditional)
        if (process.env.NODE_ENV === 'development') {
          appLog.debug('[QueryLogs] Audit logs found', { count: allAuditLogs.length, uniqueUsers: new Set(allAuditLogs.map(l => l.userId).filter(Boolean)).size, rbacUserId });
        }

        // Get unique user IDs to fetch user details (from both Audit Logs and log_comment)
        const auditUserIds = Array.from(auditMap.values()).flat().map(d => d.userId).filter(Boolean) as string[];
        const logCommentUserIds = logs.map(l => {
          try {
            if (l.log_comment_json) {
              const parsed = JSON.parse(l.log_comment_json);
              return parsed.rbac_user_id;
            }
          } catch (e) { return null; }
          return null;
        }).filter(Boolean) as string[];

        const uniqueUserIds = Array.from(new Set([...auditUserIds, ...logCommentUserIds]));
        // Fetch user details in parallel ONLY for users not already in userMap (from snapshots)
        await Promise.all(
          uniqueUserIds
            .filter(userId => !userMap.has(userId))
            .map(async (userId) => {
              try {
                const user = await rbacUsersApi.get(userId);
                userMap.set(userId, {
                  username: user.username,
                  email: user.email,
                  displayName: user.displayName,
                });
              } catch (error) {
                // If the user fetching fails (e.g. 404), we still might have basic info from logs or can just skip
                appLog.warn('Failed to fetch user details', { userId, error });
              }
            })
        );

        // Match query logs with audit logs
        let matchedCount = 0;
        let unmatchedCount = 0;
        const matchedLogs = logs
          .map(log => {
            const queryTime = log.event_timestamp;
            // Try to find matching audit log within 60 seconds (wider window for better matching)
            // Optimize: Check exact match first, then check ±5 second intervals
            let rbacUserId: string | null | undefined = undefined;
            let connectionId: string | null | undefined = undefined;
            let rbacUserInfo: { username: string; email: string; displayName: string | null } | undefined = undefined;

            // Find best match among candidates
            const findBestMatch = (candidates: Array<{
              userId: string | null,
              connectionId: string | null,
              query: string | null,
              usernameSnapshot?: string,
              emailSnapshot?: string,
              displayNameSnapshot?: string
            }>) => {
              // 1. Try to match by query text content
              // The audit log stores truncated query (500 chars), so check if log.query starts with or includes it
              const queryMatch = candidates.find(c => c.query && log.query.includes(c.query));
              if (queryMatch) return queryMatch;

              // 2. If no query match (or no query text in audit), return first candidate
              // This falls back to timestamp-only matching
              return candidates[0];
            };

            // First try exact match (most common case)
            if (auditMap.has(queryTime)) {
              const candidates = auditMap.get(queryTime);
              if (candidates && candidates.length > 0) {
                const match = findBestMatch(candidates);
                rbacUserId = match.userId || null;
                connectionId = match.connectionId || null;
              }
            } else {
              // Then try ±5 second intervals (matches our optimized storage)
              for (let offset = -60; offset <= 60; offset += 5) {
                const key = queryTime + offset;
                if (auditMap.has(key)) {
                  const candidates = auditMap.get(key);
                  if (candidates && candidates.length > 0) {
                    const match = findBestMatch(candidates);
                    rbacUserId = match.userId || null;
                    connectionId = match.connectionId || null;
                    break;
                  }
                }
              }
            }

            // Priority: Check log_comment for RBAC User ID
            if (log.log_comment_json) {
              try {
                const parsed = JSON.parse(log.log_comment_json);
                if (parsed.rbac_user_id) {
                  rbacUserId = parsed.rbac_user_id;
                }
              } catch (e) { }
            }


            if (rbacUserId && userMap.has(rbacUserId)) {
              rbacUserInfo = userMap.get(rbacUserId);
              matchedCount++;
            }

            // Track unmatched queries for debugging
            if (!rbacUserId) {
              unmatchedCount++;
              if (process.env.NODE_ENV === 'development' && unmatchedCount <= 5) {
                appLog.debug('[QueryLogs] Unmatched query', {
                  query_id: log.query_id,
                  queryTime,
                  user: log.user,
                  event_time: log.event_time,
                  query_preview: log.query?.substring(0, 100),
                });
              }
            }

            return {
              type: log.type,
              event_date: log.event_date,
              event_time: log.event_time,
              query_id: log.query_id,
              query: log.query,
              query_duration_ms: log.query_duration_ms,
              read_rows: log.read_rows,
              read_bytes: log.read_bytes,
              memory_usage: log.memory_usage,
              user: log.user,
              rbacUser: rbacUserInfo ? (rbacUserInfo.displayName || rbacUserInfo.username || rbacUserInfo.email) : (rbacUserId || undefined),
              rbacUserId: rbacUserId,
              connectionId,
              connectionName: connectionId ? connectionMap.get(connectionId) : undefined,
              exception: log.exception,
            };
          })
          .filter(log => {
            // If rbacUserId filter is provided, only return logs that have a matching RBAC user
            // This ensures non-super-admin users only see their own logs
            if (rbacUserId) {
              // Only show logs that have been successfully matched to this user's audit logs
              // If a log doesn't have rbacUserId, it means it wasn't matched, so exclude it
              return log.rbacUserId === rbacUserId;
            }
            // Super-admin sees all logs (including those without RBAC user match)
            return true;
          });

        const filteredCount = matchedLogs.length;
        // Debug logging (can be removed in production or made conditional)
        if (process.env.NODE_ENV === 'development') {
          appLog.debug('[QueryLogs] Matched logs', { matchedCount, total: logs.length, unmatchedCount, rbacUserId, filteredCount });
        }
        return matchedLogs;
      } catch (error) {
        // If audit log fetch fails and rbacUserId is provided, return empty array
        // (non-admin users should only see their own logs, which require audit log matching)
        appLog.warn('Failed to fetch RBAC user info', error);
        if (rbacUserId) {
          // For non-admin users, if we can't match audit logs, return empty array
          // This ensures they don't see logs they shouldn't have access to
          return [];
        }
        // For super-admin or when no rbacUserId filter, return logs without RBAC user
        return logs.map(log => ({
          type: log.type,
          event_date: log.event_date,
          event_time: log.event_time,
          query_id: log.query_id,
          query: log.query,
          query_duration_ms: log.query_duration_ms,
          read_rows: log.read_rows,
          read_bytes: log.read_bytes,
          memory_usage: log.memory_usage,
          user: log.user,
          rbacUser: undefined,
          rbacUserId: undefined,
          connectionName: undefined,
          exception: log.exception,
        }));
      }
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
      memoryTotal: number;
      memoryPercentage: number;
      cpuLoad: number;
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
      totalRows: number;
      totalBytes: number;
    };
  }, Error>>
) {
  // Check if there's an active connection (both connection ID and session)
  const { activeConnectionId, sessionId } = useAuthStore();
  const hasConnection = !!(activeConnectionId && sessionId);

  return useQuery({
    queryKey: ['metrics', timeRange, activeConnectionId] as const,
    enabled: hasConnection, // Only fetch when connected
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
          appLog.warn('Metrics query failed', error);
          return [];
        }
      };

      // Fetch query counts by type per minute
      // For failed queries, we count:
      // 1. ExceptionWhileProcessing entries
      // 2. ExceptionBeforeStart entries
      // 3. QueryFinish entries with exception_code != 0
      // 4. QueryStart entries with exception field (non-empty)
      // This matches the logic used in the Logs page
      const queriesData = await safeQuery(`
        SELECT 
          toUnixTimestamp(toStartOfMinute(event_time)) as ts,
          countIf(query_kind = 'Select' AND type = 'QueryFinish') as select_count,
          countIf(query_kind = 'Insert' AND type = 'QueryFinish') as insert_count,
          countIf(
            type = 'ExceptionWhileProcessing'
            OR type = 'ExceptionBeforeStart'
            OR (type = 'QueryFinish' AND exception_code != 0)
            OR (type = 'QueryStart' AND length(exception) > 0)
          ) as failed_count,
          countIf(type = 'QueryFinish') as total_count
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL ${interval}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart', 'QueryStart')
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
        count: Number((d as { failed_count: number }).failed_count) || 0,
      }));

      // Fetch current server stats (single values, very lightweight)
      // Optimized: Fetch all stats in a single query to reduce HTTP overhead
      let currentStats = {
        memoryUsage: 0,
        memoryTotal: 0,
        memoryPercentage: 0,
        cpuLoad: 0,
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
        totalRows: 0,
        totalBytes: 0,
      };

      try {
        const statsResult = await safeQuery(`
          SELECT
            (SELECT value / 1073741824 FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' LIMIT 1) as memoryUsage,
            (SELECT value / 1073741824 FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1) as memoryTotal,
            (SELECT avg(ProfileEvent_OSCPUVirtualTimeMicroseconds) / 1000000 
             FROM system.metric_log 
             WHERE event_time >= now() - INTERVAL ${interval}) as cpuLoad,
            (SELECT count() FROM system.processes) as activeQueries,
            (SELECT sum(value) FROM system.metrics WHERE metric IN ('TCPConnection', 'HTTPConnection')) as connections,
            (SELECT value FROM system.asynchronous_metrics WHERE metric = 'Uptime' LIMIT 1) as uptime,
            (SELECT sum(rows) FROM system.parts WHERE active) as totalRows,
            (SELECT sum(bytes_on_disk) FROM system.parts WHERE active) as totalBytes,
            (SELECT count() FROM system.databases) as databasesCount,
            (SELECT count() FROM system.tables WHERE database NOT IN ('system', 'information_schema')) as tablesCount,
            (SELECT count() FROM system.parts WHERE active) as partsCount
        `);
        if (statsResult.length > 0) {
          const row = statsResult[0] as Record<string, number>;
          currentStats.memoryUsage = Number(row.memoryUsage) || 0;
          currentStats.memoryTotal = Number(row.memoryTotal) || 0;
          currentStats.memoryPercentage = currentStats.memoryTotal > 0 ? (currentStats.memoryUsage / currentStats.memoryTotal) * 100 : 0;
          currentStats.cpuLoad = Number(row.cpuLoad) || 0;
          currentStats.activeQueries = Number(row.activeQueries) || 0;
          currentStats.connections = Number(row.connections) || 0;
          currentStats.uptime = Number(row.uptime) || 0;
          currentStats.partsCount = Number(row.partsCount) || 0;

          // Consistent metrics (matched with Server logic)
          currentStats.totalRows = Number(row.totalRows) || 0;
          currentStats.totalBytes = Number(row.totalBytes) || 0;
          currentStats.databasesCount = Number(row.databasesCount) || 0;
          currentStats.tablesCount = Number(row.tablesCount) || 0;
        }

        // Calculate totals from time series
        currentStats.totalQueries = sortedData.reduce((sum, d) => sum + Number((d as { total_count: number }).total_count), 0);
        currentStats.failedQueries = sortedData.reduce((sum, d) => sum + Number((d as { failed_count: number }).failed_count), 0);
      } catch (error) {
        appLog.warn('Failed to fetch current stats', error);
        // Ignore - will use defaults
      }

      // Transform results to chart format
      const transformData = (data: Array<{ ts: number;[key: string]: number }>, valueKey: string) => {
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
 * Hook to fetch production-grade metrics
 * Fetches all production metrics in one optimized API call
 * Only fetches when there's an active ClickHouse connection
 */
export function useProductionMetrics(
  intervalMinutes: number = 60,
  options?: Partial<UseQueryOptions<metricsApi.ProductionMetrics, Error>>
) {
  // Check if there's an active connection (both connection ID and session)
  const { activeConnectionId, sessionId } = useAuthStore();
  const hasConnection = !!(activeConnectionId && sessionId);

  return useQuery({
    queryKey: queryKeys.productionMetrics(intervalMinutes, activeConnectionId || undefined),
    queryFn: () => metricsApi.getProductionMetrics(intervalMinutes),
    enabled: hasConnection, // Only fetch when connected
    staleTime: 30000,
    gcTime: 60000,
    retry: false,
    refetchOnWindowFocus: false,
    ...options,
  });
}

/**
 * Hook to fetch top tables by size
 */
export function useTopTables(
  limit: number = 10,
  options?: Partial<UseQueryOptions<metricsApi.TopTableBySize[], Error>>
) {
  // Check if there's an active connection
  const { activeConnectionId, sessionId } = useAuthStore();
  const hasConnection = !!(activeConnectionId && sessionId);

  return useQuery({
    queryKey: queryKeys.topTables(limit, activeConnectionId || undefined),
    queryFn: () => metricsApi.getTopTables(limit),
    enabled: hasConnection,
    staleTime: 60000,
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

