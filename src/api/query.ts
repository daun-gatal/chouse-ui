/**
 * Query API
 */

import { api } from './client';

// ============================================
// Types
// ============================================

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

export interface IntellisenseData {
  columns: Array<{
    database: string;
    table: string;
    column_name: string;
    column_type: string;
  }>;
  functions: string[];
  keywords: string[];
}

// ============================================
// API Functions
// ============================================

/**
 * Execute a SQL query
 */
export async function executeQuery<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/execute', { query, format });
}

/**
 * Get intellisense data for SQL editor
 */
export async function getIntellisenseData(): Promise<IntellisenseData> {
  return api.get<IntellisenseData>('/query/intellisense');
}

