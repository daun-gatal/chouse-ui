-- RBAC PostgreSQL Migration: Initial Schema
-- This creates all tables for the RBAC system

-- Users table
CREATE TABLE IF NOT EXISTS rbac_users (
    id TEXT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(255),
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system_user BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    metadata JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON rbac_users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON rbac_users(username);
CREATE INDEX IF NOT EXISTS users_active_idx ON rbac_users(is_active);

-- Roles table
CREATE TABLE IF NOT EXISTS rbac_roles (
    id TEXT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_idx ON rbac_roles(name);
CREATE INDEX IF NOT EXISTS roles_priority_idx ON rbac_roles(priority);

-- Permissions table
CREATE TABLE IF NOT EXISTS rbac_permissions (
    id TEXT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_idx ON rbac_permissions(name);
CREATE INDEX IF NOT EXISTS permissions_category_idx ON rbac_permissions(category);

-- User-Role junction table
CREATE TABLE IF NOT EXISTS rbac_user_roles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by TEXT,
    expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_idx ON rbac_user_roles(user_id, role_id);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON rbac_user_roles(user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON rbac_user_roles(role_id);

-- Role-Permission junction table
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS role_perms_role_perm_idx ON rbac_role_permissions(role_id, permission_id);
CREATE INDEX IF NOT EXISTS role_perms_role_idx ON rbac_role_permissions(role_id);

-- Resource permissions table
CREATE TABLE IF NOT EXISTS rbac_resource_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES rbac_users(id) ON DELETE CASCADE,
    role_id TEXT REFERENCES rbac_roles(id) ON DELETE CASCADE,
    resource_type VARCHAR(50) NOT NULL,
    resource_id TEXT NOT NULL,
    permission_id TEXT NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
    granted BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    ip_address VARCHAR(45),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON rbac_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_idx ON rbac_sessions(refresh_token);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON rbac_sessions(expires_at);

-- Audit logs table (consider partitioning by created_at for production)
CREATE TABLE IF NOT EXISTS rbac_audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id TEXT,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_user_idx ON rbac_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_action_idx ON rbac_audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_resource_idx ON rbac_audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_created_at_idx ON rbac_audit_logs(created_at);

-- API keys table
CREATE TABLE IF NOT EXISTS rbac_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix VARCHAR(12) NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx ON rbac_api_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON rbac_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON rbac_api_keys(key_prefix);

-- ClickHouse connections table
CREATE TABLE IF NOT EXISTS rbac_clickhouse_connections (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 8123,
    username VARCHAR(255) NOT NULL,
    password_encrypted TEXT,
    database VARCHAR(255),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ssl_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT REFERENCES rbac_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS ch_connections_name_idx ON rbac_clickhouse_connections(name);
CREATE INDEX IF NOT EXISTS ch_connections_default_idx ON rbac_clickhouse_connections(is_default);

-- User-Connection access table
CREATE TABLE IF NOT EXISTS rbac_user_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES rbac_users(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES rbac_clickhouse_connections(id) ON DELETE CASCADE,
    can_use BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_conn_user_conn_idx ON rbac_user_connections(user_id, connection_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_rbac_users_updated_at ON rbac_users;
CREATE TRIGGER update_rbac_users_updated_at
    BEFORE UPDATE ON rbac_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rbac_roles_updated_at ON rbac_roles;
CREATE TRIGGER update_rbac_roles_updated_at
    BEFORE UPDATE ON rbac_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rbac_ch_connections_updated_at ON rbac_clickhouse_connections;
CREATE TRIGGER update_rbac_ch_connections_updated_at
    BEFORE UPDATE ON rbac_clickhouse_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
