/**
 * Database Abstraction Layer
 * 
 * Provides a unified interface for SQLite and PostgreSQL.
 * Automatically selects the appropriate driver based on configuration.
 */

import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { Database } from 'bun:sqlite';
import postgres from 'postgres';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

import * as sqliteSchema from '../schema/sqlite';
import * as postgresSchema from '../schema/postgres';

// ============================================
// Configuration
// ============================================

export type DatabaseType = 'sqlite' | 'postgres';

export interface DatabaseConfig {
  type: DatabaseType;
  // SQLite options
  sqlitePath?: string;
  // PostgreSQL options
  postgresUrl?: string;
  postgresPoolSize?: number;
}

// Environment-based configuration
export function getDatabaseConfig(): DatabaseConfig {
  const dbType = (process.env.RBAC_DB_TYPE || 'sqlite') as DatabaseType;
  
  return {
    type: dbType,
    sqlitePath: process.env.RBAC_SQLITE_PATH || './data/rbac.db',
    postgresUrl: process.env.RBAC_POSTGRES_URL || process.env.DATABASE_URL,
    postgresPoolSize: parseInt(process.env.RBAC_POSTGRES_POOL_SIZE || '10', 10),
  };
}

// ============================================
// Database Instance Types
// ============================================

export type SqliteDb = ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>;
export type PostgresDb = ReturnType<typeof drizzlePostgres<typeof postgresSchema>>;
export type RbacDb = SqliteDb | PostgresDb;

// ============================================
// Database Connection Manager
// ============================================

let dbInstance: RbacDb | null = null;
let sqliteClient: Database | null = null;
let postgresClient: ReturnType<typeof postgres> | null = null;

/**
 * Parse PostgreSQL URL to extract database name and connection details
 */
