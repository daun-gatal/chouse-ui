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
 * Execute a custom metrics query (SELECT only)
 */
export async function executeMetricsQuery<T = Record<string, unknown>>(
  query: string
): Promise<{ meta: any[]; data: T[]; statistics: any; rows: number }> {
  return api.get('/metrics/custom', {
    params: { query },
  });
}

