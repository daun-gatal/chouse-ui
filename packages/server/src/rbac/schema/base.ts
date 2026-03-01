/**
 * RBAC Base Schema Types
 * 
 * Shared types and enums for the RBAC system.
 * These are database-agnostic and used by both SQLite and PostgreSQL schemas.
 */

// ============================================
// Role Definitions (based on existing templates)
// ============================================

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  DEVELOPER: 'developer',
  ANALYST: 'analyst',
  VIEWER: 'viewer',
  GUEST: 'guest',
} as const;

export type SystemRole = typeof SYSTEM_ROLES[keyof typeof SYSTEM_ROLES];

export const ROLE_HIERARCHY: Record<SystemRole, number> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: 100,
  [SYSTEM_ROLES.ADMIN]: 80,
  [SYSTEM_ROLES.DEVELOPER]: 60,
  [SYSTEM_ROLES.ANALYST]: 40,
  [SYSTEM_ROLES.VIEWER]: 20,
  [SYSTEM_ROLES.GUEST]: 10,
};

// ============================================
// Permission Definitions
// ============================================

export const PERMISSIONS = {
  // User Management
  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',

  // Role Management
  ROLES_VIEW: 'roles:view',
  ROLES_CREATE: 'roles:create',
  ROLES_UPDATE: 'roles:update',
  ROLES_DELETE: 'roles:delete',
  ROLES_ASSIGN: 'roles:assign',

  // ClickHouse User Management
  CH_USERS_VIEW: 'clickhouse:users:view',
  CH_USERS_CREATE: 'clickhouse:users:create',
  CH_USERS_UPDATE: 'clickhouse:users:update',
  CH_USERS_DELETE: 'clickhouse:users:delete',

  // Database Operations
  DB_VIEW: 'database:view',
  DB_CREATE: 'database:create',
  DB_DROP: 'database:drop',

  // Table Operations
  TABLE_VIEW: 'table:view',
  TABLE_CREATE: 'table:create',
  TABLE_ALTER: 'table:alter',
  TABLE_DROP: 'table:drop',
  TABLE_SELECT: 'table:select',
  TABLE_INSERT: 'table:insert',
  TABLE_UPDATE: 'table:update',
  TABLE_DELETE: 'table:delete',

  // Query Operations
  QUERY_EXECUTE: 'query:execute',
  QUERY_EXECUTE_DDL: 'query:execute:ddl',
  QUERY_EXECUTE_DML: 'query:execute:dml',
  QUERY_EXECUTE_MISC: 'query:execute:misc',
  QUERY_HISTORY_VIEW: 'query:history:view',
  QUERY_HISTORY_VIEW_ALL: 'query:history:view:all',

  // Saved Queries
  SAVED_QUERIES_VIEW: 'saved_queries:view',
  SAVED_QUERIES_CREATE: 'saved_queries:create',
  SAVED_QUERIES_UPDATE: 'saved_queries:update',
  SAVED_QUERIES_DELETE: 'saved_queries:delete',
  SAVED_QUERIES_SHARE: 'saved_queries:share',

  // Metrics & Monitoring
  METRICS_VIEW: 'metrics:view',
  METRICS_VIEW_ADVANCED: 'metrics:view:advanced',

  // Settings
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_UPDATE: 'settings:update',

  // Audit Logs
  AUDIT_VIEW: 'audit:view',
  AUDIT_EXPORT: 'audit:export',
  AUDIT_DELETE: 'audit:delete',

  // Live Query Management
  LIVE_QUERIES_VIEW: 'live_queries:view',
  LIVE_QUERIES_KILL: 'live_queries:kill',
  LIVE_QUERIES_KILL_ALL: 'live_queries:kill_all',

  // Connection Management
  CONNECTIONS_VIEW: 'connections:view',
  CONNECTIONS_EDIT: 'connections:edit',
  CONNECTIONS_DELETE: 'connections:delete',

  // AI Features
  AI_OPTIMIZE: 'ai:optimize',
  AI_CHAT: 'ai:chat',

  // AI Models Management
  AI_MODELS_VIEW: 'ai_models:view',
  AI_MODELS_CREATE: 'ai_models:create',
  AI_MODELS_UPDATE: 'ai_models:update',
  AI_MODELS_DELETE: 'ai_models:delete',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ============================================
// Default Role Permissions
// ============================================

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),

  [SYSTEM_ROLES.ADMIN]: [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.USERS_DELETE,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.ROLES_ASSIGN,
    PERMISSIONS.CH_USERS_VIEW,
    PERMISSIONS.CH_USERS_CREATE,
    PERMISSIONS.CH_USERS_UPDATE,
    PERMISSIONS.CH_USERS_DELETE,
    PERMISSIONS.DB_VIEW,
    PERMISSIONS.DB_CREATE,
    PERMISSIONS.DB_DROP,
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_CREATE,
    PERMISSIONS.TABLE_ALTER,
    PERMISSIONS.TABLE_DROP,
    PERMISSIONS.TABLE_SELECT,
    PERMISSIONS.TABLE_INSERT,
    PERMISSIONS.TABLE_UPDATE,
    PERMISSIONS.TABLE_DELETE,
    PERMISSIONS.QUERY_EXECUTE,
    PERMISSIONS.QUERY_EXECUTE_DDL,
    PERMISSIONS.QUERY_EXECUTE_DML,
    PERMISSIONS.QUERY_EXECUTE_MISC,
    PERMISSIONS.QUERY_HISTORY_VIEW,
    PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
    PERMISSIONS.SAVED_QUERIES_VIEW,
    PERMISSIONS.SAVED_QUERIES_CREATE,
    PERMISSIONS.SAVED_QUERIES_UPDATE,
    PERMISSIONS.SAVED_QUERIES_DELETE,
    PERMISSIONS.SAVED_QUERIES_SHARE,
    PERMISSIONS.METRICS_VIEW,
    PERMISSIONS.METRICS_VIEW_ADVANCED,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_UPDATE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.LIVE_QUERIES_VIEW,
    PERMISSIONS.LIVE_QUERIES_KILL,
    PERMISSIONS.LIVE_QUERIES_KILL_ALL,
    PERMISSIONS.AI_OPTIMIZE,
    PERMISSIONS.AI_CHAT,
    PERMISSIONS.AI_MODELS_VIEW,
    PERMISSIONS.AI_MODELS_CREATE,
    PERMISSIONS.AI_MODELS_UPDATE,
    PERMISSIONS.AI_MODELS_DELETE,
  ],

  [SYSTEM_ROLES.DEVELOPER]: [
    PERMISSIONS.DB_VIEW,
    PERMISSIONS.DB_CREATE,
    PERMISSIONS.DB_DROP,
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_CREATE,
    PERMISSIONS.TABLE_ALTER,
    PERMISSIONS.TABLE_DROP,
    PERMISSIONS.TABLE_SELECT,
    PERMISSIONS.TABLE_INSERT,
    PERMISSIONS.TABLE_UPDATE,
    PERMISSIONS.TABLE_DELETE,
    PERMISSIONS.QUERY_EXECUTE,
    PERMISSIONS.QUERY_EXECUTE_DDL,
    PERMISSIONS.QUERY_EXECUTE_DML,
    PERMISSIONS.QUERY_EXECUTE_MISC,
    PERMISSIONS.QUERY_HISTORY_VIEW,
    PERMISSIONS.SAVED_QUERIES_VIEW,
    PERMISSIONS.SAVED_QUERIES_CREATE,
    PERMISSIONS.SAVED_QUERIES_UPDATE,
    PERMISSIONS.SAVED_QUERIES_DELETE,
    PERMISSIONS.METRICS_VIEW,
    PERMISSIONS.AI_OPTIMIZE,
    PERMISSIONS.AI_CHAT,
  ],

  [SYSTEM_ROLES.ANALYST]: [
    PERMISSIONS.DB_VIEW,
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_SELECT,
    PERMISSIONS.TABLE_INSERT,
    PERMISSIONS.TABLE_UPDATE,
    PERMISSIONS.TABLE_DELETE,
    PERMISSIONS.QUERY_EXECUTE,
    PERMISSIONS.QUERY_EXECUTE_DML,
    PERMISSIONS.QUERY_EXECUTE_MISC,
    PERMISSIONS.QUERY_HISTORY_VIEW,
    PERMISSIONS.SAVED_QUERIES_VIEW,
    PERMISSIONS.SAVED_QUERIES_CREATE,
    PERMISSIONS.SAVED_QUERIES_UPDATE,
    PERMISSIONS.SAVED_QUERIES_DELETE,
    PERMISSIONS.METRICS_VIEW,
    PERMISSIONS.AI_OPTIMIZE,
    PERMISSIONS.AI_CHAT,
  ],

  [SYSTEM_ROLES.VIEWER]: [
    PERMISSIONS.DB_VIEW,
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_SELECT,
    PERMISSIONS.QUERY_EXECUTE,
    PERMISSIONS.QUERY_HISTORY_VIEW,
    PERMISSIONS.SAVED_QUERIES_VIEW,
    PERMISSIONS.METRICS_VIEW,
  ],

  [SYSTEM_ROLES.GUEST]: [
    // User Management - View only
    PERMISSIONS.USERS_VIEW,
    // Role Management - View only
    PERMISSIONS.ROLES_VIEW,
    // ClickHouse User Management - View only
    PERMISSIONS.CH_USERS_VIEW,
    // Database Operations - View only
    PERMISSIONS.DB_VIEW,
    // Table Operations - View and Select only
    PERMISSIONS.TABLE_VIEW,
    PERMISSIONS.TABLE_SELECT,
    // Query Operations - Execute read-only queries only (no DDL/DML)
    PERMISSIONS.QUERY_EXECUTE,
    PERMISSIONS.QUERY_HISTORY_VIEW,
    // Saved Queries - View only
    PERMISSIONS.SAVED_QUERIES_VIEW,
    // Metrics & Monitoring - View only
    PERMISSIONS.METRICS_VIEW,
    PERMISSIONS.METRICS_VIEW_ADVANCED,
    // Settings - View only
    PERMISSIONS.SETTINGS_VIEW,
    // Audit Logs - View only
    PERMISSIONS.AUDIT_VIEW,
  ],
};

