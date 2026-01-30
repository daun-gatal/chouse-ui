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
  read_rate: number; // Bytes read per second
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

