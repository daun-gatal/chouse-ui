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
 * Initialize the database connection
 */
export async function initializeDatabase(config?: DatabaseConfig): Promise<RbacDb> {
  const cfg = config || getDatabaseConfig();
  
  if (dbInstance) {
    return dbInstance;
  }

  if (cfg.type === 'sqlite') {
    // Ensure data directory exists
    const path = cfg.sqlitePath || './data/rbac.db';
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      await Bun.write(dir + '/.gitkeep', '');
    }
    
    // Create SQLite connection
    sqliteClient = new Database(path);
    sqliteClient.exec('PRAGMA journal_mode = WAL;');
    sqliteClient.exec('PRAGMA foreign_keys = ON;');
    
    dbInstance = drizzleSqlite(sqliteClient, { schema: sqliteSchema });
    console.log(`[RBAC] Connected to SQLite database: ${path}`);
  } else if (cfg.type === 'postgres') {
    if (!cfg.postgresUrl) {
      throw new Error('[RBAC] PostgreSQL URL is required. Set RBAC_POSTGRES_URL or DATABASE_URL');
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
