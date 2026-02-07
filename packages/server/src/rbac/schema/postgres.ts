/**
 * RBAC Schema for PostgreSQL
 * 
 * PostgreSQL-specific schema definitions using Drizzle ORM.
 * Ideal for production and multi-instance deployments.
 */

import { pgTable, text, boolean, timestamp, integer, uniqueIndex, index, jsonb, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================
// Users Table
// ============================================

export const users = pgTable('rbac_users', {
  id: text('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  isSystemUser: boolean('is_system_user').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
  usernameIdx: uniqueIndex('users_username_idx').on(table.username),
  activeIdx: index('users_active_idx').on(table.isActive),
}));

// ============================================
// Roles Table
// ============================================

export const roles = pgTable('rbac_roles', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (table) => ({
  nameIdx: uniqueIndex('roles_name_idx').on(table.name),
  priorityIdx: index('roles_priority_idx').on(table.priority),
}));

// ============================================
// Permissions Table
// ============================================

export const permissions = pgTable('rbac_permissions', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }).notNull(),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameIdx: uniqueIndex('permissions_name_idx').on(table.name),
  categoryIdx: index('permissions_category_idx').on(table.category),
}));

// ============================================
// User-Role Junction Table
// ============================================

export const userRoles = pgTable('rbac_user_roles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy: text('assigned_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  userRoleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),
  userIdx: index('user_roles_user_idx').on(table.userId),
  roleIdx: index('user_roles_role_idx').on(table.roleId),
}));

// ============================================
// Role-Permission Junction Table
// ============================================

export const rolePermissions = pgTable('rbac_role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  rolePermIdx: uniqueIndex('role_perms_role_perm_idx').on(table.roleId, table.permissionId),
  roleIdx: index('role_perms_role_idx').on(table.roleId),
}));

// ============================================
// Resource Permissions (Scoped Access)
// ============================================

export const resourcePermissions = pgTable('rbac_resource_permissions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  resourceType: varchar('resource_type', { length: 50 }).notNull(),
  resourceId: text('resource_id').notNull(),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  granted: boolean('granted').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
}, (table) => ({
  resourceIdx: index('resource_perms_resource_idx').on(table.resourceType, table.resourceId),
  userIdx: index('resource_perms_user_idx').on(table.userId),
  roleIdx: index('resource_perms_role_idx').on(table.roleId),
}));

// ============================================
// Sessions Table
// ============================================

export const sessions = pgTable('rbac_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshToken: text('refresh_token').notNull().unique(),
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  userIdx: index('sessions_user_idx').on(table.userId),
  tokenIdx: uniqueIndex('sessions_token_idx').on(table.refreshToken),
  expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
}));

// ============================================
// Audit Logs Table (with partitioning support)
// ============================================

export const auditLogs = pgTable('rbac_audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: text('resource_id'),
  details: jsonb('details').$type<Record<string, unknown>>(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  status: varchar('status', { length: 20 }).notNull().default('success'),
  errorMessage: text('error_message'),
  usernameSnapshot: varchar('username_snapshot', { length: 100 }),
  emailSnapshot: varchar('email_snapshot', { length: 255 }),
  displayNameSnapshot: varchar('display_name_snapshot', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('audit_user_idx').on(table.userId),
  actionIdx: index('audit_action_idx').on(table.action),
  resourceIdx: index('audit_resource_idx').on(table.resourceType, table.resourceId),
  createdAtIdx: index('audit_created_at_idx').on(table.createdAt),
}));

// ============================================
// API Keys Table
// ============================================

export const apiKeys = pgTable('rbac_api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  userIdx: index('api_keys_user_idx').on(table.userId),
  keyHashIdx: uniqueIndex('api_keys_hash_idx').on(table.keyHash),
  prefixIdx: index('api_keys_prefix_idx').on(table.keyPrefix),
}));

// ============================================
// ClickHouse Connections Table
// ============================================

export const clickhouseConnections = pgTable('rbac_clickhouse_connections', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  host: varchar('host', { length: 255 }).notNull(),
  port: integer('port').notNull().default(8123),
  username: varchar('username', { length: 255 }).notNull(),
  passwordEncrypted: text('password_encrypted'),
  database: varchar('database', { length: 255 }),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sslEnabled: boolean('ssl_enabled').notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (table) => ({
  nameIdx: index('ch_connections_name_idx').on(table.name),
  defaultIdx: index('ch_connections_default_idx').on(table.isDefault),
}));

// ============================================
// User-Connection Access Table
// ============================================

