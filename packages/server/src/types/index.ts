import { z } from "zod";

// ============================================
// Authentication & Session Types
// ============================================

export const ConnectionConfigSchema = z.object({
  url: z.string().url("Invalid ClickHouse URL"),
  username: z.string().min(1, "Username is required"),
  password: z.string().optional().default(""),
  database: z.string().optional(),
});

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

export interface Session {
  id: string;
  connectionConfig: ConnectionConfig;
  createdAt: Date;
  lastUsedAt: Date;
  isAdmin: boolean;
  permissions: string[];
  version: string;
  rbacConnectionId?: string; // The RBAC connection ID this session is connected to
  rbacUserId?: string; // The RBAC user ID that owns this session (for session ownership validation)
}

export interface SessionInfo {
  sessionId: string;
  username: string;
  isAdmin: boolean;
  version: string;
  expiresAt: Date;
}

// ============================================
// Query Types
// ============================================

export const QueryRequestSchema = z.object({
  query: z.string().min(1, "Query is required"),
  format: z.enum(["JSON", "JSONEachRow", "CSV", "TabSeparated"]).optional().default("JSON"),
  queryId: z.string().optional(),
});

export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export interface QueryStatistics {
  elapsed: number;
  rows_read: number;
  bytes_read: number;
}

export interface QueryMeta {
  name: string;
  type: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  meta: QueryMeta[];
  data: T[];
  statistics: QueryStatistics;
  rows: number;
  queryId?: string | null;
  error?: string | null;
}

// ============================================
// Database Explorer Types
// ============================================

export interface TableInfo {
  name: string;
  type: "table" | "view";
  rows?: string; // Formatted row count (e.g., "1.2M")
  size?: string; // Formatted size (e.g., "500 MB")
  engine?: string; // Table engine type
}

export interface DatabaseInfo {
  name: string;
  type: "database";
  children: TableInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
  comment: string;
}

export interface TableDetails {
  database: string;
  table: string;
  engine: string;
  total_rows: string;
  total_bytes: string;
  columns: ColumnInfo[];
  create_table_query: string;
}

// ============================================
// Saved Queries Types
// ============================================

export const SavedQuerySchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Query name is required"),
  query: z.string().min(1, "Query content is required"),
  isPublic: z.boolean().optional().default(false),
});

export type SavedQueryInput = z.infer<typeof SavedQuerySchema>;

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  created_at: string;
  updated_at: string;
  owner: string;
  is_public: boolean;
}

// ============================================
// Metrics Types
// ============================================

export interface SystemStats {
  version: string;
  uptime: number;
  databaseCount: number;
  tableCount: number;
  totalRows: string;
  totalSize: string;
  memoryUsage: string;
  memoryTotal: string;
  memoryPercentage: number;
  cpuLoad: number;
  activeConnections: number;
  activeQueries: number;
}

export interface RecentQuery {
  query: string;
  duration: number;
  status: "Success" | "Error";
  time: string;
}

// ============================================
// Production Metrics Types
// ============================================

export interface QueryLatencyMetrics {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  avg_ms: number;
  slow_queries_count: number;
}

export interface DiskMetrics {
  name: string;
  path: string;
  free_space: number;
  total_space: number;
  used_space: number;
  used_percent: number;
}

export interface MergeMetrics {
  merges_running: number;
  mutations_running: number;
  merged_rows_per_sec: number;
  merged_bytes_per_sec: number;
  merges_mutations_memory: number;
  pending_mutations: number;
}

export interface ReplicationMetrics {
  database: string;
  table: string;
  absolute_delay: number;
  queue_size: number;
  is_leader: boolean;
  is_readonly: boolean;
  total_replicas: number;
  active_replicas: number;
}

export interface CacheMetrics {
  mark_cache_hits: number;
  mark_cache_misses: number;
  mark_cache_hit_ratio: number;
  uncompressed_cache_hits: number;
  uncompressed_cache_misses: number;
  uncompressed_cache_hit_ratio: number;
  compiled_expression_cache_count: number;
}

export interface ResourceMetrics {
  cpu_load: number;
  memory_resident: number;
  memory_tracking: number;
  background_pool_tasks: number;
  background_schedule_pool_tasks: number;
  background_merges_mutations_pool_tasks: number;
  global_threads: number;
  local_threads: number;
  file_descriptors_used: number;
  file_descriptors_max: number;
  read_rate: number; // Bytes read per second
  // New metrics
  load_average_15?: number;
  total_parts?: number;
  max_parts_per_partition?: number;
  primary_key_cache_bytes?: number;
  primary_key_cache_files?: number;

}

export interface ErrorMetrics {
  exception_code: number;
  exception_name: string;
  count: number;
  sample_error: string;
  last_occurred: string;
}

export interface InsertThroughputMetrics {
  timestamp: number;
  rows_per_second: number;
  bytes_per_second: number;
  inserts_per_second: number;
}

