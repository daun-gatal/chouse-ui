/**
 * Workspace Store
 * 
 * Manages tabs, query execution, and workspace state.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryApi, savedQueriesApi } from '@/api';
import type { QueryResult } from '@/api';
import { toast } from 'sonner';
import { useRbacStore } from './rbac';
import { useAuthStore } from './auth';
import { queryClient } from '@/providers/QueryProvider';
import { queryKeys } from '@/hooks/useQuery';

// ============================================
// Types
// ============================================

export interface Tab {
  id: string;
  title: string;
  type: 'sql' | 'home' | 'information';
  content: string | { database?: string; table?: string };
  error?: string | null;
  isLoading?: boolean;
  queryId?: string | null;
  isSaved?: boolean;
  result?: QueryResult | null;
  isDirty?: boolean;
}

export interface WorkspaceState {
  // State
  tabs: Tab[];
  activeTab: string;
  isTabLoading: boolean;
  tabError: string | null;

  // Tab actions
  addTab: (tab: Tab) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  getTabById: (tabId: string) => Tab | undefined;
  moveTab: (oldIndex: number, newIndex: number) => void;
  duplicateTab: (tabId: string) => void;
  closeAllTabs: () => void;
  updateTabTitle: (tabId: string, title: string) => void;

  // Query actions
  runQuery: (query: string, tabId?: string) => Promise<QueryResult>;

  // Saved queries actions
  saveQuery: (tabId: string, name: string, query: string, isPublic?: boolean) => Promise<void>;
  updateSavedQuery: (tabId: string, query: string, name?: string) => Promise<void>;
  deleteSavedQuery: (id: string) => Promise<void>;

  // Utility
  resetWorkspace: () => void;
}

// ============================================
// Helpers
// ============================================

export function genTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const defaultTabs: Tab[] = [
  {
    id: 'home',
    title: 'Home',
    content: '',
    type: 'home',
  },
];

// Custom storage adapter that includes user ID in the key
const createUserSpecificStorage = (): any => {
  const getStorageKey = (): string => {
    try {
      const state = useRbacStore.getState();
      const userId = state.user?.id;

      // If we have a current user, use it and store it for later
      if (userId) {
        // Store the user ID so we can use it even after logout
        try {
          localStorage.setItem('workspace-last-user-id', userId);
        } catch {
          // Ignore storage errors
        }
        return `workspace-storage-${userId}`;
      }

      // If no current user, try to use the last known user ID
      // This preserves data across logout/login for the same user
      try {
        const lastUserId = localStorage.getItem('workspace-last-user-id');
        if (lastUserId) {
          return `workspace-storage-${lastUserId}`;
        }
      } catch {
        // Ignore storage errors
      }

      return 'workspace-storage';
    } catch {
      return 'workspace-storage';
    }
  };

  return {
    getItem: (name: string): string | null => {
      const key = getStorageKey();
      try {
        const value = localStorage.getItem(key);
        return value;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string): void => {
      const key = getStorageKey();
      try {
        localStorage.setItem(key, value);
      } catch {
        // Ignore storage errors
      }
    },
    removeItem: (name: string): void => {
      const key = getStorageKey();
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore storage errors
      }
    },
  };
};

// Track current user ID to detect user changes
let workspaceCurrentUserId: string | null = null;

// Check if user has changed and clear tabs if so
const checkAndClearWorkspaceData = (set: any) => {
  try {
    const state = useRbacStore.getState();
    const userId = state.user?.id || null;

    // Only clear if:
    // 1. We had a previous user (workspaceCurrentUserId !== null)
    // 2. The user actually changed (workspaceCurrentUserId !== userId)
    // 3. The new user is not null (userId !== null) - meaning we're logging in as a different user, not logging out
    if (workspaceCurrentUserId !== null && workspaceCurrentUserId !== userId && userId !== null) {
      // Clear tabs except home when user changes
      set({ tabs: defaultTabs, activeTab: 'home' });
      // Clear the stored user ID since it's a different user
      try {
        localStorage.removeItem('workspace-last-user-id');
        localStorage.setItem('workspace-last-user-id', userId);
      } catch {
        // Ignore storage errors
      }
    }

    // Only update current user ID if we have a user (don't set to null on logout)
    // This preserves the storage key so data persists across logout/login for the same user
    if (userId !== null) {
      workspaceCurrentUserId = userId;
    }
  } catch {
    // Ignore errors
  }
};

// ============================================
// Store
// ============================================

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      // Initial state
      tabs: defaultTabs,
      activeTab: 'home',
      isTabLoading: false,
      tabError: null,

      /**
       * Add a new tab
       */
      addTab: (tab: Tab) => {
        // Check if user changed and clear if needed
        checkAndClearWorkspaceData(set);

        const { tabs } = get();
        const existingTab = tabs.find((t) => t.id === tab.id);

        if (existingTab) {
          set({ activeTab: existingTab.id });
          return;
        }

        set({
          tabs: [...tabs, tab],
          activeTab: tab.id,
        });
      },

      /**
       * Update a tab
       */
      updateTab: (tabId: string, updates: Partial<Tab>) => {
        set({
          tabs: get().tabs.map((tab) =>
            tab.id === tabId ? { ...tab, ...updates } : tab
          ),
        });
      },

      /**
       * Remove a tab
       */
      removeTab: (tabId: string) => {
        const { tabs, activeTab } = get();
        const updatedTabs = tabs.filter((tab) => tab.id !== tabId);

        set({ tabs: updatedTabs });

        if (activeTab === tabId) {
          set({
            activeTab: updatedTabs[updatedTabs.length - 1]?.id || 'home',
          });
        }
      },

      /**
       * Set active tab
       */
      setActiveTab: (tabId: string) => {
        set({ activeTab: tabId });
      },

      /**
       * Get tab by ID
       */
      getTabById: (tabId: string) => {
        return get().tabs.find((tab) => tab.id === tabId);
      },

      /**
       * Move tab position
       */
      moveTab: (oldIndex: number, newIndex: number) => {
        const tabs = [...get().tabs];
        const [removed] = tabs.splice(oldIndex, 1);
        tabs.splice(newIndex, 0, removed);
        set({ tabs });
      },

      /**
       * Duplicate a tab
       */
      duplicateTab: (tabId: string) => {
        const { tabs } = get();
        const tabToDuplicate = tabs.find((tab) => tab.id === tabId);

        if (!tabToDuplicate) return;

        const newTab: Tab = {
          ...tabToDuplicate,
          id: genTabId(),
          title: `${tabToDuplicate.title} (Copy)`,
          isSaved: false,
        };

        set({
          tabs: [...tabs, newTab],
          activeTab: newTab.id,
        });
      },

      /**
       * Close all tabs except home
       */
      closeAllTabs: () => {
        set({
          tabs: defaultTabs,
          activeTab: 'home',
        });
      },

      /**
       * Update tab title
       */
      updateTabTitle: (tabId: string, title: string) => {
        set({
          tabs: get().tabs.map((tab) =>
            tab.id === tabId ? { ...tab, title } : tab
          ),
        });
        toast.success(`Tab title updated to "${title}"`);
      },

      /**
       * Run a SQL query
       */
      runQuery: async (query: string, tabId?: string) => {
        const executionQueryId = `query_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        if (tabId) {
          set({
            tabs: get().tabs.map((tab) =>
              tab.id === tabId ? { ...tab, isLoading: true, queryId: executionQueryId, error: null } : tab
            ),
          });
        }

        try {
          const result = await queryApi.executeQuery(query, "JSON", executionQueryId);

          if (tabId) {
            get().updateTab(tabId, {
              result,
              isLoading: false,
              queryId: null,
              error: null,
            });
          }

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Query failed';
          const errorResult: QueryResult = {
            meta: [],
            data: [],
            statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
            rows: 0,
            queryId: executionQueryId,
            error: errorMessage,
          };

          if (tabId) {
            get().updateTab(tabId, {
              result: errorResult,
              isLoading: false,
              queryId: null,
              error: errorMessage,
            });
          }

          return errorResult;
        } finally {
          if (tabId) {
            set({
              tabs: get().tabs.map((tab) =>
                tab.id === tabId ? { ...tab, isLoading: false, queryId: null } : tab
              ),
            });
          }
        }
      },

      /**
       * Save a query (creates a new saved query)
       * Updates the tab with the new saved query's ID
       */
      saveQuery: async (tabId: string, name: string, query: string, isPublic = false) => {
        const authState = useAuthStore.getState();
        const connectionId = authState.activeConnectionId;
        const connectionName = authState.activeConnectionName;

        try {
          const savedQuery = await savedQueriesApi.saveQuery({
            connectionId: connectionId ?? undefined,
            connectionName: connectionName ?? undefined,
            name,
            query,
            isPublic
          });

          // Update the tab: change its ID to match the saved query's ID
          // This ensures future "Save" operations update the correct query
          const { tabs, activeTab } = get();
          const newTabs = tabs.map(tab =>
            tab.id === tabId
              ? { ...tab, id: savedQuery.id, title: name, isSaved: true, content: query }
              : tab
          );

          // Update active tab if it was the one being saved
          const newActiveTab = activeTab === tabId ? savedQuery.id : activeTab;

          set({ tabs: newTabs, activeTab: newActiveTab });

          // Invalidate the saved queries cache to refresh the list
          if (connectionId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(connectionId) });
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries() });
          queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesConnectionNames });

          toast.success(`Query "${name}" saved successfully!`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to save query';
          toast.error(message);
          throw error;
        }
      },

      /**
       * Update a saved query
       * @param tabId - The tab/query ID
       * @param query - The query content
       * @param name - Optional new name for the query
       */
      updateSavedQuery: async (tabId: string, query: string, name?: string) => {
        const connectionId = useAuthStore.getState().activeConnectionId;
        const tab = get().getTabById(tabId);
        if (!tab) {
          throw new Error('Tab not found');
        }

        const queryName = name?.trim() || tab.title;

        try {
          await savedQueriesApi.updateSavedQuery(tabId, { name: queryName, query });
          get().updateTab(tabId, { content: query, title: queryName });

          // Invalidate the saved queries cache to refresh the list
          if (connectionId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries(connectionId) });
          }
          queryClient.invalidateQueries({ queryKey: queryKeys.savedQueries() });
          queryClient.invalidateQueries({ queryKey: queryKeys.savedQueriesConnectionNames });

          toast.success(`Query "${queryName}" updated successfully!`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to update query';
          toast.error(message);
          throw error;
        }
      },

      /**
       * Delete a saved query
       */
      deleteSavedQuery: async (id: string) => {
        try {
          await savedQueriesApi.deleteSavedQuery(id);
          get().removeTab(id);
          toast.success('Query deleted successfully!');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete query';
          toast.error(message);
          throw error;
        }
      },

      /**
       * Reset workspace to default state
       */
      resetWorkspace: () => {
        set({
          tabs: defaultTabs,
          activeTab: 'home',
          isTabLoading: false,
          tabError: null,
        });
      },
    }),
    {
      name: 'workspace-storage',
      storage: createUserSpecificStorage(),
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          ...t,
          result: undefined,
          isLoading: false,
          error: null,
        })),
        activeTab: state.activeTab,
      }),
      // Restore tabs and check if user changed
      onRehydrateStorage: () => (state) => {
        if (state) {
          try {
            const rbacState = useRbacStore.getState();
            const userId = rbacState.user?.id || null;

            // Only clear if we had a previous user and it's different from current
            if (workspaceCurrentUserId !== null && workspaceCurrentUserId !== userId && userId !== null) {
              // Clear tabs except home when user changes
              state.tabs = defaultTabs;
              state.activeTab = 'home';
              // Clear the stored user ID since it's a different user
              try {
                localStorage.removeItem('workspace-last-user-id');
                localStorage.setItem('workspace-last-user-id', userId);
              } catch {
                // Ignore storage errors
              }
            }

            // Update current user ID
            if (userId !== null) {
              workspaceCurrentUserId = userId;
            }
          } catch {
            // Ignore errors
          }
        }
      },
    }
  )
);

