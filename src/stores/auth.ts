/**
 * Connection Info Store
 * 
 * Stores ClickHouse connection information (session metadata).
 * Authentication is handled by RBAC (useRbacStore).
 * This store only tracks the active ClickHouse connection details.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearSession } from '@/api/client';

// ============================================
// Types
// ============================================

export interface ConnectionInfoState {
  // ClickHouse session info (from connection)
  sessionId: string | null;
  username: string | null;
  url: string | null;
  version: string | null;
  isAdmin: boolean; // ClickHouse admin status (not RBAC admin)
  permissions: string[]; // ClickHouse permissions (not RBAC permissions)
  
  // Active connection tracking
  activeConnectionId: string | null;
  activeConnectionName: string | null;
  
  // Actions
  setConnectionInfo: (info: {
    sessionId: string;
    username: string;
    url: string;
    version: string;
    isAdmin: boolean;
    permissions: string[];
    activeConnectionId: string;
    activeConnectionName: string;
  }) => void;
  clearConnectionInfo: () => void;
  setActiveConnection: (connectionId: string | null, connectionName?: string | null) => void;
}

// ============================================
// Store
// ============================================

export const useAuthStore = create<ConnectionInfoState>()(
  persist(
    (set) => ({
      // Initial state
      sessionId: null,
      username: null,
      url: null,
      version: null,
      isAdmin: false,
      permissions: [],
      activeConnectionId: null,
      activeConnectionName: null,

      /**
       * Set connection info (called after connecting to ClickHouse via RBAC)
       */
      setConnectionInfo: (info) => {
        set({
          sessionId: info.sessionId,
          username: info.username,
          url: info.url,
          version: info.version,
          isAdmin: info.isAdmin,
          permissions: info.permissions,
          activeConnectionId: info.activeConnectionId,
          activeConnectionName: info.activeConnectionName,
        });
      },

      /**
       * Clear connection info (called on disconnect/logout)
       */
      clearConnectionInfo: () => {
        clearSession();
        set({
          sessionId: null,
          username: null,
          url: null,
          version: null,
          isAdmin: false,
          permissions: [],
          activeConnectionId: null,
          activeConnectionName: null,
        });
      },

      /**
       * Set active connection (ID and name)
       */
      setActiveConnection: (connectionId: string | null, connectionName?: string | null) => {
        set({ 
          activeConnectionId: connectionId,
          activeConnectionName: connectionName ?? null,
        });
      },
    }),
    {
      name: 'connection-info-storage',
      // Persist connection info for display purposes
      partialize: (state) => ({
        sessionId: state.sessionId,
        username: state.username,
        url: state.url,
        version: state.version,
        isAdmin: state.isAdmin,
        activeConnectionId: state.activeConnectionId,
        activeConnectionName: state.activeConnectionName,
      }),
    }
  )
);

// ============================================
// Type alias for backward compatibility
// ============================================

export type AuthState = ConnectionInfoState;
