/**
 * API Module
 * 
 * This module exports all API functions for ClickHouse Studio.
 * Use these functions instead of direct ClickHouse client calls.
 */

// Client and utilities
export { api, getSessionId, setSessionId, clearSession } from './client';
export type { ApiResponse, ApiError, RequestOptions } from './client';

// Authentication
export * as authApi from './auth';
export type { LoginCredentials, LoginResponse, SessionInfo, RefreshResponse } from './auth';

// Query execution
export * as queryApi from './query';
export type { QueryResult, QueryStatistics, QueryMeta, IntellisenseData } from './query';

// Database explorer
export * as explorerApi from './explorer';
export type {
  DatabaseInfo,
  TableInfo,
  TableDetails,
  ColumnInfo,
  CreateDatabaseInput,
  CreateTableInput,
  ColumnDefinition,
} from './explorer';

// Metrics
export * as metricsApi from './metrics';
export type { SystemStats, RecentQuery } from './metrics';

// Saved queries
export * as savedQueriesApi from './saved-queries';
export type { SavedQuery, SaveQueryInput, UpdateQueryInput } from './saved-queries';

// Configuration
export * as configApi from './config';
export type { AppConfig } from './config';

// RBAC (Role-Based Access Control)
export {
  rbacAuthApi,
  rbacUsersApi,
  rbacRolesApi,
  rbacAuditApi,
  checkRbacHealth,
  setRbacTokens,
  getRbacAccessToken,
  getRbacRefreshToken,
  clearRbacTokens,
} from './rbac';
export type {
  RbacUser,
  RbacRole,
  RbacPermission,
  RbacTokens,
  RbacLoginResponse,
  RbacAuditLog,
  CreateUserInput as RbacCreateUserInput,
  UpdateUserInput as RbacUpdateUserInput,
  CreateRoleInput as RbacCreateRoleInput,
  UpdateRoleInput as RbacUpdateRoleInput,
} from './rbac';
