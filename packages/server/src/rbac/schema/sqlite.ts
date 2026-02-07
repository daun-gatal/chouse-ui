/**
 * RBAC Schema for SQLite
 * 
 * SQLite-specific schema definitions using Drizzle ORM.
 * Ideal for development and single-instance deployments.
 */

import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================
// Users Table
// ============================================

export const users = sqliteTable('rbac_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isSystemUser: integer('is_system_user', { mode: 'boolean' }).notNull().default(false),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  passwordChangedAt: integer('password_changed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
  usernameIdx: uniqueIndex('users_username_idx').on(table.username),
  activeIdx: index('users_active_idx').on(table.isActive),
}));

// ============================================
// Roles Table
// ============================================

export const roles = sqliteTable('rbac_roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  priority: integer('priority').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => ({
  nameIdx: uniqueIndex('roles_name_idx').on(table.name),
  priorityIdx: index('roles_priority_idx').on(table.priority),
}));

// ============================================
// Permissions Table
// ============================================

export const permissions = sqliteTable('rbac_permissions', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  nameIdx: uniqueIndex('permissions_name_idx').on(table.name),
  categoryIdx: index('permissions_category_idx').on(table.category),
}));

// ============================================
// User-Role Junction Table
// ============================================

export const userRoles = sqliteTable('rbac_user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  assignedBy: text('assigned_by'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
}, (table) => ({
  userRoleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),
  userIdx: index('user_roles_user_idx').on(table.userId),
  roleIdx: index('user_roles_role_idx').on(table.roleId),
}));

// ============================================
// Role-Permission Junction Table
// ============================================

export const rolePermissions = sqliteTable('rbac_role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  rolePermIdx: uniqueIndex('role_perms_role_perm_idx').on(table.roleId, table.permissionId),
  roleIdx: index('role_perms_role_idx').on(table.roleId),
}));

// ============================================
// Resource Permissions (Scoped Access)
// ============================================

export const resourcePermissions = sqliteTable('rbac_resource_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(), // 'database', 'table', 'saved_query'
  resourceId: text('resource_id').notNull(), // e.g., 'default.my_table' or '*' for all
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  granted: integer('granted', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by'),
}, (table) => ({
  resourceIdx: index('resource_perms_resource_idx').on(table.resourceType, table.resourceId),
  userIdx: index('resource_perms_user_idx').on(table.userId),
  roleIdx: index('resource_perms_role_idx').on(table.roleId),
}));

// ============================================
// Sessions Table (for JWT refresh tokens)
// ============================================

export const sessions = sqliteTable('rbac_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshToken: text('refresh_token').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
}, (table) => ({
  userIdx: index('sessions_user_idx').on(table.userId),
  tokenIdx: uniqueIndex('sessions_token_idx').on(table.refreshToken),
  expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
}));

// ============================================
// Audit Logs Table
// ============================================

export const auditLogs = sqliteTable('rbac_audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  status: text('status').notNull().default('success'), // 'success', 'failure'
  errorMessage: text('error_message'),
  usernameSnapshot: text('username_snapshot'),
  emailSnapshot: text('email_snapshot'),
  displayNameSnapshot: text('display_name_snapshot'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdx: index('audit_user_idx').on(table.userId),
  actionIdx: index('audit_action_idx').on(table.action),
  resourceIdx: index('audit_resource_idx').on(table.resourceType, table.resourceId),
  createdAtIdx: index('audit_created_at_idx').on(table.createdAt),
}));

// ============================================
// API Keys Table (for programmatic access)
// ============================================

export const apiKeys = sqliteTable('rbac_api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(), // First 8 chars for identification
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default([]),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
}, (table) => ({
  userIdx: index('api_keys_user_idx').on(table.userId),
  keyHashIdx: uniqueIndex('api_keys_hash_idx').on(table.keyHash),
  prefixIdx: index('api_keys_prefix_idx').on(table.keyPrefix),
}));

// ============================================
// ClickHouse Connections Table
// ============================================

export const clickhouseConnections = sqliteTable('rbac_clickhouse_connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(8123),
  username: text('username').notNull(),
  passwordEncrypted: text('password_encrypted'), // Encrypted with server key
  database: text('database'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sslEnabled: integer('ssl_enabled', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => ({
  nameIdx: index('ch_connections_name_idx').on(table.name),
  defaultIdx: index('ch_connections_default_idx').on(table.isDefault),
}));

// ============================================
// User-Connection Access Table
// ============================================

export const userConnections = sqliteTable('rbac_user_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').notNull().references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  canUse: integer('can_use', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userConnIdx: uniqueIndex('user_conn_user_conn_idx').on(table.userId, table.connectionId),
}));

// ============================================
// Data Access Rules Table
// Defines which databases/tables a role OR user can access
// Either roleId OR userId must be set (not both)
// ============================================

export const dataAccessRules = sqliteTable('rbac_data_access_rules', {
  id: text('id').primaryKey(),
  // Either roleId or userId should be set, not both
  roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  // null connectionId means rule applies to all connections

  // Database pattern: exact name, wildcard (*), or regex pattern
  databasePattern: text('database_pattern').notNull().default('*'),

  // Table pattern: exact name, wildcard (*), or regex pattern
  tablePattern: text('table_pattern').notNull().default('*'),

  // Access type: 'read' (SELECT), 'write' (INSERT/UPDATE), 'admin' (DDL)
  accessType: text('access_type').notNull().default('read'),

  // If false, this is a deny rule (takes precedence over allow rules)
  isAllowed: integer('is_allowed', { mode: 'boolean' }).notNull().default(true),

  // Priority: higher priority rules are evaluated first
  priority: integer('priority').notNull().default(0),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  description: text('description'),
}, (table) => ({
  roleIdx: index('data_access_role_idx').on(table.roleId),
  userIdx: index('data_access_user_idx').on(table.userId),
  connIdx: index('data_access_conn_idx').on(table.connectionId),
  patternIdx: index('data_access_pattern_idx').on(table.databasePattern, table.tablePattern),
  roleConnIdx: index('data_access_role_conn_idx').on(table.roleId, table.connectionId),
  userConnIdx: index('data_access_user_conn_idx').on(table.userId, table.connectionId),
}));

