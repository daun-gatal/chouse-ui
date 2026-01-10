/**
 * Explorer Store
 * 
 * Manages database explorer state, including databases, tables, and modals.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { explorerApi, savedQueriesApi } from '@/api';
import type { DatabaseInfo, SavedQuery } from '@/api';
import { toast } from 'sonner';

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

  // Favorites & Recent
  favorites: FavoriteItem[];
  recentItems: RecentItem[];
  
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
  addFavorite: (database: string, table?: string) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (database: string, table?: string) => boolean;
  toggleFavorite: (database: string, table?: string) => void;

  // Recent items actions
  addRecentItem: (database: string, table?: string) => void;
  clearRecentItems: () => void;
  getRecentItems: (limit?: number) => RecentItem[];

  // View preferences
  setSortBy: (sortBy: SortOption) => void;
  setViewMode: (mode: ViewMode) => void;
  setShowFavoritesOnly: (show: boolean) => void;
}

// ============================================
// Store
// ============================================

// Helper function to generate item ID
const getItemId = (database: string, table?: string): string => {
  return table ? `${database}.${table}` : database;
};

export const useExplorerStore = create<ExplorerState>()(
  persist(
    (set, get) => ({
      // Initial state
      databases: [],
      isLoadingDatabases: false,
      databaseError: null,

      // Tree state - restored from persisted array or new Set
      expandedNodes: new Set<string>(),

      savedQueries: [],
      isSavedQueriesEnabled: false,
      isLoadingSavedQueries: false,

      // Favorites & Recent (persisted)
      favorites: [],
      recentItems: [],

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
  },

  expandNode: (nodeId: string) => {
    const { expandedNodes } = get();
    const newExpandedNodes = new Set(expandedNodes);
    newExpandedNodes.add(nodeId);
    set({ expandedNodes: newExpandedNodes });
  },

  collapseNode: (nodeId: string) => {
    const { expandedNodes } = get();
    const newExpandedNodes = new Set(expandedNodes);
    newExpandedNodes.delete(nodeId);
    set({ expandedNodes: newExpandedNodes });
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
  addFavorite: (database: string, table?: string) => {
    const id = getItemId(database, table);
    const { favorites } = get();
    
    // Check if already favorited
    if (favorites.some(f => f.id === id)) {
      return;
    }

    const newFavorite: FavoriteItem = {
      id,
      type: table ? 'table' : 'database',
      database,
      table,
      name: table || database,
      addedAt: Date.now(),
    };

    set({ favorites: [...favorites, newFavorite] });
    toast.success(`${table ? 'Table' : 'Database'} added to favorites`);
  },

  removeFavorite: (id: string) => {
    const { favorites } = get();
    const favorite = favorites.find(f => f.id === id);
    set({ favorites: favorites.filter(f => f.id !== id) });
    if (favorite) {
      toast.success(`${favorite.type === 'table' ? 'Table' : 'Database'} removed from favorites`);
    }
  },

  isFavorite: (database: string, table?: string) => {
    const id = getItemId(database, table);
    return get().favorites.some(f => f.id === id);
  },

  toggleFavorite: (database: string, table?: string) => {
    const { isFavorite, addFavorite, removeFavorite } = get();
    const id = getItemId(database, table);
    
    if (isFavorite(database, table)) {
      removeFavorite(id);
    } else {
      addFavorite(database, table);
    }
  },

  // Recent items actions
  addRecentItem: (database: string, table?: string) => {
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
      accessedAt: Date.now(),
    };

    // Keep only last 20 items, most recent first
    const updated = [newRecent, ...filtered].slice(0, 20);
    set({ recentItems: updated });
  },

  clearRecentItems: () => {
    set({ recentItems: [] });
    toast.success('Recent items cleared');
  },

  getRecentItems: (limit: number = 10) => {
    return get().recentItems.slice(0, limit);
  },

  // View preferences
  setSortBy: (sortBy: SortOption) => {
    set({ sortBy });
  },

  setViewMode: (mode: ViewMode) => {
    set({ viewMode: mode });
  },

  setShowFavoritesOnly: (show: boolean) => {
    set({ showFavoritesOnly: show });
  },
}),
    {
      name: 'explorer-storage',
      partialize: (state) => ({
        favorites: state.favorites,
        recentItems: state.recentItems,
        sortBy: state.sortBy,
        viewMode: state.viewMode,
        expandedNodes: Array.from(state.expandedNodes), // Convert Set to Array for persistence
      }),
      // Restore expandedNodes from persisted array
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray((state as any).expandedNodes)) {
          state.expandedNodes = new Set((state as any).expandedNodes);
        }
      },
    }
  )
);
