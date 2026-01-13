/**
 * RBAC API Client
 * 
 * Frontend API client for the Role-Based Access Control system.
 */

import { ApiError, getSessionId } from './client';

// ============================================
// Types
// ============================================

export interface RbacUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  roles: string[];
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RbacRole {
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

export interface RbacPermission {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  category: string;
}

export interface RbacTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface RbacLoginResponse {
  user: RbacUser;
  tokens: RbacTokens;
}

export interface RbacAuditLog {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  status: 'success' | 'failure';
  errorMessage: string | null;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  username: string;
  password?: string;
  displayName?: string;
  roleIds?: string[];
  generatePassword?: boolean;
}

export interface UpdateUserInput {
  email?: string;
  username?: string;
  displayName?: string;
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

// ============================================
// Token Management
// ============================================

const RBAC_ACCESS_TOKEN_KEY = 'rbac_access_token';
const RBAC_REFRESH_TOKEN_KEY = 'rbac_refresh_token';

export function setRbacTokens(tokens: RbacTokens): void {
  localStorage.setItem(RBAC_ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(RBAC_REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function getRbacAccessToken(): string | null {
  return localStorage.getItem(RBAC_ACCESS_TOKEN_KEY);
}

export function getRbacRefreshToken(): string | null {
  return localStorage.getItem(RBAC_REFRESH_TOKEN_KEY);
}

export function clearRbacTokens(): void {
  localStorage.removeItem(RBAC_ACCESS_TOKEN_KEY);
  localStorage.removeItem(RBAC_REFRESH_TOKEN_KEY);
}

// ============================================
// API Client with Auth Header
// ============================================

async function rbacFetch<T>(
  endpoint: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const accessToken = getRbacAccessToken();
  const sessionId = getSessionId();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers || {}),
  };
  
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  
  // Add session ID if available (for ClickHouse operations)
  // Only add if not already provided in options.headers
  if (sessionId && !headers['X-Session-ID']) {
    headers['X-Session-ID'] = sessionId;
  }
  
  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
  };
  
  // Handle body - stringify if it's an object
  if (options.body !== undefined) {
    fetchOptions.body = typeof options.body === 'string' 
      ? options.body 
      : JSON.stringify(options.body);
  }
  
  const response = await fetch(`/api/rbac${endpoint}`, fetchOptions);
  
  const data = await response.json();
  
  if (!response.ok) {
    // Try to refresh token on 401
    if (response.status === 401 && accessToken) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        // Retry with new token
        return rbacFetch<T>(endpoint, options);
      }
    }
    throw new ApiError(
      data.error?.message || 'Request failed',
      response.status,
      data.error?.code
    );
  }
  
  return data.data;
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getRbacRefreshToken();
  if (!refreshToken) return false;
  
  try {
    const response = await fetch('/api/rbac/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ refreshToken }),
    });
    
    if (!response.ok) {
      clearRbacTokens();
      return false;
    }
    
    const data = await response.json();
    setRbacTokens(data.data.tokens);
    return true;
  } catch {
    clearRbacTokens();
    return false;
  }
}

// ============================================
// Auth API
// ============================================

export const rbacAuthApi = {
  /**
   * Login with email/username and password
   */
  async login(identifier: string, password: string): Promise<RbacLoginResponse> {
    const response = await fetch('/api/rbac/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ identifier, password }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new ApiError(
        data.error?.message || 'Login failed',
        response.status,
        data.error?.code
      );
    }
    
    // Store tokens
    setRbacTokens(data.data.tokens);
    
    return data.data;
  },
  
  /**
   * Logout current session
   */
  async logout(): Promise<void> {
    try {
      await rbacFetch('/auth/logout', { method: 'POST' });
    } finally {
      clearRbacTokens();
    }
  },
  
  /**
   * Logout from all sessions
   */
  async logoutAll(): Promise<void> {
    try {
      await rbacFetch('/auth/logout-all', { method: 'POST' });
    } finally {
      clearRbacTokens();
    }
  },
  
  /**
   * Get current user info
   */
  async getCurrentUser(): Promise<RbacUser> {
    const result = await rbacFetch<{ user: RbacUser }>('/auth/me');
    return result.user;
  },
  
  /**
   * Change password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await rbacFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  
  /**
   * Validate current token
   */
  async validateToken(): Promise<{
    valid: boolean;
    userId: string;
    username: string;
    roles: string[];
    permissions: string[];
  }> {
    return rbacFetch('/auth/validate');
  },
};

