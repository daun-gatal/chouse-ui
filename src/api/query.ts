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
  queryId?: string | null;
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
// Query Type Detection
// ============================================

/**
 * Detect the type of SQL query to route to the appropriate endpoint
 */
export function detectQueryType(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'create' | 'drop' | 'alter' | 'truncate' | 'show' | 'system' | 'unknown' {
  const normalized = sql.trim().toUpperCase();

  // Check for SELECT (including WITH clauses)
  if (normalized.startsWith('SELECT') || normalized.startsWith('WITH')) {
    return 'select';
  }

  // Check for INSERT
  if (normalized.startsWith('INSERT')) {
    return 'insert';
  }

  // Check for UPDATE
  if (normalized.startsWith('UPDATE')) {
    return 'update';
  }

  // Check for DELETE
  if (normalized.startsWith('DELETE')) {
    return 'delete';
  }

  // Check for CREATE
  if (normalized.startsWith('CREATE')) {
    return 'create';
  }

  // Check for DROP
  if (normalized.startsWith('DROP')) {
    return 'drop';
  }

  // Check for ALTER
  if (normalized.startsWith('ALTER')) {
    return 'alter';
  }

  // Check for TRUNCATE
  if (normalized.startsWith('TRUNCATE')) {
    return 'truncate';
  }

  // Check for SHOW
  if (normalized.startsWith('SHOW')) {
    return 'show';
  }

  // Check for system queries (DESCRIBE, DESC, or SELECT from system tables)
  if (normalized.startsWith('DESCRIBE') || normalized.startsWith('DESC')) {
    return 'system';
  }

  // Check if it's a SELECT from system database
  if (normalized.startsWith('SELECT') && normalized.includes('FROM SYSTEM.')) {
    return 'system';
  }

  return 'unknown';
}

// ============================================
// API Functions
// ============================================

/**
 * Execute a SQL query
 * Routes to the generic execution endpoint which handles parsing and permission checks
 */
export async function executeQuery<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Use the generic execution endpoint for all queries
  // The backend determines the query type and validates permissions
  return api.post<QueryResult<T>>('/query/execute', { query, format, queryId });
}

/**
 * Execute SELECT queries from tables (read-only)
 */
export async function executeSelect<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/select', { query, format, queryId });
}

/**
 * Execute INSERT statements into tables
 */
export async function executeInsert<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/insert', { query, format, queryId });
}

/**
 * Execute UPDATE statements on tables
 */
export async function executeUpdate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/update', { query, format, queryId });
}

/**
 * Execute DELETE statements from tables
 */
export async function executeDelete<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/delete', { query, format, queryId });
}

/**
 * Execute CREATE TABLE statements (DDL)
 */
export async function executeCreate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Auto-detect if it's CREATE DATABASE or CREATE TABLE
  const normalized = query.trim().toUpperCase();
  if (normalized.match(/^CREATE\s+(OR\s+REPLACE\s+)?DATABASE/i)) {
    return api.post<QueryResult<T>>('/query/database/create', { query, format, queryId });
  } else {
    return api.post<QueryResult<T>>('/query/table/create', { query, format, queryId });
  }
}

/**
 * Execute DROP statements (DDL)
 * Auto-routes to /query/table/drop or /query/database/drop
 */
export async function executeDrop<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Auto-detect if it's DROP DATABASE or DROP TABLE
  const normalized = query.trim().toUpperCase();

  if (normalized.match(/^DROP\s+(DATABASE|SCHEMA)/i)) {
    return api.post<QueryResult<T>>('/query/database/drop', { query, format, queryId });
  } else {
    return api.post<QueryResult<T>>('/query/table/drop', { query, format, queryId });
  }
}

/**
 * Execute ALTER statements (DDL)
 * Auto-routes to /query/table/alter or /query/database/alter
 */
export async function executeAlter<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  // Auto-detect if it's ALTER DATABASE or ALTER TABLE
  const normalized = query.trim().toUpperCase();
  if (normalized.match(/^ALTER\s+(DATABASE|SCHEMA)/i)) {
    return api.post<QueryResult<T>>('/query/database/alter', { query, format, queryId });
  } else {
    return api.post<QueryResult<T>>('/query/table/alter', { query, format, queryId });
  }
}

/**
 * Execute TRUNCATE TABLE statements
 */
export async function executeTruncate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/truncate', { query, format, queryId });
}

/**
 * Execute SHOW queries (read-only system queries)
 */
export async function executeShow<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/show', { query, format, queryId });
}

/**
 * Execute system queries (DESCRIBE, system table queries)
 */
export async function executeSystem<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON',
  queryId?: string
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/system', { query, format, queryId });
}

/**
 * Get intellisense data for SQL editor
 */
export async function getIntellisenseData(): Promise<IntellisenseData> {
  return api.get<IntellisenseData>('/query/intellisense');
}