function parsePostgresUrl(url: string): {
  protocol: string;
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
  originalUrl: string;
} {
  try {
    const urlObj = new URL(url);
    const database = urlObj.pathname.slice(1); // Remove leading '/'
    
    return {
      protocol: urlObj.protocol,
      username: urlObj.username,
      password: urlObj.password,
      host: urlObj.hostname,
      port: parseInt(urlObj.port || '5432', 10),
      database: database || 'postgres',
      originalUrl: url,
    };
  } catch (error) {
    throw new Error(`[RBAC] Invalid PostgreSQL URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a PostgreSQL URL with a different database name
 */
function createPostgresUrlWithDb(
  originalUrl: string,
  newDatabase: string
): string {
  const parsed = parsePostgresUrl(originalUrl);
  const urlObj = new URL(originalUrl);
  urlObj.pathname = `/${newDatabase}`;
  return urlObj.toString();
}

/**
 * Escape PostgreSQL identifier (database name, table name, etc.)
 * Wraps identifier in double quotes and escapes any existing quotes
 */
function escapePostgresIdentifier(identifier: string): string {
  // Replace double quotes with escaped double quotes and wrap in quotes
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Ensure PostgreSQL database exists, create it if it doesn't
 */
async function ensurePostgresDatabaseExists(postgresUrl: string): Promise<void> {
  const parsed = parsePostgresUrl(postgresUrl);
  
  // If database name is 'postgres', it always exists
  if (parsed.database === 'postgres') {
    return;
  }
  
  // Connect to default 'postgres' database to check/create target database
  const adminUrl = createPostgresUrlWithDb(postgresUrl, 'postgres');
  const adminClient = postgres(adminUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  
  try {
    // Check if database exists
    const result = await adminClient`
      SELECT 1 FROM pg_database WHERE datname = ${parsed.database}
    `;
    
    if (result.length === 0) {
      // Database doesn't exist, create it
      console.log(`[RBAC] Creating PostgreSQL database: ${parsed.database}`);
      const escapedDbName = escapePostgresIdentifier(parsed.database);
      await adminClient.unsafe(`CREATE DATABASE ${escapedDbName}`);
      console.log(`[RBAC] PostgreSQL database created: ${parsed.database}`);
    } else {
      console.log(`[RBAC] PostgreSQL database already exists: ${parsed.database}`);
    }
  } finally {
    await adminClient.end();
  }
}

/**
 * Ensure SQLite database file and directory exist
 */
async function ensureSqliteDatabaseExists(sqlitePath: string): Promise<void> {
  const dir = dirname(sqlitePath);
  
  // Create directory if it doesn't exist (skip if it's current directory or root)
  if (dir && dir !== '.' && dir !== './' && dir !== '/' && !existsSync(dir)) {
    try {
      await mkdir(dir, { recursive: true });
      console.log(`[RBAC] Created SQLite directory: ${dir}`);
    } catch (error) {
      console.warn(`[RBAC] Warning: Could not create SQLite directory ${dir}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // The database file will be created automatically when we open it
  // Log status for user information
  if (!existsSync(sqlitePath)) {
    console.log(`[RBAC] SQLite database file will be created: ${sqlitePath}`);
  } else {
    console.log(`[RBAC] SQLite database file already exists: ${sqlitePath}`);
  }
}

/**
 * Initialize the database connection
 */
export async function initializeDatabase(config?: DatabaseConfig): Promise<RbacDb> {
  const cfg = config || getDatabaseConfig();
  
  if (dbInstance) {
    return dbInstance;
  }

  if (cfg.type === 'sqlite') {
    // Ensure SQLite database file and directory exist
    const path = cfg.sqlitePath || './data/rbac.db';
    await ensureSqliteDatabaseExists(path);
    
    // Create SQLite connection (file is created automatically if it doesn't exist)
    sqliteClient = new Database(path);
    sqliteClient.exec('PRAGMA journal_mode = WAL;');
    sqliteClient.exec('PRAGMA foreign_keys = ON;');
    
    dbInstance = drizzleSqlite(sqliteClient, { schema: sqliteSchema });
    console.log(`[RBAC] Connected to SQLite database: ${path}`);
  } else if (cfg.type === 'postgres') {
    if (!cfg.postgresUrl) {
      throw new Error('[RBAC] PostgreSQL URL is required. Set RBAC_POSTGRES_URL or DATABASE_URL');
    }
    
    // Ensure PostgreSQL database exists, create it if it doesn't
    try {
      await ensurePostgresDatabaseExists(cfg.postgresUrl);
    } catch (error) {
      console.warn(`[RBAC] Warning: Could not ensure PostgreSQL database exists: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.warn(`[RBAC] Attempting to connect anyway...`);
    }
    
    // Create PostgreSQL connection
    postgresClient = postgres(cfg.postgresUrl, {
      max: cfg.postgresPoolSize || 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    
    dbInstance = drizzlePostgres(postgresClient, { schema: postgresSchema });
    console.log(`[RBAC] Connected to PostgreSQL database`);
  } else {
    throw new Error(`[RBAC] Unsupported database type: ${cfg.type}`);
  }

  return dbInstance;
}

/**
 * Get the current database instance
 */
export function getDatabase(): RbacDb {
  if (!dbInstance) {
    throw new Error('[RBAC] Database not initialized. Call initializeDatabase() first.');
  }
  return dbInstance;
}

/**
 * Get the database type
 */
export function getDatabaseType(): DatabaseType {
  return getDatabaseConfig().type;
}

/**
 * Check if using SQLite
 */
export function isSqlite(): boolean {
  return getDatabaseType() === 'sqlite';
}

/**
 * Check if using PostgreSQL
 */
export function isPostgres(): boolean {
  return getDatabaseType() === 'postgres';
}

/**
 * Get the appropriate schema based on database type
 */
export function getSchema() {
  return isSqlite() ? sqliteSchema : postgresSchema;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (sqliteClient) {
    sqliteClient.close();
    sqliteClient = null;
  }
  
  if (postgresClient) {
    await postgresClient.end();
    postgresClient = null;
  }
  
  dbInstance = null;
  console.log('[RBAC] Database connection closed');
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<{ healthy: boolean; type: DatabaseType; error?: string }> {
  try {
    const db = getDatabase();
    const type = getDatabaseType();
    
    // Simple query to check connection
    if (isSqlite()) {
      (db as SqliteDb).run(sql`SELECT 1`);
    } else {
      await (db as PostgresDb).execute(sql`SELECT 1`);
    }
    
    return { healthy: true, type };
  } catch (error) {
    return { 
      healthy: false, 
      type: getDatabaseType(),
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Re-export sql for convenience
export { sql };

// Export migration utilities
export * from './migrations';