// ============================================
// Resource Types for Scoped Permissions
// ============================================

export const RESOURCE_TYPES = {
  DATABASE: 'database',
  TABLE: 'table',
  SAVED_QUERY: 'saved_query',
  CONNECTION: 'connection',
} as const;

export type ResourceType = typeof RESOURCE_TYPES[keyof typeof RESOURCE_TYPES];

// ============================================
// Audit Action Types
// ============================================

export const AUDIT_ACTIONS = {
  // Auth
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  LOGIN_FAILED: 'auth.login_failed',
  PASSWORD_CHANGE: 'auth.password_change',

  // User Management
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ROLE_ASSIGN: 'user.role_assign',
  USER_ROLE_REVOKE: 'user.role_revoke',

  // Role Management
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',

  // ClickHouse Operations
  CH_USER_CREATE: 'clickhouse.user_create',
  CH_USER_UPDATE: 'clickhouse.user_update',
  CH_USER_DELETE: 'clickhouse.user_delete',
  CH_USER_SYNC: 'clickhouse.user_sync',
  CH_QUERY_EXECUTE: 'clickhouse.query_execute',
  CH_DATABASE_CREATE: 'clickhouse.database_create',
  CH_DATABASE_DROP: 'clickhouse.database_drop',
  CH_TABLE_CREATE: 'clickhouse.table_create',
  CH_TABLE_ALTER: 'clickhouse.table_alter',
  CH_TABLE_DROP: 'clickhouse.table_drop',

  // Settings
  SETTINGS_UPDATE: 'settings.update',

  // Live Query Management
  LIVE_QUERY_KILL: 'live_query.kill',

  // Audit Logs
  AUDIT_LOG_DELETE: 'audit.delete',

  // AI Providers
  AI_PROVIDER_CREATE: 'ai_provider.create',
  AI_PROVIDER_UPDATE: 'ai_provider.update',
  AI_PROVIDER_DELETE: 'ai_provider.delete',

  // AI Models
  AI_MODEL_CREATE: 'ai_model.create',
  AI_MODEL_UPDATE: 'ai_model.update',
  AI_MODEL_DELETE: 'ai_model.delete',

  // AI Configs
  AI_CONFIG_CREATE: 'ai_config.create',
  AI_CONFIG_UPDATE: 'ai_config.update',
  AI_CONFIG_DELETE: 'ai_config.delete',

  // Connection Management
  CONNECTION_CREATE: 'connection.create',
  CONNECTION_UPDATE: 'connection.update',
  CONNECTION_DELETE: 'connection.delete',
  CONNECTION_CONNECT: 'connection.connect',
  CONNECTION_GRANT_ACCESS: 'connection.grant_access',
  CONNECTION_REVOKE_ACCESS: 'connection.revoke_access',

  // Data Access Rules
  DATA_ACCESS_CREATE: 'data_access.create',
  DATA_ACCESS_UPDATE: 'data_access.update',
  DATA_ACCESS_DELETE: 'data_access.delete',
  DATA_ACCESS_BULK_SET: 'data_access.bulk_set',

  // Saved Queries
  SAVED_QUERY_CREATE: 'saved_query.create',
  SAVED_QUERY_UPDATE: 'saved_query.update',
  SAVED_QUERY_DELETE: 'saved_query.delete',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];
