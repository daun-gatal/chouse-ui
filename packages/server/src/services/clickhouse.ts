import { createClient, ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import type { 
  ConnectionConfig, 
  QueryResult, 
  DatabaseInfo, 
  TableDetails,
  SystemStats,
  RecentQuery,
  ColumnInfo,
  SavedQuery,
} from "../types";
import { AppError } from "../types";

// ============================================
// Types for ClickHouse JSON Response
// ============================================

// JSON format returns { data: T[], meta: [...], statistics: {...}, rows: number }
interface JsonResponse<T> {
  data: T[];
  meta?: { name: string; type: string }[];
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
  rows?: number;
}

// Helper to extract data from JSON response
function extractData<T>(response: JsonResponse<T>): T[] {
  return response.data;
}

// ============================================
// ClickHouse Service
// ============================================

export class ClickHouseService {
  private client: ClickHouseClient;
  private config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
    this.client = createClient({
      url: config.url,
      username: config.username,
      password: config.password || "",
      database: config.database,
      request_timeout: 300000,
      clickhouse_settings: {
        max_result_rows: "10000",
        max_result_bytes: "10000000",
        result_overflow_mode: "break",
      } as ClickHouseSettings,
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  // ============================================
  // Connection & Health
  // ============================================

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result.success;
    } catch (error) {
      throw this.handleError(error, "Failed to ping ClickHouse server");
    }
  }

  async getVersion(): Promise<string> {
    try {
      const result = await this.client.query({ query: "SELECT version()" });
      const response = await result.json() as JsonResponse<{ "version()": string }>;
      return response.data[0]?.["version()"] || "unknown";
    } catch (error) {
      throw this.handleError(error, "Failed to get version");
    }
  }

  async checkIsAdmin(): Promise<{ isAdmin: boolean; permissions: string[] }> {
    try {
      const result = await this.client.query({
        query: `SELECT access_type, database, table FROM system.grants WHERE user_name = currentUser()`,
        format: "JSONEachRow",
      });
      // JSONEachRow format returns an array directly
      const grants = await result.json() as { access_type: string; database?: string | null; table?: string | null }[];
      
      const permissions = grants.map(g => g.access_type);
      
      const isAdmin = grants.some(g => {
        const isGlobal = (!g.database || g.database === "") && (!g.table || g.table === "");
        if (g.access_type === "ALL" && isGlobal) return true;
        if (g.access_type.includes("ALL") && isGlobal) return true;
        if (g.access_type === "CREATE USER") return true;
        if (g.access_type === "ACCESS MANAGEMENT") return true;
        return false;
      });

      return { isAdmin, permissions };
    } catch (error) {
      console.error("Failed to check admin status:", error);
      return { isAdmin: false, permissions: [] };
    }
  }

  // ============================================
  // Query Execution
  // ============================================

  async executeQuery<T = Record<string, unknown>>(
    query: string,
    format: string = "JSON"
  ): Promise<QueryResult<T>> {
    try {
      const trimmedQuery = query.trim();
      
      // Check if it's a command (CREATE, INSERT, ALTER, DROP, etc.)
      if (this.isCommand(trimmedQuery)) {
        await this.client.command({ query: trimmedQuery });
        return {
          meta: [],
          data: [],
          statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
          rows: 0,
          error: null,
        };
      }

      const result = await this.client.query({
        query: trimmedQuery,
        format: format as "JSON" | "JSONEachRow",
      });

      const jsonResult = await result.json() as {
        meta?: { name: string; type: string }[];
        data?: T[];
        statistics?: { elapsed: number; rows_read: number; bytes_read: number };
        rows?: number;
      };

      return {
        meta: jsonResult.meta || [],
        data: jsonResult.data || [],
        statistics: jsonResult.statistics || { elapsed: 0, rows_read: 0, bytes_read: 0 },
        rows: jsonResult.rows || (jsonResult.data?.length ?? 0),
        error: null,
      };
    } catch (error) {
      throw this.handleError(error, "Query execution failed");
    }
  }

  private isCommand(query: string): boolean {
    const commandPatterns = [
      /^\s*CREATE\s+/i,
      /^\s*INSERT\s+/i,
      /^\s*ALTER\s+/i,
      /^\s*DROP\s+/i,
      /^\s*TRUNCATE\s+/i,
      /^\s*RENAME\s+/i,
      /^\s*OPTIMIZE\s+/i,
      /^\s*ATTACH\s+/i,
      /^\s*DETACH\s+/i,
      /^\s*GRANT\s+/i,
      /^\s*REVOKE\s+/i,
    ];
    return commandPatterns.some(pattern => pattern.test(query));
  }

  // ============================================
  // Database Explorer
  // ============================================

  async getDatabasesAndTables(): Promise<DatabaseInfo[]> {
    try {
      // Enhanced query to include table metadata (rows, size, engine)
      const result = await this.client.query({
        query: `
          SELECT
            databases.name AS database_name,
            tables.name AS table_name,
            tables.engine AS table_engine,
            CASE 
              WHEN tables.total_rows > 0 THEN formatReadableQuantity(tables.total_rows)
              ELSE '0'
            END AS total_rows,
            CASE 
              WHEN tables.total_bytes > 0 THEN formatReadableSize(tables.total_bytes)
              ELSE '0 B'
            END AS total_bytes
          FROM system.databases AS databases
          LEFT JOIN system.tables AS tables
            ON databases.name = tables.database
          ORDER BY database_name, table_name
        `,
      });

      const response = await result.json() as JsonResponse<{
        database_name: string;
        table_name?: string;
        table_engine?: string;
        total_rows?: string;
        total_bytes?: string;
      }>;

      const databases: Record<string, DatabaseInfo> = {};

      for (const row of response.data) {
        const { database_name, table_name, table_engine, total_rows, total_bytes } = row;
        
        if (!databases[database_name]) {
          databases[database_name] = {
            name: database_name,
            type: "database",
            children: [],
          };
        }

        if (table_name) {
          const isView = table_engine?.toLowerCase().includes('view') || false;
          databases[database_name].children.push({
            name: table_name,
            type: isView ? "view" : "table",
            engine: table_engine || undefined,
            rows: total_rows || undefined,
            size: total_bytes || undefined,
          });
        }
      }

      return Object.values(databases);
    } catch (error) {
      throw this.handleError(error, "Failed to fetch databases");
    }
  }

  async getTableDetails(database: string, table: string): Promise<TableDetails> {
    try {
      // Get table info
      const tableInfoResult = await this.client.query({
        query: `
          SELECT 
            database,
            name as table,
            engine,
            formatReadableQuantity(total_rows) as total_rows,
            formatReadableSize(total_bytes) as total_bytes,
            create_table_query
          FROM system.tables 
          WHERE database = '${database}' AND name = '${table}'
        `,
      });
      const tableInfoResponse = await tableInfoResult.json() as JsonResponse<{
        database: string;
        table: string;
        engine: string;
        total_rows: string;
        total_bytes: string;
        create_table_query: string;
      }>;

      // Get columns
      const columnsResult = await this.client.query({
        query: `
          SELECT 
            name,
            type,
            default_kind,
            default_expression,
            comment
          FROM system.columns 
          WHERE database = '${database}' AND table = '${table}'
          ORDER BY position
        `,
      });
      const columnsResponse = await columnsResult.json() as JsonResponse<ColumnInfo>;

      const info = tableInfoResponse.data[0];
      return {
        database: info?.database || database,
        table: info?.table || table,
        engine: info?.engine || "",
        total_rows: info?.total_rows || "0",
        total_bytes: info?.total_bytes || "0 B",
        columns: columnsResponse.data,
        create_table_query: info?.create_table_query || "",
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch table details");
    }
  }

  async getTableSample(database: string, table: string, limit: number = 100): Promise<QueryResult> {
    return this.executeQuery(`SELECT * FROM ${database}.${table} LIMIT ${limit}`);
  }

  // ============================================
  // System Stats & Metrics
  // ============================================

  async getSystemStats(): Promise<SystemStats> {
    try {
      const [
        versionRes,
        uptimeRes,
        dbCountRes,
        tableCountRes,
        sizeRes,
        memRes,
        cpuRes,
        connRes,
        activeQueriesRes,
      ] = await Promise.all([
        this.client.query({ query: "SELECT version()" }),
        this.client.query({ query: "SELECT uptime()" }),
        this.client.query({ query: "SELECT count() FROM system.databases" }),
        this.client.query({ query: "SELECT count() FROM system.tables WHERE database NOT IN ('system', 'information_schema')" }),
        this.client.query({ query: "SELECT formatReadableSize(sum(bytes_on_disk)) as size, sum(rows) as rows FROM system.parts WHERE active" }),
        this.client.query({ query: "SELECT formatReadableSize(value) as mem FROM system.metrics WHERE metric = 'MemoryTracking'" }),
        this.client.query({ query: "SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSCPULoad' LIMIT 1" }),
        this.client.query({ query: "SELECT value FROM system.metrics WHERE metric = 'TCPConnection'" }),
        this.client.query({ query: "SELECT count() as cnt FROM system.processes" }),
      ]);

      // Note: .json() returns { data: [...], meta: [...], ... }, extract the data array
      const version = await versionRes.json() as JsonResponse<{ "version()": string }>;
      const uptime = await uptimeRes.json() as JsonResponse<{ "uptime()": number }>;
      const dbCount = await dbCountRes.json() as JsonResponse<{ "count()": number }>;
      const tableCount = await tableCountRes.json() as JsonResponse<{ "count()": number }>;
      const sizeData = await sizeRes.json() as JsonResponse<{ size: string; rows: string }>;
      const memData = await memRes.json() as JsonResponse<{ mem: string }>;
      const cpuData = await cpuRes.json() as JsonResponse<{ value: number }>;
      const connData = await connRes.json() as JsonResponse<{ value: number }>;
      const activeQueriesData = await activeQueriesRes.json() as JsonResponse<{ cnt: number }>;

      return {
        version: version.data[0]?.["version()"] || "-",
        uptime: uptime.data[0]?.["uptime()"] || 0,
        databaseCount: Number(dbCount.data[0]?.["count()"] || 0),
        tableCount: Number(tableCount.data[0]?.["count()"] || 0),
        totalRows: this.formatLargeNumber(Number(sizeData.data[0]?.rows || 0)),
        totalSize: sizeData.data[0]?.size || "0 B",
        memoryUsage: memData.data[0]?.mem || "0 B",
        cpuLoad: Number(cpuData.data[0]?.value || 0),
        activeConnections: Number(connData.data[0]?.value || 0),
        activeQueries: Number(activeQueriesData.data[0]?.cnt || 0),
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch system stats");
    }
  }

  /**
   * Get recent queries from query log
   * @param limit - Number of queries to fetch
   * @param username - Optional username to filter by (for non-admin users)
   */
  async getRecentQueries(limit: number = 10, username?: string): Promise<RecentQuery[]> {
    try {
      // Build user filter clause if username is provided
      const userFilter = username ? `AND user = '${username.replace(/'/g, "''")}'` : '';
      
      const result = await this.client.query({
        query: `
          SELECT 
            query, 
            query_duration_ms, 
            type, 
            event_time 
          FROM system.query_log 
          WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing') 
          ${userFilter}
          ORDER BY event_time DESC 
          LIMIT ${limit}
        `,
        format: "JSONEachRow",
      });

      // JSONEachRow format returns an array directly
      const queries = await result.json() as {
        query: string;
        query_duration_ms: number;
        type: string;
        event_time: string;
      }[];

      return queries.map(q => ({
        query: q.query,
        duration: q.query_duration_ms,
        status: q.type === "QueryFinish" ? "Success" : "Error",
        time: q.event_time,
      }));
    } catch (error) {
      throw this.handleError(error, "Failed to fetch recent queries");
    }
  }

  // ============================================
  // Production Metrics
  // ============================================

  /**
   * Get query latency percentiles (p50, p95, p99)
   */
  async getQueryLatencyMetrics(intervalMinutes: number = 60): Promise<import("../types").QueryLatencyMetrics> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            quantile(0.50)(query_duration_ms) as p50_ms,
            quantile(0.95)(query_duration_ms) as p95_ms,
            quantile(0.99)(query_duration_ms) as p99_ms,
            max(query_duration_ms) as max_ms,
            avg(query_duration_ms) as avg_ms,
            countIf(query_duration_ms > 1000) as slow_queries_count
          FROM system.query_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
            AND type = 'QueryFinish'
            AND query_kind IN ('Select', 'Insert')
        `,
      });
      const response = await result.json() as JsonResponse<{
        p50_ms: number;
        p95_ms: number;
        p99_ms: number;
        max_ms: number;
        avg_ms: number;
        slow_queries_count: number;
      }>;
      
      const data = response.data[0] || {};
      return {
        p50_ms: Number(data.p50_ms) || 0,
        p95_ms: Number(data.p95_ms) || 0,
        p99_ms: Number(data.p99_ms) || 0,
        max_ms: Number(data.max_ms) || 0,
        avg_ms: Number(data.avg_ms) || 0,
        slow_queries_count: Number(data.slow_queries_count) || 0,
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch query latency metrics");
    }
  }

  /**
   * Get disk space usage metrics
   */
  async getDiskMetrics(): Promise<import("../types").DiskMetrics[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            name,
            path,
            free_space,
            total_space,
            total_space - free_space as used_space,
            round((1 - free_space / total_space) * 100, 2) as used_percent
          FROM system.disks
        `,
      });
      const response = await result.json() as JsonResponse<{
        name: string;
        path: string;
        free_space: string;
        total_space: string;
        used_space: string;
        used_percent: number;
      }>;
      
      return response.data.map(d => ({
        name: d.name,
        path: d.path,
        free_space: Number(d.free_space),
        total_space: Number(d.total_space),
        used_space: Number(d.used_space),
        used_percent: Number(d.used_percent),
      }));
    } catch (error) {
      throw this.handleError(error, "Failed to fetch disk metrics");
    }
  }

  /**
   * Get merge and mutation metrics
   */
  async getMergeMetrics(): Promise<import("../types").MergeMetrics> {
    try {
      // Run queries with individual error handling for compatibility
      const safeQuery = async <T>(query: string, defaultValue: T): Promise<T> => {
        try {
          const result = await this.client.query({ query });
          const response = await result.json() as JsonResponse<T>;
          return response.data[0] || defaultValue;
        } catch {
          return defaultValue;
        }
      };

      const [activeMerges, mergeQueue, mutations, parts, maxParts] = await Promise.all([
        safeQuery<{ value: number }>("SELECT value FROM system.metrics WHERE metric = 'Merge'", { value: 0 }),
        safeQuery<{ cnt: number }>("SELECT count() as cnt FROM system.merges", { cnt: 0 }),
        safeQuery<{ cnt: number }>("SELECT count() as cnt FROM system.mutations WHERE is_done = 0", { cnt: 0 }),
        safeQuery<{ cnt: number }>("SELECT count() as cnt FROM system.parts WHERE active AND level = 0", { cnt: 0 }),
        safeQuery<{ val: number }>("SELECT max(num_parts) as val FROM system.merges", { val: 0 }),
      ]);

      return {
        active_merges: Number(activeMerges.value) || 0,
        merge_queue_size: Number(mergeQueue.cnt) || 0,
        pending_mutations: Number(mutations.cnt) || 0,
        parts_to_merge: Number(parts.cnt) || 0,
        max_parts_per_partition: Number(maxParts.val) || 0,
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch merge metrics");
    }
  }

  /**
   * Get replication status metrics (if using ReplicatedMergeTree)
   */
  async getReplicationMetrics(): Promise<import("../types").ReplicationMetrics[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            database,
            table,
            absolute_delay,
            queue_size,
            is_leader,
            is_readonly,
            total_replicas,
            active_replicas
          FROM system.replicas
          ORDER BY absolute_delay DESC
          LIMIT 20
        `,
      });
      const response = await result.json() as JsonResponse<{
        database: string;
        table: string;
        absolute_delay: number;
        queue_size: number;
        is_leader: number;
        is_readonly: number;
        total_replicas: number;
        active_replicas: number;
      }>;
      
      return response.data.map(r => ({
        database: r.database,
        table: r.table,
        absolute_delay: Number(r.absolute_delay),
        queue_size: Number(r.queue_size),
        is_leader: Boolean(r.is_leader),
        is_readonly: Boolean(r.is_readonly),
        total_replicas: Number(r.total_replicas),
        active_replicas: Number(r.active_replicas),
      }));
    } catch {
      // Replicated tables may not exist
      return [];
    }
  }

  /**
   * Get cache hit ratio metrics
   * Note: system.events uses 'event' column, not 'metric'
   */
  async getCacheMetrics(): Promise<import("../types").CacheMetrics> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            sumIf(value, event = 'MarkCacheHits') as mark_hits,
            sumIf(value, event = 'MarkCacheMisses') as mark_misses,
            sumIf(value, event = 'UncompressedCacheHits') as uncomp_hits,
            sumIf(value, event = 'UncompressedCacheMisses') as uncomp_misses,
            sumIf(value, event = 'CompiledExpressionCacheCount') as compiled_cache
          FROM system.events
        `,
      });
      const response = await result.json() as JsonResponse<{
        mark_hits: number;
        mark_misses: number;
        uncomp_hits: number;
        uncomp_misses: number;
        compiled_cache: number;
      }>;
      
      const data = response.data[0] || {};
      const markHits = Number(data.mark_hits) || 0;
      const markMisses = Number(data.mark_misses) || 0;
      const uncompHits = Number(data.uncomp_hits) || 0;
      const uncompMisses = Number(data.uncomp_misses) || 0;
      
      return {
        mark_cache_hits: markHits,
        mark_cache_misses: markMisses,
        mark_cache_hit_ratio: markHits + markMisses > 0 
          ? Math.round((markHits / (markHits + markMisses)) * 100 * 100) / 100 
          : 0,
        uncompressed_cache_hits: uncompHits,
        uncompressed_cache_misses: uncompMisses,
        uncompressed_cache_hit_ratio: uncompHits + uncompMisses > 0 
          ? Math.round((uncompHits / (uncompHits + uncompMisses)) * 100 * 100) / 100 
          : 0,
        compiled_expression_cache_count: Number(data.compiled_cache) || 0,
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch cache metrics");
    }
  }

  /**
   * Get resource usage metrics (CPU, memory, threads)
   */
  async getResourceMetrics(): Promise<import("../types").ResourceMetrics> {
    try {
      const [asyncMetrics, metrics] = await Promise.all([
        this.client.query({
          query: `
            SELECT metric, value FROM system.asynchronous_metrics 
            WHERE metric IN ('OSCPULoad', 'MemoryResident', 'MaxPartCountForPartition')
          `,
        }),
        this.client.query({
          query: `
            SELECT metric, value FROM system.metrics 
            WHERE metric IN (
              'MemoryTracking', 'BackgroundPoolTask', 'BackgroundSchedulePoolTask',
              'BackgroundMergesAndMutationsPoolTask', 'GlobalThread', 'LocalThread',
              'OpenFileForRead', 'OpenFileForWrite'
            )
          `,
        }),
      ]);

      const asyncData = await asyncMetrics.json() as JsonResponse<{ metric: string; value: number }>;
      const metricsData = await metrics.json() as JsonResponse<{ metric: string; value: number }>;
      
      const asyncMap = Object.fromEntries(asyncData.data.map(d => [d.metric, Number(d.value)]));
      const metricsMap = Object.fromEntries(metricsData.data.map(d => [d.metric, Number(d.value)]));

      return {
        cpu_load: asyncMap.OSCPULoad || 0,
        memory_resident: (asyncMap.MemoryResident || 0) / (1024 * 1024 * 1024), // Convert to GB
        memory_tracking: (metricsMap.MemoryTracking || 0) / (1024 * 1024 * 1024), // Convert to GB
        background_pool_tasks: metricsMap.BackgroundPoolTask || 0,
        background_schedule_pool_tasks: metricsMap.BackgroundSchedulePoolTask || 0,
        background_merges_mutations_pool_tasks: metricsMap.BackgroundMergesAndMutationsPoolTask || 0,
        global_threads: metricsMap.GlobalThread || 0,
        local_threads: metricsMap.LocalThread || 0,
        file_descriptors_used: (metricsMap.OpenFileForRead || 0) + (metricsMap.OpenFileForWrite || 0),
        file_descriptors_max: 0, // Will be populated if available
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch resource metrics");
    }
  }

  /**
   * Get error breakdown by exception code
   * Counts errors from:
   * 1. ExceptionWhileProcessing entries (with exception_code != 0)
   * 2. ExceptionBeforeStart entries (with exception_code != 0)
   * 3. QueryFinish entries with exception_code != 0
   * 4. QueryStart entries with exception field (non-empty) and exception_code != 0
   * This matches the logic used in the Logs page and Metrics page
   * Note: We only count entries with exception_code != 0 to group by error type
   */
  async getErrorMetrics(intervalMinutes: number = 60): Promise<import("../types").ErrorMetrics[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            exception_code,
            any(exception) as sample_error,
            count() as count,
            max(event_time) as last_occurred
          FROM system.query_log 
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
            AND exception_code != 0
            AND (
              type = 'ExceptionWhileProcessing'
              OR type = 'ExceptionBeforeStart'
              OR type = 'QueryFinish'
              OR (type = 'QueryStart' AND length(exception) > 0)
            )
          GROUP BY exception_code 
          ORDER BY count DESC
          LIMIT 15
        `,
      });
      const response = await result.json() as JsonResponse<{
        exception_code: number;
        sample_error: string;
        count: number;
        last_occurred: string;
      }>;
      
      return response.data.map(e => ({
        exception_code: Number(e.exception_code),
        exception_name: this.getExceptionName(Number(e.exception_code)),
        count: Number(e.count),
        sample_error: e.sample_error?.substring(0, 200) || '',
        last_occurred: e.last_occurred,
      }));
    } catch (error) {
      throw this.handleError(error, "Failed to fetch error metrics");
    }
  }

  /**
   * Get insert throughput time series
   */
  async getInsertThroughput(intervalMinutes: number = 60): Promise<import("../types").InsertThroughputMetrics[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            toUnixTimestamp(toStartOfMinute(event_time)) as ts,
            sum(written_rows) / 60 as rows_per_second,
            sum(written_bytes) / 60 as bytes_per_second,
            count() / 60 as inserts_per_second
          FROM system.query_log
          WHERE query_kind = 'Insert' 
            AND type = 'QueryFinish'
            AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts 
          ORDER BY ts
        `,
      });
      const response = await result.json() as JsonResponse<{
        ts: number;
        rows_per_second: number;
        bytes_per_second: number;
        inserts_per_second: number;
      }>;
      
      return response.data.map(d => ({
        timestamp: Number(d.ts),
        rows_per_second: Number(d.rows_per_second) || 0,
        bytes_per_second: Number(d.bytes_per_second) || 0,
        inserts_per_second: Number(d.inserts_per_second) || 0,
      }));
    } catch (error) {
      throw this.handleError(error, "Failed to fetch insert throughput metrics");
    }
  }

  /**
   * Get top tables by size
   */
  async getTopTablesBySize(limit: number = 10): Promise<import("../types").TopTableBySize[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            database,
            table,
            sum(rows) as rows,
            sum(bytes_on_disk) as bytes_on_disk,
            count() as parts_count
          FROM system.parts
          WHERE active
            AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
          GROUP BY database, table
          ORDER BY bytes_on_disk DESC
          LIMIT ${limit}
        `,
      });
      const response = await result.json() as JsonResponse<{
        database: string;
        table: string;
        rows: string;
        bytes_on_disk: string;
        parts_count: number;
      }>;
      
      // Helper function to format bytes to readable size
      const formatReadableSize = (bytes: number): string => {
        if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TiB`;
        if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GiB`;
        if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MiB`;
        if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KiB`;
        return `${bytes} B`;
      };
      
      return response.data.map(t => {
        const bytesOnDisk = Number(t.bytes_on_disk) || 0;
        return {
          database: t.database,
          table: t.table,
          rows: Number(t.rows),
          bytes_on_disk: bytesOnDisk,
          compressed_size: formatReadableSize(bytesOnDisk),
          parts_count: Number(t.parts_count),
        };
      });
    } catch (error) {
      throw this.handleError(error, "Failed to fetch top tables");
    }
  }

  /**
   * Get all production metrics in one call (optimized)
   * Each metric is fetched independently so failures don't affect others
   */
  async getProductionMetrics(intervalMinutes: number = 60): Promise<import("../types").ProductionMetrics> {
    // Default values for when individual metrics fail
    const defaultLatency: import("../types").QueryLatencyMetrics = {
      p50_ms: 0, p95_ms: 0, p99_ms: 0, max_ms: 0, avg_ms: 0, slow_queries_count: 0
    };
    const defaultMerges: import("../types").MergeMetrics = {
      active_merges: 0, merge_queue_size: 0, pending_mutations: 0, parts_to_merge: 0, max_parts_per_partition: 0
    };
    const defaultCache: import("../types").CacheMetrics = {
      mark_cache_hits: 0, mark_cache_misses: 0, mark_cache_hit_ratio: 0,
      uncompressed_cache_hits: 0, uncompressed_cache_misses: 0, uncompressed_cache_hit_ratio: 0,
      compiled_expression_cache_count: 0
    };
    const defaultResources: import("../types").ResourceMetrics = {
      cpu_load: 0, memory_resident: 0, memory_tracking: 0, background_pool_tasks: 0,
      background_schedule_pool_tasks: 0, background_merges_mutations_pool_tasks: 0,
      global_threads: 0, local_threads: 0, file_descriptors_used: 0, file_descriptors_max: 0
    };

    // Fetch all metrics with individual error handling
    const [
      latency,
      disks,
      merges,
      replication,
      cache,
      resources,
      errors,
      insertThroughput,
      topTables,
    ] = await Promise.all([
      this.getQueryLatencyMetrics(intervalMinutes).catch(() => defaultLatency),
      this.getDiskMetrics().catch(() => []),
      this.getMergeMetrics().catch(() => defaultMerges),
      this.getReplicationMetrics().catch(() => []),
      this.getCacheMetrics().catch(() => defaultCache),
      this.getResourceMetrics().catch(() => defaultResources),
      this.getErrorMetrics(intervalMinutes).catch(() => []),
      this.getInsertThroughput(intervalMinutes).catch(() => []),
      this.getTopTablesBySize(10).catch(() => []),
    ]);

    return {
      latency,
      disks,
      merges,
      replication,
      cache,
      resources,
      errors,
      insertThroughput,
      topTables,
    };
  }

  /**
   * Map exception codes to human-readable names
   */
  private getExceptionName(code: number): string {
    const exceptionNames: Record<number, string> = {
      1: 'UNSUPPORTED_METHOD',
      2: 'UNSUPPORTED_PARAMETER',
      3: 'UNEXPECTED_END_OF_FILE',
      4: 'EXPECTED_END_OF_FILE',
      6: 'CANNOT_PARSE_TEXT',
      10: 'CANNOT_OPEN_FILE',
      27: 'INCORRECT_DATA',
      36: 'BAD_TYPE_OF_FIELD',
      47: 'UNKNOWN_PACKET_FROM_CLIENT',
      48: 'UNKNOWN_PACKET_FROM_SERVER',
      53: 'ATTEMPT_TO_READ_AFTER_EOF',
      57: 'DEADLOCK_AVOIDED',
      60: 'UNKNOWN_TABLE',
      62: 'SYNTAX_ERROR',
      73: 'UNKNOWN_USER',
      76: 'UNKNOWN_TYPE',
      81: 'UNKNOWN_DATABASE',
      159: 'TIMEOUT_EXCEEDED',
      160: 'TOO_SLOW',
      164: 'READONLY',
      202: 'TOO_MANY_SIMULTANEOUS_QUERIES',
      241: 'MEMORY_LIMIT_EXCEEDED',
      252: 'TOO_MANY_PARTS',
      306: 'INVALID_JOIN_ON_EXPRESSION',
      349: 'QUERY_WAS_CANCELLED',
      394: 'QUERY_WAS_CANCELLED_BY_CLIENT',
      497: 'ACCESS_DENIED',
    };
    return exceptionNames[code] || `ERROR_${code}`;
  }

  // ============================================
  // Saved Queries
  // ============================================

  async checkSavedQueriesEnabled(): Promise<boolean> {
    try {
      const result = await this.executeQuery<{ exists: number }>(`
        SELECT COUNT(*) as exists 
        FROM system.tables 
        WHERE database = 'CH_UI' 
        AND name = 'saved_queries'
      `);
      return (result.data[0]?.exists ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async activateSavedQueries(): Promise<void> {
    await this.client.command({ query: "CREATE DATABASE IF NOT EXISTS CH_UI" });
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS CH_UI.saved_queries (
          id String,
          name String,
          query String,
          created_at DateTime64(3),
          updated_at DateTime64(3),
          owner String,
          is_public Boolean DEFAULT false,
          PRIMARY KEY (id)
        ) ENGINE = MergeTree()
        ORDER BY (id, created_at)
        SETTINGS index_granularity = 8192
      `,
    });
  }

  async deactivateSavedQueries(): Promise<void> {
    await this.client.command({ query: "DROP TABLE IF EXISTS CH_UI.saved_queries" });
  }

  async getSavedQueries(): Promise<SavedQuery[]> {
    const result = await this.executeQuery<SavedQuery>(
      "SELECT * FROM CH_UI.saved_queries ORDER BY updated_at DESC"
    );
    return result.data;
  }

  async saveQuery(id: string, name: string, query: string, isPublic: boolean = false): Promise<void> {
    const safeName = this.escapeString(name);
    const safeQuery = this.escapeString(query);

    await this.client.command({
      query: `
        INSERT INTO CH_UI.saved_queries (id, name, query, created_at, updated_at, owner, is_public)
        VALUES (
          '${id}',
          '${safeName}',
          '${safeQuery}',
          now(),
          now(),
          currentUser(),
          ${isPublic}
        )
      `,
    });
  }

  async updateSavedQuery(id: string, name: string, query: string): Promise<void> {
    const safeName = this.escapeString(name);
    const safeQuery = this.escapeString(query);

    await this.client.command({
      query: `
        ALTER TABLE CH_UI.saved_queries
        UPDATE
          name = '${safeName}',
          query = '${safeQuery}',
          updated_at = now()
        WHERE id = '${id}'
      `,
    });
  }

  async deleteSavedQuery(id: string): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE CH_UI.saved_queries DELETE WHERE id = '${id}'`,
    });
  }

  // ============================================
  // Intellisense
  // ============================================

  async getIntellisenseData(): Promise<{
    columns: { database: string; table: string; column_name: string; column_type: string }[];
    functions: string[];
    keywords: string[];
  }> {
    try {
      const [columnsRes, functionsRes, keywordsRes] = await Promise.all([
        this.client.query({
          query: `
            SELECT database, table, name AS column_name, type AS column_type
            FROM system.columns
            ORDER BY database, table, column_name
          `,
        }),
        this.client.query({ query: "SELECT name FROM system.functions" }),
        this.client.query({ query: "SELECT keyword FROM system.keywords" }),
      ]);

      const columnsData = await columnsRes.json() as JsonResponse<{ database: string; table: string; column_name: string; column_type: string }>;
      const functionsData = await functionsRes.json() as JsonResponse<{ name: string }>;
      const keywordsData = await keywordsRes.json() as JsonResponse<{ keyword: string }>;

      return {
        columns: columnsData.data,
        functions: functionsData.data.map(f => f.name),
        keywords: keywordsData.data.map(k => k.keyword),
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch intellisense data");
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private escapeString(value: string): string {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "''")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
  }

  private formatLargeNumber(num: number): string {
    if (isNaN(num) || num === 0) return "0";
    if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toLocaleString();
  }

  private handleError(error: unknown, defaultMessage: string): AppError {
    const err = error as Error & { response?: { status?: number } };
    const message = err?.message || defaultMessage;
    const statusCode = err?.response?.status;

    if (statusCode === 401 || statusCode === 403 || message.includes("Authentication")) {
      return AppError.unauthorized("Authentication failed. Please check your credentials.");
    }

    if (statusCode === 404) {
      return new AppError(
        "Server not found at the specified URL",
        "CONNECTION_ERROR",
        "connection",
        404
      );
    }

    if (statusCode === 502 || statusCode === 504) {
      return new AppError(
        "Cannot reach the ClickHouse server",
        "NETWORK_ERROR",
        "network",
        502
      );
    }

    if (message.includes("timeout")) {
      return new AppError(
        "Connection timed out",
        "TIMEOUT_ERROR",
        "timeout",
        408
      );
    }

    return AppError.internal(message, error);
  }
}

// ============================================
// Connection Pool (Session Management)
// ============================================

const sessions = new Map<string, { service: ClickHouseService; session: import("../types").Session }>();

export function createSession(
  sessionId: string,
  config: ConnectionConfig,
  sessionData: Omit<import("../types").Session, "id" | "connectionConfig">
): ClickHouseService {
  const service = new ClickHouseService(config);
  sessions.set(sessionId, {
    service,
    session: {
      id: sessionId,
      connectionConfig: config,
      ...sessionData,
    },
  });
  return service;
}

export function getSession(sessionId: string): { service: ClickHouseService; session: import("../types").Session } | undefined {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.session.lastUsedAt = new Date();
  }
  return entry;
}

export async function destroySession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId);
  if (entry) {
    await entry.service.close();
    sessions.delete(sessionId);
  }
}

/**
 * Destroy all sessions owned by a specific RBAC user
 * Used when user logs out or switches accounts
 */
export async function destroyUserSessions(rbacUserId: string): Promise<number> {
  let destroyed = 0;
  const sessionsToDestroy: string[] = [];

  // Collect all session IDs owned by this user
  for (const [sessionId, entry] of sessions.entries()) {
    if (entry.session.rbacUserId === rbacUserId) {
      sessionsToDestroy.push(sessionId);
    }
  }

  // Destroy all collected sessions
  for (const sessionId of sessionsToDestroy) {
    try {
      await destroySession(sessionId);
      destroyed++;
    } catch (error) {
      console.error(`[ClickHouse] Failed to destroy session ${sessionId}:`, error);
    }
  }

  return destroyed;
}

export function getSessionCount(): number {
  return sessions.size;
}

// Cleanup expired sessions (run periodically)
export async function cleanupExpiredSessions(maxAge: number = 3600000): Promise<number> {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, entry] of sessions.entries()) {
    if (now - entry.session.lastUsedAt.getTime() > maxAge) {
      await destroySession(id);
      cleaned++;
    }
  }

  return cleaned;
}

