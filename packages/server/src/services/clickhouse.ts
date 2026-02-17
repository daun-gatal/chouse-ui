import { ClickHouseClient } from "@clickhouse/client";
import { ClientManager } from "./clientManager";
import type {
  ConnectionConfig,
  QueryResult,
  DatabaseInfo,
  TableDetails,
  SystemStats,
  RecentQuery,
  ColumnInfo,
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
  private config: ConnectionConfig;
  private rbacUserId?: string;

  constructor(config: ConnectionConfig, options?: { rbacUserId?: string }) {
    this.config = config;
    this.rbacUserId = options?.rbacUserId;
  }

  private get client(): ClickHouseClient {
    return ClientManager.getInstance().getClient(this.config);
  }

  async close(): Promise<void> {
    // No-op: Client is managed by ClientManager
    // We don't close the shared client here
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
    format: string = "JSON",
    queryId?: string
  ): Promise<QueryResult<T>> {
    try {
      const trimmedQuery = query.trim();

      // Check if it's a command (CREATE, INSERT, ALTER, DROP, etc.)
      if (this.isCommand(trimmedQuery)) {
        const commandParams: any = {
          query: trimmedQuery,
          query_id: queryId,
        };

        // Inject RBAC User ID into log_comment if present
        if (this.rbacUserId) {
          commandParams.clickhouse_settings = {
            log_comment: JSON.stringify({ rbac_user_id: this.rbacUserId }),
          };
        }

        const result = await this.client.command(commandParams);
        return {
          meta: [],
          data: [],
          statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
          rows: 0,
          queryId: result.query_id,
          error: null,
        };
      }

      // Build query settings
      const clickhouse_settings: Record<string, string | number> = {};

      // Inject RBAC User ID into log_comment if present
      if (this.rbacUserId) {
        // Tag format: {"rbac_user_id":"UUID"}
        // This allows us to track which RBAC user executed the query regardless of the DB user
        clickhouse_settings.log_comment = JSON.stringify({ rbac_user_id: this.rbacUserId });
      }

      const result = await this.client.query({
        query: trimmedQuery,
        format: format as "JSON" | "JSONEachRow",
        clickhouse_settings,
        query_id: queryId,
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
        queryId: result.query_id,
        error: null,
      };
    } catch (error) {
      throw this.handleError(error, "Query execution failed");
    }
  }

  /**
   * Stream data insertion into a table
   * @param database Target database
   * @param table Target table
   * @param stream Node.js readable stream (e.g. file stream)
   * @param format Data format (CSV, JSONEachRow, etc.)
   */
  async insertStream(
    database: string,
    table: string,
    stream: any,
    format: string = "CSV",
    settings?: Record<string, string | number>
  ): Promise<{ queryId: string }> {
    try {
      const escapedDatabase = this.escapeIdentifier(database);
      const escapedTable = this.escapeIdentifier(table);

      const clickhouse_settings: Record<string, string | number> = {
        input_format_null_as_default: 1,
        date_time_input_format: "best_effort",
        ...settings,
      };

      if (this.rbacUserId) {
        clickhouse_settings.log_comment = JSON.stringify({ rbac_user_id: this.rbacUserId });
      }

      const result = await this.client.insert({
        table: `${escapedDatabase}.${escapedTable}`,
        values: stream,
        format: format as any,
        clickhouse_settings,
      });

      return {
        queryId: result.query_id,
      };
    } catch (error) {
      throw this.handleError(error, "Streaming insert failed");
    }
  }

  // Helper to escape identifiers manually if needed
  private escapeIdentifier(identifier: string): string {
    if (!identifier) return "";
    return identifier.includes(".") || identifier.includes("-")
      ? `"${identifier.replace(/"/g, '""')}"`
      : identifier;
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
      /^\s*KILL\s+/i,
      /^\s*SET\s+/i,
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
        this.client.query({
          query: `
            SELECT
              (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' LIMIT 1) as mem_resident,
              (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal' LIMIT 1) as mem_total,
              (SELECT value FROM system.metrics WHERE metric = 'MemoryTracking' LIMIT 1) as mem_tracking
          `
        }),
        // Use ProfileEvent-based cores usage for summary cards
        this.client.query({
          query: `
            SELECT 
              (SELECT avg(ProfileEvent_OSCPUVirtualTimeMicroseconds) / 1000000 
               FROM system.metric_log 
               WHERE event_time >= now() - INTERVAL 5 SECOND) as cpu_load
          `
        }),
        this.client.query({
          query: "SELECT sum(value) as value FROM system.metrics WHERE metric IN ('TCPConnection', 'HTTPConnection', 'InterserverConnection', 'MySQLConnection', 'PostgreSQLConnection')"
        }),
        this.client.query({ query: "SELECT count() as cnt FROM system.processes WHERE query_id != currentQueryID()" }),
      ]);

      // Note: .json() returns { data: [...], meta: [...], ... }, extract the data array
      const version = await versionRes.json() as JsonResponse<{ "version()": string }>;
      const uptime = await uptimeRes.json() as JsonResponse<{ "uptime()": number }>;
      const dbCount = await dbCountRes.json() as JsonResponse<{ "count()": number }>;
      const tableCount = await tableCountRes.json() as JsonResponse<{ "count()": number }>;
      const sizeData = await sizeRes.json() as JsonResponse<{ size: string; rows: string }>;
      const memData = await memRes.json() as JsonResponse<{ mem_resident: string; mem_total: string; mem_tracking: string }>;
      const cpuData = await cpuRes.json() as JsonResponse<{ cpu_load: number }>;
      const connData = await connRes.json() as JsonResponse<{ value: number }>;
      const activeQueriesData = await activeQueriesRes.json() as JsonResponse<{ cnt: number }>;

      const memResident = Number(memData.data[0]?.mem_resident || 0);
      const memTotal = Number(memData.data[0]?.mem_total || 0);

      const formatSize = (bytes: number) => {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
          size /= 1024;
          unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
      };

      return {
        version: version.data[0]?.["version()"] || "-",
        uptime: uptime.data[0]?.["uptime()"] || 0,
        databaseCount: Number(dbCount.data[0]?.["count()"] || 0),
        tableCount: Number(tableCount.data[0]?.["count()"] || 0),
        totalRows: this.formatLargeNumber(Number(sizeData.data[0]?.rows || 0)),
        totalSize: sizeData.data[0]?.size || "0 B",
        memoryUsage: formatSize(memResident),
        memoryTotal: formatSize(memTotal),
        memoryPercentage: memTotal > 0 ? (memResident / memTotal) * 100 : 0,
        cpuLoad: Number(cpuData.data[0]?.cpu_load || 0),
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

      const data = (response.data[0] || {}) as any;
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
   * Get Visual Query Explain Plan with support for multiple EXPLAIN types
   * @param query - The SQL query to explain
   * @param explainType - The type of explain (plan, ast, syntax, pipeline, estimate)
   */
  async getExplainPlan(query: string, explainType: 'plan' | 'ast' | 'syntax' | 'pipeline' | 'estimate' = 'plan'): Promise<any> {
    try {
      let explainQuery: string;

      switch (explainType) {
        case 'plan':
          explainQuery = `EXPLAIN json = 1 ${query}`;
          break;
        case 'ast':
          explainQuery = `EXPLAIN AST ${query}`;
          break;
        case 'syntax':
          explainQuery = `EXPLAIN SYNTAX ${query}`;
          break;
        case 'pipeline':
          explainQuery = `EXPLAIN PIPELINE ${query}`;
          break;
        case 'estimate':
          explainQuery = `EXPLAIN ESTIMATE ${query}`;
          break;
        default:
          explainQuery = `EXPLAIN json = 1 ${query}`;
      }

      // For text-based explain types (AST, SYNTAX, PIPELINE), get raw text
      if (explainType === 'ast' || explainType === 'syntax' || explainType === 'pipeline') {
        const result = await this.client.query({
          query: explainQuery,
          format: 'TabSeparatedRaw',
        });
        const text = await result.text();
        return {
          type: explainType,
          [explainType]: text.trim(),
          raw: text
        };
      }

      // For JSON-based explain types (plan, estimate), use executeQuery
      const result = await this.executeQuery(explainQuery, 'JSON');

      if (explainType === 'plan') {
        if (result.data && result.data.length > 0) {
          const planJson = (result.data[0] as any).explain;
          if (typeof planJson === 'string') {
            return { type: 'plan', plan: JSON.parse(planJson), raw: result.data };
          }
          return { type: 'plan', plan: planJson, raw: result.data };
        }
        return { type: 'plan', plan: null, raw: null };
      }

      if (explainType === 'estimate') {
        return {
          type: 'estimate',
          estimate: result.data,
          raw: result.data
        };
      }

      return { type: explainType, [explainType]: null, raw: null };
    } catch (error) {
      throw this.handleError(error, `Failed to get ${explainType} explain`);
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
   * Get merge and mutation metrics from system.metric_log
   * Uses CurrentMetric and ProfileEvent metrics following ClickHouse Cloud dashboard approach
   */
  async getMergeMetrics(intervalMinutes: number = 60): Promise<import("../types").MergeMetrics> {
    try {
      // Check if system.metric_log exists
      const checkTable = await this.client.query({
        query: "EXISTS TABLE system.metric_log",
      });
      const checkResponse = await checkTable.json() as JsonResponse<{ result: number }>;

      if (!checkResponse.data[0] || checkResponse.data[0].result !== 1) {
        // Fall back to system.metrics if metric_log is not available
        return this.getMergeMetricsFallback();
      }

      // 1. Get instantaneous metrics from system.metrics (always up to date)
      const metricsResult = await this.client.query({
        query: `
          SELECT metric, value 
          FROM system.metrics 
          WHERE metric IN ('PartMutation')
        `,
      });
      const metricsResponse = await metricsResult.json() as JsonResponse<{ metric: string; value: string }>;
      const metricsMap = new Map(metricsResponse.data.map(d => [d.metric, Number(d.value)]));

      // 2. Get rates from system.metric_log (historical deltas)
      const logResult = await this.client.query({
        query: `
          SELECT
            avg(ProfileEvent_MergedRows) as merged_rows_per_sec,
            avg(ProfileEvent_MergedUncompressedBytes) as merged_bytes_per_sec,
            avg(CurrentMetric_Merge) as merges_running,
            avg(CurrentMetric_MergesMutationsMemoryTracking) as merges_mutations_memory
          FROM system.metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
        `,
      });
      const logResponse = await logResult.json() as JsonResponse<{
        merged_rows_per_sec: number;
        merged_bytes_per_sec: number;
        merges_running: number;
        merges_mutations_memory: number;
      }>;
      const logData = (logResponse.data[0] as any) || {
        merged_rows_per_sec: 0,
        merged_bytes_per_sec: 0,
        merges_running: 0,
        merges_mutations_memory: 0
      };

      // 3. Get pending mutations count
      const mutationsResult = await this.client.query({
        query: "SELECT count() as cnt FROM system.mutations WHERE is_done = 0",
      });
      const mutationsResponse = await mutationsResult.json() as JsonResponse<{ cnt: number }>;
      const pendingMutations = Number(mutationsResponse.data[0]?.cnt) || 0;

      return {
        merges_running: Number(logData.merges_running) || 0,
        mutations_running: metricsMap.get('PartMutation') || 0,
        merged_rows_per_sec: Number(logData.merged_rows_per_sec) || 0,
        merged_bytes_per_sec: Number(logData.merged_bytes_per_sec) || 0,
        merges_mutations_memory: Number(logData.merges_mutations_memory) || 0,
        pending_mutations: pendingMutations,
      };
    } catch (error) {
      // If metric_log query fails, fall back to legacy implementation
      try {
        return await this.getMergeMetricsFallback();
      } catch (fallbackError) {
        throw this.handleError(error, "Failed to fetch merge metrics");
      }
    }
  }

  /**
   * Fallback method using system.metrics when metric_log is not available
   * @private
   */
  private async getMergeMetricsFallback(): Promise<import("../types").MergeMetrics> {
    const safeQuery = async <T>(query: string, defaultValue: T): Promise<T> => {
      try {
        const result = await this.client.query({ query });
        const response = await result.json() as JsonResponse<T>;
        return response.data[0] || defaultValue;
      } catch {
        return defaultValue;
      }
    };

    const [merges, mutationsRunning, pending] = await Promise.all([
      safeQuery<{ value: number }>("SELECT value FROM system.metrics WHERE metric = 'Merge'", { value: 0 }),
      safeQuery<{ value: number }>("SELECT value FROM system.metrics WHERE metric = 'PartMutation'", { value: 0 }),
      safeQuery<{ cnt: number }>("SELECT count() as cnt FROM system.mutations WHERE is_done = 0", { cnt: 0 }),
    ]);

    return {
      merges_running: Number(merges.value) || 0,
      mutations_running: Number(mutationsRunning.value) || 0,
      merged_rows_per_sec: 0, // Not available without metric_log
      merged_bytes_per_sec: 0, // Not available without metric_log
      merges_mutations_memory: 0, // Not available without metric_log
      pending_mutations: Number(pending.cnt) || 0,
    };
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

      const data = (response.data[0] || {}) as any;
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

  async getResourceMetrics(intervalMinutes: number = 60): Promise<import("../types").ResourceMetrics> {
    try {
      // Check for table availability
      const [hasMetricLog, hasAsyncMetricLog] = await Promise.all([
        this.checkTableExists('system.metric_log'),
        this.checkTableExists('system.asynchronous_metric_log')
      ]);

      // Base query parts
      let cpuLoadQuery = "0";
      let loadAvgQuery = "0";
      let totalPartsQuery = "0";
      let maxPartsQuery = "0";
      let primaryKeyCacheBytesQuery = "0";
      let primaryKeyCacheFilesQuery = "0";

      if (hasMetricLog) {
        cpuLoadQuery = `(SELECT avg(ProfileEvent_OSCPUVirtualTimeMicroseconds) / 1000000 
                         FROM system.metric_log 
                         WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE)`;

        primaryKeyCacheBytesQuery = `(SELECT avg(CurrentMetric_PrimaryIndexCacheBytes) 
                                     FROM system.metric_log 
                                     WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE)`;

        primaryKeyCacheFilesQuery = `(SELECT avg(CurrentMetric_PrimaryIndexCacheFiles) 
                                     FROM system.metric_log 
                                     WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE)`;
      }

      if (hasAsyncMetricLog) {
        loadAvgQuery = `(SELECT avg(value) FROM system.asynchronous_metric_log 
                         WHERE metric = 'LoadAverage15' AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE)`;

        totalPartsQuery = `(SELECT max(value) FROM system.asynchronous_metric_log 
                           WHERE metric = 'TotalPartsOfMergeTreeTables' AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE)`;

        maxPartsQuery = `(SELECT max(value) FROM system.asynchronous_metric_log 
                         WHERE metric = 'MaxPartCountForPartition' AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE)`;
        // Fallback for parts count if async metric log is missing
        totalPartsQuery = "(SELECT count() FROM system.parts)";
      }

      // Get current resource metrics
      // ... (implementation of the rest of the method would be here, assuming it continues)


      const metricsResult = await this.client.query({
        query: `
            SELECT 
              ${cpuLoadQuery} as cpu_load,
              ${loadAvgQuery} as load_average_15,
              ${totalPartsQuery} as total_parts,
              ${maxPartsQuery} as max_parts_per_partition,
              ${primaryKeyCacheBytesQuery} as primary_key_cache_bytes,
              ${primaryKeyCacheFilesQuery} as primary_key_cache_files,
              (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MemoryResident' LIMIT 1) as memory_resident,
              (SELECT value FROM system.metrics WHERE metric = 'MemoryTracking' LIMIT 1) as memory_tracking,
              (SELECT value FROM system.metrics WHERE metric = 'BackgroundPoolTask' LIMIT 1) as background_pool_tasks,
              (SELECT value FROM system.metrics WHERE metric = 'BackgroundSchedulePoolTask' LIMIT 1) as background_schedule_pool_tasks,
              (SELECT value FROM system.metrics WHERE metric = 'BackgroundMergesAndMutationsPoolTask' LIMIT 1) as background_merges_mutations_pool_tasks,
              (SELECT value FROM system.metrics WHERE metric = 'GlobalThread' LIMIT 1) as global_threads,
              (SELECT value FROM system.metrics WHERE metric = 'LocalThread' LIMIT 1) as local_threads,
              (SELECT value FROM system.metrics WHERE metric = 'OpenFileForRead' LIMIT 1) + 
              (SELECT value FROM system.metrics WHERE metric = 'OpenFileForWrite' LIMIT 1) as file_descriptors_used,
              (SELECT (max(ProfileEvent_ReadBufferFromFileDescriptorReadBytes) - min(ProfileEvent_ReadBufferFromFileDescriptorReadBytes)) / (${intervalMinutes} * 60)
               FROM system.metric_log 
               WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE) as read_rate
          `,
      });

      const response = await metricsResult.json() as JsonResponse<{
        cpu_load: number;
        load_average_15: number;
        total_parts: number;
        max_parts_per_partition: number;
        primary_key_cache_bytes: number;
        primary_key_cache_files: number;
        memory_resident: number;
        memory_tracking: number;
        background_pool_tasks: number;
        background_schedule_pool_tasks: number;
        background_merges_mutations_pool_tasks: number;
        global_threads: number;
        local_threads: number;
        file_descriptors_used: number;
        read_rate: number;
      }>;

      const data = response.data[0] || {} as any;

      return {
        cpu_load: Number(data.cpu_load) || 0,
        load_average_15: Number(data.load_average_15) || 0,
        total_parts: Number(data.total_parts) || 0,
        max_parts_per_partition: Number(data.max_parts_per_partition) || 0,
        primary_key_cache_bytes: Number(data.primary_key_cache_bytes) || 0,
        primary_key_cache_files: Number(data.primary_key_cache_files) || 0,
        memory_resident: Number(data.memory_resident) || 0,
        memory_tracking: Number(data.memory_tracking) || 0,
        background_pool_tasks: Number(data.background_pool_tasks) || 0,
        background_schedule_pool_tasks: Number(data.background_schedule_pool_tasks) || 0,
        background_merges_mutations_pool_tasks: Number(data.background_merges_mutations_pool_tasks) || 0,
        global_threads: Number(data.global_threads) || 0,
        local_threads: Number(data.local_threads) || 0,
        file_descriptors_used: Number(data.file_descriptors_used) || 0,
        file_descriptors_max: 0,
        read_rate: Number(data.read_rate) || 0,
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch resource metrics");
    }
  }

  /**
   * Helper to check if a table exists
   * @private
   */
  private async checkTableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.client.query({
        query: `EXISTS TABLE ${tableName}`,
      });
      const response = await result.json() as JsonResponse<{ result: number }>;
      return response.data[0]?.result === 1;
    } catch {
      return false;
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
   * Get top tables by size (non-system tables only).
   * Uses system.tables so all user tables are included regardless of engine.
   */
  async getTopTablesBySize(limit: number = 10): Promise<import("../types").TopTableBySize[]> {
    try {
      const result = await this.client.query({
        query: `
          SELECT 
            database,
            name AS table,
            coalesce(total_rows, 0) AS rows,
            coalesce(total_bytes, 0) AS bytes_on_disk
          FROM system.tables
          WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
          ORDER BY coalesce(total_bytes, 0) DESC
          LIMIT ${limit}
        `,
        format: "JSON",
      });
      const response = await result.json() as JsonResponse<{
        database: string;
        table: string;
        rows: string | number;
        bytes_on_disk: string | number;
      }>;

      const formatReadableSize = (bytes: number): string => {
        if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TiB`;
        if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GiB`;
        if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MiB`;
        if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KiB`;
        return `${bytes} B`;
      };

      if (!response.data || response.data.length === 0) {
        return [];
      }

      return response.data.map((t) => {
        const bytesOnDisk = Number(t.bytes_on_disk) || 0;
        return {
          database: t.database,
          table: t.table,
          rows: Number(t.rows),
          bytes_on_disk: bytesOnDisk,
          compressed_size: formatReadableSize(bytesOnDisk),
          parts_count: 0,
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
      merges_running: 0, mutations_running: 0, merged_rows_per_sec: 0, merged_bytes_per_sec: 0, merges_mutations_memory: 0, pending_mutations: 0
    };
    const defaultCache: import("../types").CacheMetrics = {
      mark_cache_hits: 0, mark_cache_misses: 0, mark_cache_hit_ratio: 0,
      uncompressed_cache_hits: 0, uncompressed_cache_misses: 0, uncompressed_cache_hit_ratio: 0,
      compiled_expression_cache_count: 0
    };
    const defaultResources: import("../types").ResourceMetrics = {
      cpu_load: 0, memory_resident: 0, memory_tracking: 0, background_pool_tasks: 0,
      background_schedule_pool_tasks: 0, background_merges_mutations_pool_tasks: 0,
      global_threads: 0, local_threads: 0, file_descriptors_used: 0, file_descriptors_max: 0,
      read_rate: 0
    };
    const defaultNetwork: import("../types").NetworkMetrics = {
      tcp_connections: 0, http_connections: 0, interserver_connections: 0,
      mysql_connections: 0, postgresql_connections: 0,
      network_send_speed: 0, network_receive_speed: 0
    };

    // Fetch all metrics with individual error handling
    const [
      latency,
      disks,
      merges,
      replication,
      cache,
      resources,
      network,
      errors,
      insertThroughput,
      topTables,
      memoryHistory,
      systemHistory,
      networkHistory,
      performanceHistory,
      detailedMemoryHistory,
      storageCacheHistory,
      concurrencyHistory,
      mergeHistory,
    ] = await Promise.all([
      this.getQueryLatencyMetrics(intervalMinutes).catch(() => defaultLatency),
      this.getDiskMetrics().catch(() => []),
      this.getMergeMetrics(intervalMinutes).catch(() => defaultMerges),
      this.getReplicationMetrics().catch(() => []),
      this.getCacheMetrics().catch(() => defaultCache),
      this.getResourceMetrics(intervalMinutes).catch(() => defaultResources),
      this.getNetworkMetrics(intervalMinutes).catch(() => defaultNetwork),
      this.getErrorMetrics(intervalMinutes).catch(() => []),
      this.getInsertThroughput(intervalMinutes).catch(() => []),
      this.getTopTablesBySize(10).catch(() => []),
      this.getMemoryMetricsHistory(intervalMinutes).catch(() => []),
      this.getSystemMetricsHistory(intervalMinutes).catch(() => []),
      this.getNetworkMetricsHistory(intervalMinutes).catch(() => []),
      this.getPerformanceMetricsHistory(intervalMinutes).catch(() => []),
      this.getDetailedMemoryMetricsHistory(intervalMinutes).catch(() => []),
      this.getStorageCacheMetricsHistory(intervalMinutes).catch(() => []),
      this.getConcurrencyMetricsHistory(intervalMinutes).catch(() => []),
      this.getMergeHistory(intervalMinutes).catch(() => []),
    ]);



    // I should check how the results are destructured.
    // Let me view the Promise.all call first to be safe.


    return {
      latency,
      disks,
      merges,
      replication,
      cache,
      resources,
      network,
      errors,
      insertThroughput,
      topTables,
      memory_history: memoryHistory,
      system_history: systemHistory,
      network_history: networkHistory,
      performance_history: performanceHistory,
      detailed_memory_history: detailedMemoryHistory,
      storage_cache_history: storageCacheHistory,
      concurrency_history: concurrencyHistory,
      merges_history: mergeHistory,
    };
  }

  /**
   * Get system metrics history (Queries, Parts, Merges, Mutations) from system.metric_log
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getSystemMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").SystemHistoryMetric[]> {
    try {
      // Check if system.metric_log exists first
      const checkTable = await this.client.query({
        query: "EXISTS TABLE system.metric_log",
      });
      const checkResponse = await checkTable.json() as JsonResponse<{ result: number }>;

      if (!checkResponse.data[0] || checkResponse.data[0].result !== 1) {
        return [];
      }

      // Determine appropriate time bucket based on interval
      let bucketSeconds = 60; // Default 1 minute
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      const result = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avgIf(value, metric = 'Query') as queries,
            avgIf(value, metric = 'Merge') as merges,
            avgIf(value, metric = 'Mutation') as mutations,
            avgIf(value, metric = 'PartsCommitted') as parts
          FROM system.asynchronous_metric_log
          WHERE metric IN ('Query', 'Merge', 'Mutation', 'PartsCommitted')
            AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const response = await result.json() as JsonResponse<{ ts: number; queries: number; merges: number; mutations: number; parts: number }>;

      return response.data.map(d => ({
        timestamp: Number(d.ts),
        queries: Number(d.queries) || 0,
        merges: Number(d.merges) || 0,
        mutations: Number(d.mutations) || 0,
        parts: Number(d.parts) || 0,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get network traffic history from system.metric_log
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getNetworkMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").NetworkHistoryMetric[]> {
    try {
      // Check if system.metric_log exists first
      const checkTable = await this.client.query({
        query: "EXISTS TABLE system.metric_log",
      });
      const checkResponse = await checkTable.json() as JsonResponse<{ result: number }>;

      if (!checkResponse.data[0] || checkResponse.data[0].result !== 1) {
        return [];
      }

      // Determine appropriate time bucket based on interval
      let bucketSeconds = 60; // Default 1 minute
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      const result = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avg(ProfileEvent_NetworkSendBytes) as network_send_speed,
            avg(ProfileEvent_NetworkReceiveBytes) as network_receive_speed
          FROM system.metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const response = await result.json() as JsonResponse<{ ts: number; network_send_speed: number; network_receive_speed: number }>;

      return response.data.map(d => ({
        timestamp: Number(d.ts),
        network_send_speed: Number(d.network_send_speed) || 0,
        network_receive_speed: Number(d.network_receive_speed) || 0,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get comprehensive performance metrics history including CPU, throughput
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getPerformanceMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").PerformanceHistoryMetric[]> {
    try {
      const checkTable = await this.client.query({
        query: "EXISTS TABLE system.metric_log",
      });
      const checkResponse = await checkTable.json() as JsonResponse<{ result: number }>;

      if (!checkResponse.data[0] || checkResponse.data[0].result !== 1) {
        return [];
      }

      let bucketSeconds = 60;
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      // Query metric_log for ProfileEvents
      const metricResult = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avg(ProfileEvent_OSCPUWaitMicroseconds) / 1000000 as cpu_wait,
            avg(ProfileEvent_OSIOWaitMicroseconds) / 1000000 as cpu_io_wait,
            avg(ProfileEvent_Query) as queries_per_sec,
            avg(ProfileEvent_SelectedRows) as selected_rows_per_sec,
            avg(ProfileEvent_SelectedBytes) as selected_bytes_per_sec,
            avg(ProfileEvent_InsertedBytes) as inserted_bytes_per_sec,
            avg(ProfileEvent_OSReadBytes) as read_from_disk_bytes_per_sec,
            avg(ProfileEvent_OSReadChars) as read_from_fs_bytes_per_sec,
            avg(ProfileEvent_InsertedRows) as inserted_rows_per_sec,
            avg(ProfileEvent_MergedRows) as merged_rows_per_sec
          FROM system.metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      // Query asynchronous_metric_log for OS CPU metrics (Normalized)
      const asyncResult = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avgIf(value, metric = 'OSUserTimeNormalized') as cpu_user,
            avgIf(value, metric = 'OSSystemTimeNormalized') as cpu_system
          FROM system.asynchronous_metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
            AND metric IN ('OSUserTimeNormalized', 'OSSystemTimeNormalized')
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const metricResponse = await metricResult.json() as JsonResponse<any>;
      const asyncResponse = await asyncResult.json() as JsonResponse<any>;

      // Merge the two datasets by timestamp
      const metricMap = new Map(metricResponse.data.map((d: any) => [Number(d.ts), d]));
      const asyncMap = new Map(asyncResponse.data.map((d: any) => [Number(d.ts), d]));

      const allTimestamps = new Set([...metricMap.keys(), ...asyncMap.keys()]);
      const result: import("../types").PerformanceHistoryMetric[] = [];

      for (const ts of Array.from(allTimestamps).sort()) {
        const metricData = (metricMap.get(ts) || {}) as any;
        const asyncData = (asyncMap.get(ts) || {}) as any;

        result.push({
          timestamp: ts,
          cpu_user: Number(asyncData.cpu_user) || 0,
          cpu_system: Number(asyncData.cpu_system) || 0,
          cpu_wait: Number(metricData.cpu_wait) || 0,
          cpu_io_wait: Number(metricData.cpu_io_wait) || 0,
          queries_per_sec: Number(metricData.queries_per_sec) || 0,
          selected_rows_per_sec: Number(metricData.selected_rows_per_sec) || 0,
          selected_bytes_per_sec: Number(metricData.selected_bytes_per_sec) || 0,
          inserted_bytes_per_sec: Number(metricData.inserted_bytes_per_sec) || 0,
          read_from_disk_bytes_per_sec: Number(metricData.read_from_disk_bytes_per_sec) || 0,
          read_from_fs_bytes_per_sec: Number(metricData.read_from_fs_bytes_per_sec) || 0,
          inserted_rows_per_sec: Number(metricData.inserted_rows_per_sec) || 0,
          merged_rows_per_sec: Number(metricData.merged_rows_per_sec) || 0,
        });
      }

      return result;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get detailed memory metrics history
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getDetailedMemoryMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").DetailedMemoryMetric[]> {
    try {
      // Check for table availability
      const [hasMetricLog, hasAsyncMetricLog] = await Promise.all([
        this.checkTableExists('system.metric_log'),
        this.checkTableExists('system.asynchronous_metric_log')
      ]);

      if (!hasMetricLog && !hasAsyncMetricLog) {
        return [];
      }

      let bucketSeconds = 60;
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      let metricMap = new Map<number, any>();
      let asyncMap = new Map<number, any>();

      if (hasMetricLog) {
        const metricResult = await this.client.query({
          query: `
            SELECT
              toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
              avg(CurrentMetric_MemoryTracking) as memory_tracking,
              avg(CurrentMetric_MergesMutationsMemoryTracking) as merges_mutations_memory,
              avg(CurrentMetric_PrimaryIndexCacheBytes) as primary_key_cache_bytes
            FROM system.metric_log
            WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
            GROUP BY ts
            ORDER BY ts
          `,
        });
        const metricResponse = await metricResult.json() as JsonResponse<any>;
        metricMap = new Map(metricResponse.data.map((d: any) => [Number(d.ts), d]));
      }

      if (hasAsyncMetricLog) {
        const asyncResult = await this.client.query({
          query: `
            SELECT
              toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
              avgIf(value, metric = 'MemoryResident') as memory_resident,
              avgIf(value, metric LIKE 'jemalloc.allocated') as jemalloc_allocated,
              avgIf(value, metric LIKE 'jemalloc.resident') as jemalloc_resident,
              avgIf(value, metric = 'TotalPrimaryKeyBytesInMemoryAllocated') as primary_key_memory,
              avgIf(value, metric = 'TotalIndexGranularityBytesInMemoryAllocated') as index_granularity_memory
            FROM system.asynchronous_metric_log
            WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
              AND metric IN ('MemoryResident', 'jemalloc.allocated', 'jemalloc.resident', 
                           'TotalPrimaryKeyBytesInMemoryAllocated', 'TotalIndexGranularityBytesInMemoryAllocated')
            GROUP BY ts
            ORDER BY ts
          `,
        });
        const asyncResponse = await asyncResult.json() as JsonResponse<any>;
        asyncMap = new Map(asyncResponse.data.map((d: any) => [Number(d.ts), d]));
      }

      const allTimestamps = new Set([...metricMap.keys(), ...asyncMap.keys()]);
      const result: import("../types").DetailedMemoryMetric[] = [];

      for (const ts of Array.from(allTimestamps).sort((a, b) => a - b)) {
        const metricData = (metricMap.get(ts) || {}) as any;
        const asyncData = (asyncMap.get(ts) || {}) as any;

        result.push({
          timestamp: ts,
          memory_tracking: Number(metricData.memory_tracking) || 0,
          memory_resident: Number(asyncData.memory_resident) || 0,
          jemalloc_allocated: Number(asyncData.jemalloc_allocated) || 0,
          jemalloc_resident: Number(asyncData.jemalloc_resident) || 0,
          primary_key_memory: Number(asyncData.primary_key_memory) || 0,
          index_granularity_memory: Number(asyncData.index_granularity_memory) || 0,
          merges_mutations_memory: Number(metricData.merges_mutations_memory) || 0,
          cache_bytes: Number(metricData.primary_key_cache_bytes) || 0,
        });
      }

      return result;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get storage and cache metrics history including S3 and cache hit rates
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getStorageCacheMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").StorageCacheMetric[]> {
    try {
      let bucketSeconds = 60;
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      const result = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avg(ProfileEvent_ReadBufferFromS3Bytes) as s3_read_bytes_per_sec,
            avg(ProfileEvent_ReadBufferFromS3Microseconds) as s3_read_microseconds,
            avg(ProfileEvent_ReadBufferFromS3RequestsErrors) as s3_read_errors_per_sec,
            avg(ProfileEvent_DiskS3PutObject + ProfileEvent_DiskS3UploadPart + 
                ProfileEvent_DiskS3CreateMultipartUpload + ProfileEvent_DiskS3CompleteMultipartUpload) as disk_s3_put_requests_per_sec,
            avg(ProfileEvent_DiskS3GetObject + ProfileEvent_DiskS3HeadObject + ProfileEvent_DiskS3ListObjects) as disk_s3_get_requests_per_sec,
            avg(CurrentMetric_FilesystemCacheSize) as filesystem_cache_size,
            if(sum(ProfileEvent_CachedReadBufferReadFromCacheBytes) + sum(ProfileEvent_CachedReadBufferReadFromSourceBytes) > 0,
               sum(ProfileEvent_CachedReadBufferReadFromCacheBytes) / 
               (sum(ProfileEvent_CachedReadBufferReadFromCacheBytes) + sum(ProfileEvent_CachedReadBufferReadFromSourceBytes)),
               0) as fs_cache_hit_rate,
            greatest(0, if(sum(ProfileEvent_OSReadChars) + sum(ProfileEvent_ReadBufferFromS3Bytes) > 0,
                          (sum(ProfileEvent_OSReadChars) - sum(ProfileEvent_OSReadBytes)) / 
                          (sum(ProfileEvent_OSReadChars) + sum(ProfileEvent_ReadBufferFromS3Bytes)),
                          0)) as page_cache_hit_rate
          FROM system.metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const response = await result.json() as JsonResponse<any>;

      return response.data.map((d: any) => ({
        timestamp: Number(d.ts),
        s3_read_bytes_per_sec: Number(d.s3_read_bytes_per_sec) || 0,
        s3_read_microseconds: Number(d.s3_read_microseconds) || 0,
        s3_read_errors_per_sec: Number(d.s3_read_errors_per_sec) || 0,
        disk_s3_put_requests_per_sec: Number(d.disk_s3_put_requests_per_sec) || 0,
        disk_s3_get_requests_per_sec: Number(d.disk_s3_get_requests_per_sec) || 0,
        fs_cache_hit_rate: Number(d.fs_cache_hit_rate) || 0,
        page_cache_hit_rate: Number(d.page_cache_hit_rate) || 0,
        filesystem_cache_size: Number(d.filesystem_cache_size) || 0,
      }));
    } catch (error) {
      return [];
    }
  }


  /**
   * Get merge metrics history
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getMergeHistory(intervalMinutes: number = 60): Promise<import("../types").MergeHistoryMetric[]> {
    try {
      let bucketSeconds = 60;
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      const result = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            max(CurrentMetric_Merge) as merges_running,
            max(CurrentMetric_PartMutation) as mutations_running,
            avg(ProfileEvent_MergedRows) as merged_rows_per_sec,
            avg(ProfileEvent_MergedUncompressedBytes) as merged_bytes_per_sec, 
            max(CurrentMetric_MergesMutationsMemoryTracking) as memory_usage
          FROM system.metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const response = await result.json() as JsonResponse<any>;
      return response.data.map((d: any) => ({
        timestamp: Number(d.ts),
        merges_running: Number(d.merges_running) || 0,
        mutations_running: Number(d.mutations_running) || 0,
        merged_rows_per_sec: Number(d.merged_rows_per_sec) || 0,
        merged_bytes_per_sec: Number(d.merged_bytes_per_sec) || 0,
        memory_usage: Number(d.memory_usage) || 0,
      }));
    } catch (error) {
      console.error("Failed to fetch merge history", error);
      return [];
    }
  }

  /**
   * Get concurrency metrics history including running queries, merges, connections, and parts
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getConcurrencyMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").ConcurrencyMetric[]> {
    try {
      let bucketSeconds = 60;
      if (intervalMinutes <= 15) bucketSeconds = 10;
      else if (intervalMinutes <= 60) bucketSeconds = 60;
      else if (intervalMinutes <= 360) bucketSeconds = 300;
      else bucketSeconds = 1800;

      // Query metric_log for current metrics
      const metricResult = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avg(CurrentMetric_Query) as running_queries,
            avg(CurrentMetric_Merge) as running_merges,
            max(CurrentMetric_TCPConnection) as tcp_connections,
            max(CurrentMetric_HTTPConnection) as http_connections,
            max(CurrentMetric_MySQLConnection) as mysql_connections,
            max(CurrentMetric_InterserverConnection) as interserver_connections
          FROM system.metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      // Query asynchronous_metric_log for parts metrics
      const asyncResult = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avgIf(value, metric = 'TotalPartsOfMergeTreeTables') as total_mergetree_parts,
            maxIf(value, metric = 'MaxPartCountForPartition') as max_parts_per_partition
          FROM system.asynchronous_metric_log
          WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
            AND metric IN ('TotalPartsOfMergeTreeTables', 'MaxPartCountForPartition')
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const metricResponse = await metricResult.json() as JsonResponse<any>;
      const asyncResponse = await asyncResult.json() as JsonResponse<any>;

      const metricMap = new Map(metricResponse.data.map((d: any) => [Number(d.ts), d]));
      const asyncMap = new Map(asyncResponse.data.map((d: any) => [Number(d.ts), d]));

      const allTimestamps = new Set([...metricMap.keys(), ...asyncMap.keys()]);
      const result: import("../types").ConcurrencyMetric[] = [];

      for (const ts of Array.from(allTimestamps).sort()) {
        const metricData = metricMap.get(ts) || {};
        const asyncData = asyncMap.get(ts) || {};

        result.push({
          timestamp: ts,
          running_queries: Number(metricData.running_queries) || 0,
          running_merges: Number(metricData.running_merges) || 0,
          tcp_connections: Number(metricData.tcp_connections) || 0,
          http_connections: Number(metricData.http_connections) || 0,
          mysql_connections: Number(metricData.mysql_connections) || 0,
          interserver_connections: Number(metricData.interserver_connections) || 0,
          total_mergetree_parts: Number(asyncData.total_mergetree_parts) || 0,
          max_parts_per_partition: Number(asyncData.max_parts_per_partition) || 0,
        });
      }

      return result;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get memory usage history from system.asynchronous_metric_log
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getMemoryMetricsHistory(intervalMinutes: number = 60): Promise<import("../types").MemoryHistoryMetric[]> {
    try {
      // Check if system.asynchronous_metric_log exists first
      // This table might not be enabled in all setups
      const checkTable = await this.client.query({
        query: "EXISTS TABLE system.asynchronous_metric_log",
      });
      const checkResponse = await checkTable.json() as JsonResponse<{ result: number }>;

      if (!checkResponse.data[0] || checkResponse.data[0].result !== 1) {
        return [];
      }

      // Determine appropriate time bucket based on interval
      // Target around 60-100 data points for smooth graphs
      let bucketSeconds = 60; // Default 1 minute
      if (intervalMinutes <= 15) bucketSeconds = 10; // 15m -> ~90 points
      else if (intervalMinutes <= 60) bucketSeconds = 60; // 1h -> 60 points
      else if (intervalMinutes <= 360) bucketSeconds = 300; // 6h -> 72 points
      else bucketSeconds = 1800; // 24h -> 48 points

      const result = await this.client.query({
        query: `
          SELECT
            toUnixTimestamp(toStartOfInterval(event_time, INTERVAL ${bucketSeconds} SECOND)) as ts,
            avg(value) / (1024 * 1024 * 1024) as memory_gb
          FROM system.asynchronous_metric_log
          WHERE metric = 'MemoryResident'
            AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          GROUP BY ts
          ORDER BY ts
        `,
      });

      const response = await result.json() as JsonResponse<{ ts: number; memory_gb: number }>;

      return response.data.map(d => ({
        timestamp: Number(d.ts),
        memory_resident_gb: Number(d.memory_gb) || 0,
      }));
    } catch (error) {
      // Silently fail if metric log is not available/accessible
      return [];
    }
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

  /**
   * Get network metrics
   */
  /**
   * Get network metrics
   * @param intervalMinutes - Time interval in minutes (default: 60)
   */
  async getNetworkMetrics(intervalMinutes: number = 60): Promise<import("../types").NetworkMetrics> {
    try {
      // Get connection metrics from system.metrics
      const metricsResult = await this.client.query({
        query: `
          SELECT metric, value FROM system.metrics
          WHERE metric IN ('TCPConnection', 'HTTPConnection', 'InterserverConnection', 'MySQLConnection', 'PostgreSQLConnection')
        `,
      });
      const metricsResponse = await metricsResult.json() as JsonResponse<{ metric: string; value: number }>;
      const metricsMap = Object.fromEntries(metricsResponse.data.map(d => [d.metric, Number(d.value)]));

      // Get throughput metrics (prefer system.metric_log for rates, fallback to system.events)
      let networkSendSpeed = 0;
      let networkReceiveSpeed = 0;

      try {
        // Try to get average rate from last 15 seconds via metric_log
        const logResult = await this.client.query({
          query: `
             SELECT 
               avg(ProfileEvent_NetworkSendBytes) as send_speed,
               avg(ProfileEvent_NetworkReceiveBytes) as receive_speed
             FROM system.metric_log
             WHERE event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
          `,
        });
        const logResponse = await logResult.json() as JsonResponse<{ send_speed: number; receive_speed: number }>;
        if (logResponse.data[0]) {
          networkSendSpeed = Number(logResponse.data[0].send_speed) || 0;
          networkReceiveSpeed = Number(logResponse.data[0].receive_speed) || 0;
        }
      } catch (e) {
        // Fallback or ignore if metric_log not available/doesn't have columns
        // Could implement a system.events delta check here if needed, but 0 is safe fallback
      }

      return {
        tcp_connections: Number(metricsMap.TCPConnection) || 0,
        http_connections: Number(metricsMap.HTTPConnection) || 0,
        interserver_connections: Number(metricsMap.InterserverConnection) || 0,
        mysql_connections: Number(metricsMap.MySQLConnection) || 0,
        postgresql_connections: Number(metricsMap.PostgreSQLConnection) || 0,
        network_send_speed: networkSendSpeed,
        network_receive_speed: networkReceiveSpeed,
      };
    } catch (error) {
      throw this.handleError(error, "Failed to fetch network metrics");
    }
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
  const service = new ClickHouseService(config, { rbacUserId: sessionData.rbacUserId });
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

