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

export const APP_VERSION = '1.3.0';

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

  // User Favorites table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_favorites (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      database TEXT NOT NULL,
      "table" TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, database, "table")
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);

  // User Recent Items table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_recent_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      database TEXT NOT NULL,
      "table" TEXT,
      accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, database, "table")
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
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
  await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rbac_user_favorites (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
        database VARCHAR(255) NOT NULL,
        "table" VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, database, "table")
      )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_favorites_user_id_idx ON rbac_user_favorites(user_id)`);

  // User Recent Items table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rbac_user_recent_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
      database VARCHAR(255) NOT NULL,
      "table" VARCHAR(255),
      accessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, database, "table")
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_recent_user_id_idx ON rbac_user_recent_items(user_id)`);
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
