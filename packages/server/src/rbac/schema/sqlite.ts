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
// User Identities (SSO links)
// ============================================

export const userIdentities = sqliteTable('rbac_user_identities', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  email: text('email'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
}, (table) => ({
  providerSubjectIdx: uniqueIndex('user_identities_provider_subject_idx').on(table.provider, table.subject),
  userIdx: index('user_identities_user_idx').on(table.userId),
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
  browser: text('browser'),
  browserVersion: text('browser_version'),
  os: text('os'),
  osVersion: text('os_version'),
  deviceType: text('device_type'),
  language: text('language'),
  country: text('country'),
  timezone: text('timezone'),
  city: text('city'),
  countryRegion: text('country_region'),
  deviceModel: text('device_model'),
  architecture: text('architecture'),
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
// Data Access Policies (named, reusable bundles)
// A policy groups one or more pattern rules and is attached to roles (M:N).
// Connection scope is PER-RULE: each rule may target a specific connection, or
// null = applies to all connections.
// ============================================

export const dataAccessPolicies = sqliteTable('rbac_data_access_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  // System policies (e.g. guest system-tables) cannot be deleted.
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  nameIdx: uniqueIndex('data_access_policies_name_idx').on(table.name),
}));

// Pattern entries inside a policy. connectionId scopes the rule to one connection;
// null = applies to all connections.
export const dataAccessPolicyRules = sqliteTable('rbac_data_access_policy_rules', {
  id: text('id').primaryKey(),
  policyId: text('policy_id').notNull().references(() => dataAccessPolicies.id, { onDelete: 'cascade' }),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  databasePattern: text('database_pattern').notNull().default('*'),
  tablePattern: text('table_pattern').notNull().default('*'),
  isAllowed: integer('is_allowed', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  policyIdx: index('data_access_policy_rules_policy_idx').on(table.policyId),
  connIdx: index('data_access_policy_rules_conn_idx').on(table.connectionId),
  patternIdx: index('data_access_policy_rules_pattern_idx').on(table.databasePattern, table.tablePattern),
}));

// M:N link role <-> policy
export const roleDataAccessPolicies = sqliteTable('rbac_role_data_access_policies', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  policyId: text('policy_id').notNull().references(() => dataAccessPolicies.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  rolePolicyIdx: uniqueIndex('role_data_access_role_policy_idx').on(table.roleId, table.policyId),
  roleIdx: index('role_data_access_role_idx').on(table.roleId),
  policyIdx: index('role_data_access_policy_idx').on(table.policyId),
}));

// ============================================
// ClickHouse Role State Table
// Reversible enable/disable for native ClickHouse roles. A row means the role
// is currently DISABLED; savedGrants holds the snapshot of its grants so they
// can be restored on enable. ClickHouse stays the source of truth for active
// roles — this only records transient disabled state.
// ============================================

export const clickhouseRoleState = sqliteTable('rbac_clickhouse_role_state', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull().references(() => clickhouseConnections.id, { onDelete: 'cascade' }),
  roleName: text('role_name').notNull(),
  savedGrants: text('saved_grants', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  disabledAt: integer('disabled_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  disabledBy: text('disabled_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  connRoleIdx: uniqueIndex('ch_role_state_conn_role_idx').on(table.connectionId, table.roleName),
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
// AI Providers Table
// Stores credentials and base configs for AI providers (e.g., OpenAI, Anthropic)
// ============================================
export const aiProviders = sqliteTable('rbac_ai_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull(),
  baseUrl: text('base_url'),
  apiKeyEncrypted: text('api_key_encrypted'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ============================================
// AI Models Table
// Stores available models for each provider (e.g., "gpt-4o")
// ============================================
export const aiModels = sqliteTable('rbac_ai_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => aiProviders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // Display name, e.g., "GPT-4o"
  modelId: text('model_id').notNull(), // String used by SDK, e.g., "gpt-4o"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  providerIdIdx: index('ai_models_provider_id_idx').on(table.providerId),
}));

// ============================================
// AI Configs Table
// Stores deployments/configurations surfaced to the frontend (e.g., "Main Chat Assistant")
// ============================================

export const aiConfigs = sqliteTable('rbac_ai_configs', {
  id: text('id').primaryKey(),
  modelId: text('model_id').notNull().references(() => aiModels.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // Custom display name for frontend
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  modelIdIdx: index('ai_configs_model_id_idx').on(table.modelId),
  isActiveIdx: index('ai_configs_is_active_idx').on(table.isActive),
  isDefaultIdx: index('ai_configs_is_default_idx').on(table.isDefault),
}));

// ============================================
// AI Chat Tables
// Stores AI assistant conversation threads and messages
// ============================================

/**
 * AI Chat Threads Table
 * Each thread represents a conversation session with the AI assistant
 */
export const aiChatThreads = sqliteTable('rbac_ai_chat_threads', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  connectionId: text('connection_id').references(() => clickhouseConnections.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdIdx: index('ai_chat_threads_user_id_idx').on(table.userId),
  connIdIdx: index('ai_chat_threads_conn_id_idx').on(table.connectionId),
  updatedAtIdx: index('ai_chat_threads_updated_at_idx').on(table.updatedAt),
}));

/**
 * AI Chat Messages Table
 * Individual messages within a chat thread
 */
export const aiChatMessages = sqliteTable('rbac_ai_chat_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => aiChatThreads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  toolCalls: text('tool_calls', { mode: 'json' }).$type<Array<{ name: string; args: Record<string, unknown>; result?: unknown }>>(),
  chartSpec: text('chart_spec', { mode: 'json' }).$type<Record<string, unknown> | Array<Record<string, unknown>>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  threadIdIdx: index('ai_chat_messages_thread_id_idx').on(table.threadId),
  createdAtIdx: index('ai_chat_messages_created_at_idx').on(table.createdAt),
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
export type DataAccessPolicy = typeof dataAccessPolicies.$inferSelect;
export type NewDataAccessPolicy = typeof dataAccessPolicies.$inferInsert;
export type DataAccessPolicyRule = typeof dataAccessPolicyRules.$inferSelect;
export type NewDataAccessPolicyRule = typeof dataAccessPolicyRules.$inferInsert;
export type RoleDataAccessPolicy = typeof roleDataAccessPolicies.$inferSelect;
export type NewRoleDataAccessPolicy = typeof roleDataAccessPolicies.$inferInsert;
export type ClickHouseRoleState = typeof clickhouseRoleState.$inferSelect;
export type NewClickHouseRoleState = typeof clickhouseRoleState.$inferInsert;
export type SavedQuery = typeof savedQueries.$inferSelect;
export type NewSavedQuery = typeof savedQueries.$inferInsert;
export type AiChatThread = typeof aiChatThreads.$inferSelect;
export type NewAiChatThread = typeof aiChatThreads.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type NewAiChatMessage = typeof aiChatMessages.$inferInsert;
export type AiProvider = typeof aiProviders.$inferSelect;
export type NewAiProvider = typeof aiProviders.$inferInsert;
export type AiModel = typeof aiModels.$inferSelect;
export type NewAiModel = typeof aiModels.$inferInsert;
export type AiConfig = typeof aiConfigs.$inferSelect;
export type NewAiConfig = typeof aiConfigs.$inferInsert;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;