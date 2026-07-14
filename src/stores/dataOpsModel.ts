/**
 * DataOps Model Store
 *
 * Persists the per-user AI model selection for the DataOps page. All AI
 * features under DataOps use this model; null means the backend picks the
 * configured system-default model.
 */

import { create } from "zustand";
import { persist, type StateStorage, createJSONStorage } from "zustand/middleware";
import { useRbacStore } from "./rbac";

// ============================================
// Types
// ============================================

export interface DataOpsModelState {
  /** Selected AI model config id for DataOps AI features; null = system default. */
  modelId: string | null;

  // Actions
  setModelId: (id: string | null) => void;
}

// ============================================
// Per-user storage key
// ============================================

const createUserSpecificStorage = (): StateStorage => {
  const getKey = (): string => {
    try {
      const userId = useRbacStore.getState().user?.id;
      if (userId) return `dataops-model-storage-${userId}`;
    } catch {
      // ignore
    }
    return "dataops-model-storage";
  };

  return {
    getItem: (_name: string): string | null => {
      try { return localStorage.getItem(getKey()); } catch { return null; }
    },
    setItem: (_name: string, value: string): void => {
      try { localStorage.setItem(getKey(), value); } catch { /* ignore */ }
    },
    removeItem: (_name: string): void => {
      try { localStorage.removeItem(getKey()); } catch { /* ignore */ }
    },
  };
};

// ============================================
// Store
// ============================================

export const useDataOpsModelStore = create<DataOpsModelState>()(
  persist(
    (set) => ({
      modelId: null,

      setModelId: (id: string | null) => set({ modelId: id }),
    }),
    {
      name: "dataops-model-storage",
      storage: createJSONStorage(createUserSpecificStorage),
    }
  )
);
