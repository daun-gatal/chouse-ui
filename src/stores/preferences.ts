/**
 * Preferences Store
 *
 * Persists per-user workspace preferences (theme is handled separately by
 * the theme-provider; this store covers query-execution settings).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useRbacStore } from "./rbac";

// ============================================
// Constants
// ============================================

/** Minimum rows the user can configure — prevents accidentally clearing the cap. */
export const RESULT_ROWS_MIN = 100;

/** Upper bound exposed in the UI input — keeps the browser from receiving
 *  runaway result sets even if the user sets the max very high. */
export const RESULT_ROWS_MAX = 10_000;

/** Sensible out-of-the-box default. */
export const RESULT_ROWS_DEFAULT = 10_000;

// Note: RESULT_ROWS_UNLIMITED (0) is intentionally NOT exported.
// The SQL editor always enforces a cap; unlimited is only used internally
// by service-layer code that owns its own LIMIT bounds.

// ============================================
// Types
// ============================================

export interface PreferencesState {
  /**
   * Maximum rows returned per user-initiated SQL editor query.
   * Always a positive integer in [RESULT_ROWS_MIN, RESULT_ROWS_MAX].
   */
  maxResultRows: number;

  // Actions
  setMaxResultRows: (value: number) => void;
  resetPreferences: () => void;
}

// ============================================
// Per-user storage key
// ============================================

const createUserSpecificStorage = (): any => {
  const getKey = (): string => {
    try {
      const userId = useRbacStore.getState().user?.id;
      if (userId) return `preferences-storage-${userId}`;
    } catch {
      // ignore
    }
    return "preferences-storage";
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

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      maxResultRows: RESULT_ROWS_DEFAULT,

      setMaxResultRows: (value: number) => {
        // Always clamp to the valid user range — 0 / negative / out-of-range
        // values are not permitted from the UI path.
        const clamped = Math.min(RESULT_ROWS_MAX, Math.max(RESULT_ROWS_MIN, Math.round(value)));
        set({ maxResultRows: clamped });
      },

      resetPreferences: () => {
        set({ maxResultRows: RESULT_ROWS_DEFAULT });
      },
    }),
    {
      name: "preferences-storage",
      storage: createUserSpecificStorage(),
    }
  )
);
