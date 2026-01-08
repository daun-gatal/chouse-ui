/**
 * React Query Provider
 * 
 * Configures and provides the TanStack Query client to the application.
 */

import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ============================================
// Query Client Configuration
// ============================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry failed requests up to 3 times
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Consider data stale after 30 seconds by default
      staleTime: 30000,

      // Keep unused data in cache for 5 minutes
      gcTime: 300000,

      // Refetch on window focus
      refetchOnWindowFocus: true,

      // Don't refetch on mount if data is fresh
      refetchOnMount: true,
    },
    mutations: {
      // Retry mutations once
      retry: 1,
    },
  },
});

// ============================================
// Provider Component
// ============================================

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// Export query client for manual operations
export { queryClient };
export default QueryProvider;

