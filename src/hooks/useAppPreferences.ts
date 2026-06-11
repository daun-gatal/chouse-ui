/**
 * Hook for managing app-level preferences (theme, maxResultRows) backed by the
 * server's workspacePreferences.app JSON field.
 *
 * On mount it fetches the stored value and hydrates the Zustand preferences
 * store and the theme provider.  Writes are optimistic: local state updates
 * immediately and then persists to the server in the background.
 */

import { useState, useEffect, useCallback } from "react";
import { rbacUserPreferencesApi } from "@/api/rbac";
import { useRbacStore } from "@/stores/rbac";
import { usePreferencesStore } from "@/stores/preferences";
import { useTheme } from "@/components/common/theme-provider";
import { log } from "@/lib/log";

export interface AppPreferences {
  maxResultRows?: number;
  theme?: "light" | "dark" | "system" | "auto";
}

export function useAppPreferences(): {
  updateAppPreferences: (updates: Partial<AppPreferences>) => Promise<void>;
  isLoading: boolean;
} {
  const { isAuthenticated } = useRbacStore();
  const { setMaxResultRows } = usePreferencesStore();
  const { setTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || hasFetched) {
      setIsLoading(false);
      return;
    }

    const fetchPreferences = async (): Promise<void> => {
      try {
        const userPreferences = await rbacUserPreferencesApi.getPreferences();
        const appPrefs = userPreferences.workspacePreferences?.app as AppPreferences | undefined;

        if (appPrefs) {
          if (appPrefs.maxResultRows !== undefined) {
            setMaxResultRows(appPrefs.maxResultRows);
          }
          if (appPrefs.theme) {
            setTheme(appPrefs.theme);
          }
        }
      } catch (error) {
        log.error("[useAppPreferences] Failed to fetch preferences", error);
      } finally {
        setHasFetched(true);
        setIsLoading(false);
      }
    };

    fetchPreferences().catch((error) => {
      log.error("[useAppPreferences] Error fetching preferences", error);
      setHasFetched(true);
      setIsLoading(false);
    });
  }, [isAuthenticated, hasFetched, setMaxResultRows, setTheme]);

  const updateAppPreferences = useCallback(
    async (updates: Partial<AppPreferences>): Promise<void> => {
      // Apply locally first (fast path)
      if (updates.maxResultRows !== undefined) setMaxResultRows(updates.maxResultRows);
      if (updates.theme) setTheme(updates.theme);

      if (!isAuthenticated) return;

      // Persist to server (best-effort)
      try {
        const currentPreferences = await rbacUserPreferencesApi.getPreferences();
        await rbacUserPreferencesApi.updatePreferences({
          workspacePreferences: {
            ...currentPreferences.workspacePreferences,
            app: {
              ...((currentPreferences.workspacePreferences?.app as AppPreferences) ?? {}),
              ...updates,
            },
          },
        });
      } catch (error) {
        log.error("[useAppPreferences] Failed to sync preferences to server", error);
      }
    },
    [isAuthenticated, setMaxResultRows, setTheme],
  );

  return { updateAppPreferences, isLoading };
}
