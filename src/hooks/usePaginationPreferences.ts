/**
 * Hook for managing table pagination preferences
 * 
 * Provides pagination sizes from user preferences with fallback to defaults.
 * Follows `.rules/CODE_CHANGES.md` guidelines.
 */

import { useState, useEffect, useCallback } from 'react';
import { rbacUserPreferencesApi } from '@/api/rbac';
import { useRbacStore } from '@/stores/rbac';

export interface TablePaginationPreferences {
  queryResults?: number;
  dataSample?: number;
  logs?: number;
  userManagement?: number;
}

const DEFAULT_PAGINATION_SIZES: Required<TablePaginationPreferences> = {
  queryResults: 100,
  dataSample: 25,
  logs: 100,
  userManagement: 10,
};

/**
 * Hook to get and update pagination size for a specific table context
 * 
 * @param context - The table context ('queryResults', 'dataSample', 'logs', 'userManagement')
 * @returns Object with pagination size and update function
 */
export function usePaginationPreference(
  context: keyof TablePaginationPreferences
): {
  pageSize: number;
  setPageSize: (size: number) => Promise<void>;
  isLoading: boolean;
} {
  const { isAuthenticated } = useRbacStore();
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGINATION_SIZES[context]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  // Fetch pagination preference from database when authenticated
  useEffect(() => {
    if (!isAuthenticated || hasFetched) {
      setIsLoading(false);
      return;
    }

    const fetchPaginationPreference = async (): Promise<void> => {
      try {
        const preferences = await rbacUserPreferencesApi.getPreferences();
        const tablePagination = preferences.workspacePreferences?.tablePagination as 
          | TablePaginationPreferences
          | undefined;
        
        if (tablePagination && typeof tablePagination[context] === 'number' && tablePagination[context]! > 0) {
          setPageSizeState(tablePagination[context]!);
        }
        setHasFetched(true);
        setIsLoading(false);
      } catch (error) {
        console.error(`[usePaginationPreference] Failed to fetch pagination preference for ${context}:`, error);
        setHasFetched(true);
        setIsLoading(false);
      }
    };

    fetchPaginationPreference().catch((error) => {
      console.error(`[usePaginationPreference] Error fetching pagination preference:`, error);
      setHasFetched(true);
      setIsLoading(false);
    });
  }, [isAuthenticated, hasFetched, context]);

  // Update pagination size
  const setPageSize = useCallback(async (size: number): Promise<void> => {
    // Validate size
    if (size <= 0 || !Number.isInteger(size)) {
      console.error(`[usePaginationPreference] Invalid page size: ${size}`);
      return;
    }

    // Update local state immediately
    setPageSizeState(size);

    // Sync to database if authenticated
    if (isAuthenticated) {
      try {
        const currentPreferences = await rbacUserPreferencesApi.getPreferences();
        await rbacUserPreferencesApi.updatePreferences({
          workspacePreferences: {
            ...currentPreferences.workspacePreferences,
            tablePagination: {
              ...((currentPreferences.workspacePreferences?.tablePagination as TablePaginationPreferences) || {}),
              [context]: size,
            },
          },
        });
      } catch (error) {
        console.error(`[usePaginationPreference] Failed to sync pagination preference for ${context}:`, error);
        // Continue anyway - state is already set locally
      }
    }
  }, [isAuthenticated, context]);

  return {
    pageSize,
    setPageSize,
    isLoading,
  };
}

/**
 * Get default pagination size for a context (without hook overhead)
 * Useful for components that don't need reactive updates
 */
export function getDefaultPaginationSize(context: keyof TablePaginationPreferences): number {
  return DEFAULT_PAGINATION_SIZES[context];
}
