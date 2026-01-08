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
  updateSavedQuery: (tabId: string, query: string) => Promise<void>;
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
        if (tabId) {
          set({
            tabs: get().tabs.map((tab) =>
              tab.id === tabId ? { ...tab, isLoading: true, error: null } : tab
            ),
          });
        }

        try {
          const result = await queryApi.executeQuery(query);

          if (tabId) {
            get().updateTab(tabId, {
              result,
              isLoading: false,
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
            error: errorMessage,
          };

          if (tabId) {
            get().updateTab(tabId, {
              result: errorResult,
              isLoading: false,
              error: errorMessage,
            });
          }

          return errorResult;
        } finally {
          if (tabId) {
            set({
              tabs: get().tabs.map((tab) =>
                tab.id === tabId ? { ...tab, isLoading: false } : tab
              ),
            });
          }
        }
      },

      /**
       * Save a query
       */
      saveQuery: async (tabId: string, name: string, query: string, isPublic = false) => {
        try {
          await savedQueriesApi.saveQuery({ id: tabId, name, query, isPublic });
          get().updateTab(tabId, { title: name, isSaved: true });
          toast.success(`Query "${name}" saved successfully!`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to save query';
          toast.error(message);
          throw error;
        }
      },

      /**
       * Update a saved query
       */
      updateSavedQuery: async (tabId: string, query: string) => {
        const tab = get().getTabById(tabId);
        if (!tab || !tab.title) {
          throw new Error('Tab not found or has no title');
        }

        try {
          await savedQueriesApi.updateSavedQuery(tabId, { name: tab.title, query });
          get().updateTab(tabId, { content: query });
          toast.success(`Query "${tab.title}" updated successfully!`);
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
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          ...t,
          result: undefined,
          isLoading: false,
          error: null,
        })),
        activeTab: state.activeTab,
      }),
    }
  )
);

