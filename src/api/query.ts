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
 * Execute a SQL query (automatically routes to appropriate endpoint)
 * @deprecated Use specific query functions (executeSelect, executeInsert, etc.) for better type safety
 */
export async function executeQuery<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  // Auto-detect query type and route to appropriate endpoint
  const queryType = detectQueryType(query);
  
  switch (queryType) {
    case 'select':
      return executeSelect<T>(query, format);
    case 'insert':
      return executeInsert<T>(query, format);
    case 'update':
      return executeUpdate<T>(query, format);
    case 'delete':
      return executeDelete<T>(query, format);
    case 'create':
      return executeCreate<T>(query, format);
    case 'drop':
      return executeDrop<T>(query, format);
    case 'alter':
      return executeAlter<T>(query, format);
    case 'truncate':
      return executeTruncate<T>(query, format);
    case 'show':
      return executeShow<T>(query, format);
    case 'system':
      return executeSystem<T>(query, format);
    default:
      // Unknown query type - try to route as SELECT (safest default for read operations)
      console.warn(`[Query API] Unknown query type, routing as SELECT: ${query.substring(0, 50)}...`);
      return executeSelect<T>(query, format);
  }
}

/**
 * Execute SELECT queries from tables (read-only)
 */
export async function executeSelect<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/select', { query, format });
}

/**
 * Execute INSERT statements into tables
 */
export async function executeInsert<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/insert', { query, format });
}

/**
 * Execute UPDATE statements on tables
 */
export async function executeUpdate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/update', { query, format });
}

/**
 * Execute DELETE statements from tables
 */
export async function executeDelete<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/delete', { query, format });
}

/**
 * Execute CREATE TABLE statements (DDL)
 */
export async function executeCreate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  // Auto-detect if it's CREATE DATABASE or CREATE TABLE
  const normalized = query.trim().toUpperCase();
  if (normalized.match(/^CREATE\s+(OR\s+REPLACE\s+)?DATABASE/i)) {
    return api.post<QueryResult<T>>('/query/database/create', { query, format });
  } else {
    return api.post<QueryResult<T>>('/query/table/create', { query, format });
  }
}

/**
 * Execute DROP statements (DDL)
 * Auto-routes to /query/table/drop or /query/database/drop
 */
export async function executeDrop<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  // Auto-detect if it's DROP DATABASE or DROP TABLE
  const normalized = query.trim().toUpperCase();
  
  if (normalized.match(/^DROP\s+(DATABASE|SCHEMA)/i)) {
    return api.post<QueryResult<T>>('/query/database/drop', { query, format });
  } else {
    return api.post<QueryResult<T>>('/query/table/drop', { query, format });
  }
}

/**
 * Execute ALTER statements (DDL)
 * Auto-routes to /query/table/alter or /query/database/alter
 */
export async function executeAlter<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  // Auto-detect if it's ALTER DATABASE or ALTER TABLE
  const normalized = query.trim().toUpperCase();
  if (normalized.match(/^ALTER\s+(DATABASE|SCHEMA)/i)) {
    return api.post<QueryResult<T>>('/query/database/alter', { query, format });
  } else {
    return api.post<QueryResult<T>>('/query/table/alter', { query, format });
  }
}

/**
 * Execute TRUNCATE TABLE statements
 */
export async function executeTruncate<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/table/truncate', { query, format });
}

/**
 * Execute SHOW queries (read-only system queries)
 */
export async function executeShow<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/show', { query, format });
}

/**
 * Execute system queries (DESCRIBE, system table queries)
 */
export async function executeSystem<T = Record<string, unknown>>(
  query: string,
  format: 'JSON' | 'JSONEachRow' | 'CSV' | 'TabSeparated' = 'JSON'
): Promise<QueryResult<T>> {
  return api.post<QueryResult<T>>('/query/system', { query, format });
}

/**
 * Get intellisense data for SQL editor
 */
export async function getIntellisenseData(): Promise<IntellisenseData> {
  return api.get<IntellisenseData>('/query/intellisense');
}

