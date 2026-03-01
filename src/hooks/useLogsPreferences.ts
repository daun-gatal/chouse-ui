/**
 * Hook for managing Logs page preferences
 * 
 * Provides logs page preferences from user preferences with fallback to defaults.
 */

import { useState, useEffect, useCallback } from 'react';
import { rbacUserPreferencesApi } from '@/api/rbac';
import { useRbacStore } from '@/stores/rbac';
import { log } from '@/lib/log';

export interface LogsPagePreferences {
  defaultLimit?: number;
  defaultViewMode?: 'grid' | 'table';
  defaultLogType?: string;
  autoRefresh?: boolean;
  defaultSelectedUserId?: string;
  defaultSelectedRoleId?: string;
  defaultSearchQuery?: string;
}

const DEFAULT_LOGS_PREFERENCES: Required<LogsPagePreferences> = {
  defaultLimit: 100,
  defaultViewMode: 'grid',
  defaultLogType: 'all',
  autoRefresh: false,
  defaultSelectedUserId: 'all',
  defaultSelectedRoleId: 'all',
  defaultSearchQuery: '',
};

/**
 * Hook to get and update logs page preferences
 */
export function useLogsPreferences(): {
  preferences: LogsPagePreferences;
  updatePreferences: (updates: Partial<LogsPagePreferences>) => Promise<void>;
  isLoading: boolean;
} {
  const { isAuthenticated } = useRbacStore();
  const [preferences, setPreferences] = useState<LogsPagePreferences>(DEFAULT_LOGS_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  // Fetch preferences from database when authenticated
  useEffect(() => {
    if (!isAuthenticated || hasFetched) {
      setIsLoading(false);
      return;
    }

    const fetchPreferences = async (): Promise<void> => {
      try {
        const userPreferences = await rbacUserPreferencesApi.getPreferences();
        const logsPagePrefs = userPreferences.workspacePreferences?.logsPage as 
          | LogsPagePreferences
          | undefined;
        
        if (logsPagePrefs) {
          setPreferences({
            ...DEFAULT_LOGS_PREFERENCES,
            ...logsPagePrefs,
          });
        }
        setHasFetched(true);
        setIsLoading(false);
      } catch (error) {
        log.error('[useLogsPreferences] Failed to fetch preferences', error);
        setHasFetched(true);
        setIsLoading(false);
      }
    };

    fetchPreferences().catch((error) => {
      log.error('[useLogsPreferences] Error fetching preferences', error);
      setHasFetched(true);
      setIsLoading(false);
    });
  }, [isAuthenticated, hasFetched]);

  // Update preferences
  const updatePreferences = useCallback(async (updates: Partial<LogsPagePreferences>): Promise<void> => {
    // Update local state immediately
    setPreferences((prev) => ({
      ...prev,
      ...updates,
    }));

    // Sync to database if authenticated
    if (isAuthenticated) {
      try {
        const currentPreferences = await rbacUserPreferencesApi.getPreferences();
        await rbacUserPreferencesApi.updatePreferences({
          workspacePreferences: {
            ...currentPreferences.workspacePreferences,
            logsPage: {
              ...((currentPreferences.workspacePreferences?.logsPage as LogsPagePreferences) || {}),
              ...updates,
            },
          },
        });
      } catch (error) {
        log.error('[useLogsPreferences] Failed to sync preferences', error);
        // Continue anyway - state is already set locally
      }
    }
  }, [isAuthenticated]);

  return {
    preferences,
    updatePreferences,
    isLoading,
  };
}
