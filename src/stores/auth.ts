/**
 * Authentication Store
 * 
 * Manages user authentication state, session, and permissions.
 * Uses the new API client instead of direct ClickHouse connection.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi, getSessionId, clearSession } from '@/api';
import type { LoginCredentials, SessionInfo } from '@/api';

// ============================================
// Types
// ============================================

export interface AuthState {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  
  // Session info
  sessionId: string | null;
  username: string | null;
  isAdmin: boolean;
  permissions: string[];
  version: string | null;
  
  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  clearError: () => void;
}

// ============================================
// Store
// ============================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
      error: null,
      sessionId: null,
      username: null,
      isAdmin: false,
      permissions: [],
      version: null,

      /**
       * Login with credentials
       */
      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true, error: null });

        try {
          const response = await authApi.login(credentials);

          set({
            isAuthenticated: true,
            isLoading: false,
            sessionId: response.sessionId,
            username: response.username,
            isAdmin: response.isAdmin,
            permissions: response.permissions,
            version: response.version,
            error: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({
            isAuthenticated: false,
            isLoading: false,
            error: message,
            sessionId: null,
            username: null,
            isAdmin: false,
            permissions: [],
            version: null,
          });
          throw error;
        }
      },

      /**
       * Logout and clear session
       */
      logout: async () => {
        set({ isLoading: true });

        try {
          await authApi.logout();
        } catch (error) {
          // Ignore logout errors - we'll clear local state anyway
          console.error('Logout error:', error);
        } finally {
          clearSession();
          set({
            isAuthenticated: false,
            isLoading: false,
            sessionId: null,
            username: null,
            isAdmin: false,
            permissions: [],
            version: null,
            error: null,
          });
        }
      },

      /**
       * Refresh session and update permissions
       */
      refreshSession: async () => {
        try {
          const response = await authApi.refreshSession();
          set({
            isAdmin: response.isAdmin,
            permissions: response.permissions,
          });
        } catch (error) {
          // Session expired - force logout
          await get().logout();
          throw error;
        }
      },

      /**
       * Check if there's a valid session
       */
      checkSession: async () => {
        const currentSessionId = getSessionId();
        
        if (!currentSessionId) {
          set({ isInitialized: true, isAuthenticated: false });
          return false;
        }

        set({ isLoading: true });

        try {
          const session = await authApi.getSession();
          set({
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            sessionId: session.sessionId,
            username: session.username,
            isAdmin: session.isAdmin,
            permissions: session.permissions,
            version: session.version,
          });
          return true;
        } catch (error) {
          clearSession();
          set({
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            sessionId: null,
            username: null,
            isAdmin: false,
            permissions: [],
            version: null,
          });
          return false;
        }
      },

      /**
       * Clear error message
       */
      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      // Only persist session-related state, not sensitive data
      partialize: (state) => ({
        sessionId: state.sessionId,
        username: state.username,
        isAdmin: state.isAdmin,
        version: state.version,
      }),
    }
  )
);

// ============================================
// Selectors
// ============================================

export const selectIsAdmin = (state: AuthState) => state.isAdmin;
export const selectPermissions = (state: AuthState) => state.permissions;
export const selectUsername = (state: AuthState) => state.username;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;

/**
 * Check if user has a specific permission
 */
export function hasPermission(state: AuthState, permission: string): boolean {
  if (state.isAdmin) return true;
  
  const normalizedPerm = permission.toUpperCase();
  
  return state.permissions.some((p) => {
    if (p === 'ALL' || p === 'ALL DATABASES' || p === 'ALL TABLES') return true;
    if (p === normalizedPerm) return true;
    if (normalizedPerm.startsWith(p)) return true;
    return false;
  });
}

