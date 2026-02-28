/**
 * API Module
 * 
 * This module exports all API functions for CHouse UI.
 * Use these functions instead of direct ClickHouse client calls.
 */

// Client and utilities
export {
  api,
  getSessionId,
  setSessionId,
  clearSession,
  setRbacTokens,
  getRbacAccessToken,
  getRbacRefreshToken,
  clearRbacTokens
} from './client';
export type { ApiResponse, ApiError, RequestOptions, RbacTokens } from './client';

// Query execution
export * as queryApi from './query';
export type { QueryResult, QueryStatistics, QueryMeta, IntellisenseData, IntellisenseFunctionInfo } from './query';

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
  rbacConnectionsApi,
  rbacUserPreferencesApi,
  checkRbacHealth,
} from './rbac';
export type {
  RbacUser,
  RbacRole,
  RbacPermission,
  RbacLoginResponse,
  RbacAuditLog,
  UserFavorite,
  UserRecentItem,
  UserPreferences,
  CreateUserInput as RbacCreateUserInput,
  UpdateUserInput as RbacUpdateUserInput,
  CreateRoleInput as RbacCreateRoleInput,
  UpdateRoleInput as RbacUpdateRoleInput,
} from './rbac';
