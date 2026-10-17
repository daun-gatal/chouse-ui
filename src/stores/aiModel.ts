/**
 * AI Model Store
 *
 * Persists the per-user AI model shared by Data, Dashboards and AI Governance.
 * null means the user chose the system default model.
 */

import { create } from "zustand";
import { persist, type StateStorage, createJSONStorage } from "zustand/middleware";
import { useRbacStore } from "./rbac";

// ============================================
// Types
// ============================================

export interface AiModelState {
  /** Selected AI model config id; null = system default. */
  modelId: string | null;

  // Actions
  setModelId: (id: string | null) => void;
}

// ============================================
// Per-user storage key
// ============================================

export const createUserSpecificStorage = (): StateStorage => {
  const keyFor = (prefix: string): string => {
    try {
      const userId = useRbacStore.getState().user?.id;
      if (userId) return `${prefix}-${userId}`;
    } catch {
      // ignore
    }
    return prefix;
  };

  return {
    getItem: (_name: string): string | null => {
      try {
        // Earlier builds stored this choice for the Data page only; carry it
        // over the first time the shared picker loads.
        return localStorage.getItem(keyFor("ai-model-storage")) ?? localStorage.getItem(keyFor("dataops-model-storage"));
      } catch {
        return null;
      }
    },
    setItem: (_name: string, value: string): void => {
      try {
        localStorage.setItem(keyFor("ai-model-storage"), value);
        localStorage.removeItem(keyFor("dataops-model-storage"));
      } catch { /* ignore */ }
    },
    removeItem: (_name: string): void => {
      try { localStorage.removeItem(keyFor("ai-model-storage")); } catch { /* ignore */ }
    },
  };
};

// ============================================
// Store
// ============================================

export const useAiModelStore = create<AiModelState>()(
  persist(
    (set) => ({
      modelId: null,

      setModelId: (id: string | null) => set({ modelId: id }),
    }),
    {
      name: "ai-model-storage",
      storage: createJSONStorage(createUserSpecificStorage),
    }
  )
);
