/**
 * Explorer API
 */

import { api } from './client';

// ============================================
// Types
// ============================================

export interface TableInfo {
  name: string;
  type: 'table' | 'view';
}

export interface DatabaseInfo {
  name: string;
  type: 'database';
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

export interface CreateDatabaseInput {
  name: string;
  engine?: string;
  cluster?: string;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  default?: string;
  comment?: string;
}

export interface CreateTableInput {
  database: string;
  name: string;
  columns: ColumnDefinition[];
  engine?: string;
  orderBy?: string;
  partitionBy?: string;
  primaryKey?: string;
  cluster?: string;
}

// ============================================
// API Functions
// ============================================

/**
 * Get all databases and tables
 */
export async function getDatabases(): Promise<DatabaseInfo[]> {
  return api.get<DatabaseInfo[]>('/explorer/databases');
}

/**
 * Get table details
 */
export async function getTableDetails(database: string, table: string): Promise<TableDetails> {
  return api.get<TableDetails>(`/explorer/table/${database}/${table}`);
}

/**
 * Get table data sample
 */
export async function getTableSample(
  database: string,
  table: string,
  limit: number = 100
): Promise<{ meta: any[]; data: any[]; statistics: any; rows: number }> {
  return api.get(`/explorer/table/${database}/${table}/sample`, {
    params: { limit },
  });
}

/**
 * Create a new database
 */
export async function createDatabase(input: CreateDatabaseInput): Promise<{ message: string }> {
  return api.post('/explorer/database', input);
}

/**
 * Drop a database
 */
export async function dropDatabase(name: string): Promise<{ message: string }> {
  return api.delete(`/explorer/database/${name}`);
}

/**
 * Create a new table
 */
export async function createTable(input: CreateTableInput): Promise<{ message: string }> {
  return api.post('/explorer/table', input);
}

/**
 * Drop a table
 */
export async function dropTable(database: string, table: string): Promise<{ message: string }> {
  return api.delete(`/explorer/table/${database}/${table}`);
}