// ============================================
// Users API
// ============================================

export const rbacUsersApi = {
  /**
   * List users
   */
  async list(options?: {
    page?: number;
    limit?: number;
    search?: string;
    roleId?: string;
    isActive?: boolean;
  }): Promise<{ users: RbacUser[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.search) params.set('search', options.search);
    if (options?.roleId) params.set('roleId', options.roleId);
    if (options?.isActive !== undefined) params.set('isActive', String(options.isActive));
    
    return rbacFetch(`/users?${params}`);
  },
  
  /**
   * Get user by ID
   */
  async get(id: string): Promise<RbacUser> {
    const result = await rbacFetch<{ user: RbacUser }>(`/users/${id}`);
    return result.user;
  },
  
  /**
   * Create user
   */
  async create(input: CreateUserInput): Promise<{ user: RbacUser; generatedPassword?: string }> {
    return rbacFetch('/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Update user
   */
  async update(id: string, input: UpdateUserInput): Promise<RbacUser> {
    const result = await rbacFetch<{ user: RbacUser }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return result.user;
  },
  
  /**
   * Delete user
   */
  async delete(id: string): Promise<void> {
    await rbacFetch(`/users/${id}`, { method: 'DELETE' });
  },
  
  /**
   * Reset user password
   */
  async resetPassword(id: string, options?: {
    newPassword?: string;
    generatePassword?: boolean;
  }): Promise<{ message: string; generatedPassword?: string }> {
    return rbacFetch(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(options || { generatePassword: true }),
    });
  },
  
  /**
   * Assign roles to user
   */
  async assignRoles(id: string, roleIds: string[]): Promise<RbacUser> {
    const result = await rbacFetch<{ user: RbacUser }>(`/users/${id}/assign-roles`, {
      method: 'POST',
      body: JSON.stringify({ roleIds }),
    });
    return result.user;
  },
};

// ============================================
// Roles API
// ============================================

export const rbacRolesApi = {
  /**
   * List all roles
   */
  async list(): Promise<RbacRole[]> {
    const result = await rbacFetch<{ roles: RbacRole[] }>('/roles');
    return result.roles;
  },
  
  /**
   * Get role by ID
   */
  async get(id: string): Promise<RbacRole> {
    const result = await rbacFetch<{ role: RbacRole }>(`/roles/${id}`);
    return result.role;
  },
  
  /**
   * Create role
   */
  async create(input: CreateRoleInput): Promise<RbacRole> {
    const result = await rbacFetch<{ role: RbacRole }>('/roles', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.role;
  },
  
  /**
   * Update role
   */
  async update(id: string, input: UpdateRoleInput): Promise<RbacRole> {
    const result = await rbacFetch<{ role: RbacRole }>(`/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return result.role;
  },
  
  /**
   * Delete role
   */
  async delete(id: string): Promise<void> {
    await rbacFetch(`/roles/${id}`, { method: 'DELETE' });
  },
  
  /**
   * List all permissions
   */
  async listPermissions(): Promise<RbacPermission[]> {
    const result = await rbacFetch<{ permissions: RbacPermission[] }>('/roles/permissions/list');
    return result.permissions;
  },
  
  /**
   * Get permissions grouped by category
   */
  async getPermissionsByCategory(): Promise<Record<string, RbacPermission[]>> {
    const result = await rbacFetch<{ permissionsByCategory: Record<string, RbacPermission[]> }>('/roles/permissions/by-category');
    return result.permissionsByCategory;
  },
};

// ============================================
// Audit API
// ============================================

export const rbacAuditApi = {
  /**
   * List audit logs
   */
  async list(options?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ logs: RbacAuditLog[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.userId) params.set('userId', options.userId);
    if (options?.action) params.set('action', options.action);
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    
    return rbacFetch(`/audit?${params}`);
  },
  
  /**
   * Get available audit actions
   */
  async getActions(): Promise<{ actions: string[]; groupedActions: Record<string, string[]> }> {
    return rbacFetch('/audit/actions');
  },
  
  /**
   * Get audit statistics
   */
  async getStats(): Promise<{
    stats: {
      totalEvents: number;
      last24Hours: number;
      byAction: Record<string, number>;
      byStatus: Record<string, number>;
      byHour: Record<string, number>;
    };
  }> {
    return rbacFetch('/audit/stats');
  },
  
  /**
   * Export audit logs as CSV (returns download URL)
   */
  getExportUrl(options?: {
    userId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }): string {
    const params = new URLSearchParams();
    if (options?.userId) params.set('userId', options.userId);
    if (options?.action) params.set('action', options.action);
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    
    const accessToken = getRbacAccessToken();
    return `/api/rbac/audit/export?${params}&token=${accessToken}`;
  },
};

// ============================================
// Connections API
// ============================================

export interface ClickHouseConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  database: string | null;
  isDefault: boolean;
  isActive: boolean;
  sslEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface CreateConnectionInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  database?: string;
  sslEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateConnectionInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string | null;
  sslEnabled?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TestConnectionInput {
  host: string;
  port?: number;
  username: string;
  password?: string;
  database?: string;
  sslEnabled?: boolean;
}

export interface TestConnectionResult {
  success: boolean;
  version?: string;
  databases?: string[];
  error?: string;
  latencyMs?: number;
}

export interface ConnectResult {
  sessionId: string;
  connectionId: string;
  connectionName: string;
  host: string;
  port: number;
  username: string;
  database: string | null;
  isAdmin: boolean;
  permissions: string[];
  version: string;
}

export interface SessionStatus {
  connected: boolean;
  sessionId?: string;
  username?: string;
  isAdmin?: boolean;
  permissions?: string[];
  version?: string;
}

export const rbacConnectionsApi = {
  /**
   * List all connections
   */
  async list(options?: {
    search?: string;
    activeOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ connections: ClickHouseConnection[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.activeOnly) params.set('activeOnly', 'true');
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    
    const query = params.toString();
    return rbacFetch(`/connections${query ? `?${query}` : ''}`);
  },
  
  /**
   * Get current user's accessible connections
   */
  async getMyConnections(): Promise<ClickHouseConnection[]> {
    return rbacFetch('/connections/my');
  },
  
  /**
   * Get the default connection
   */
  async getDefault(): Promise<ClickHouseConnection | null> {
    try {
      return await rbacFetch('/connections/default');
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  },
  
  /**
   * Get connection by ID
   */
  async getById(id: string): Promise<ClickHouseConnection> {
    return rbacFetch(`/connections/${id}`);
  },
  
  /**
   * Create a new connection
   */
  async create(input: CreateConnectionInput): Promise<ClickHouseConnection> {
    return rbacFetch('/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Update a connection
   */
  async update(id: string, input: UpdateConnectionInput): Promise<ClickHouseConnection> {
    return rbacFetch(`/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Delete a connection
   */
  async delete(id: string): Promise<void> {
    await rbacFetch(`/connections/${id}`, {
      method: 'DELETE',
    });
  },
  
  /**
   * Set a connection as default
   */
  async setDefault(id: string): Promise<ClickHouseConnection> {
    return rbacFetch(`/connections/${id}/default`, {
      method: 'POST',
    });
  },
  
  /**
   * Test a connection (without saving)
   */
  async test(input: TestConnectionInput): Promise<TestConnectionResult> {
    return rbacFetch('/connections/test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Test a saved connection
   */
  async testSaved(id: string): Promise<TestConnectionResult> {
    return rbacFetch(`/connections/${id}/test`, {
      method: 'POST',
    });
  },
  
  /**
   * Get users with access to a connection
   */
  async getUsers(connectionId: string): Promise<Array<{
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    isActive: boolean;
    roles: string[];
    hasDirectAccess: boolean;
    accessViaRoles: string[];
  }>> {
    return rbacFetch(`/connections/${connectionId}/users`);
  },
  
  /**
   * Grant user access to a connection
   */
  async grantAccess(connectionId: string, userId: string): Promise<void> {
    await rbacFetch(`/connections/${connectionId}/access/${userId}`, {
      method: 'POST',
    });
  },
  
  /**
   * Revoke user access to a connection
   */
  async revokeAccess(connectionId: string, userId: string): Promise<void> {
    await rbacFetch(`/connections/${connectionId}/access/${userId}`, {
      method: 'DELETE',
    });
  },
  
  /**
   * Connect to a saved connection (creates ClickHouse session)
   */
  async connect(id: string): Promise<ConnectResult> {
    return rbacFetch(`/connections/${id}/connect`, {
      method: 'POST',
    });
  },
  
  /**
   * Disconnect from ClickHouse (destroy session)
   */
  async disconnect(sessionId?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }
    await rbacFetch('/connections/disconnect', {
      method: 'POST',
      headers,
    });
  },
  
  /**
   * Get current ClickHouse session status
   */
  async getSessionStatus(sessionId?: string): Promise<SessionStatus> {
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers['X-Session-ID'] = sessionId;
    }
    return rbacFetch('/connections/session', { headers });
  },
};

// ============================================
// ClickHouse Users Types
// ============================================

export type ClickHouseUserRole = 'developer' | 'analyst' | 'viewer';

export interface ClickHouseUser {
  name: string;
  host_ip?: string;
  host_names?: string;
  default_roles_all?: number;
  default_roles_list?: string;
  default_roles_except?: string;
  auth_type?: string;
  // Grants information (populated when fetching a single user)
  role?: ClickHouseUserRole;
  allowedDatabases?: string[];
  allowedTables?: Array<{ database: string; table: string }>;
}

export interface CreateClickHouseUserInput {
  username: string;
  password?: string; // Optional when authType is 'no_password'
  role: ClickHouseUserRole;
  allowedDatabases?: string[];
  allowedTables?: Array<{ database: string; table: string }>;
  hostIp?: string;
  hostNames?: string;
  cluster?: string;
  authType?: string; // e.g., 'sha256_password', 'double_sha1_password', 'plaintext_password', 'no_password'
}

export interface UpdateClickHouseUserInput {
  password?: string;
  role?: ClickHouseUserRole;
  allowedDatabases?: string[];
  allowedTables?: Array<{ database: string; table: string }>;
  hostIp?: string;
  hostNames?: string;
  cluster?: string;
}

export interface ClickHouseUserDDL {
  createUser: string;
  grantStatements: string[];
  fullDDL: string;
}

export const rbacClickHouseUsersApi = {
  /**
   * List all ClickHouse users
   */
  async list(): Promise<ClickHouseUser[]> {
    return rbacFetch('/clickhouse-users');
  },
  
  /**
   * Get available clusters
   */
  async getClusters(): Promise<string[]> {
    return rbacFetch('/clickhouse-users/clusters');
  },
  
  /**
   * Get ClickHouse user by username
   */
  async get(username: string): Promise<ClickHouseUser> {
    return rbacFetch(`/clickhouse-users/${encodeURIComponent(username)}`);
  },
  
  /**
   * Generate DDL for creating a user (preview)
   */
  async generateDDL(input: CreateClickHouseUserInput): Promise<ClickHouseUserDDL> {
    return rbacFetch('/clickhouse-users/generate-ddl', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Create a ClickHouse user
   */
  async create(input: CreateClickHouseUserInput): Promise<{ username: string }> {
    return rbacFetch('/clickhouse-users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Generate DDL for updating a user (preview)
   */
  async generateUpdateDDL(username: string, input: UpdateClickHouseUserInput): Promise<ClickHouseUserDDL> {
    return rbacFetch(`/clickhouse-users/${encodeURIComponent(username)}/generate-ddl`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Update a ClickHouse user
   */
  async update(username: string, input: UpdateClickHouseUserInput): Promise<{ username: string }> {
    return rbacFetch(`/clickhouse-users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Delete a ClickHouse user
   */
  async delete(username: string): Promise<void> {
    await rbacFetch(`/clickhouse-users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    });
  },
  
  /**
   * Sync unregistered ClickHouse users to metadata
   */
  async sync(): Promise<{ synced: number; errors: Array<{ username: string; error: string }> }> {
    return rbacFetch('/clickhouse-users/sync', {
      method: 'POST',
    });
  },
};

// ============================================
// Data Access Types
// ============================================

export type AccessType = 'read' | 'write' | 'admin';

export interface DataAccessRule {
  id: string;
  roleId: string | null;
  userId: string | null;
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  accessType: AccessType;
  isAllowed: boolean;
  priority: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface CreateDataAccessRuleInput {
  roleId?: string | null;
  userId?: string | null;
  connectionId?: string | null;
  databasePattern: string;
  tablePattern: string;
  isAllowed?: boolean;
  priority?: number;
  description?: string;
}

export interface UpdateDataAccessRuleInput {
  connectionId?: string | null;
  databasePattern?: string;
  tablePattern?: string;
  isAllowed?: boolean;
  priority?: number;
  description?: string;
}

export interface AccessCheckResult {
  allowed: boolean;
  rule?: DataAccessRule;
  reason?: string;
}

// ============================================
// Data Access API
// ============================================

// ============================================
// User Preferences API
// ============================================

export interface UserFavorite {
  id: string;
  database: string;
  table?: string;
  createdAt: string;
}

export interface UserRecentItem {
  id: string;
  database: string;
  table?: string;
  accessedAt: string;
}

export interface UserPreferences {
  explorerSortBy?: 'name' | 'date' | 'size';
  explorerViewMode?: 'tree' | 'list' | 'compact';
  explorerShowFavoritesOnly?: boolean;
  workspacePreferences?: Record<string, unknown>;
}

export const rbacUserPreferencesApi = {
  /**
   * Get all favorites for the authenticated user
   */
  async getFavorites(): Promise<UserFavorite[]> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch('/api/rbac/user-preferences/favorites', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Failed to fetch favorites', response.status);
    }
    return data.favorites || [];
  },

  /**
   * Add a favorite for the authenticated user
   */
  async addFavorite(database: string, table?: string): Promise<UserFavorite> {
    let accessToken = getRbacAccessToken();
    if (!accessToken) {
      console.error('[UserPreferences] No access token found');
      throw new ApiError('Not authenticated', 401);
    }

    let response = await fetch('/api/rbac/user-preferences/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ database, table }),
    });

    // If 401, try to refresh token and retry
    if (response.status === 401) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        accessToken = getRbacAccessToken();
        if (accessToken) {
          response = await fetch('/api/rbac/user-preferences/favorites', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ database, table }),
          });
        }
      }
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      console.error('[UserPreferences] Failed to parse response:', e);
      const text = await response.text();
      console.error('[UserPreferences] Response text:', text);
      throw new ApiError('Invalid response from server', response.status);
    }
    
    if (!response.ok) {
      console.error('[UserPreferences] Failed to add favorite:', {
        status: response.status,
        statusText: response.statusText,
        error: data.error,
        hasToken: !!accessToken,
        tokenLength: accessToken?.length,
        tokenPreview: accessToken ? `${accessToken.substring(0, 20)}...` : null,
        responseData: data,
        headers: Object.fromEntries(response.headers.entries()),
      });
      throw new ApiError(data.error?.message || `Failed to add favorite (${response.status})`, response.status);
    }
    return data.favorite;
  },

  /**
   * Remove a favorite for the authenticated user
   */
  async removeFavorite(favoriteId: string): Promise<void> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch(`/api/rbac/user-preferences/favorites/${favoriteId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      throw new ApiError(data.error?.message || 'Failed to remove favorite', response.status);
    }
  },

  /**
   * Clear all favorites for the authenticated user
   */
  async clearFavorites(): Promise<void> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch('/api/rbac/user-preferences/favorites', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      throw new ApiError(data.error?.message || 'Failed to clear favorites', response.status);
    }
  },

  /**
   * Check if a database/table is favorited
   */
  async isFavorite(database: string, table?: string): Promise<boolean> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const params = new URLSearchParams({ database });
    if (table) params.append('table', table);
    
    const response = await fetch(`/api/rbac/user-preferences/favorites/check?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Failed to check favorite', response.status);
    }
    return data.isFavorite || false;
  },

  /**
   * Get recent items for the authenticated user
   */
  async getRecentItems(limit: number = 10): Promise<UserRecentItem[]> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch(`/api/rbac/user-preferences/recent?limit=${limit}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Failed to fetch recent items', response.status);
    }
    return data.recentItems || [];
  },

  /**
   * Add a recent item for the authenticated user
   */
  async addRecentItem(database: string, table?: string): Promise<UserRecentItem> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch('/api/rbac/user-preferences/recent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ database, table }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Failed to add recent item', response.status);
    }
    return data.recentItem;
  },

  /**
   * Clear all recent items for the authenticated user
   */
  async clearRecentItems(): Promise<void> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch('/api/rbac/user-preferences/recent', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      throw new ApiError(data.error?.message || 'Failed to clear recent items', response.status);
    }
  },

  /**
   * Get user preferences
   */
  async getPreferences(): Promise<UserPreferences> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch('/api/rbac/user-preferences/preferences', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Failed to fetch preferences', response.status);
    }
    return data.preferences || {};
  },

  /**
   * Update user preferences
   */
  async updatePreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    const accessToken = getRbacAccessToken();
    if (!accessToken) throw new ApiError('Not authenticated', 401);

    const response = await fetch('/api/rbac/user-preferences/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(preferences),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.error?.message || 'Failed to update preferences', response.status);
    }
    return data.preferences || {};
  },
};

export const rbacDataAccessApi = {
  /**
   * List all data access rules
   */
  async list(options?: {
    roleId?: string;
    userId?: string;
    connectionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rules: DataAccessRule[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.roleId) params.set('roleId', options.roleId);
    if (options?.userId) params.set('userId', options.userId);
    if (options?.connectionId) params.set('connectionId', options.connectionId);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    
    const query = params.toString();
    return rbacFetch(`/data-access${query ? `?${query}` : ''}`);
  },
  
  /**
   * Get rules for a specific role
   */
  async getRulesForRole(roleId: string, connectionId?: string): Promise<DataAccessRule[]> {
    const params = connectionId ? `?connectionId=${connectionId}` : '';
    return rbacFetch(`/data-access/role/${roleId}${params}`);
  },
  
  /**
   * Get rules for a specific user (user-level rules only)
   */
  async getRulesForUser(userId: string): Promise<DataAccessRule[]> {
    return rbacFetch(`/data-access/user/${userId}`);
  },
  
  /**
   * Get rule by ID
   */
  async getById(id: string): Promise<DataAccessRule> {
    return rbacFetch(`/data-access/${id}`);
  },
  
  /**
   * Create a new rule
   */
  async create(input: CreateDataAccessRuleInput): Promise<DataAccessRule> {
    return rbacFetch('/data-access', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Update a rule
   */
  async update(id: string, input: UpdateDataAccessRuleInput): Promise<DataAccessRule> {
    return rbacFetch(`/data-access/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  
  /**
   * Delete a rule
   */
  async delete(id: string): Promise<void> {
    await rbacFetch(`/data-access/${id}`, {
      method: 'DELETE',
    });
  },
  
  /**
   * Bulk set rules for a role (replaces existing)
   */
  async bulkSetForRole(
    roleId: string,
    rules: Omit<CreateDataAccessRuleInput, 'roleId' | 'userId'>[]
  ): Promise<DataAccessRule[]> {
    return rbacFetch('/data-access/bulk', {
      method: 'POST',
      body: JSON.stringify({ roleId, rules }),
    });
  },
  
  /**
   * Bulk set rules for a user (replaces existing user-level rules)
   */
  async bulkSetForUser(
    userId: string,
    rules: Omit<CreateDataAccessRuleInput, 'roleId' | 'userId'>[]
  ): Promise<DataAccessRule[]> {
    return rbacFetch('/data-access/bulk', {
      method: 'POST',
      body: JSON.stringify({ userId, rules }),
    });
  },
  
  /**
   * Check if current user has access to a database/table
   */
  async checkAccess(
    database: string,
    table?: string,
    accessType: AccessType = 'read',
    connectionId?: string
  ): Promise<AccessCheckResult> {
    return rbacFetch('/data-access/check', {
      method: 'POST',
      body: JSON.stringify({ database, table, accessType, connectionId }),
    });
  },
  
  /**
   * Filter databases for current user
   */
  async filterDatabases(
    databases: string[],
    connectionId?: string
  ): Promise<string[]> {
    return rbacFetch('/data-access/filter/databases', {
      method: 'POST',
      body: JSON.stringify({ databases, connectionId }),
    });
  },
  
  /**
   * Filter tables for current user
   */
  async filterTables(
    database: string,
    tables: string[],
    connectionId?: string
  ): Promise<string[]> {
    return rbacFetch('/data-access/filter/tables', {
      method: 'POST',
      body: JSON.stringify({ database, tables, connectionId }),
    });
  },
};

// ============================================
// Health Check
// ============================================

export async function checkRbacHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  database: string;
  error?: string;
}> {
  const response = await fetch('/api/rbac/health', {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  const data = await response.json();
  return data.data;
}
