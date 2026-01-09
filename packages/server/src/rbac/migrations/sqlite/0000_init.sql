-- RBAC SQLite Migration: Initial Schema
-- This creates all tables for the RBAC system

-- Users table
CREATE TABLE IF NOT EXISTS rbac_users (
    id TEXT PRIMARY KEY,
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
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON rbac_users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON rbac_users(username);
CREATE INDEX IF NOT EXISTS users_active_idx ON rbac_users(is_active);

-- Roles table
CREATE TABLE IF NOT EXISTS rbac_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    metadata TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_idx ON rbac_roles(name);
CREATE INDEX IF NOT EXISTS roles_priority_idx ON rbac_roles(priority);

-- Permissions table
CREATE TABLE IF NOT EXISTS rbac_permissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_idx ON rbac_permissions(name);
CREATE INDEX IF NOT EXISTS permissions_category_idx ON rbac_permissions(category);

-- User-Role junction table
CREATE TABLE IF NOT EXISTS rbac_user_roles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    assigned_at INTEGER NOT NULL DEFAULT (unixepoch()),
    assigned_by TEXT,
    expires_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_idx ON rbac_user_roles(user_id, role_id);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON rbac_user_roles(user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON rbac_user_roles(role_id);

-- Role-Permission junction table
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS role_perms_role_perm_idx ON rbac_role_permissions(role_id, permission_id);
CREATE INDEX IF NOT EXISTS role_perms_role_idx ON rbac_role_permissions(role_id);

-- Resource permissions table
CREATE TABLE IF NOT EXISTS rbac_resource_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    granted INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS resource_perms_resource_idx ON rbac_resource_permissions(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS resource_perms_user_idx ON rbac_resource_permissions(user_id);
CREATE INDEX IF NOT EXISTS resource_perms_role_idx ON rbac_resource_permissions(role_id);

-- Sessions table
CREATE TABLE IF NOT EXISTS rbac_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at INTEGER,
    revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON rbac_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_idx ON rbac_sessions(refresh_token);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON rbac_sessions(expires_at);

-- Audit logs table
CREATE TABLE IF NOT EXISTS rbac_audit_logs (
    id TEXT PRIMARY KEY,
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
);

CREATE INDEX IF NOT EXISTS audit_user_idx ON rbac_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_action_idx ON rbac_audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_resource_idx ON rbac_audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_created_at_idx ON rbac_audit_logs(created_at);

-- API keys table
CREATE TABLE IF NOT EXISTS rbac_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    expires_at INTEGER,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx ON rbac_api_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON rbac_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON rbac_api_keys(key_prefix);

-- ClickHouse connections table
CREATE TABLE IF NOT EXISTS rbac_clickhouse_connections (
    id TEXT PRIMARY KEY,
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
);

CREATE INDEX IF NOT EXISTS ch_connections_name_idx ON rbac_clickhouse_connections(name);
CREATE INDEX IF NOT EXISTS ch_connections_default_idx ON rbac_clickhouse_connections(is_default);

-- User-Connection access table
CREATE TABLE IF NOT EXISTS rbac_user_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
    can_use INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS user_conn_user_conn_idx ON rbac_user_connections(user_id, connection_id);
