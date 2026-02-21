/**
 * Metrics API
 */

import { api } from './client';

// ============================================
// Types
// ============================================

export interface SystemStats {
  version: string;
  uptime: number;
  databaseCount: number;
  tableCount: number;
  totalRows: number;
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
  status: 'Success' | 'Error';
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

export interface MergeHistoryMetric {
  timestamp: number;
  merges_running: number;
  mutations_running: number;
  merged_rows_per_sec: number;
  merged_bytes_per_sec: number;
  memory_usage: number;
}

export interface NetworkHistoryMetric {
  timestamp: number;
  network_send_speed: number;
  network_receive_speed: number;
}

export interface PerformanceHistoryMetric {
  timestamp: number;
  // CPU metrics (normalized ratio)
  cpu_user: number;
  cpu_system: number;
  cpu_wait: number;
  cpu_io_wait: number;
  // CPU usage in cores
  cpu_cores: number;
  // Load average
  load_average_15: number;
  // Query throughput
  queries_per_sec: number;
  selected_rows_per_sec: number;
  // Data throughput (bytes/sec)
  selected_bytes_per_sec: number;
  inserted_bytes_per_sec: number;
  read_from_disk_bytes_per_sec: number;
  read_from_fs_bytes_per_sec: number;
  write_to_disk_bytes_per_sec: number;
  write_to_fs_bytes_per_sec: number;
  // Process throughput
  inserted_rows_per_sec: number;
  merged_rows_per_sec: number;
  // Delayed inserts (backpressure indicator)
  delayed_inserts_per_sec: number;
  delayed_inserts_wait_sec: number;
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

export interface ZooKeeperMetric {
  timestamp: number;
  transactions_per_sec: number;
  wait_seconds: number;
  bytes_sent_per_sec: number;
  bytes_received_per_sec: number;
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
  // Comprehensive metrics
  performance_history: PerformanceHistoryMetric[];
  detailed_memory_history: DetailedMemoryMetric[];
  storage_cache_history: StorageCacheMetric[];
  concurrency_history: ConcurrencyMetric[];
  merges_history: MergeHistoryMetric[];
  zookeeper_history: ZooKeeperMetric[];
}

// ============================================
// API Functions
// ============================================

/**
 * Get system statistics
 */
export async function getSystemStats(): Promise<SystemStats> {
  return api.get<SystemStats>('/metrics/stats');
}

/**
 * Get recent queries from query log
 * @param limit - Number of queries to fetch
 * @param username - Optional username to filter by (for non-admin users)
 */
export async function getRecentQueries(limit: number = 10, username?: string): Promise<RecentQuery[]> {
  return api.get<RecentQuery[]>('/metrics/recent-queries', {
    params: { limit, username },
  });
}

/**
 * Get all production metrics in one optimized call
 * @param interval - Time interval in minutes (default: 60)
 */
export async function getProductionMetrics(interval: number = 60): Promise<ProductionMetrics> {
  return api.get<ProductionMetrics>('/metrics/production', {
    params: { interval },
  });
}

/**
 * Get query latency percentiles
 * @param interval - Time interval in minutes (default: 60)
 */
export async function getQueryLatency(interval: number = 60): Promise<QueryLatencyMetrics> {
  return api.get<QueryLatencyMetrics>('/metrics/latency', {
    params: { interval },
  });
}

/**
 * Get disk space usage metrics
 */
export async function getDiskMetrics(): Promise<DiskMetrics[]> {
  return api.get<DiskMetrics[]>('/metrics/disks');
}

/**
 * Get merge and mutation metrics
 */
export async function getMergeMetrics(): Promise<MergeMetrics> {
  return api.get<MergeMetrics>('/metrics/merges');
}

/**
 * Get replication status metrics
 */
export async function getReplicationMetrics(): Promise<ReplicationMetrics[]> {
  return api.get<ReplicationMetrics[]>('/metrics/replication');
}

/**
 * Get cache hit ratio metrics
 */
export async function getCacheMetrics(): Promise<CacheMetrics> {
  return api.get<CacheMetrics>('/metrics/cache');
}

/**
 * Get resource usage metrics
 */
export async function getResourceMetrics(): Promise<ResourceMetrics> {
  return api.get<ResourceMetrics>('/metrics/resources');
}

/**
 * Get error breakdown metrics
 * @param interval - Time interval in minutes (default: 60)
 */
export async function getErrorMetrics(interval: number = 60): Promise<ErrorMetrics[]> {
  return api.get<ErrorMetrics[]>('/metrics/errors', {
    params: { interval },
  });
}

/**
 * Get insert throughput time series
 * @param interval - Time interval in minutes (default: 60)
 */
export async function getInsertThroughput(interval: number = 60): Promise<InsertThroughputMetrics[]> {
  return api.get<InsertThroughputMetrics[]>('/metrics/insert-throughput', {
    params: { interval },
  });
}

/**
 * Get top tables by size
 * @param limit - Number of tables to return (default: 10)
 */
export async function getTopTables(limit: number = 10): Promise<TopTableBySize[]> {
  return api.get<TopTableBySize[]>('/metrics/top-tables', {
    params: { limit },
  });
}

/**
 * Execute a custom metrics query (SELECT only)
 */
export async function executeMetricsQuery<T = Record<string, unknown>>(
  query: string
): Promise<{ meta: unknown[]; data: T[]; statistics: unknown; rows: number }> {
  return api.get('/metrics/custom', {
    params: { query },
  });
}


export interface DetailedMemoryMetric {
  timestamp: number;
  memory_tracking: number;
  memory_resident: number;
  jemalloc_allocated: number;
  jemalloc_resident: number;
  primary_key_memory: number;
  index_granularity_memory: number;
  merges_mutations_memory: number;
  cache_bytes: number;
}
