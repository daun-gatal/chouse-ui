/**
 * Session Cleanup Utility
 * 
 * Centralized cleanup function for clearing all user-related state
 * when switching users or logging out. Ensures no data leakage between users.
 */

import { clearSession, getSessionId } from '@/api/client';
import { rbacConnectionsApi } from '@/api/rbac';
import { useExplorerStore } from '@/stores/explorer';
import { useWorkspaceStore } from '@/stores/workspace';
import { useRbacStore } from '@/stores/rbac';
import { queryKeys } from '@/hooks/useQuery';
import { queryClient } from '@/providers/QueryProvider';

/**
 * Cleanup all user-related state and sessions
 * Should be called BEFORE setting new user state in RBAC store
 * 
 * @param currentUserId - The current user ID (if any) to cleanup
 */
export async function cleanupUserSession(currentUserId: string | null): Promise<void> {
  try {
    // 1. Disconnect from ClickHouse connection if there's an active session
    const sessionId = getSessionId();
    if (sessionId) {
      try {
        await rbacConnectionsApi.disconnect(sessionId);
      } catch (error) {
        // Log but don't throw - continue cleanup even if disconnect fails
        console.error('[SessionCleanup] Failed to disconnect ClickHouse session:', error);
      }
    }

    // 2. Clear ClickHouse session from client
    clearSession();

    // 3. Clear all stores (workspace tabs, explorer databases, etc.)
    // Note: Explorer and workspace stores have their own user-specific cleanup
    // via onRehydrateStorage, but we explicitly reset here for immediate effect
    const workspaceStore = useWorkspaceStore.getState();
    const explorerStore = useExplorerStore.getState();

    // Reset workspace to default (only home tab)
    workspaceStore.resetWorkspace();

    // Immediately clear explorer databases state (don't wait for fetch)
    // This prevents showing old user's data while new data is being fetched
    explorerStore.clearDatabases();

    // Invalidate TanStack Query cache to ensure fresh data is fetched for new user
    // This clears cached database queries, table details, etc.
    // Using removeQueries to immediately clear cache (invalidateQueries marks as stale but doesn't remove)
    queryClient.removeQueries({ queryKey: queryKeys.databases });
    // Remove all table details queries (using predicate to match all)
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'tableDetails'
    });
    // Remove all table sample queries
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'tableSample'
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'systemStats'
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'productionMetrics'
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'topTables'
    });
    // Remove all recent queries (using predicate to match all)
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'recentQueries'
    });
    // Remove all saved queries (savedQueries is now a function, so use predicate)
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'savedQueries'
    });
    queryClient.removeQueries({ queryKey: queryKeys.intellisense });

    // 4. Clear any user-specific localStorage keys
    if (currentUserId) {
      try {
        // Clear user-specific storage keys
        localStorage.removeItem(`explorer-storage-${currentUserId}`);
        localStorage.removeItem(`workspace-storage-${currentUserId}`);
        localStorage.removeItem('explorer-last-user-id');
        localStorage.removeItem('workspace-last-user-id');
      } catch (error) {
        console.error('[SessionCleanup] Failed to clear localStorage:', error);
      }
    }
  } catch (error) {
    // Log error but don't throw - cleanup should be best-effort
    console.error('[SessionCleanup] Error during cleanup:', error);
  }
}

/**
 * Broadcast user change to all browser tabs
 * Uses BroadcastChannel API for cross-tab communication
 */
export function broadcastUserChange(newUserId: string | null): void {
  try {
    // Check if BroadcastChannel is supported
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('user-change');
      channel.postMessage({
        type: 'USER_CHANGED',
        userId: newUserId,
        timestamp: Date.now(),
      });
      // Close channel after sending (it will be recreated if needed)
      setTimeout(() => channel.close(), 100);
    }
  } catch (error) {
    // BroadcastChannel might not be available in all environments
    console.warn('[SessionCleanup] BroadcastChannel not available:', error);
  }
}

/**
 * Listen for user changes from other tabs
 * Should be called once during app initialization
 * 
 * @param onUserChange - Callback when user change is detected
 */
export function listenForUserChanges(
  onUserChange: (userId: string | null) => void
): (() => void) | undefined {
  try {
    if (typeof BroadcastChannel === 'undefined') {
      return undefined;
    }

    const channel = new BroadcastChannel('user-change');

    const handleMessage = (event: MessageEvent<{ type: string; userId: string | null }>): void => {
      if (event.data.type === 'USER_CHANGED') {
        const { userId } = event.data;
        // Cleanup current session before switching
        const currentUserId = useRbacStore.getState().user?.id || null;
        if (currentUserId !== userId) {
          cleanupUserSession(currentUserId).catch((error) => {
            console.error('[SessionCleanup] Failed to cleanup on user change:', error);
          });
          onUserChange(userId);
        }
      }
    };

    channel.addEventListener('message', handleMessage);

    // Return cleanup function
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  } catch (error) {
    console.warn('[SessionCleanup] Failed to setup BroadcastChannel listener:', error);
    return undefined;
  }
}