export const userConnections = pgTable('rbac_user_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').notNull().references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  canUse: boolean('can_use').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userConnIdx: uniqueIndex('user_conn_user_conn_idx').on(table.userId, table.connectionId),
}));

// ============================================
// Data Access Rules Table
// Defines which databases/tables a role OR user can access
// Either roleId OR userId must be set (not both)
// ============================================

export const dataAccessRules = pgTable('rbac_data_access_rules', {
  id: text('id').primaryKey(),
  // Either roleId or userId should be set, not both
  roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  // null connectionId means rule applies to all connections

  // Database pattern: exact name, wildcard (*), or regex pattern
  databasePattern: varchar('database_pattern', { length: 255 }).notNull().default('*'),

  // Table pattern: exact name, wildcard (*), or regex pattern
  tablePattern: varchar('table_pattern', { length: 255 }).notNull().default('*'),

  // Access type: 'read' (SELECT), 'write' (INSERT/UPDATE), 'admin' (DDL)
  accessType: varchar('access_type', { length: 20 }).notNull().default('read'),

  // If false, this is a deny rule (takes precedence over allow rules)
  isAllowed: boolean('is_allowed').notNull().default(true),

  // Priority: higher priority rules are evaluated first
  priority: integer('priority').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

export const clickhouseUsersMetadata = pgTable('rbac_clickhouse_users_metadata', {
  id: text('id').primaryKey(),
  // The ClickHouse username (as it appears in system.users)
  username: varchar('username', { length: 255 }).notNull(),
  // Which ClickHouse connection this user belongs to
  connectionId: text('connection_id').notNull().references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  // Role: developer, analyst, or viewer
  role: varchar('role', { length: 20 }).notNull(), // 'developer' | 'analyst' | 'viewer'
  // Cluster name (optional, for ON CLUSTER operations)
  cluster: varchar('cluster', { length: 255 }),
  // Host restrictions (optional)
  hostIp: varchar('host_ip', { length: 255 }),
  hostNames: varchar('host_names', { length: 255 }),
  // Authentication type (optional, defaults to sha256_password)
  authType: varchar('auth_type', { length: 50 }),
  // Allowed databases (JSON array of database names)
  allowedDatabases: jsonb('allowed_databases').$type<string[]>().notNull().default([]),
  // Allowed tables (JSON array of {database: string, table: string})
  allowedTables: jsonb('allowed_tables').$type<Array<{ database: string; table: string }>>().notNull().default([]),
  // Metadata
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
export const userFavorites = pgTable('rbac_user_favorites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }),
  connectionName: varchar('connection_name', { length: 255 }), // Denormalized for display when connection is deleted
  database: varchar('database', { length: 255 }).notNull(),
  table: varchar('table', { length: 255 }), // null means favorite database, not table
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userDbTableConnIdx: uniqueIndex('user_favorites_user_db_table_conn_idx').on(table.userId, table.database, table.table, table.connectionId),
  userIdIdx: index('user_favorites_user_id_idx').on(table.userId),
  connIdIdx: index('user_favorites_conn_id_idx').on(table.connectionId),
}));

/**
 * User Recent Items Table
 * Stores recently accessed databases and tables for each user with optional connection association
 */
export const userRecentItems = pgTable('rbac_user_recent_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }),
  connectionName: varchar('connection_name', { length: 255 }), // Denormalized for display when connection is deleted
  database: varchar('database', { length: 255 }).notNull(),
  table: varchar('table', { length: 255 }), // null means recent database, not table
  accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
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
export const savedQueries = pgTable('rbac_saved_queries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }), // Optional - null means shared across all connections
  connectionName: varchar('connection_name', { length: 255 }), // Denormalized for display when connection is deleted
  name: varchar('name', { length: 255 }).notNull(),
  query: text('query').notNull(),
  description: text('description'),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('saved_queries_user_idx').on(table.userId),
  connIdx: index('saved_queries_conn_idx').on(table.connectionId),
}));

/**
 * User Preferences Table
 * Stores user-specific UI preferences (view mode, sort order, etc.)
 */
export const userPreferences = pgTable('rbac_user_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  // Explorer preferences
  explorerSortBy: varchar('explorer_sort_by', { length: 50 }), // 'name' | 'date' | 'size'
  explorerViewMode: varchar('explorer_view_mode', { length: 50 }), // 'tree' | 'list' | 'compact'
  explorerShowFavoritesOnly: boolean('explorer_show_favorites_only').default(false),
  // Workspace preferences
  workspacePreferences: jsonb('workspace_preferences').$type<Record<string, unknown>>(),
  // Other preferences can be added here
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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