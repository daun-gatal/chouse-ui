/**
 * Live Queries Hooks
 * 
 * React Query hooks for managing running ClickHouse queries.
 * These hooks provide real-time data fetching with auto-refresh,
 * and mutation handling for killing queries.
 */

import {
    useQuery,
    useMutation,
    useQueryClient,
    UseQueryOptions,
} from '@tanstack/react-query';
import { liveQueriesApi, LiveQueriesResponse, KillQueryResponse } from '@/api/live-queries';
import { toast } from 'sonner';

// ============================================
// Query Keys
// ============================================

export const liveQueriesKeys = {
    all: ['liveQueries'] as const,
    list: () => [...liveQueriesKeys.all, 'list'] as const,
} as const;

// ============================================
// Hooks
// ============================================

/**
 * Hook to fetch running queries from system.processes
 * 
 * @param refetchInterval - Auto-refresh interval in milliseconds (default: 3000ms)
 * @param options - Additional React Query options
 */
export function useLiveQueries(
    refetchInterval: number = 3000,
    options?: Partial<UseQueryOptions<LiveQueriesResponse, Error>>
) {
    return useQuery({
        queryKey: liveQueriesKeys.list(),
        queryFn: liveQueriesApi.getLiveQueries,
        refetchInterval,
        refetchIntervalInBackground: false, // Don't refetch when tab is not visible
        staleTime: 1000, // Consider data stale after 1 second
        ...options,
    });
}

/**
 * Hook to kill a running query
 * 
 * Provides optimistic updates for better UX and
 * automatic cache invalidation after mutation.
 */
export function useKillQuery() {
    const queryClient = useQueryClient();

    return useMutation<KillQueryResponse, Error, string, { previousData?: LiveQueriesResponse }>({
        mutationFn: (queryId: string) => liveQueriesApi.killQuery(queryId),
        onMutate: async (queryId: string) => {
            // Cancel any outgoing refetches
            await queryClient.cancelQueries({ queryKey: liveQueriesKeys.list() });

            // Snapshot the previous value
            const previousData = queryClient.getQueryData<LiveQueriesResponse>(liveQueriesKeys.list());

            // Optimistically update by removing the killed query
            if (previousData) {
                queryClient.setQueryData<LiveQueriesResponse>(liveQueriesKeys.list(), {
                    ...previousData,
                    queries: previousData.queries.filter(q => q.query_id !== queryId),
                    total: previousData.total - 1,
                });
            }

            return { previousData };
        },
        onSuccess: (data) => {
            toast.success('Query killed successfully', {
                description: `Query ${data.queryId.slice(0, 8)}... has been terminated.`,
            });
        },
        onError: (error, _queryId, context) => {
            // Rollback on error
            if (context?.previousData) {
                queryClient.setQueryData(liveQueriesKeys.list(), context.previousData);
            }

            toast.error('Failed to kill query', {
                description: error.message || 'An unexpected error occurred.',
            });
        },
        onSettled: () => {
            // Always refetch after mutation to ensure consistency
            queryClient.invalidateQueries({ queryKey: liveQueriesKeys.list() });
        },
    });
}

/**
 * Hook to get computed stats from live queries
 */
export function useLiveQueriesStats(data: LiveQueriesResponse | undefined) {
    if (!data || !data.queries.length) {
        return {
            totalQueries: 0,
            longestRunning: 0,
            totalMemory: 0,
            totalReadRows: 0,
        };
    }

    return {
        totalQueries: data.queries.length,
        longestRunning: Math.max(...data.queries.map(q => q.elapsed_seconds)),
        totalMemory: data.queries.reduce((acc, q) => acc + q.memory_usage, 0),
        totalReadRows: data.queries.reduce((acc, q) => acc + q.read_rows, 0),
    };
}
