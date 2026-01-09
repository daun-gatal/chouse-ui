/**
 * RBAC Store
 * 
 * Manages RBAC authentication state, user info, roles, and permissions.
 * This is separate from the ClickHouse connection auth store.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  rbacAuthApi,
  setRbacTokens,
  clearRbacTokens,
  getRbacAccessToken,
  type RbacUser,
  type RbacTokens,
} from '@/api/rbac';

// ============================================
// Types
// ============================================

export interface RbacState {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  
  // User info
  user: RbacUser | null;
  roles: string[];
  permissions: string[];
  
  // Actions
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshUser: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
  
  // Permission helpers
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
}

// ============================================
// Store
// ============================================

export const useRbacStore = create<RbacState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
      error: null,
      user: null,
      roles: [],
      permissions: [],

      /**
       * Login with identifier (email or username) and password
       */
      login: async (identifier: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const response = await rbacAuthApi.login(identifier, password);

          set({
            isAuthenticated: true,
            isLoading: false,
            user: response.user,
            roles: response.user.roles,
            permissions: response.user.permissions,
            error: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({
            isAuthenticated: false,
            isLoading: false,
            error: message,
            user: null,
            roles: [],
            permissions: [],
          });
          throw error;
        }
      },

      /**
       * Logout current session
       */
      logout: async () => {
        set({ isLoading: true });

        try {
          await rbacAuthApi.logout();
        } catch (error) {
          console.error('Logout error:', error);
        } finally {
          clearRbacTokens();
          set({
            isAuthenticated: false,
            isLoading: false,
            user: null,
            roles: [],
            permissions: [],
            error: null,
          });
        }
      },

      /**
       * Logout from all sessions
       */
      logoutAll: async () => {
        set({ isLoading: true });

        try {
          await rbacAuthApi.logoutAll();
        } catch (error) {
          console.error('Logout all error:', error);
        } finally {
          clearRbacTokens();
          set({
            isAuthenticated: false,
            isLoading: false,
            user: null,
            roles: [],
            permissions: [],
            error: null,
          });
        }
      },

      /**
       * Refresh user info from server
       */
      refreshUser: async () => {
        try {
          const user = await rbacAuthApi.getCurrentUser();
          set({
            user,
            roles: user.roles,
            permissions: user.permissions,
          });
        } catch (error) {
          // If refresh fails, user might be logged out
          await get().logout();
          throw error;
        }
      },

      /**
       * Check if there's a valid auth session
       */
      checkAuth: async () => {
        const accessToken = getRbacAccessToken();
        
        if (!accessToken) {
          set({ isInitialized: true, isAuthenticated: false });
          return false;
        }

        set({ isLoading: true });

        try {
          const user = await rbacAuthApi.getCurrentUser();
          set({
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            user,
            roles: user.roles,
            permissions: user.permissions,
          });
          return true;
        } catch (error) {
          clearRbacTokens();
          set({
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            user: null,
            roles: [],
            permissions: [],
          });
          return false;
        }
      },

      /**
       * Clear error message
       */
      clearError: () => set({ error: null }),

      // ============================================
      // Permission Helpers
      // ============================================

      /**
       * Check if user has a specific permission
       */
      hasPermission: (permission: string) => {
        const { permissions, roles } = get();
        // Super admin has all permissions
        if (roles.includes('super_admin')) return true;
        return permissions.includes(permission);
      },

      /**
       * Check if user has any of the specified permissions
       */
      hasAnyPermission: (perms: string[]) => {
        const { permissions, roles } = get();
        if (roles.includes('super_admin')) return true;
        return perms.some(p => permissions.includes(p));
      },

      /**
       * Check if user has all of the specified permissions
       */
      hasAllPermissions: (perms: string[]) => {
        const { permissions, roles } = get();
        if (roles.includes('super_admin')) return true;
        return perms.every(p => permissions.includes(p));
      },

      /**
       * Check if user has a specific role
       */
      hasRole: (role: string) => {
        return get().roles.includes(role);
      },

      /**
       * Check if user has any of the specified roles
       */
      hasAnyRole: (roleList: string[]) => {
        const { roles } = get();
        return roleList.some(r => roles.includes(r));
      },

      /**
       * Check if user is super admin
       */
      isSuperAdmin: () => {
        return get().roles.includes('super_admin');
      },

      /**
       * Check if user is admin (including super admin)
       */
      isAdmin: () => {
        const { roles } = get();
        return roles.includes('super_admin') || roles.includes('admin');
      },
    }),
    {
      name: 'rbac-storage',
      // Only persist minimal state
      partialize: (state) => ({
        user: state.user,
        roles: state.roles,
        permissions: state.permissions,
      }),
    }
  )
);

// ============================================
// Selectors
// ============================================

export const selectRbacUser = (state: RbacState) => state.user;
export const selectRbacRoles = (state: RbacState) => state.roles;
export const selectRbacPermissions = (state: RbacState) => state.permissions;
export const selectIsRbacAuthenticated = (state: RbacState) => state.isAuthenticated;
export const selectIsRbacLoading = (state: RbacState) => state.isLoading;

// ============================================
// Permission Constants (for frontend use)
// ============================================

export const RBAC_PERMISSIONS = {
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
  
  // Query Operations
  QUERY_EXECUTE: 'query:execute',
  QUERY_EXECUTE_DDL: 'query:execute:ddl',
  QUERY_EXECUTE_DML: 'query:execute:dml',
  QUERY_HISTORY_VIEW: 'query:history:view',
  QUERY_HISTORY_VIEW_ALL: 'query:history:view:all',
  
  // Saved Queries
  SAVED_QUERIES_VIEW: 'saved_queries:view',
  SAVED_QUERIES_CREATE: 'saved_queries:create',
  SAVED_QUERIES_UPDATE: 'saved_queries:update',
  SAVED_QUERIES_DELETE: 'saved_queries:delete',
  SAVED_QUERIES_SHARE: 'saved_queries:share',
  
  // Metrics
  METRICS_VIEW: 'metrics:view',
  METRICS_VIEW_ADVANCED: 'metrics:view:advanced',
  
  // Settings
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_UPDATE: 'settings:update',
  
  // Audit
  AUDIT_VIEW: 'audit:view',
  AUDIT_EXPORT: 'audit:export',
} as const;

export type RbacPermission = typeof RBAC_PERMISSIONS[keyof typeof RBAC_PERMISSIONS];
