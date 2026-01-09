/**
 * Migration Example
 * 
 * This file shows how to add new migrations for version upgrades.
 * 
 * To add a new migration:
 * 1. Add a new entry to the MIGRATIONS array in migrations.ts
 * 2. Update APP_VERSION constant
 * 3. Implement the up() function (and optionally down() for rollback)
 * 
 * The migration system will:
 * - Only run migrations that haven't been applied yet
 * - Track applied migrations in the _rbac_migrations table
 * - Run migrations in version order
 */

import { sql } from 'drizzle-orm';
import type { RbacDb, SqliteDb, PostgresDb } from './index';
import type { Migration } from './migrations';

// ============================================
// Example: Adding API Keys feature (v1.1.0)
// ============================================

export const migration_1_1_0_api_keys: Migration = {
  version: '1.1.0',
  name: 'add_api_keys',
  description: 'Add API keys table for programmatic access',
  
  up: async (db) => {
    const { isSqlite } = await import('./index');
    
    if (isSqlite()) {
      // SQLite migration
      (db as SqliteDb).run(sql`
        CREATE TABLE IF NOT EXISTS rbac_api_keys (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          scopes TEXT,
          expires_at TEXT,
          last_used_at TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          revoked_at TEXT
        )
      `);
      
      (db as SqliteDb).run(sql`
        CREATE INDEX IF NOT EXISTS idx_rbac_api_keys_user_id ON rbac_api_keys(user_id)
      `);
      
      (db as SqliteDb).run(sql`
        CREATE INDEX IF NOT EXISTS idx_rbac_api_keys_prefix ON rbac_api_keys(key_prefix)
      `);
    } else {
      // PostgreSQL migration
      await (db as PostgresDb).execute(sql`
        CREATE TABLE IF NOT EXISTS rbac_api_keys (
          id UUID PRIMARY KEY NOT NULL,
          user_id UUID NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          key_hash VARCHAR(255) NOT NULL UNIQUE,
          key_prefix VARCHAR(20) NOT NULL,
          scopes TEXT[],
          expires_at TIMESTAMP WITH TIME ZONE,
          last_used_at TIMESTAMP WITH TIME ZONE,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMP WITH TIME ZONE
        )
      `);
      
      await (db as PostgresDb).execute(sql`
        CREATE INDEX IF NOT EXISTS idx_rbac_api_keys_user_id ON rbac_api_keys(user_id)
      `);
      
      await (db as PostgresDb).execute(sql`
        CREATE INDEX IF NOT EXISTS idx_rbac_api_keys_prefix ON rbac_api_keys(key_prefix)
      `);
    }
    
    console.log('[Migration 1.1.0] Added API keys table');
  },
  
  // Optional rollback function
  down: async (db) => {
    const { isSqlite } = await import('./index');
    
    if (isSqlite()) {
      (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_api_keys`);
    } else {
      await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_api_keys`);
    }
    
    console.log('[Migration 1.1.0] Rolled back API keys table');
  },
};

// ============================================
// Example: Adding user settings (v1.2.0)
// ============================================

export const migration_1_2_0_user_settings: Migration = {
  version: '1.2.0',
  name: 'add_user_settings',
  description: 'Add user settings/preferences table',
  
  up: async (db) => {
    const { isSqlite } = await import('./index');
    
    if (isSqlite()) {
      (db as SqliteDb).run(sql`
        CREATE TABLE IF NOT EXISTS rbac_user_settings (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL UNIQUE REFERENCES rbac_users(id) ON DELETE CASCADE,
          theme TEXT DEFAULT 'dark',
          language TEXT DEFAULT 'en',
          timezone TEXT DEFAULT 'UTC',
          notifications_enabled INTEGER DEFAULT 1,
          settings_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      await (db as PostgresDb).execute(sql`
        CREATE TABLE IF NOT EXISTS rbac_user_settings (
          id UUID PRIMARY KEY NOT NULL,
          user_id UUID NOT NULL UNIQUE REFERENCES rbac_users(id) ON DELETE CASCADE,
          theme VARCHAR(20) DEFAULT 'dark',
          language VARCHAR(10) DEFAULT 'en',
          timezone VARCHAR(50) DEFAULT 'UTC',
          notifications_enabled BOOLEAN DEFAULT true,
          settings_json JSONB,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `);
    }
    
    console.log('[Migration 1.2.0] Added user settings table');
  },
};

// ============================================
// Example: Adding column to existing table (v1.3.0)
// ============================================

export const migration_1_3_0_user_mfa: Migration = {
  version: '1.3.0',
  name: 'add_mfa_columns',
  description: 'Add MFA (multi-factor auth) columns to users table',
  
  up: async (db) => {
    const { isSqlite } = await import('./index');
    
    if (isSqlite()) {
      // SQLite doesn't support adding multiple columns in one statement
      (db as SqliteDb).run(sql`
        ALTER TABLE rbac_users ADD COLUMN mfa_enabled INTEGER DEFAULT 0
      `);
      (db as SqliteDb).run(sql`
        ALTER TABLE rbac_users ADD COLUMN mfa_secret TEXT
      `);
      (db as SqliteDb).run(sql`
        ALTER TABLE rbac_users ADD COLUMN mfa_backup_codes TEXT
      `);
    } else {
      await (db as PostgresDb).execute(sql`
        ALTER TABLE rbac_users 
        ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT[]
      `);
    }
    
    console.log('[Migration 1.3.0] Added MFA columns to users table');
  },
};

// ============================================
// How to Register Migrations
// ============================================

/**
 * To register these migrations, add them to the MIGRATIONS array in migrations.ts:
 * 
 * ```typescript
 * import { 
 *   migration_1_1_0_api_keys,
 *   migration_1_2_0_user_settings,
 *   migration_1_3_0_user_mfa,
 * } from './migrations.example';
 * 
 * const MIGRATIONS: Migration[] = [
 *   {
 *     version: '1.0.0',
 *     name: 'init',
 *     description: 'Initial RBAC schema',
 *     up: async (db) => { ... },
 *   },
 *   migration_1_1_0_api_keys,
 *   migration_1_2_0_user_settings,
 *   migration_1_3_0_user_mfa,
 * ];
 * 
 * // Also update APP_VERSION
 * export const APP_VERSION = '1.3.0';
 * ```
 * 
 * The migration system will automatically:
 * 1. Skip migrations that have already been applied
 * 2. Run new migrations in order
 * 3. Record each migration in _rbac_migrations table
 */
