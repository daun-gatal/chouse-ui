/**
 * RBAC Schema Index
 * 
 * Re-exports all schema definitions and types.
 */

// Base types and constants
export * from './base';

// Database-specific schemas are imported dynamically based on DB_TYPE
// This file serves as the main entry point for schema types

import type { User, Role, Permission, Session, AuditLog, ApiKey, ClickHouseConnection, ClickHouseUserMetadata, DataAccessRule, UserRole, AiProvider, AiModel, AiConfig } from './sqlite';

// Re-export common types (shape is same for both SQLite and PostgreSQL)
export type {
  User,
  Role,
  Permission,
  Session,
  AuditLog,
  ApiKey,
  ClickHouseConnection,
  ClickHouseUserMetadata,
  DataAccessRule,
  UserRole,
  AiProvider,
  AiModel,
  AiConfig,
};

// User with roles expanded
export interface UserWithRoles extends User {
  roles: Role[];
  permissions: string[];
}

// Role with permissions expanded
export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

// Session with user info
export interface SessionWithUser extends Session {
  user: User;
}

// Audit log with user info
export interface AuditLogWithUser extends AuditLog {
  user?: User | null;
}

// API response types
export interface UserResponse {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  roles: string[];
  permissions: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface RoleResponse {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  priority: number;
  permissions: string[];
  userCount?: number;
}

export interface PermissionResponse {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}

// Input types for creating/updating
export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  displayName?: string | null;
  roleIds?: string[];
}

export interface UpdateUserInput {
  email?: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
  roleIds?: string[];
}

export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string;
  permissionIds: string[];
  isDefault?: boolean;
}

export interface UpdateRoleInput {
  displayName?: string;
  description?: string | null;
  permissionIds?: string[];
  isDefault?: boolean;
}
