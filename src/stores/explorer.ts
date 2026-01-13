/**
 * Explorer Store
 * 
 * Manages database explorer state, including databases, tables, and modals.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { explorerApi, savedQueriesApi, rbacUserPreferencesApi } from '@/api';
import type { DatabaseInfo, SavedQuery, UserFavorite, UserRecentItem } from '@/api';
import { toast } from 'sonner';
import { useRbacStore } from './rbac';

// ============================================
// Types
// ============================================

export interface FavoriteItem {
  id: string; // Format: "database.table" or "database"
  type: 'database' | 'table';
  database: string;
  table?: string;
  name: string;
  addedAt: number;
}

export interface RecentItem {
  id: string; // Format: "database.table" or "database"
  type: 'database' | 'table';
  database: string;
  table?: string;
  name: string;
  accessedAt: number;
}

export type SortOption = 'name' | 'size' | 'rows' | 'recent';
export type ViewMode = 'tree' | 'list' | 'compact';

export interface ExplorerState {
  // Database state
  databases: DatabaseInfo[];
  isLoadingDatabases: boolean;
  databaseError: string | null;

  // Tree state
  expandedNodes: Set<string>;

  // Saved queries state
  savedQueries: SavedQuery[];
  isSavedQueriesEnabled: boolean;
  isLoadingSavedQueries: boolean;

  // Favorites & Recent (loaded from API)
  favorites: FavoriteItem[];
  recentItems: RecentItem[];
  isLoadingFavorites: boolean;
  isLoadingRecentItems: boolean;
  
  // View preferences
  sortBy: SortOption;
  viewMode: ViewMode;
  showFavoritesOnly: boolean;

  // Modal state - with both naming conventions for compatibility
  isCreateTableModalOpen: boolean;
  isCreateDatabaseModalOpen: boolean;
  isUploadFileModalOpen: boolean;
  isAlterTableModalOpen: boolean;
  createTableModalOpen: boolean;
  createDatabaseModalOpen: boolean;
  uploadFileModalOpen: boolean;
  alterTableModalOpen: boolean;
  selectedDatabaseForCreateTable: string;
  selectedDatabaseForUpload: string;
  selectedDatabase: string;
  selectedTableForAlter: string;

  // Actions
  fetchDatabases: () => Promise<void>;
  clearDatabases: () => void; // Clear databases state immediately
  fetchSavedQueries: () => Promise<SavedQuery[]>;
  checkSavedQueriesStatus: () => Promise<boolean>;

  // Tree actions
  toggleNode: (nodeId: string) => void;
  expandNode: (nodeId: string) => void;
  collapseNode: (nodeId: string) => void;

  // Modal actions
  openCreateTableModal: (database: string) => void;
  closeCreateTableModal: () => void;
  openCreateDatabaseModal: () => void;
  closeCreateDatabaseModal: () => void;
  openUploadFileModal: (database: string) => void;
  closeUploadFileModal: () => void;
  openAlterTableModal: (database: string, table: string) => void;
  closeAlterTableModal: () => void;

  // Utility
  refreshAll: () => Promise<void>;

  // Favorites actions
  fetchFavorites: () => Promise<void>;
  addFavorite: (database: string, table?: string) => Promise<void>;
  removeFavorite: (id: string) => Promise<void>;
  clearFavorites: () => Promise<void>;
  isFavorite: (database: string, table?: string) => boolean;
  toggleFavorite: (database: string, table?: string) => Promise<void>;

  // Recent items actions
  fetchRecentItems: (limit?: number) => Promise<void>;
  addRecentItem: (database: string, table?: string) => Promise<void>;
  clearRecentItems: () => Promise<void>;
  getRecentItems: (limit?: number) => RecentItem[];

  // View preferences
  setSortBy: (sortBy: SortOption) => Promise<void>;
  setViewMode: (mode: ViewMode) => Promise<void>;
  setShowFavoritesOnly: (show: boolean) => Promise<void>;

  // Preferences actions
  fetchPreferences: () => Promise<void>;
  syncExpandedNodes: () => Promise<void>;
}

// ============================================
// Store
// ============================================

// Helper function to generate item ID
const getItemId = (database: string, table?: string): string => {
  return table ? `${database}.${table}` : database;
};

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
          localStorage.setItem('explorer-last-user-id', userId);
        } catch {
          // Ignore storage errors
        }
        return `explorer-storage-${userId}`;
      }
      
      // If no current user, try to use the last known user ID
      // This preserves data across logout/login for the same user
      try {
        const lastUserId = localStorage.getItem('explorer-last-user-id');
        if (lastUserId) {
          return `explorer-storage-${lastUserId}`;
        }
      } catch {
        // Ignore storage errors
      }
      
      return 'explorer-storage';
    } catch {
      return 'explorer-storage';
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
let currentUserId: string | null = null;

// Check if user has changed and clear favorites/recent if so
const checkAndClearUserData = (set: any) => {
  try {
    const state = useRbacStore.getState();
    const userId = state.user?.id || null;
    
    // Only clear if:
    // 1. We had a previous user (currentUserId !== null)
    // 2. The user actually changed (currentUserId !== userId)
    // 3. The new user is not null (userId !== null) - meaning we're logging in as a different user, not logging out
    if (currentUserId !== null && currentUserId !== userId && userId !== null) {
      set({ favorites: [], recentItems: [] });
      // Clear the stored user ID since it's a different user
      try {
        localStorage.removeItem('explorer-last-user-id');
        localStorage.setItem('explorer-last-user-id', userId);
      } catch {
        // Ignore storage errors
      }
    }
    
    // Only update current user ID if we have a user (don't set to null on logout)
    // This preserves the storage key so data persists across logout/login for the same user
    if (userId !== null) {
      currentUserId = userId;
    }
  } catch {
    // Ignore errors
  }
};

export const useExplorerStore = create<ExplorerState>()(
  persist(
    (set, get) => {
      // Don't check user on initialization - let rehydration handle it
      
      return {
        // Initial state
        databases: [],
        isLoadingDatabases: false,
        databaseError: null,

      // Tree state - restored from persisted array or new Set
      expandedNodes: new Set<string>(),

      savedQueries: [],
      isSavedQueriesEnabled: false,
      isLoadingSavedQueries: false,

      // Favorites & Recent (loaded from API)
      favorites: [],
      recentItems: [],
      isLoadingFavorites: false,
      isLoadingRecentItems: false,

      // View preferences
      sortBy: 'name',
      viewMode: 'tree',
      showFavoritesOnly: false,

  // Modal state - dual naming for compatibility
  isCreateTableModalOpen: false,
  isCreateDatabaseModalOpen: false,
  isUploadFileModalOpen: false,
  isAlterTableModalOpen: false,
  createTableModalOpen: false,
  createDatabaseModalOpen: false,
  uploadFileModalOpen: false,
  alterTableModalOpen: false,
  selectedDatabaseForCreateTable: '',
  selectedDatabaseForUpload: '',
  selectedDatabase: '',
  selectedTableForAlter: '',

  /**
   * Fetch all databases and tables
   */
  fetchDatabases: async () => {
    // Check if user changed and clear if needed
    checkAndClearUserData(set);
    
    set({ isLoadingDatabases: true, databaseError: null });

    try {
      const databases = await explorerApi.getDatabases();
      set({ databases, isLoadingDatabases: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch databases';
      set({
        databaseError: message,
        isLoadingDatabases: false,
      });
      toast.error(message);
    }
  },

  /**
   * Clear databases state immediately
   * Used when switching users to prevent showing old user's data
   */
  clearDatabases: () => {
    set({
      databases: [],
      isLoadingDatabases: false,
      databaseError: null,
    });
  },

  /**
   * Fetch saved queries
   */
  fetchSavedQueries: async () => {
    set({ isLoadingSavedQueries: true });

    try {
      const queries = await savedQueriesApi.getSavedQueries();
      set({ savedQueries: queries, isLoadingSavedQueries: false });
      return queries;
    } catch (error) {
      console.error('Failed to fetch saved queries:', error);
      set({ savedQueries: [], isLoadingSavedQueries: false });
      return [];
    }
  },

  /**
   * Check if saved queries feature is enabled
   */
  checkSavedQueriesStatus: async () => {
    try {
      const isEnabled = await savedQueriesApi.checkSavedQueriesStatus();
      set({ isSavedQueriesEnabled: isEnabled });
      
      if (isEnabled) {
        await get().fetchSavedQueries();
      }
      
      return isEnabled;
    } catch (error) {
      console.error('Failed to check saved queries status:', error);
      set({ isSavedQueriesEnabled: false });
      return false;
    }
  },

  // Tree actions
  toggleNode: (nodeId: string) => {
    const { expandedNodes } = get();
    const newExpandedNodes = new Set(expandedNodes);
    if (newExpandedNodes.has(nodeId)) {
      newExpandedNodes.delete(nodeId);
    } else {
      newExpandedNodes.add(nodeId);
    }
    set({ expandedNodes: newExpandedNodes });
    
    // Sync to database (debounced)
    const { syncExpandedNodes } = get();
    setTimeout(() => {
      syncExpandedNodes().catch((error) => {
        console.error('[ExplorerStore] Failed to sync expandedNodes after toggle:', error);
      });
    }, 500); // Debounce by 500ms
  },

  expandNode: (nodeId: string) => {
    const { expandedNodes } = get();
    const newExpandedNodes = new Set(expandedNodes);
    newExpandedNodes.add(nodeId);
    set({ expandedNodes: newExpandedNodes });
    
    // Sync to database (debounced)
    const { syncExpandedNodes } = get();
    setTimeout(() => {
      syncExpandedNodes().catch((error) => {
        console.error('[ExplorerStore] Failed to sync expandedNodes after expand:', error);
      });
    }, 500); // Debounce by 500ms
  },

  collapseNode: (nodeId: string) => {
    const { expandedNodes } = get();
    const newExpandedNodes = new Set(expandedNodes);
    newExpandedNodes.delete(nodeId);
    set({ expandedNodes: newExpandedNodes });
    
    // Sync to database (debounced)
    const { syncExpandedNodes } = get();
    setTimeout(() => {
      syncExpandedNodes().catch((error) => {
        console.error('[ExplorerStore] Failed to sync expandedNodes after collapse:', error);
      });
    }, 500); // Debounce by 500ms
  },

  // Modal actions
  openCreateTableModal: (database: string) => {
    set({
      isCreateTableModalOpen: true,
      createTableModalOpen: true,
      selectedDatabaseForCreateTable: database,
      selectedDatabase: database,
    });
  },

  closeCreateTableModal: () => {
    set({
      isCreateTableModalOpen: false,
      createTableModalOpen: false,
      selectedDatabaseForCreateTable: '',
    });
  },

  openCreateDatabaseModal: () => {
    set({ 
      isCreateDatabaseModalOpen: true,
      createDatabaseModalOpen: true,
    });
  },

  closeCreateDatabaseModal: () => {
    set({ 
      isCreateDatabaseModalOpen: false,
      createDatabaseModalOpen: false,
    });
  },

  openUploadFileModal: (database: string) => {
    set({
      isUploadFileModalOpen: true,
      uploadFileModalOpen: true,
      selectedDatabaseForUpload: database,
      selectedDatabase: database,
    });
  },

  closeUploadFileModal: () => {
    set({
      isUploadFileModalOpen: false,
      uploadFileModalOpen: false,
      selectedDatabaseForUpload: '',
    });
  },

  openAlterTableModal: (database: string, table: string) => {
    set({
      isAlterTableModalOpen: true,
      alterTableModalOpen: true,
      selectedDatabase: database,
      selectedTableForAlter: table,
    });
  },

  closeAlterTableModal: () => {
    set({
      isAlterTableModalOpen: false,
      alterTableModalOpen: false,
      selectedTableForAlter: '',
    });
  },

  /**
   * Refresh all explorer data
   */
  refreshAll: async () => {
    await Promise.all([
      get().fetchDatabases(),
      get().isSavedQueriesEnabled ? get().fetchSavedQueries() : Promise.resolve(),
    ]);
  },

  // Favorites actions
  fetchFavorites: async () => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      return;
    }

    set({ isLoadingFavorites: true });
    try {
      const apiFavorites = await rbacUserPreferencesApi.getFavorites();
      
      // Convert API format to store format
      const favorites: FavoriteItem[] = apiFavorites.map((fav) => ({
        id: getItemId(fav.database, fav.table),
        type: fav.table ? 'table' : 'database',
        database: fav.database,
        table: fav.table,
        name: fav.table || fav.database,
        addedAt: new Date(fav.createdAt).getTime(),
      }));

      set({ favorites, isLoadingFavorites: false });
    } catch (error) {
      console.error('Failed to fetch favorites:', error);
      set({ isLoadingFavorites: false });
      // Don't show error toast - favorites are optional
    }
  },

  addFavorite: async (database: string, table?: string) => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      console.error('[ExplorerStore] User not authenticated:', rbacState);
      toast.error('Please log in to add favorites');
      return;
    }
    
    console.log('[ExplorerStore] Adding favorite:', { database, table, userId: rbacState.user?.id });

    const id = getItemId(database, table);
    const { favorites } = get();
    
    // Check if already favorited locally
    if (favorites.some(f => f.id === id)) {
      return;
    }

    try {
      // Add to API
      const apiFavorite = await rbacUserPreferencesApi.addFavorite(database, table);
      
      // Update local state
      const newFavorite: FavoriteItem = {
        id: getItemId(apiFavorite.database, apiFavorite.table),
        type: apiFavorite.table ? 'table' : 'database',
        database: apiFavorite.database,
        table: apiFavorite.table,
        name: apiFavorite.table || apiFavorite.database,
        addedAt: new Date(apiFavorite.createdAt).getTime(),
      };

      set({ favorites: [...favorites, newFavorite] });
      toast.success(`${table ? 'Table' : 'Database'} added to favorites`);
    } catch (error) {
      console.error('Failed to add favorite:', error);
      toast.error('Failed to add favorite');
    }
  },

  removeFavorite: async (id: string) => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      toast.error('Please log in to remove favorites');
      return;
    }

    const { favorites } = get();
    const favorite = favorites.find(f => f.id === id);
    
    if (!favorite) {
      return;
    }

    try {
      // Find the API favorite ID
      const apiFavorites = await rbacUserPreferencesApi.getFavorites();
      const apiFavorite = apiFavorites.find(
        (f) => f.database === favorite.database && f.table === favorite.table
      );

      if (apiFavorite) {
        await rbacUserPreferencesApi.removeFavorite(apiFavorite.id);
      }

      // Update local state
      set({ favorites: favorites.filter(f => f.id !== id) });
      toast.success(`${favorite.type === 'table' ? 'Table' : 'Database'} removed from favorites`);
    } catch (error) {
      console.error('Failed to remove favorite:', error);
      toast.error('Failed to remove favorite');
    }
  },

  isFavorite: (database: string, table?: string) => {
    checkAndClearUserData(set);
    const id = getItemId(database, table);
    return get().favorites.some(f => f.id === id);
  },

  toggleFavorite: async (database: string, table?: string) => {
    const { isFavorite, addFavorite, removeFavorite } = get();
    const id = getItemId(database, table);
    
    if (isFavorite(database, table)) {
      await removeFavorite(id);
    } else {
      await addFavorite(database, table);
    }
  },

  clearFavorites: async () => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      toast.error('Please log in to clear favorites');
      return;
    }

    try {
      await rbacUserPreferencesApi.clearFavorites();
      set({ favorites: [] });
      toast.success('Favorites cleared');
    } catch (error) {
      console.error('Failed to clear favorites:', error);
      toast.error('Failed to clear favorites');
    }
  },

  // Recent items actions
  fetchRecentItems: async (limit: number = 20) => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      return;
    }

    set({ isLoadingRecentItems: true });
    try {
      const apiRecentItems = await rbacUserPreferencesApi.getRecentItems(limit);
      
      // Convert API format to store format
      const recentItems: RecentItem[] = apiRecentItems.map((item) => ({
        id: getItemId(item.database, item.table),
        type: item.table ? 'table' : 'database',
        database: item.database,
        table: item.table,
        name: item.table || item.database,
        accessedAt: new Date(item.accessedAt).getTime(),
      }));

      set({ recentItems, isLoadingRecentItems: false });
    } catch (error) {
      console.error('Failed to fetch recent items:', error);
      set({ isLoadingRecentItems: false });
      // Don't show error toast - recent items are optional
    }
  },

  addRecentItem: async (database: string, table?: string) => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      // Silently fail if not authenticated - recent items are optional
      return;
    }

    // Check if user changed and clear if needed
    checkAndClearUserData(set);
    
    try {
      // Add to API (this will update or create the item)
      const apiRecentItem = await rbacUserPreferencesApi.addRecentItem(database, table);
      
      // Update local state
      const id = getItemId(database, table);
      const { recentItems } = get();
      
      // Remove existing if present
      const filtered = recentItems.filter(item => item.id !== id);
      
      const newRecent: RecentItem = {
        id,
        type: table ? 'table' : 'database',
        database,
        table,
        name: table || database,
        accessedAt: new Date(apiRecentItem.accessedAt).getTime(),
      };

      // Keep only last 20 items, most recent first
      const updated = [newRecent, ...filtered].slice(0, 20);
      set({ recentItems: updated });
    } catch (error) {
      console.error('Failed to add recent item:', error);
      // Silently fail - recent items are optional
    }
  },

  clearRecentItems: async () => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      toast.error('Please log in to clear recent items');
      return;
    }

    try {
      await rbacUserPreferencesApi.clearRecentItems();
      set({ recentItems: [] });
      toast.success('Recent items cleared');
    } catch (error) {
      console.error('Failed to clear recent items:', error);
      toast.error('Failed to clear recent items');
    }
  },

  getRecentItems: (limit: number = 10) => {
    checkAndClearUserData(set);
    return get().recentItems.slice(0, limit);
  },

  // View preferences
  setSortBy: async (sortBy: SortOption) => {
    set({ sortBy });
    // Sync to database
    const rbacState = useRbacStore.getState();
    if (rbacState.isAuthenticated) {
      try {
        // Map store sort options to API sort options
        // Store supports: 'name' | 'size' | 'rows' | 'recent'
        // API supports: 'name' | 'date' | 'size'
        const apiSortBy = sortBy === 'recent' ? 'date' : sortBy === 'rows' ? 'size' : sortBy;
        if (apiSortBy === 'name' || apiSortBy === 'size' || apiSortBy === 'date') {
          await rbacUserPreferencesApi.updatePreferences({
            explorerSortBy: apiSortBy,
          });
        }
      } catch (error) {
        console.error('[ExplorerStore] Failed to sync sortBy preference:', error);
      }
    }
  },

  setViewMode: async (mode: ViewMode) => {
    set({ viewMode: mode });
    // Sync to database
    const rbacState = useRbacStore.getState();
    if (rbacState.isAuthenticated) {
      try {
        await rbacUserPreferencesApi.updatePreferences({
          explorerViewMode: mode,
        });
      } catch (error) {
        console.error('[ExplorerStore] Failed to sync viewMode preference:', error);
      }
    }
  },

  setShowFavoritesOnly: async (show: boolean) => {
    set({ showFavoritesOnly: show });
    // Sync to database
    const rbacState = useRbacStore.getState();
    if (rbacState.isAuthenticated) {
      try {
        await rbacUserPreferencesApi.updatePreferences({
          explorerShowFavoritesOnly: show,
        });
      } catch (error) {
        console.error('[ExplorerStore] Failed to sync showFavoritesOnly preference:', error);
      }
    }
  },

  // Fetch user preferences from database
  fetchPreferences: async () => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      return;
    }

    try {
      const preferences = await rbacUserPreferencesApi.getPreferences();
      
      // Update explorer preferences
      const updates: Partial<ExplorerState> = {};
      
      if (preferences.explorerSortBy) {
        // Map API sort options to store sort options
        // API supports: 'name' | 'date' | 'size'
        // Store supports: 'name' | 'size' | 'rows' | 'recent'
        const apiSortBy = preferences.explorerSortBy;
        if (apiSortBy === 'name' || apiSortBy === 'size' || apiSortBy === 'date') {
          // Map 'date' to 'recent' for compatibility
          updates.sortBy = (apiSortBy === 'date' ? 'recent' : apiSortBy) as SortOption;
        }
      }
      
      if (preferences.explorerViewMode) {
        updates.viewMode = preferences.explorerViewMode as ViewMode;
      }
      
      if (preferences.explorerShowFavoritesOnly !== undefined) {
        updates.showFavoritesOnly = preferences.explorerShowFavoritesOnly;
      }
      
      // Restore expanded nodes from workspacePreferences
      if (preferences.workspacePreferences?.expandedNodes && Array.isArray(preferences.workspacePreferences.expandedNodes)) {
        updates.expandedNodes = new Set(preferences.workspacePreferences.expandedNodes as string[]);
      }
      
      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (error) {
      console.error('[ExplorerStore] Failed to fetch preferences:', error);
    }
  },

  // Update expanded nodes in database
  syncExpandedNodes: async () => {
    const rbacState = useRbacStore.getState();
    if (!rbacState.isAuthenticated) {
      return;
    }

    const { expandedNodes } = get();
    try {
      // Get current preferences and merge expandedNodes
      const currentPreferences = await rbacUserPreferencesApi.getPreferences();
      await rbacUserPreferencesApi.updatePreferences({
        workspacePreferences: {
          ...currentPreferences.workspacePreferences,
          expandedNodes: Array.from(expandedNodes),
        },
      });
    } catch (error) {
      console.error('[ExplorerStore] Failed to sync expandedNodes:', error);
    }
  },
      };
    },
    {
      name: 'explorer-storage',
      storage: createUserSpecificStorage(),
      partialize: (state) => ({
        // Don't persist favorites, recentItems, or preferences - they come from API
        // Only persist temporary UI state if needed (currently nothing)
        // All preferences (sortBy, viewMode, showFavoritesOnly, expandedNodes) are now in database
      }),
      // Fetch preferences from database after rehydration
      onRehydrateStorage: () => (state) => {
        // Check user after rehydration to clear data if user changed
        if (state) {
          try {
            const rbacState = useRbacStore.getState();
            const userId = rbacState.user?.id || null;
            
            // Only clear if we had a previous user and it's different from current
            if (currentUserId !== null && currentUserId !== userId && userId !== null) {
              state.favorites = [];
              state.recentItems = [];
              state.databases = []; // Clear databases when user changes
              // Clear the stored user ID since it's a different user
              try {
                localStorage.removeItem('explorer-last-user-id');
                localStorage.setItem('explorer-last-user-id', userId);
              } catch {
                // Ignore storage errors
              }
              
              // Fetch new user's favorites and recent items from API
              if (userId) {
                // Use setTimeout to avoid calling async functions during rehydration
                setTimeout(() => {
                  const store = useExplorerStore.getState();
                  store.fetchFavorites().catch(console.error);
                  store.fetchRecentItems().catch(console.error);
                }, 100);
              }
            }
            
            // Update current user ID
            if (userId !== null) {
              currentUserId = userId;
              
              // Fetch favorites, recent items, and preferences for the current user
              setTimeout(() => {
                const store = useExplorerStore.getState();
                const rbacState = useRbacStore.getState();
                if (rbacState.isAuthenticated) {
                  store.fetchFavorites().catch(console.error);
                  store.fetchRecentItems().catch(console.error);
                  store.fetchPreferences().catch(console.error);
                }
              }, 100);
            }
          } catch {
            // Ignore errors
          }
        }
      },
    }
  )
);
