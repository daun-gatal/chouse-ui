/**
 * Hook for managing User Management page preferences
 * 
 * Provides user management page preferences from user preferences with fallback to defaults.
 */

import { useState, useEffect, useCallback } from 'react';
import { rbacUserPreferencesApi } from '@/api/rbac';
import { useRbacStore } from '@/stores/rbac';
import { log } from '@/lib/log';

export interface UserManagementPreferences {
  defaultPageSize?: number;
  defaultSearchQuery?: string;
  defaultRoleFilter?: string;
  defaultStatusFilter?: string;
}

const DEFAULT_USER_MGMT_PREFERENCES: Required<UserManagementPreferences> = {
  defaultPageSize: 10,
  defaultSearchQuery: '',
  defaultRoleFilter: 'all',
  defaultStatusFilter: 'all',
};

/**
 * Hook to get and update user management page preferences
 */
export function useUserManagementPreferences(): {
  preferences: UserManagementPreferences;
  updatePreferences: (updates: Partial<UserManagementPreferences>) => Promise<void>;
  isLoading: boolean;
} {
  const { isAuthenticated } = useRbacStore();
  const [preferences, setPreferences] = useState<UserManagementPreferences>(DEFAULT_USER_MGMT_PREFERENCES);
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
        const userMgmtPrefs = userPreferences.workspacePreferences?.userManagement as 
          | UserManagementPreferences
          | undefined;
        
        if (userMgmtPrefs) {
          setPreferences({
            ...DEFAULT_USER_MGMT_PREFERENCES,
            ...userMgmtPrefs,
          });
        }
        setHasFetched(true);
        setIsLoading(false);
      } catch (error) {
        log.error('[useUserManagementPreferences] Failed to fetch preferences', error);
        setHasFetched(true);
        setIsLoading(false);
      }
    };

    fetchPreferences().catch((error) => {
      log.error('[useUserManagementPreferences] Error fetching preferences', error);
      setHasFetched(true);
      setIsLoading(false);
    });
  }, [isAuthenticated, hasFetched]);

  // Update preferences
  const updatePreferences = useCallback(async (updates: Partial<UserManagementPreferences>): Promise<void> => {
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
            userManagement: {
              ...((currentPreferences.workspacePreferences?.userManagement as UserManagementPreferences) || {}),
              ...updates,
            },
          },
        });
      } catch (error) {
        log.error('[useUserManagementPreferences] Failed to sync preferences', error);
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
