/**
 * RBAC Migration Manager
 * 
 * Handles database schema migrations with version tracking.
 * Supports:
 * - Fresh installation (runs all migrations + seed)
 * - Version upgrades (runs only new migrations)
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDatabase, getDatabaseType, isSqlite, getSchema, type RbacDb, type SqliteDb, type PostgresDb } from './index';
import { SYSTEM_ROLES } from '../schema/base';
import { hashPassword } from '../services/password';

// ============================================
// Types
// ============================================

export interface Migration {
  version: string;
  name: string;
  description: string;
  up: (db: RbacDb) => Promise<void>;
  down?: (db: RbacDb) => Promise<void>;
}

export interface MigrationStatus {
  version: string;
  name: string;
  appliedAt: Date;
}

export interface MigrationResult {
  isFirstRun: boolean;
  migrationsApplied: string[];
  currentVersion: string;
  previousVersion: string | null;
}

// ============================================
// Current App Version
// ============================================

export const APP_VERSION = '1.17.1';

// ============================================
// Migration Registry
// ============================================

const MIGRATIONS: Migration[] = [
  {
    version: '1.0.0',
    name: 'init',
    description: 'Initial RBAC schema - users, roles, permissions, audit logs',
    up: async (db) => {
      console.log('[Migration 1.0.0] Initial schema applied via Drizzle');
    },
  },
  {
    version: '1.1.0',
    name: 'data_access_rules',
    description: 'Add data access rules table for database/table permissions (supports both role and user level rules)',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_data_access_rules (
            id TEXT PRIMARY KEY,
            role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
            database_pattern TEXT NOT NULL DEFAULT '*',
            table_pattern TEXT NOT NULL DEFAULT '*',
            access_type TEXT NOT NULL DEFAULT 'read',
            is_allowed INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
            description TEXT
          )
        `);

        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS data_access_role_idx ON rbac_data_access_rules(role_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS data_access_user_idx ON rbac_data_access_rules(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS data_access_conn_idx ON rbac_data_access_rules(connection_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS data_access_pattern_idx ON rbac_data_access_rules(database_pattern, table_pattern)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS data_access_role_conn_idx ON rbac_data_access_rules(role_id, connection_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS data_access_user_conn_idx ON rbac_data_access_rules(user_id, connection_id)`);
      } else {
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_data_access_rules (
            id TEXT PRIMARY KEY,
            role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
            database_pattern VARCHAR(255) NOT NULL DEFAULT '*',
            table_pattern VARCHAR(255) NOT NULL DEFAULT '*',
            access_type VARCHAR(20) NOT NULL DEFAULT 'read',
            is_allowed BOOLEAN NOT NULL DEFAULT true,
            priority INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
            description TEXT
          )
        `);

        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS data_access_role_idx ON rbac_data_access_rules(role_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS data_access_user_idx ON rbac_data_access_rules(user_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS data_access_conn_idx ON rbac_data_access_rules(connection_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS data_access_pattern_idx ON rbac_data_access_rules(database_pattern, table_pattern)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS data_access_role_conn_idx ON rbac_data_access_rules(role_id, connection_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS data_access_user_conn_idx ON rbac_data_access_rules(user_id, connection_id)`);
      }

      console.log('[Migration 1.1.0] Data access rules table created');
    },
    down: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_data_access_rules`);
      } else {
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_data_access_rules`);
      }

      console.log('[Migration 1.1.0] Data access rules table dropped');
    },
  },
  {
    version: '1.2.0',
    name: 'clickhouse_users_metadata',
    description: 'Add ClickHouse users metadata table to store user configuration (role, cluster, allowed databases/tables)',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_clickhouse_users_metadata (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            cluster TEXT,
            host_ip TEXT,
            host_names TEXT,
            allowed_databases TEXT NOT NULL DEFAULT '[]',
            allowed_tables TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
            UNIQUE(username, connection_id)
          )
        `);

        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ch_users_meta_username_idx ON rbac_clickhouse_users_metadata(username)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ch_users_meta_connection_idx ON rbac_clickhouse_users_metadata(connection_id)`);
      } else {
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_clickhouse_users_metadata (
            id TEXT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            cluster VARCHAR(255),
            host_ip VARCHAR(255),
            host_names VARCHAR(255),
            allowed_databases JSONB NOT NULL DEFAULT '[]',
            allowed_tables JSONB NOT NULL DEFAULT '[]',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
            UNIQUE(username, connection_id)
          )
        `);

        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ch_users_meta_username_idx ON rbac_clickhouse_users_metadata(username)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ch_users_meta_connection_idx ON rbac_clickhouse_users_metadata(connection_id)`);
      }

      console.log('[Migration 1.2.0] ClickHouse users metadata table created');
    },
    down: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_clickhouse_users_metadata`);
      } else {
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_clickhouse_users_metadata`);
      }

      console.log('[Migration 1.2.0] ClickHouse users metadata table dropped');
    },
  },
  {
    version: '1.2.1',
    name: 'add_auth_type_to_metadata',
    description: 'Add auth_type column to ClickHouse users metadata table',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        // SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check first
        try {
          (db as SqliteDb).run(sql`
            ALTER TABLE rbac_clickhouse_users_metadata 
            ADD COLUMN auth_type TEXT
          `);
          console.log('[Migration 1.2.1] Added auth_type column to SQLite metadata table');
        } catch (error: any) {
          // Column might already exist, which is fine
          if (error?.message?.includes('duplicate column')) {
            console.log('[Migration 1.2.1] auth_type column already exists, skipping');
          } else {
            throw error;
          }
        }
      } else {
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_clickhouse_users_metadata 
          ADD COLUMN IF NOT EXISTS auth_type VARCHAR(50)
        `);
        console.log('[Migration 1.2.1] Added auth_type column to PostgreSQL metadata table');
      }
    },
    down: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        // SQLite doesn't support DROP COLUMN easily, would need to recreate table
        console.log('[Migration 1.2.1] SQLite does not support DROP COLUMN, manual intervention required');
      } else {
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_clickhouse_users_metadata 
          DROP COLUMN IF EXISTS auth_type
        `);
        console.log('[Migration 1.2.1] Removed auth_type column from PostgreSQL metadata table');
      }
    },
  },
  {
    version: '1.2.2',
    name: 'add_guest_role',
    description: 'Add Guest role with read-only access to all tabs and system tables',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      // It will check if the role exists and only create it if it doesn't
      const { seedRoles, seedPermissions } = await import('../services/seed');

      // First ensure all permissions exist
      const permissionIdMap = await seedPermissions();

      // Then seed roles (which includes GUEST)
      const roleIdMap = await seedRoles(permissionIdMap);

      console.log('[Migration 1.2.2] Ensured Guest role exists with permissions');

      // Create data access rule for GUEST role to allow read access to system tables
      // This ensures guest users can query system tables for metrics and logs
      const guestRoleId = roleIdMap.get(SYSTEM_ROLES.GUEST);
      if (guestRoleId) {
        const { createDataAccessRule } = await import('../services/dataAccess');

        try {
          // Check if rule already exists (idempotent)
          const { getRulesForRole } = await import('../services/dataAccess');
          const existingRules = await getRulesForRole(guestRoleId);
          const hasSystemRule = existingRules.some(
            rule => rule.databasePattern === 'system' &&
              rule.tablePattern === '*' &&
              rule.accessType === 'read' &&
              rule.isAllowed === true
          );

          if (!hasSystemRule) {
            await createDataAccessRule({
              roleId: guestRoleId,
              connectionId: null, // Applies to all connections
              databasePattern: 'system',
              tablePattern: '*',
              accessType: 'read',
              isAllowed: true,
              priority: 100, // High priority
              description: 'Allow GUEST role to read system tables for metrics and logs',
            });
            console.log('[Migration 1.2.2] Created data access rule for system tables');
          } else {
            console.log('[Migration 1.2.2] System table access rule already exists');
          }
        } catch (error: any) {
          // Rule might already exist (unique constraint), which is fine
          if (error?.message?.includes('UNIQUE') || error?.message?.includes('unique')) {
            console.log('[Migration 1.2.2] System table access rule already exists');
          } else {
            console.warn('[Migration 1.2.2] Could not create system table access rule:', error);
            // Don't throw - migration should continue even if rule creation fails
          }
        }
      }
    },
    down: async (db) => {
      const dbType = getDatabaseType();
      const roleName = SYSTEM_ROLES.GUEST;

      if (dbType === 'sqlite') {
        // Get role ID
        const roleResult = (db as SqliteDb).all(sql`
          SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
        `) as Array<{ id: string }>;

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          // Remove data access rules for this role
          (db as SqliteDb).run(sql`
            DELETE FROM rbac_data_access_rules WHERE role_id = ${roleId}
          `);

          // Remove role permissions
          (db as SqliteDb).run(sql`
            DELETE FROM rbac_role_permissions WHERE role_id = ${roleId}
          `);

          // Remove the role
          (db as SqliteDb).run(sql`
            DELETE FROM rbac_roles WHERE id = ${roleId}
          `);

          console.log('[Migration 1.2.2] Removed Guest role and associated rules');
        }
      } else {
        // PostgreSQL
        const roleResult = await (db as PostgresDb).execute(sql`
          SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
        `) as Array<{ id: string }>;

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          // Remove data access rules for this role
          await (db as PostgresDb).execute(sql`
            DELETE FROM rbac_data_access_rules WHERE role_id = ${roleId}
          `);

          // Remove role permissions
          await (db as PostgresDb).execute(sql`
            DELETE FROM rbac_role_permissions WHERE role_id = ${roleId}
          `);

          // Remove the role
          await (db as PostgresDb).execute(sql`
            DELETE FROM rbac_roles WHERE id = ${roleId}
          `);

          console.log('[Migration 1.2.2] Removed Guest role and associated rules');
        }
      }
    },
  },
  {
    version: '1.3.0',
    name: 'user_preferences_tables',
    description: 'Add user preferences tables for favorites, recent items, and UI preferences',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        // User Favorites table
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_favorites (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            database TEXT NOT NULL,
            "table" TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(user_id, database, "table")
          )
        `);

        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);

        // User Recent Items table
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_recent_items (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            database TEXT NOT NULL,
            "table" TEXT,
            accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(user_id, database, "table")
          )
        `);

        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_recent_accessed_at_idx ON rbac_user_recent_items(accessed_at)`);

        // User Preferences table
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_preferences (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL UNIQUE REFERENCES rbac_users(id) ON DELETE CASCADE,
            explorer_sort_by TEXT,
            explorer_view_mode TEXT,
            explorer_show_favorites_only INTEGER DEFAULT 0,
            workspace_preferences TEXT,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);

        (db as SqliteDb).run(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_id_idx ON rbac_user_preferences(user_id)`);
      } else {
        // User Favorites table
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_favorites (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            database VARCHAR(255) NOT NULL,
            "table" VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, database, "table")
          )
        `);

        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);

        // User Recent Items table
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_recent_items (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            database VARCHAR(255) NOT NULL,
            "table" VARCHAR(255),
            accessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, database, "table")
          )
        `);

        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS user_recent_accessed_at_idx ON rbac_user_recent_items(accessed_at)`);

        // User Preferences table
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_preferences (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL UNIQUE REFERENCES rbac_users(id) ON DELETE CASCADE,
            explorer_sort_by VARCHAR(50),
            explorer_view_mode VARCHAR(50),
            explorer_show_favorites_only BOOLEAN DEFAULT false,
            workspace_preferences JSONB,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `);

        await (db as PostgresDb).execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_id_idx ON rbac_user_preferences(user_id)`);
      }

      console.log('[Migration 1.3.0] User preferences tables created');
    },
    down: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_user_preferences`);
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_user_recent_items`);
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_user_favorites`);
      } else {
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_user_preferences`);
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_user_recent_items`);
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_user_favorites`);
      }

      console.log('[Migration 1.3.0] User preferences tables dropped');
    },
  },
  {
    version: '1.4.0',
    name: 'saved_queries_table',
    description: 'Add saved queries table to store user queries scoped by user and connection (replaces ClickHouse-based storage)',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_saved_queries (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            query TEXT NOT NULL,
            description TEXT,
            is_public INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);

        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_idx ON rbac_saved_queries(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS saved_queries_conn_idx ON rbac_saved_queries(connection_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_conn_idx ON rbac_saved_queries(user_id, connection_id)`);
      } else {
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_saved_queries (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            query TEXT NOT NULL,
            description TEXT,
            is_public BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `);

        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_idx ON rbac_saved_queries(user_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS saved_queries_conn_idx ON rbac_saved_queries(connection_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_conn_idx ON rbac_saved_queries(user_id, connection_id)`);
      }

      console.log('[Migration 1.4.0] Saved queries table created');
    },
    down: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_saved_queries`);
      } else {
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_saved_queries`);
      }

      console.log('[Migration 1.4.0] Saved queries table dropped');
    },
  },
  {
    version: '1.5.0',
    name: 'saved_queries_shared',
    description: 'Make saved queries shareable across connections - connectionId becomes optional, add connectionName for display',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
        // First, create a new table with the updated schema
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_saved_queries_new (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
            connection_name TEXT,
            name TEXT NOT NULL,
            query TEXT NOT NULL,
            description TEXT,
            is_public INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);

        // Copy data from old table to new, joining to get connection names
        (db as SqliteDb).run(sql`
          INSERT INTO rbac_saved_queries_new (id, user_id, connection_id, connection_name, name, query, description, is_public, created_at, updated_at)
          SELECT sq.id, sq.user_id, sq.connection_id, cc.name, sq.name, sq.query, sq.description, sq.is_public, sq.created_at, sq.updated_at
          FROM rbac_saved_queries sq
          LEFT JOIN rbac_clickhouse_connections cc ON sq.connection_id = cc.id
        `);

        // Drop old table
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_saved_queries`);

        // Rename new table
        (db as SqliteDb).run(sql`ALTER TABLE rbac_saved_queries_new RENAME TO rbac_saved_queries`);

        // Recreate indexes
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_idx ON rbac_saved_queries(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS saved_queries_conn_idx ON rbac_saved_queries(connection_id)`);
      } else {
        // PostgreSQL supports ALTER COLUMN
        // Make connection_id nullable
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_saved_queries 
          ALTER COLUMN connection_id DROP NOT NULL
        `);

        // Add connection_name column
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_saved_queries 
          ADD COLUMN IF NOT EXISTS connection_name VARCHAR(255)
        `);

        // Populate connection_name from existing connections
        await (db as PostgresDb).execute(sql`
          UPDATE rbac_saved_queries sq
          SET connection_name = cc.name
          FROM rbac_clickhouse_connections cc
          WHERE sq.connection_id = cc.id AND sq.connection_name IS NULL
        `);

        // Drop the old composite index
        await (db as PostgresDb).execute(sql`DROP INDEX IF EXISTS saved_queries_user_conn_idx`);
      }

      console.log('[Migration 1.5.0] Saved queries table updated to support shared queries across connections');
    },
    down: async (db) => {
      // This migration is not easily reversible as it changes data
      console.log('[Migration 1.5.0] Down migration not supported - connectionId is now optional');
    },
  },
  {
    version: '1.6.0',
    name: 'favorites_recent_connection',
    description: 'Add connection association to favorites and recent items for filtering by connection',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        // SQLite: Recreate tables with new columns

        // Favorites table
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_favorites_new (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
            connection_name TEXT,
            database TEXT NOT NULL,
            "table" TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(user_id, database, "table", connection_id)
          )
        `);

        // Copy data from old favorites table, joining to get connection info
        (db as SqliteDb).run(sql`
          INSERT INTO rbac_user_favorites_new (id, user_id, connection_id, connection_name, database, "table", created_at)
          SELECT id, user_id, NULL, NULL, database, "table", created_at
          FROM rbac_user_favorites
        `);

        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_user_favorites`);
        (db as SqliteDb).run(sql`ALTER TABLE rbac_user_favorites_new RENAME TO rbac_user_favorites`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_favorites_conn_id_idx ON rbac_user_favorites(connection_id)`);

        // Recent items table
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_user_recent_items_new (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
            connection_name TEXT,
            database TEXT NOT NULL,
            "table" TEXT,
            accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(user_id, database, "table", connection_id)
          )
        `);

        // Copy data from old recent items table
        (db as SqliteDb).run(sql`
          INSERT INTO rbac_user_recent_items_new (id, user_id, connection_id, connection_name, database, "table", accessed_at)
          SELECT id, user_id, NULL, NULL, database, "table", accessed_at
          FROM rbac_user_recent_items
        `);

        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_user_recent_items`);
        (db as SqliteDb).run(sql`ALTER TABLE rbac_user_recent_items_new RENAME TO rbac_user_recent_items`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_recent_conn_id_idx ON rbac_user_recent_items(connection_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS user_recent_accessed_at_idx ON rbac_user_recent_items(accessed_at)`);
      } else {
        // PostgreSQL: Add columns to existing tables

        // Favorites table
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_user_favorites 
          ADD COLUMN IF NOT EXISTS connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL
        `);
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_user_favorites 
          ADD COLUMN IF NOT EXISTS connection_name VARCHAR(255)
        `);
        await (db as PostgresDb).execute(sql`
          DROP INDEX IF EXISTS user_favorites_user_db_table_idx
        `);
        await (db as PostgresDb).execute(sql`
          CREATE UNIQUE INDEX IF NOT EXISTS user_favorites_user_db_table_conn_idx 
          ON rbac_user_favorites(user_id, database, "table", connection_id)
        `);
        await (db as PostgresDb).execute(sql`
          CREATE INDEX IF NOT EXISTS user_favorites_conn_id_idx ON rbac_user_favorites(connection_id)
        `);

        // Recent items table
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_user_recent_items 
          ADD COLUMN IF NOT EXISTS connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL
        `);
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_user_recent_items 
          ADD COLUMN IF NOT EXISTS connection_name VARCHAR(255)
        `);
        await (db as PostgresDb).execute(sql`
          DROP INDEX IF EXISTS user_recent_user_db_table_idx
        `);
        await (db as PostgresDb).execute(sql`
          CREATE UNIQUE INDEX IF NOT EXISTS user_recent_user_db_table_conn_idx 
          ON rbac_user_recent_items(user_id, database, "table", connection_id)
        `);
        await (db as PostgresDb).execute(sql`
          CREATE INDEX IF NOT EXISTS user_recent_conn_id_idx ON rbac_user_recent_items(connection_id)
        `);
      }

      console.log('[Migration 1.6.0] Favorites and recent items tables updated to support connection filtering');
    },
    down: async (db) => {
      console.log('[Migration 1.6.0] Down migration not supported');
    },
  },
  {
    version: '1.7.0',
    name: 'live_query_management_permissions',
    description: 'Add live query management permissions for viewing and killing running queries',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      // It will check if permissions exist and only create them if they don't
      const { seedPermissions, seedRoles } = await import('../services/seed');

      // First ensure all permissions exist (including new ones)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.7.0] Live query management permissions created');

      // Get LIVE_QUERIES_VIEW and LIVE_QUERIES_KILL permission IDs
      const liveQueriesViewId = permissionIdMap.get('live_queries:view');
      const liveQueriesKillId = permissionIdMap.get('live_queries:kill');

      if (!liveQueriesViewId || !liveQueriesKillId) {
        console.error('[Migration 1.7.0] Failed to get live query permission IDs');
        return;
      }

      // Import database functions (use raw SQL to avoid schema/db dialect union type issues)
      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Get super_admin role ID (live queries permissions are only granted to super_admin by default)
      const rolesToUpdate = [SYSTEM_ROLES.SUPER_ADMIN];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          for (const permId of [liveQueriesViewId, liveQueriesKillId]) {
            let existing: Array<unknown>;

            if (dbType === 'sqlite') {
              existing = (db as SqliteDb).all(sql`
                SELECT 1 FROM rbac_role_permissions
                WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1
              `);
            } else {
              const rows = await (db as PostgresDb).execute(sql`
                SELECT 1 FROM rbac_role_permissions
                WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1
              `);
              existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
            }

            if (existing.length === 0) {
              const id = randomUUID();
              const createdAt = new Date();

              if (dbType === 'sqlite') {
                (db as SqliteDb).run(sql`
                  INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                  VALUES (${id}, ${roleId}, ${permId}, ${Math.floor(createdAt.getTime() / 1000)})
                `);
              } else {
                // Postgres driver expects string/Buffer for bind params, not Date
                await (db as PostgresDb).execute(sql`
                  INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                  VALUES (${id}, ${roleId}, ${permId}, ${createdAt.toISOString()})
                `);
              }
              console.log(`[Migration 1.7.0] Assigned permission ${permId} to role ${roleName}`);
            } else {
              console.log(`[Migration 1.7.0] Permission ${permId} already assigned to role ${roleName}`);
            }
          }
        }
      }

      console.log('[Migration 1.7.0] Live query management permissions assigned to super_admin role');
    },
    down: async (db) => {
      console.log('[Migration 1.7.0] Down migration: Removing live query permissions');
      // Permissions will be removed by cascade on role deletion, but we can clean up manually if needed
    },
  },
  {
    version: '1.8.0',
    name: 'connection_management_permissions',
    description: 'Add connection management permissions (connections:view, connections:edit, connections:delete)',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      // It will check if permissions exist and only create them if they don't
      const { seedPermissions } = await import('../services/seed');

      // First ensure all permissions exist (including new ones)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.8.0] Connection management permissions created');

      // Get permission IDs
      const connViewId = permissionIdMap.get('connections:view');
      const connEditId = permissionIdMap.get('connections:edit');
      const connDeleteId = permissionIdMap.get('connections:delete');

      if (!connViewId || !connEditId || !connDeleteId) {
        console.error('[Migration 1.8.0] Failed to get connection permission IDs');
        return;
      }

      // Import database functions (use raw SQL to avoid schema/db dialect union type issues)
      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Get super_admin role ID (only grant to super_admin by default)
      const rolesToUpdate = [SYSTEM_ROLES.SUPER_ADMIN];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          for (const permId of [connViewId, connEditId, connDeleteId]) {
            let existing: Array<unknown>;

            if (dbType === 'sqlite') {
              existing = (db as SqliteDb).all(sql`
                SELECT 1 FROM rbac_role_permissions
                WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1
              `);
            } else {
              const rows = await (db as PostgresDb).execute(sql`
                SELECT 1 FROM rbac_role_permissions
                WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1
              `);
              existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
            }

            if (existing.length === 0) {
              const id = randomUUID();
              const createdAt = new Date();

              if (dbType === 'sqlite') {
                (db as SqliteDb).run(sql`
                  INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                  VALUES (${id}, ${roleId}, ${permId}, ${Math.floor(createdAt.getTime() / 1000)})
                `);
              } else {
                // Postgres driver expects string/Buffer for bind params, not Date
                await (db as PostgresDb).execute(sql`
                  INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                  VALUES (${id}, ${roleId}, ${permId}, ${createdAt.toISOString()})
                `);
              }
              console.log(`[Migration 1.8.0] Assigned permission ${permId} to role ${roleName}`);
            } else {
              console.log(`[Migration 1.8.0] Permission ${permId} already assigned to role ${roleName}`);
            }
          }
        }
      }

      console.log('[Migration 1.8.0] Connection management permissions assigned to super_admin role');
    },
    down: async (db) => {
      console.log('[Migration 1.8.0] Down migration: Connection management permissions will remain (idempotent seed)');
    },
  },
  {
    version: '1.9.0',
    name: 'audit_log_deletion_permission',
    description: 'Add audit log deletion permission (audit:delete)',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      // It will check if permissions exist and only create them if they don't
      const { seedPermissions } = await import('../services/seed');

      // First ensure all permissions exist (including new ones)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.9.0] Audit log deletion permission created');

      // Get permission ID
      const auditDeleteId = permissionIdMap.get('audit:delete');

      if (!auditDeleteId) {
        console.error('[Migration 1.9.0] Failed to get audit delete permission ID');
        return;
      }

      // Import database functions (use raw SQL to avoid schema/db dialect union type issues)
      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Get super_admin role ID (only grant to super_admin by default)
      const rolesToUpdate = [SYSTEM_ROLES.SUPER_ADMIN];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          let existing: Array<unknown>;

          if (dbType === 'sqlite') {
            existing = (db as SqliteDb).all(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${auditDeleteId} LIMIT 1
            `);
          } else {
            const rows = await (db as PostgresDb).execute(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${auditDeleteId} LIMIT 1
            `);
            existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          }

          if (existing.length === 0) {
            const id = randomUUID();
            const createdAt = new Date();

            if (dbType === 'sqlite') {
              (db as SqliteDb).run(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${auditDeleteId}, ${Math.floor(createdAt.getTime() / 1000)})
              `);
            } else {
              // Postgres driver expects string/Buffer for bind params, not Date
              await (db as PostgresDb).execute(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${auditDeleteId}, ${createdAt.toISOString()})
              `);
            }
            console.log(`[Migration 1.9.0] Assigned permission ${auditDeleteId} to role ${roleName}`);
          } else {
            console.log(`[Migration 1.9.0] Permission ${auditDeleteId} already assigned to role ${roleName}`);
          }
        }
      }

      console.log('[Migration 1.9.0] Audit log deletion permission assigned to super_admin role');
    },
    down: async (db) => {
      console.log('[Migration 1.9.0] Down migration: Audit log deletion permission will remain (idempotent seed)');
    },
  },
  {
    version: '1.10.0',
    name: 'query_execute_misc_permission',
    description: 'Add query:execute:misc permission for non-DQL/DML/DDL queries (SHOW, DESCRIBE, etc.)',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      const { seedPermissions } = await import('../services/seed');

      // First ensure all permissions exist (including new ones)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.10.0] Query execute misc permission created');

      // Get permission ID
      const queryMiscId = permissionIdMap.get('query:execute:misc');

      if (!queryMiscId) {
        console.error('[Migration 1.10.0] Failed to get query:execute:misc permission ID');
        return;
      }

      // Import database functions
      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Grant to Super Admin, Admin, Developer, and Analyst (as defined in base.ts)
      const rolesToUpdate = [
        SYSTEM_ROLES.SUPER_ADMIN,
        SYSTEM_ROLES.ADMIN,
        SYSTEM_ROLES.DEVELOPER,
        SYSTEM_ROLES.ANALYST
      ];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          let existing: Array<unknown>;

          if (dbType === 'sqlite') {
            existing = (db as SqliteDb).all(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${queryMiscId} LIMIT 1
            `);
          } else {
            const rows = await (db as PostgresDb).execute(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${queryMiscId} LIMIT 1
            `);
            existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          }

          if (existing.length === 0) {
            const id = randomUUID();
            const createdAt = new Date();

            if (dbType === 'sqlite') {
              (db as SqliteDb).run(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${queryMiscId}, ${Math.floor(createdAt.getTime() / 1000)})
              `);
            } else {
              // Postgres driver expects string/Buffer for bind params, not Date
              await (db as PostgresDb).execute(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${queryMiscId}, ${createdAt.toISOString()})
              `);
            }
            console.log(`[Migration 1.10.0] Assigned permission ${queryMiscId} to role ${roleName}`);
          } else {
            console.log(`[Migration 1.10.0] Permission ${queryMiscId} already assigned to role ${roleName}`);
          }
        }
      }

      console.log('[Migration 1.10.0] Query execute misc permission assigned to relevant roles');
    },
    down: async (db) => {
      console.log('[Migration 1.10.0] Down migration: Query execute misc permission will remain (idempotent seed)');
    },
  },
  {
    version: '1.10.1',
    name: 'fix_query_execute_misc_permission',
    description: 'Retry assignment of query:execute:misc permission (fix for 1.10.0)',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      const { seedPermissions } = await import('../services/seed');

      // First ensure all permissions exist (including new ones)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.10.1] Ensuring query execute misc permission exists');

      // Get permission ID
      const queryMiscId = permissionIdMap.get('query:execute:misc');

      if (!queryMiscId) {
        console.error('[Migration 1.10.1] Failed to get query:execute:misc permission ID');
        return;
      }

      // Import database functions
      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Grant to Super Admin, Admin, Developer, and Analyst
      const rolesToUpdate = [
        SYSTEM_ROLES.SUPER_ADMIN,
        SYSTEM_ROLES.ADMIN,
        SYSTEM_ROLES.DEVELOPER,
        SYSTEM_ROLES.ANALYST
      ];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          let existing: Array<unknown>;

          if (dbType === 'sqlite') {
            existing = (db as SqliteDb).all(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${queryMiscId} LIMIT 1
            `);
          } else {
            const rows = await (db as PostgresDb).execute(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${queryMiscId} LIMIT 1
            `);
            existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          }

          if (existing.length === 0) {
            const id = randomUUID();
            const createdAt = new Date();

            if (dbType === 'sqlite') {
              (db as SqliteDb).run(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${queryMiscId}, ${Math.floor(createdAt.getTime() / 1000)})
              `);
            } else {
              // Postgres driver expects string/Buffer for bind params, not Date
              await (db as PostgresDb).execute(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${queryMiscId}, ${createdAt.toISOString()})
              `);
            }
            console.log(`[Migration 1.10.1] Assigned permission ${queryMiscId} to role ${roleName}`);
          } else {
            console.log(`[Migration 1.10.1] Permission ${queryMiscId} already assigned to role ${roleName}`);
          }
        }
      }

      console.log('[Migration 1.10.1] Query execute misc permission check completed');
    },
    down: async (db) => {
      console.log('[Migration 1.10.1] Down migration: No action needed');
    },
  },
  {
    version: '1.11.0',
    name: 'audit_log_snapshots',
    description: 'Add user snapshot columns to audit logs table',
    up: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        const columns = [
          'username_snapshot',
          'email_snapshot',
          'display_name_snapshot'
        ];

        for (const col of columns) {
          try {
            (db as SqliteDb).run(sql.raw(`
              ALTER TABLE rbac_audit_logs 
              ADD COLUMN ${col} TEXT
            `));
            console.log(`[Migration 1.11.0] Added ${col} column to SQLite audit logs table`);
          } catch (error: any) {
            if (error?.message?.includes('duplicate column')) {
              console.log(`[Migration 1.11.0] ${col} column already exists, skipping`);
            } else {
              throw error;
            }
          }
        }
      } else {
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_audit_logs 
          ADD COLUMN IF NOT EXISTS username_snapshot VARCHAR(100),
          ADD COLUMN IF NOT EXISTS email_snapshot VARCHAR(255),
          ADD COLUMN IF NOT EXISTS display_name_snapshot VARCHAR(255)
        `);
        console.log('[Migration 1.11.0] Added snapshot columns to PostgreSQL audit logs table');
      }
    },
    down: async (db) => {
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        console.log('[Migration 1.11.0] SQLite does not support DROP COLUMN, manual intervention required');
      } else {
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_audit_logs 
          DROP COLUMN IF EXISTS username_snapshot,
          DROP COLUMN IF EXISTS email_snapshot,
          DROP COLUMN IF EXISTS display_name_snapshot
        `);
        console.log('[Migration 1.11.0] Removed snapshot columns from PostgreSQL audit logs table');
      }
    },
  },
  {
    version: '1.12.0',
    name: 'ai_optimize_permission',
    description: 'Add ai:optimize permission and assign to default roles (Admin, Developer, Analyst)',
    up: async (db) => {
      // Use the existing seed function which is idempotent
      const { seedPermissions } = await import('../services/seed');

      // First ensure all permissions exist (including the new ai:optimize)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.12.0] AI optimize permission created/updated');

      // Get permission ID
      const aiOptimizeId = permissionIdMap.get('ai:optimize');

      if (!aiOptimizeId) {
        console.error('[Migration 1.12.0] Failed to get ai:optimize permission ID');
        return;
      }

      // Import database functions
      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Grant to Super Admin, Admin, Developer, and Analyst
      const rolesToUpdate = [
        SYSTEM_ROLES.SUPER_ADMIN,
        SYSTEM_ROLES.ADMIN,
        SYSTEM_ROLES.DEVELOPER,
        SYSTEM_ROLES.ANALYST
      ];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          let existing: Array<unknown>;

          if (dbType === 'sqlite') {
            existing = (db as SqliteDb).all(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${aiOptimizeId} LIMIT 1
            `);
          } else {
            const rows = await (db as PostgresDb).execute(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${aiOptimizeId} LIMIT 1
            `);
            existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          }

          if (existing.length === 0) {
            const id = randomUUID();
            const createdAt = new Date();

            if (dbType === 'sqlite') {
              (db as SqliteDb).run(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${aiOptimizeId}, ${Math.floor(createdAt.getTime() / 1000)})
              `);
            } else {
              // Postgres driver expects string/Buffer for bind params, not Date
              await (db as PostgresDb).execute(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${aiOptimizeId}, ${createdAt.toISOString()})
              `);
            }
            console.log(`[Migration 1.12.0] Assigned permission ${aiOptimizeId} to role ${roleName}`);
          } else {
            console.log(`[Migration 1.12.0] Permission ${aiOptimizeId} already assigned to role ${roleName}`);
          }
        }
      }

      console.log('[Migration 1.12.0] AI optimize permission sync completed');
    },
    down: async (db) => {
      console.log('[Migration 1.12.0] Down migration: AI optimization permission will remain (idempotent seed)');
    },
  },
  {
    version: '1.13.0',
    name: 'live_queries_kill_all_permission',
    description: 'Add live_queries:kill_all permission for admin-level kill access. Existing live_queries:kill now means kill own queries only. Fixes privilege escalation where non-admin users could see and kill admin queries.',
    up: async (db) => {
      const { seedPermissions } = await import('../services/seed');

      // Seed all permissions (including new live_queries:kill_all)
      const permissionIdMap = await seedPermissions();

      console.log('[Migration 1.13.0] live_queries:kill_all permission created');

      const killAllId = permissionIdMap.get('live_queries:kill_all');

      if (!killAllId) {
        console.error('[Migration 1.13.0] Failed to get live_queries:kill_all permission ID');
        return;
      }

      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Grant to Super Admin and Admin (backward compatible — they previously had unrestricted kill)
      const rolesToUpdate = [
        SYSTEM_ROLES.SUPER_ADMIN,
        SYSTEM_ROLES.ADMIN,
      ];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          let existing: Array<unknown>;

          if (dbType === 'sqlite') {
            existing = (db as SqliteDb).all(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${killAllId} LIMIT 1
            `);
          } else {
            const rows = await (db as PostgresDb).execute(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${killAllId} LIMIT 1
            `);
            existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          }

          if (existing.length === 0) {
            const id = randomUUID();
            const createdAt = new Date();

            if (dbType === 'sqlite') {
              (db as SqliteDb).run(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${killAllId}, ${Math.floor(createdAt.getTime() / 1000)})
              `);
            } else {
              await (db as PostgresDb).execute(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${killAllId}, ${createdAt.toISOString()})
              `);
            }
            console.log(`[Migration 1.13.0] Assigned permission ${killAllId} to role ${roleName}`);
          } else {
            console.log(`[Migration 1.13.0] Permission ${killAllId} already assigned to role ${roleName}`);
          }
        }
      }

      console.log('[Migration 1.13.0] live_queries:kill_all permission assigned to super_admin and admin roles');
    },
    down: async (db) => {
      console.log('[Migration 1.13.0] Down migration: live_queries:kill_all permission will remain (idempotent seed)');
    },
  },
  {
    version: '1.14.0',
    name: 'ai_chat_tables_and_permission',
    description: 'Add AI chat tables (threads, messages) and ai:chat permission for the AI assistant feature',
    up: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const dbType = getDatabaseType();

      // Create AI chat threads table
      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_chat_threads (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            title TEXT,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_chat_threads_user_id_idx ON rbac_ai_chat_threads(user_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_chat_threads_conn_id_idx ON rbac_ai_chat_threads(connection_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_chat_threads_updated_at_idx ON rbac_ai_chat_threads(updated_at)`);
      } else {
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_chat_threads (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
            title TEXT,
            connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_threads_user_id_idx ON rbac_ai_chat_threads(user_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_threads_conn_id_idx ON rbac_ai_chat_threads(connection_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_threads_updated_at_idx ON rbac_ai_chat_threads(updated_at)`);
      }

      console.log('[Migration 1.14.0] Created rbac_ai_chat_threads table');

      // Create AI chat messages table
      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_chat_messages (
            id TEXT PRIMARY KEY NOT NULL,
            thread_id TEXT NOT NULL REFERENCES rbac_ai_chat_threads(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_calls TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_thread_id_idx ON rbac_ai_chat_messages(thread_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_created_at_idx ON rbac_ai_chat_messages(created_at)`);
      } else {
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_chat_messages (
            id TEXT PRIMARY KEY NOT NULL,
            thread_id TEXT NOT NULL REFERENCES rbac_ai_chat_threads(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            tool_calls JSONB,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_thread_id_idx ON rbac_ai_chat_messages(thread_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_chat_messages_created_at_idx ON rbac_ai_chat_messages(created_at)`);
      }

      console.log('[Migration 1.14.0] Created rbac_ai_chat_messages table');

      // Seed ai:chat permission and assign to roles
      const { seedPermissions } = await import('../services/seed');
      const permissionIdMap = await seedPermissions();

      const aiChatId = permissionIdMap.get('ai:chat');

      if (!aiChatId) {
        console.error('[Migration 1.14.0] Failed to get ai:chat permission ID');
        return;
      }

      const { SYSTEM_ROLES } = await import('../schema/base');
      const { randomUUID } = await import('crypto');

      const rolesToUpdate = [
        SYSTEM_ROLES.SUPER_ADMIN,
        SYSTEM_ROLES.ADMIN,
        SYSTEM_ROLES.DEVELOPER,
        SYSTEM_ROLES.ANALYST
      ];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          roleResult = (db as SqliteDb).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          const rows = await (db as PostgresDb).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          let existing: Array<unknown>;

          if (dbType === 'sqlite') {
            existing = (db as SqliteDb).all(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${aiChatId} LIMIT 1
            `);
          } else {
            const rows = await (db as PostgresDb).execute(sql`
              SELECT 1 FROM rbac_role_permissions
              WHERE role_id = ${roleId} AND permission_id = ${aiChatId} LIMIT 1
            `);
            existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          }

          if (existing.length === 0) {
            const id = randomUUID();
            const createdAt = new Date();

            if (dbType === 'sqlite') {
              (db as SqliteDb).run(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${aiChatId}, ${Math.floor(createdAt.getTime() / 1000)})
              `);
            } else {
              await (db as PostgresDb).execute(sql`
                INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                VALUES (${id}, ${roleId}, ${aiChatId}, ${createdAt.toISOString()})
              `);
            }
            console.log(`[Migration 1.14.0] Assigned ai:chat permission to role ${roleName}`);
          } else {
            console.log(`[Migration 1.14.0] ai:chat permission already assigned to role ${roleName}`);
          }
        }
      }

      console.log('[Migration 1.14.0] AI chat tables and permission setup completed');
    },
    down: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_ai_chat_messages`);
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_ai_chat_threads`);
      } else {
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_ai_chat_messages`);
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_ai_chat_threads`);
      }

      console.log('[Migration 1.14.0] Dropped AI chat tables');
    },
  },
  {
    version: '1.15.0',
    name: 'add_chart_spec_to_messages',
    description: 'Add chart_spec column to AI chat messages to persist chart metadata',
    up: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        try {
          (db as SqliteDb).run(sql`
            ALTER TABLE rbac_ai_chat_messages ADD COLUMN chart_spec TEXT
          `);
          console.log('[Migration 1.15.0] Added chart_spec column to SQLite rbac_ai_chat_messages table');
        } catch (error: any) {
          if (!error?.message?.includes('duplicate column')) throw error;
          console.log('[Migration 1.15.0] chart_spec column already exists, skipping');
        }
      } else {
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_ai_chat_messages ADD COLUMN IF NOT EXISTS chart_spec JSONB
        `);
        console.log('[Migration 1.15.0] Added chart_spec column to PostgreSQL rbac_ai_chat_messages table');
      }
    },
    down: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        console.log('[Migration 1.15.0] SQLite does not support DROP COLUMN easily, manual intervention required');
      } else {
        await (db as PostgresDb).execute(sql`
          ALTER TABLE rbac_ai_chat_messages DROP COLUMN IF EXISTS chart_spec
        `);
        console.log('[Migration 1.15.0] Dropped chart_spec column from PostgreSQL rbac_ai_chat_messages table');
      }
    },
  },
  {
    version: '1.16.0',
    name: 'ai_models_tables',
    description: 'Add AI Models normalized tables to store providers, models, and configurations',
    up: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        // AI Providers
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_providers (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            provider_type TEXT NOT NULL,
            base_url TEXT,
            api_key_encrypted TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);
        // AI Models
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_models (
            id TEXT PRIMARY KEY NOT NULL,
            provider_id TEXT NOT NULL REFERENCES rbac_ai_providers(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            model_id TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          )
        `);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_models_provider_id_idx ON rbac_ai_models(provider_id)`);
        // AI Configs
        (db as SqliteDb).run(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_configs (
            id TEXT PRIMARY KEY NOT NULL,
            model_id TEXT NOT NULL REFERENCES rbac_ai_models(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL
          )
        `);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_configs_model_id_idx ON rbac_ai_configs(model_id)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_active_idx ON rbac_ai_configs(is_active)`);
        (db as SqliteDb).run(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_default_idx ON rbac_ai_configs(is_default)`);
      } else {
        // AI Providers
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_providers (
            id TEXT PRIMARY KEY NOT NULL,
            name VARCHAR(255) NOT NULL,
            provider_type VARCHAR(255) NOT NULL,
            base_url TEXT,
            api_key_encrypted TEXT,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `);
        // AI Models
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_models (
            id TEXT PRIMARY KEY NOT NULL,
            provider_id TEXT NOT NULL REFERENCES rbac_ai_providers(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            model_id VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
          )
        `);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_models_provider_id_idx ON rbac_ai_models(provider_id)`);
        // AI Configs
        await (db as PostgresDb).execute(sql`
          CREATE TABLE IF NOT EXISTS rbac_ai_configs (
            id TEXT PRIMARY KEY NOT NULL,
            model_id TEXT NOT NULL REFERENCES rbac_ai_models(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            is_default BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL
          )
        `);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_configs_model_id_idx ON rbac_ai_configs(model_id)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_active_idx ON rbac_ai_configs(is_active)`);
        await (db as PostgresDb).execute(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_default_idx ON rbac_ai_configs(is_default)`);
      }

      const { seedPermissions, seedRoles } = await import('../services/seed');
      const permissionIdMap = await seedPermissions();
      await seedRoles(permissionIdMap);

      console.log('[Migration 1.16.0] Added ai models normalized tables and permissions');
    },
    down: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');
      const dbType = getDatabaseType();

      if (dbType === 'sqlite') {
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_ai_configs`);
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_ai_models`);
        (db as SqliteDb).run(sql`DROP TABLE IF EXISTS rbac_ai_providers`);
      } else {
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_ai_configs`);
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_ai_models`);
        await (db as PostgresDb).execute(sql`DROP TABLE IF EXISTS rbac_ai_providers`);
      }
      console.log('[Migration 1.16.0] Dropped ai models normalized tables');
    },
  },
  {
    version: '1.16.1',
    name: 'ai_models_admin_permissions',
    description: 'Seed AI Models permissions and assign to Admin roles',
    up: async (db) => {
      const { seedPermissions } = await import('../services/seed');

      const permissionIdMap = await seedPermissions();

      const aiViewId = permissionIdMap.get('ai_models:view');
      const aiCreateId = permissionIdMap.get('ai_models:create');
      const aiUpdateId = permissionIdMap.get('ai_models:update');
      const aiDeleteId = permissionIdMap.get('ai_models:delete');

      if (!aiViewId || !aiCreateId || !aiUpdateId || !aiDeleteId) {
        console.error('[Migration 1.16.1] Failed to get AI Models permission IDs');
        return;
      }

      const { getDatabaseType } = await import('./index');
      const { SYSTEM_ROLES } = await import('../schema/base');
      const { sql } = await import('drizzle-orm');
      const { randomUUID } = await import('crypto');

      const dbType = getDatabaseType();

      // Grant to both super_admin and admin
      const rolesToUpdate = [SYSTEM_ROLES.SUPER_ADMIN, SYSTEM_ROLES.ADMIN];

      for (const roleName of rolesToUpdate) {
        let roleResult: Array<{ id: string }>;

        if (dbType === 'sqlite') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          roleResult = (db as any).all(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `) as Array<{ id: string }>;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = await (db as any).execute(sql`
            SELECT id FROM rbac_roles WHERE name = ${roleName} LIMIT 1
          `);
          const raw = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
          roleResult = raw as Array<{ id: string }>;
        }

        if (roleResult.length > 0) {
          const roleId = roleResult[0].id;

          for (const permId of [aiViewId, aiCreateId, aiUpdateId, aiDeleteId]) {
            let existing: Array<unknown>;

            if (dbType === 'sqlite') {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              existing = (db as any).all(sql`
                SELECT 1 FROM rbac_role_permissions
                WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1
              `);
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const rows = await (db as any).execute(sql`
                SELECT 1 FROM rbac_role_permissions
                WHERE role_id = ${roleId} AND permission_id = ${permId} LIMIT 1
              `);
              existing = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
            }

            if (existing.length === 0) {
              const id = randomUUID();
              const createdAt = new Date();

              if (dbType === 'sqlite') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (db as any).run(sql`
                  INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                  VALUES (${id}, ${roleId}, ${permId}, ${Math.floor(createdAt.getTime() / 1000)})
                `);
              } else {
                // Postgres driver expects string/Buffer for bind params, not Date
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (db as any).execute(sql`
                  INSERT INTO rbac_role_permissions (id, role_id, permission_id, created_at)
                  VALUES (${id}, ${roleId}, ${permId}, ${createdAt.toISOString()})
                `);
              }
              console.log(`[Migration 1.16.1] Assigned permission ${permId} to role ${roleName}`);
            }
          }
        }
      }

      console.log('[Migration 1.16.1] Seeded AI Models permissions to Admin roles');
    },
    down: async (db) => {
      console.log('[Migration 1.16.1] Down migration: AI Models permissions will remain (idempotent seed)');
    },
  },
  {
    version: '1.16.2',
    name: 'add_provider_type_column',
    description: 'Add provider_type column to rbac_ai_providers table to separate provider type from display name',
    up: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');
      const { PROVIDER_TYPES, isValidProviderType } = await import('../constants/aiProviders');

      const dbType = getDatabaseType();

      try {
        // Step 1: Check if provider_type column already exists
        let columnExists = false;
        let isNotNull = false;

        if (dbType === 'sqlite') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tableInfo = (db as any).all(sql`
            PRAGMA table_info(rbac_ai_providers)
          `) as Array<{ name: string; notnull: number }>;
          const providerTypeCol = tableInfo.find(col => col.name === 'provider_type');
          columnExists = !!providerTypeCol;
          isNotNull = providerTypeCol?.notnull === 1;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (db as any).execute(sql`
            SELECT column_name, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'rbac_ai_providers' AND column_name = 'provider_type'
          `);
          const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
          columnExists = rows.length > 0;
          if (rows.length > 0) {
            const row = rows[0] as { is_nullable: string };
            isNotNull = row.is_nullable === 'NO';
          }
        }

        // Step 2: Add provider_type column as nullable (only if it doesn't exist)
        if (!columnExists) {
          if (dbType === 'sqlite') {
            // SQLite doesn't support ALTER TABLE ADD COLUMN with NOT NULL directly
            // We'll add it as nullable first, then update, then make it NOT NULL via table recreation
            (db as SqliteDb).run(sql`
              ALTER TABLE rbac_ai_providers ADD COLUMN provider_type TEXT
            `);
          } else {
            await (db as PostgresDb).execute(sql`
              ALTER TABLE rbac_ai_providers ADD COLUMN provider_type VARCHAR(255)
            `);
          }
          console.log('[Migration 1.16.2] Added provider_type column (nullable)');
        } else {
          console.log('[Migration 1.16.2] provider_type column already exists, skipping add');
        }

        // Step 2: Copy name values to provider_type for all existing records
        if (dbType === 'sqlite') {
          (db as SqliteDb).run(sql`
            UPDATE rbac_ai_providers SET provider_type = name WHERE provider_type IS NULL
          `);
        } else {
          await (db as PostgresDb).execute(sql`
            UPDATE rbac_ai_providers SET provider_type = name WHERE provider_type IS NULL
          `);
        }

        console.log('[Migration 1.16.2] Copied name values to provider_type');

        // Step 3: Validate all provider_type values are valid (skip if column was just created and table is empty)
        let invalidProviders: Array<{ id: string; name: string; provider_type: string }> = [];

        if (dbType === 'sqlite') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = (db as any).all(sql`
            SELECT id, name, provider_type FROM rbac_ai_providers WHERE provider_type IS NOT NULL
          `) as Array<{ id: string; name: string; provider_type: string }>;
          invalidProviders = rows.filter(row => !isValidProviderType(row.provider_type));
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (db as any).execute(sql`
            SELECT id, name, provider_type FROM rbac_ai_providers WHERE provider_type IS NOT NULL
          `);
          const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
          invalidProviders = (rows as Array<{ id: string; name: string; provider_type: string }>).filter(
            row => !isValidProviderType(row.provider_type)
          );
        }

        if (invalidProviders.length > 0) {
          const invalidList = invalidProviders.map(p => `id=${p.id}, name=${p.name}, provider_type=${p.provider_type}`).join('; ');
          throw new Error(
            `[Migration 1.16.2] Found ${invalidProviders.length} providers with invalid provider_type values: ${invalidList}. ` +
            `Valid types are: ${PROVIDER_TYPES.join(', ')}`
          );
        }

        console.log('[Migration 1.16.2] Validated all provider_type values');

        // Step 4: Make provider_type NOT NULL (only if it's currently nullable)
        if (!isNotNull) {
          // For SQLite, we need to recreate the table since it doesn't support ALTER COLUMN
          if (dbType === 'sqlite') {
            // Create new table with NOT NULL constraint
            (db as SqliteDb).run(sql`
              CREATE TABLE rbac_ai_providers_new (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                base_url TEXT,
                api_key_encrypted TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
              )
            `);

            // Copy data
            (db as SqliteDb).run(sql`
              INSERT INTO rbac_ai_providers_new 
              SELECT id, name, provider_type, base_url, api_key_encrypted, is_active, created_at, updated_at
              FROM rbac_ai_providers
            `);

            // Drop old table
            (db as SqliteDb).run(sql`DROP TABLE rbac_ai_providers`);

            // Rename new table
            (db as SqliteDb).run(sql`ALTER TABLE rbac_ai_providers_new RENAME TO rbac_ai_providers`);
          } else {
            // PostgreSQL supports ALTER COLUMN SET NOT NULL directly
            await (db as PostgresDb).execute(sql`
              ALTER TABLE rbac_ai_providers ALTER COLUMN provider_type SET NOT NULL
            `);
          }
          console.log('[Migration 1.16.2] Made provider_type NOT NULL');
        } else {
          console.log('[Migration 1.16.2] provider_type column already has NOT NULL constraint, skipping');
        }
        console.log('[Migration 1.16.2] Successfully added provider_type column');
      } catch (error) {
        console.error('[Migration 1.16.2] Error during migration:', error);
        throw error;
      }
    },
    down: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const dbType = getDatabaseType();

      try {
        if (dbType === 'sqlite') {
          // SQLite doesn't support DROP COLUMN directly, need to recreate table
          (db as SqliteDb).run(sql`
            CREATE TABLE rbac_ai_providers_new (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              base_url TEXT,
              api_key_encrypted TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL DEFAULT (unixepoch()),
              updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            )
          `);

          (db as SqliteDb).run(sql`
            INSERT INTO rbac_ai_providers_new 
            SELECT id, name, base_url, api_key_encrypted, is_active, created_at, updated_at
            FROM rbac_ai_providers
          `);

          (db as SqliteDb).run(sql`DROP TABLE rbac_ai_providers`);
          (db as SqliteDb).run(sql`ALTER TABLE rbac_ai_providers_new RENAME TO rbac_ai_providers`);
        } else {
          await (db as PostgresDb).execute(sql`
            ALTER TABLE rbac_ai_providers DROP COLUMN provider_type
          `);
        }

        console.log('[Migration 1.16.2] Rolled back: Removed provider_type column');
      } catch (error) {
        console.error('[Migration 1.16.2] Error during rollback:', error);
        throw error;
      }
    },
  },
  {
    version: '1.17.0',
    name: 'audit_log_client_info',
    description: 'Add client info columns (browser, browser_version, os, os_version, device_type, language, country) to audit logs table for enriched audit data',
    up: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const dbType = getDatabaseType();

      const columns = [
        { name: 'browser', sqliteType: 'TEXT', pgType: 'VARCHAR(100)' },
        { name: 'browser_version', sqliteType: 'TEXT', pgType: 'VARCHAR(50)' },
        { name: 'os', sqliteType: 'TEXT', pgType: 'VARCHAR(100)' },
        { name: 'os_version', sqliteType: 'TEXT', pgType: 'VARCHAR(50)' },
        { name: 'device_type', sqliteType: 'TEXT', pgType: 'VARCHAR(20)' },
        { name: 'language', sqliteType: 'TEXT', pgType: 'VARCHAR(20)' },
        { name: 'country', sqliteType: 'TEXT', pgType: 'VARCHAR(10)' },
      ];

      for (const col of columns) {
        if (dbType === 'sqlite') {
          try {
            (db as SqliteDb).run(sql.raw(`ALTER TABLE rbac_audit_logs ADD COLUMN ${col.name} ${col.sqliteType}`));
            console.log(`[Migration 1.17.0] Added ${col.name} column (SQLite)`);
          } catch (error: any) {
            if (error?.message?.includes('duplicate column')) {
              console.log(`[Migration 1.17.0] ${col.name} column already exists, skipping`);
            } else {
              throw error;
            }
          }
        } else {
          await (db as PostgresDb).execute(
            sql.raw(`ALTER TABLE rbac_audit_logs ADD COLUMN IF NOT EXISTS ${col.name} ${col.pgType}`)
          );
          console.log(`[Migration 1.17.0] Added ${col.name} column (PostgreSQL)`);
        }
      }

      console.log('[Migration 1.17.0] Successfully added client info columns to audit logs');
    },
    down: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const dbType = getDatabaseType();
      const columns = ['browser', 'browser_version', 'os', 'os_version', 'device_type', 'language', 'country'];

      if (dbType === 'sqlite') {
        console.log('[Migration 1.17.0] SQLite does not support DROP COLUMN easily, manual intervention may be required');
      } else {
        for (const col of columns) {
          await (db as PostgresDb).execute(
            sql.raw(`ALTER TABLE rbac_audit_logs DROP COLUMN IF EXISTS ${col}`)
          );
        }
        console.log('[Migration 1.17.0] Removed client info columns from audit logs (PostgreSQL)');
      }
    },
  },
  {
    version: '1.17.1',
    name: 'audit_log_enriched_geo_device',
    description: 'Add enriched geo columns (timezone, city, country_region) and device columns (device_model, architecture) to audit logs for deeper client context',
    up: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const dbType = getDatabaseType();

      const columns = [
        { name: 'timezone',       sqliteType: 'TEXT', pgType: 'VARCHAR(100)' },
        { name: 'city',           sqliteType: 'TEXT', pgType: 'VARCHAR(100)' },
        { name: 'country_region', sqliteType: 'TEXT', pgType: 'VARCHAR(10)'  },
        { name: 'device_model',   sqliteType: 'TEXT', pgType: 'VARCHAR(150)' },
        { name: 'architecture',   sqliteType: 'TEXT', pgType: 'VARCHAR(30)'  },
      ];

      for (const col of columns) {
        if (dbType === 'sqlite') {
          try {
            (db as SqliteDb).run(sql.raw(`ALTER TABLE rbac_audit_logs ADD COLUMN ${col.name} ${col.sqliteType}`));
            console.log(`[Migration 1.17.1] Added ${col.name} column (SQLite)`);
          } catch (error: any) {
            if (error?.message?.includes('duplicate column')) {
              console.log(`[Migration 1.17.1] ${col.name} column already exists, skipping`);
            } else {
              throw error;
            }
          }
        } else {
          await (db as PostgresDb).execute(
            sql.raw(`ALTER TABLE rbac_audit_logs ADD COLUMN IF NOT EXISTS ${col.name} ${col.pgType}`)
          );
          console.log(`[Migration 1.17.1] Added ${col.name} column (PostgreSQL)`);
        }
      }

      console.log('[Migration 1.17.1] Successfully added enriched geo and device columns to audit logs');
    },
    down: async (db) => {
      const { getDatabaseType } = await import('./index');
      const { sql } = await import('drizzle-orm');

      const dbType = getDatabaseType();
      const columns = ['timezone', 'city', 'country_region', 'device_model', 'architecture'];

      if (dbType === 'sqlite') {
        console.log('[Migration 1.17.1] SQLite does not support DROP COLUMN easily, manual intervention may be required');
      } else {
        for (const col of columns) {
          await (db as PostgresDb).execute(
            sql.raw(`ALTER TABLE rbac_audit_logs DROP COLUMN IF EXISTS ${col}`)
          );
        }
        console.log('[Migration 1.17.1] Removed enriched geo and device columns from audit logs (PostgreSQL)');
      }
    },
  },
];

// ============================================
// Version Table Management
// ============================================

async function ensureVersionTable(db: RbacDb): Promise<void> {
  const dbType = getDatabaseType();

  if (dbType === 'sqlite') {
    (db as SqliteDb).run(sql`
      CREATE TABLE IF NOT EXISTS _rbac_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await (db as PostgresDb).execute(sql`
      CREATE TABLE IF NOT EXISTS _rbac_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
  }
}

async function getAppliedMigrations(db: RbacDb): Promise<MigrationStatus[]> {
  const dbType = getDatabaseType();

  try {
    let result: any[];

    if (dbType === 'sqlite') {
      result = (db as SqliteDb).all(sql`
        SELECT version, name, applied_at as "appliedAt" 
        FROM _rbac_migrations 
        ORDER BY id ASC
      `);
    } else {
      const queryResult = await (db as PostgresDb).execute(sql`
        SELECT version, name, applied_at as "appliedAt" 
        FROM _rbac_migrations 
        ORDER BY id ASC
      `);
      result = queryResult as any[];
    }

    return result.map((row: any) => ({
      version: row.version,
      name: row.name,
      appliedAt: new Date(row.appliedAt),
    }));
  } catch {
    return [];
  }
}

export async function getCurrentVersion(): Promise<string | null> {
  const db = getDatabase();
  const applied = await getAppliedMigrations(db);

  if (applied.length === 0) {
    return null;
  }

  return applied[applied.length - 1].version;
}

export async function isFirstRun(): Promise<boolean> {
  const version = await getCurrentVersion();
  return version === null;
}

async function recordMigration(db: RbacDb, migration: Migration): Promise<void> {
  const dbType = getDatabaseType();

  if (dbType === 'sqlite') {
    (db as SqliteDb).run(sql`
      INSERT INTO _rbac_migrations (version, name, description)
      VALUES (${migration.version}, ${migration.name}, ${migration.description})
    `);
  } else {
    await (db as PostgresDb).execute(sql`
      INSERT INTO _rbac_migrations (version, name, description)
      VALUES (${migration.version}, ${migration.name}, ${migration.description})
    `);
  }
}

// ============================================
// Schema Creation using Drizzle
// ============================================

async function createSchemaFromDrizzle(db: RbacDb): Promise<void> {
  if (isSqlite()) {
    await createSqliteSchemaFromDrizzle(db as SqliteDb);
  } else {
    await createPostgresSchemaFromDrizzle(db as PostgresDb);
  }
}

async function createSqliteSchemaFromDrizzle(db: SqliteDb): Promise<void> {
  console.log('[Migration] Creating SQLite schema from Drizzle definitions...');

  // Users table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system_user INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER,
      password_changed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by TEXT,
      metadata TEXT
    )
  `);

  // Roles table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_roles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT
    )
  `);

  // Permissions table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // User-Role junction table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_roles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      assigned_by TEXT,
      expires_at INTEGER,
      UNIQUE(user_id, role_id)
    )
  `);

  // Role-Permission junction table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(role_id, permission_id)
    )
  `);

  // Resource Permissions (scoped access)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_resource_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
      role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      granted INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by TEXT
    )
  `);

  // Sessions table (for JWT refresh tokens)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      refresh_token TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip_address TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at INTEGER,
      revoked_at INTEGER
    )
  `);

  // Audit Logs table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      username_snapshot TEXT,
      email_snapshot TEXT,
      display_name_snapshot TEXT,
      browser TEXT,
      browser_version TEXT,
      os TEXT,
      os_version TEXT,
      device_type TEXT,
      language TEXT,
      country TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // API Keys table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_api_keys (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '[]',
      expires_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      revoked_at INTEGER
    )
  `);

  // ClickHouse Connections table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_clickhouse_connections (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 8123,
      username TEXT NOT NULL,
      password_encrypted TEXT,
      database TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      ssl_enabled INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT
    )
  `);

  // User-Connection Access table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_connections (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
      can_use INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, connection_id)
    )
  `);

  // Create indexes
  db.run(sql`CREATE INDEX IF NOT EXISTS users_email_idx ON rbac_users(email)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS users_username_idx ON rbac_users(username)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS users_active_idx ON rbac_users(is_active)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS roles_name_idx ON rbac_roles(name)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS roles_priority_idx ON rbac_roles(priority)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS permissions_name_idx ON rbac_permissions(name)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS permissions_category_idx ON rbac_permissions(category)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS user_roles_user_idx ON rbac_user_roles(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS user_roles_role_idx ON rbac_user_roles(role_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS role_perms_role_idx ON rbac_role_permissions(role_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON rbac_sessions(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS sessions_expires_idx ON rbac_sessions(expires_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS audit_user_idx ON rbac_audit_logs(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS audit_action_idx ON rbac_audit_logs(action)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS audit_created_at_idx ON rbac_audit_logs(created_at)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS api_keys_user_idx ON rbac_api_keys(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON rbac_api_keys(key_prefix)`);

  // User Favorites table (with optional connection association)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_favorites (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
      connection_name TEXT,
      database TEXT NOT NULL,
      "table" TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, database, "table", connection_id)
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS user_favorites_conn_id_idx ON rbac_user_favorites(connection_id)`);

  // User Recent Items table (with optional connection association)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_recent_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
      connection_name TEXT,
      database TEXT NOT NULL,
      "table" TEXT,
      accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, database, "table", connection_id)
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS user_recent_conn_id_idx ON rbac_user_recent_items(connection_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS user_recent_accessed_at_idx ON rbac_user_recent_items(accessed_at)`);

  // User Preferences table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_preferences (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE REFERENCES rbac_users(id) ON DELETE CASCADE,
      explorer_sort_by TEXT,
      explorer_view_mode TEXT,
      explorer_show_favorites_only INTEGER DEFAULT 0,
      workspace_preferences TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_id_idx ON rbac_user_preferences(user_id)`);

  // AI Providers table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_ai_providers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // AI Models table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_ai_models (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL REFERENCES rbac_ai_providers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS ai_models_provider_id_idx ON rbac_ai_models(provider_id)`);

  // AI Configs table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_ai_configs (
      id TEXT PRIMARY KEY NOT NULL,
      model_id TEXT NOT NULL REFERENCES rbac_ai_models(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS ai_configs_model_id_idx ON rbac_ai_configs(model_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_active_idx ON rbac_ai_configs(is_active)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_default_idx ON rbac_ai_configs(is_default)`);

  // Saved Queries table (connectionId is optional - null means shared across all connections)
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_saved_queries (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
      connection_name TEXT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      description TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_idx ON rbac_saved_queries(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS saved_queries_conn_idx ON rbac_saved_queries(connection_id)`);

  console.log('[Migration] SQLite schema created');
}

async function createPostgresSchemaFromDrizzle(db: PostgresDb): Promise<void> {
  console.log('[Migration] Creating PostgreSQL schema from Drizzle definitions...');

  // Users table (using TEXT for IDs to match Drizzle schema)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_users (
      id TEXT PRIMARY KEY NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name VARCHAR(255),
      avatar_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_system_user BOOLEAN NOT NULL DEFAULT false,
      last_login_at TIMESTAMP WITH TIME ZONE,
      password_changed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by TEXT,
      metadata JSONB
    )
  `);

  // Roles table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_roles (
      id TEXT PRIMARY KEY NOT NULL,
      name VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(255) NOT NULL,
      description TEXT,
      is_system BOOLEAN NOT NULL DEFAULT false,
      is_default BOOLEAN NOT NULL DEFAULT false,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      metadata JSONB
    )
  `);

  // Permissions table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      name VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(50) NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // User-Role junction table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_roles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      assigned_by TEXT,
      expires_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(user_id, role_id)
    )
  `);

  // Role-Permission junction table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(role_id, permission_id)
    )
  `);

  // Resource Permissions
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_resource_permissions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
      role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
      resource_type VARCHAR(50) NOT NULL,
      resource_id VARCHAR(255) NOT NULL,
      permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      granted BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by TEXT
    )
  `);

  // Sessions table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      refresh_token TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip_address VARCHAR(45),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMP WITH TIME ZONE,
      revoked_at TIMESTAMP WITH TIME ZONE
    )
  `);

  // Audit Logs table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(50),
      resource_id VARCHAR(255),
      details JSONB,
      ip_address VARCHAR(45),
      user_agent TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      error_message TEXT,
      username_snapshot VARCHAR(100),
      email_snapshot VARCHAR(255),
      display_name_snapshot VARCHAR(255),
      browser VARCHAR(100),
      browser_version VARCHAR(50),
      os VARCHAR(100),
      os_version VARCHAR(50),
      device_type VARCHAR(20),
      language VARCHAR(20),
      country VARCHAR(10),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // API Keys table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_api_keys (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      key_hash VARCHAR(255) NOT NULL UNIQUE,
      key_prefix VARCHAR(20) NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT '{}',
      expires_at TIMESTAMP WITH TIME ZONE,
      last_used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMP WITH TIME ZONE
    )
  `);

  // ClickHouse Connections table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_clickhouse_connections (
      id TEXT PRIMARY KEY NOT NULL,
      name VARCHAR(100) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INTEGER NOT NULL DEFAULT 8123,
      username VARCHAR(100) NOT NULL,
      password_encrypted TEXT,
      database VARCHAR(100),
      is_default BOOLEAN NOT NULL DEFAULT false,
      is_active BOOLEAN NOT NULL DEFAULT true,
      ssl_enabled BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      metadata JSONB
    )
  `);

  // User-Connection Access table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_connections (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
      can_use BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, connection_id)
    )
  `);

  // Create indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_email_idx ON rbac_users(email)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_username_idx ON rbac_users(username)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS users_active_idx ON rbac_users(is_active)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS roles_name_idx ON rbac_roles(name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS roles_priority_idx ON rbac_roles(priority)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS permissions_name_idx ON rbac_permissions(name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS permissions_category_idx ON rbac_permissions(category)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_roles_user_idx ON rbac_user_roles(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_roles_role_idx ON rbac_user_roles(role_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS role_perms_role_idx ON rbac_role_permissions(role_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON rbac_sessions(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS sessions_expires_idx ON rbac_sessions(expires_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_user_idx ON rbac_audit_logs(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_action_idx ON rbac_audit_logs(action)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS audit_created_at_idx ON rbac_audit_logs(created_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS api_keys_user_idx ON rbac_api_keys(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON rbac_api_keys(key_prefix)`);

  // User Favorites table
  // User Favorites table (with optional connection association)
  await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rbac_user_favorites (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
        connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
        connection_name VARCHAR(255),
        database VARCHAR(255) NOT NULL,
        "table" VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, database, "table", connection_id)
      )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_favorites_conn_id_idx ON rbac_user_favorites(connection_id)`);

  // User Recent Items table (with optional connection association)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_recent_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
      connection_name VARCHAR(255),
      database VARCHAR(255) NOT NULL,
      "table" VARCHAR(255),
      accessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, database, "table", connection_id)
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_recent_conn_id_idx ON rbac_user_recent_items(connection_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_recent_accessed_at_idx ON rbac_user_recent_items(accessed_at)`);

  // User Preferences table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_preferences (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL UNIQUE REFERENCES rbac_users(id) ON DELETE CASCADE,
      explorer_sort_by VARCHAR(50),
      explorer_view_mode VARCHAR(50),
      explorer_show_favorites_only BOOLEAN DEFAULT false,
      workspace_preferences JSONB,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_id_idx ON rbac_user_preferences(user_id)`);

  // AI Providers table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_ai_providers (
      id TEXT PRIMARY KEY NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider_type VARCHAR(255) NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // AI Models table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_ai_models (
      id TEXT PRIMARY KEY NOT NULL,
      provider_id TEXT NOT NULL REFERENCES rbac_ai_providers(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      model_id VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_models_provider_id_idx ON rbac_ai_models(provider_id)`);

  // AI Configs table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_ai_configs (
      id TEXT PRIMARY KEY NOT NULL,
      model_id TEXT NOT NULL REFERENCES rbac_ai_models(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_configs_model_id_idx ON rbac_ai_configs(model_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_active_idx ON rbac_ai_configs(is_active)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_configs_is_default_idx ON rbac_ai_configs(is_default)`);

  // Saved Queries table (connectionId is optional - null means shared across all connections)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_saved_queries (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES rbac_clickhouse_connections(id) ON DELETE SET NULL,
      connection_name VARCHAR(255),
      name VARCHAR(255) NOT NULL,
      query TEXT NOT NULL,
      description TEXT,
      is_public BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS saved_queries_user_idx ON rbac_saved_queries(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS saved_queries_conn_idx ON rbac_saved_queries(connection_id)`);

  console.log('[Migration] PostgreSQL schema created');
}

// ============================================
// Migration Runner
// ============================================

export async function runMigrations(options: { skipSeed?: boolean } = {}): Promise<MigrationResult> {
  const db = getDatabase();

  await ensureVersionTable(db);

  const appliedMigrations = await getAppliedMigrations(db);
  const appliedVersions = new Set(appliedMigrations.map(m => m.version));
  const previousVersion = appliedMigrations.length > 0
    ? appliedMigrations[appliedMigrations.length - 1].version
    : null;

  const isFirstRunFlag = appliedMigrations.length === 0;
  const migrationsApplied: string[] = [];

  console.log(`[Migration] Current version: ${previousVersion || 'none (first run)'}`);
  console.log(`[Migration] Target version: ${APP_VERSION}`);

  // For first run, create initial schema
  if (isFirstRunFlag) {
    console.log('[Migration] First run detected - creating initial schema');
    await createSchemaFromDrizzle(db);
  }

  // Run pending migrations
  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      console.log(`[Migration] Skipping ${migration.version} (already applied)`);
      continue;
    }

    console.log(`[Migration] Applying ${migration.version}: ${migration.name}`);

    try {
      await migration.up(db);
      await recordMigration(db, migration);
      migrationsApplied.push(migration.version);
      console.log(`[Migration] Applied ${migration.version} successfully`);
    } catch (error) {
      console.error(`[Migration] Failed to apply ${migration.version}:`, error);
      throw new Error(`Migration ${migration.version} failed: ${error}`);
    }
  }

  const currentVersion = await getCurrentVersion();

  if (migrationsApplied.length > 0) {
    console.log(`[Migration] Applied ${migrationsApplied.length} migration(s): ${migrationsApplied.join(', ')}`);
  } else {
    console.log('[Migration] No new migrations to apply');
  }

  return {
    isFirstRun: isFirstRunFlag,
    migrationsApplied,
    currentVersion: currentVersion || APP_VERSION,
    previousVersion,
  };
}

export async function getMigrationStatus(): Promise<{
  currentVersion: string | null;
  targetVersion: string;
  pendingMigrations: string[];
  appliedMigrations: MigrationStatus[];
}> {
  const db = getDatabase();
  await ensureVersionTable(db);

  const appliedMigrations = await getAppliedMigrations(db);
  const appliedVersions = new Set(appliedMigrations.map(m => m.version));

  const pendingMigrations = MIGRATIONS
    .filter(m => !appliedVersions.has(m.version))
    .map(m => m.version);

  return {
    currentVersion: appliedMigrations.length > 0
      ? appliedMigrations[appliedMigrations.length - 1].version
      : null,
    targetVersion: APP_VERSION,
    pendingMigrations,
    appliedMigrations,
  };
}

export async function needsUpgrade(): Promise<boolean> {
  const status = await getMigrationStatus();
  return status.pendingMigrations.length > 0;
}
