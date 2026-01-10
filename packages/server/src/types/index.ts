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
  active_merges: number;
  merge_queue_size: number;
  pending_mutations: number;
  parts_to_merge: number;
  max_parts_per_partition: number;
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

export interface ProductionMetrics {
  latency: QueryLatencyMetrics;
  disks: DiskMetrics[];
  merges: MergeMetrics;
  replication: ReplicationMetrics[];
  cache: CacheMetrics;
  resources: ResourceMetrics;
  errors: ErrorMetrics[];
  insertThroughput: InsertThroughputMetrics[];
  topTables: TopTableBySize[];
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