export interface TopTableBySize {
  database: string;
  table: string;
  rows: number;
  bytes_on_disk: number;
  compressed_size: string;
  parts_count: number;
}

export interface NetworkMetrics {
  tcp_connections: number;
  http_connections: number;
  interserver_connections: number;
  mysql_connections: number;
  postgresql_connections: number;
  // Throughput (bytes/sec)
  network_send_speed: number;
  network_receive_speed: number;
}

export interface MemoryHistoryMetric {
  timestamp: number;
  memory_resident_gb: number;
}

export interface SystemHistoryMetric {
  timestamp: number;
  queries: number;
  merges: number;
  mutations: number;
  parts: number;
}

export interface NetworkHistoryMetric {
  timestamp: number;
  network_send_speed: number;
  network_receive_speed: number;
}

export interface MergeHistoryMetric {
  timestamp: number;
  merges_running: number;
  mutations_running: number;
  merged_rows_per_sec: number;
  merged_bytes_per_sec: number;
  memory_usage: number;
}

export interface PerformanceHistoryMetric {
  timestamp: number;
  // CPU metrics (in cores)
  cpu_user: number;
  cpu_system: number;
  cpu_wait: number;
  cpu_io_wait: number;
  // Query throughput
  queries_per_sec: number;
  selected_rows_per_sec: number;
  // Data throughput (bytes/sec)
  selected_bytes_per_sec: number;
  inserted_bytes_per_sec: number;
  read_from_disk_bytes_per_sec: number;
  read_from_fs_bytes_per_sec: number;
  // Process throughput
  inserted_rows_per_sec: number;
  merged_rows_per_sec: number;
}



export interface StorageCacheMetric {
  timestamp: number;
  // S3 metrics
  s3_read_bytes_per_sec: number;
  s3_read_microseconds: number;
  s3_read_errors_per_sec: number;
  // Disk S3 metrics
  disk_s3_put_requests_per_sec: number;
  disk_s3_get_requests_per_sec: number;
  // Cache hit rates (0-1 ratio)
  fs_cache_hit_rate: number;
  page_cache_hit_rate: number;
  // Filesystem cache size
  filesystem_cache_size: number;
}

export interface ConcurrencyMetric {
  timestamp: number;
  running_queries: number;
  running_merges: number;
  tcp_connections: number;
  http_connections: number;
  mysql_connections: number;
  interserver_connections: number;
  total_mergetree_parts: number;
  max_parts_per_partition: number;
}

export interface ProductionMetrics {
  latency: QueryLatencyMetrics;
  disks: DiskMetrics[];
  merges: MergeMetrics;
  replication: ReplicationMetrics[];
  cache: CacheMetrics;
  network: NetworkMetrics;
  resources: ResourceMetrics;
  errors: ErrorMetrics[];
  insertThroughput: InsertThroughputMetrics[];
  topTables: TopTableBySize[];
  memory_history: MemoryHistoryMetric[];
  system_history: SystemHistoryMetric[];
  network_history: NetworkHistoryMetric[];
  // New comprehensive metrics
  performance_history: PerformanceHistoryMetric[];
  detailed_memory_history: DetailedMemoryMetric[];
  storage_cache_history: StorageCacheMetric[];
  concurrency_history: ConcurrencyMetric[];
  merges_history: MergeHistoryMetric[];
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================
// Error Types
// ============================================

export type ErrorCategory =
  | "connection"
  | "authentication"
  | "query"
  | "timeout"
  | "network"
  | "validation"
  | "permission"
  | "unknown";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly category: ErrorCategory,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(message, "BAD_REQUEST", "validation", 400, details);
  }

  static unauthorized(message: string = "Unauthorized"): AppError {
    return new AppError(message, "UNAUTHORIZED", "authentication", 401);
  }

  static forbidden(message: string = "Forbidden"): AppError {
    return new AppError(message, "FORBIDDEN", "permission", 403);
  }

  static notFound(message: string = "Not found"): AppError {
    return new AppError(message, "NOT_FOUND", "unknown", 404);
  }

  static internal(message: string, details?: unknown): AppError {
    return new AppError(message, "INTERNAL_ERROR", "unknown", 500, details);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      details: this.details,
    };
  }
}


export interface DetailedMemoryMetric {
  timestamp: number;
  memory_tracking: number;          // CurrentMetric_MemoryTracking
  memory_resident: number;           // MemoryResident (async)
  jemalloc_allocated: number;        // jemalloc.allocated (async)
  jemalloc_resident: number;         // jemalloc.resident (async)
  primary_key_memory: number;        // TotalPrimaryKeyBytesInMemoryAllocated
  index_granularity_memory: number;  // TotalIndexGranularityBytesInMemoryAllocated
  merges_mutations_memory: number;   // CurrentMetric_MergesMutationsMemoryTracking
  cache_bytes: number;               // Sum of cache bytes (already tracked)
}