// ============================================
// ClickHouse Users Metadata Table
// Stores configuration for ClickHouse users managed through the UI
// ============================================

export const clickhouseUsersMetadata = sqliteTable('rbac_clickhouse_users_metadata', {
  id: text('id').primaryKey(),
  // The ClickHouse username (as it appears in system.users)
  username: text('username').notNull(),
  // Which ClickHouse connection this user belongs to
  connectionId: text('connection_id').notNull().references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  // Role: developer, analyst, or viewer
  role: text('role').notNull(), // 'developer' | 'analyst' | 'viewer'
  // Cluster name (optional, for ON CLUSTER operations)
  cluster: text('cluster'),
  // Host restrictions (optional)
  hostIp: text('host_ip'),
  hostNames: text('host_names'),
  // Authentication type (optional, defaults to sha256_password)
  authType: text('auth_type'),
  // Allowed databases (JSON array of database names)
  allowedDatabases: text('allowed_databases', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // Allowed tables (JSON array of {database: string, table: string})
  allowedTables: text('allowed_tables', { mode: 'json' }).$type<Array<{ database: string; table: string }>>().notNull().default([]),
  // Metadata
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  usernameConnIdx: uniqueIndex('ch_users_meta_username_conn_idx').on(table.username, table.connectionId),
  usernameIdx: index('ch_users_meta_username_idx').on(table.username),
  connectionIdx: index('ch_users_meta_connection_idx').on(table.connectionId),
}));

// ============================================
// User Preferences Tables
// Stores user-specific UI preferences, favorites, and recent items
// ============================================

/**
 * User Favorites Table
 * Stores favorite databases and tables for each user with optional connection association
 */
export const userFavorites = sqliteTable('rbac_user_favorites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }),
  connectionName: text('connection_name'), // Denormalized for display when connection is deleted
  database: text('database').notNull(),
  table: text('table'), // null means favorite database, not table
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userDbTableConnIdx: uniqueIndex('user_favorites_user_db_table_conn_idx').on(table.userId, table.database, table.table, table.connectionId),
  userIdIdx: index('user_favorites_user_id_idx').on(table.userId),
  connIdIdx: index('user_favorites_conn_id_idx').on(table.connectionId),
}));

/**
 * User Recent Items Table
 * Stores recently accessed databases and tables for each user with optional connection association
 */
export const userRecentItems = sqliteTable('rbac_user_recent_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }),
  connectionName: text('connection_name'), // Denormalized for display when connection is deleted
  database: text('database').notNull(),
  table: text('table'), // null means recent database, not table
  accessedAt: integer('accessed_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userDbTableConnIdx: uniqueIndex('user_recent_user_db_table_conn_idx').on(table.userId, table.database, table.table, table.connectionId),
  userIdIdx: index('user_recent_user_id_idx').on(table.userId),
  connIdIdx: index('user_recent_conn_id_idx').on(table.connectionId),
  accessedAtIdx: index('user_recent_accessed_at_idx').on(table.accessedAt),
}));

/**
 * Saved Queries Table
 * Stores user saved SQL queries. connectionId is optional - if null, query is shared across all connections.
 */
export const savedQueries = sqliteTable('rbac_saved_queries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }), // Optional - null means shared across all connections
  connectionName: text('connection_name'), // Denormalized for display when connection is deleted
  name: text('name').notNull(),
  query: text('query').notNull(),
  description: text('description'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdx: index('saved_queries_user_idx').on(table.userId),
  connIdx: index('saved_queries_conn_idx').on(table.connectionId),
}));

/**
 * User Preferences Table
 * Stores user-specific UI preferences (view mode, sort order, etc.)
 */
export const userPreferences = sqliteTable('rbac_user_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  // Explorer preferences
  explorerSortBy: text('explorer_sort_by'), // 'name' | 'date' | 'size'
  explorerViewMode: text('explorer_view_mode'), // 'tree' | 'list' | 'compact'
  explorerShowFavoritesOnly: integer('explorer_show_favorites_only', { mode: 'boolean' }).default(false),
  // Workspace preferences
  workspacePreferences: text('workspace_preferences', { mode: 'json' }).$type<Record<string, unknown>>(),
  // Other preferences can be added here
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdIdx: uniqueIndex('user_preferences_user_id_idx').on(table.userId),
}));

// ============================================
// Type Exports
// ============================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserFavorite = typeof userFavorites.$inferSelect;
export type NewUserFavorite = typeof userFavorites.$inferInsert;
export type UserRecentItem = typeof userRecentItems.$inferSelect;
export type NewUserRecentItem = typeof userRecentItems.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ClickHouseConnection = typeof clickhouseConnections.$inferSelect;
export type DataAccessRule = typeof dataAccessRules.$inferSelect;
export type NewDataAccessRule = typeof dataAccessRules.$inferInsert;
export type ClickHouseUserMetadata = typeof clickhouseUsersMetadata.$inferSelect;
export type NewClickHouseUserMetadata = typeof clickhouseUsersMetadata.$inferInsert;
export type SavedQuery = typeof savedQueries.$inferSelect;
export type NewSavedQuery = typeof savedQueries.$inferInsert;