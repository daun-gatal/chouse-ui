/**
 * Explorer Store
 * 
 * Manages database explorer state, including databases, tables, and modals.
 */

import { create } from 'zustand';
import { explorerApi, savedQueriesApi } from '@/api';
import type { DatabaseInfo, SavedQuery } from '@/api';
import { toast } from 'sonner';

// ============================================
// Types
// ============================================

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

  // Modal state - with both naming conventions for compatibility
  isCreateTableModalOpen: boolean;
  isCreateDatabaseModalOpen: boolean;
  isUploadFileModalOpen: boolean;
  createTableModalOpen: boolean;
  createDatabaseModalOpen: boolean;
  uploadFileModalOpen: boolean;
  selectedDatabaseForCreateTable: string;
  selectedDatabaseForUpload: string;
  selectedDatabase: string;

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

  // Utility
  refreshAll: () => Promise<void>;
}

// ============================================
// Store
// ============================================

export const useExplorerStore = create<ExplorerState>()((set, get) => ({
  // Initial state
  databases: [],
  isLoadingDatabases: false,
  databaseError: null,

  // Tree state
  expandedNodes: new Set<string>(),

  savedQueries: [],
  isSavedQueriesEnabled: false,
  isLoadingSavedQueries: false,

  // Modal state - dual naming for compatibility
  isCreateTableModalOpen: false,
  isCreateDatabaseModalOpen: false,
  isUploadFileModalOpen: false,
  createTableModalOpen: false,
  createDatabaseModalOpen: false,
  uploadFileModalOpen: false,
  selectedDatabaseForCreateTable: '',
  selectedDatabaseForUpload: '',
  selectedDatabase: '',

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

  /**
   * Refresh all explorer data
   */
  refreshAll: async () => {
    await Promise.all([
      get().fetchDatabases(),
      get().isSavedQueriesEnabled ? get().fetchSavedQueries() : Promise.resolve(),
    ]);
  },
}));
