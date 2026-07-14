import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDataOpsModelStore } from '@/stores';
import { useDataOpsModelId } from './useDataOpsModelId';

function createWrapper(queryClient: QueryClient): ({ children }: { children: ReactNode }) => ReactElement {
    return function Wrapper({ children }: { children: ReactNode }): ReactElement {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

function createClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('useDataOpsModelId', () => {
    beforeEach(() => {
        useDataOpsModelStore.setState({ modelId: null });
    });

    it('returns undefined (backend default) when nothing is selected', () => {
        const queryClient = createClient();
        const { result } = renderHook(() => useDataOpsModelId(), { wrapper: createWrapper(queryClient) });

        expect(result.current).toBeUndefined();
        // No selection → the models query is never enabled/fetched.
        expect(queryClient.getQueryState(['ai-models'])?.fetchStatus ?? 'idle').toBe('idle');
    });

    it('returns the selected id once it is confirmed in the active list', async () => {
        useDataOpsModelStore.setState({ modelId: 'model-1' });
        const queryClient = createClient();

        const { result } = renderHook(() => useDataOpsModelId(), { wrapper: createWrapper(queryClient) });

        // While the active-model list is loading, fall back to the default.
        expect(result.current).toBeUndefined();
        await waitFor(() => expect(result.current).toBe('model-1'));
    });

    it('falls back to undefined when the persisted id is no longer active', async () => {
        useDataOpsModelStore.setState({ modelId: 'ghost-model' });
        const queryClient = createClient();

        const { result } = renderHook(() => useDataOpsModelId(), { wrapper: createWrapper(queryClient) });

        await waitFor(() => expect(queryClient.getQueryState(['ai-models'])?.status).toBe('success'));
        expect(result.current).toBeUndefined();
        // The stored selection is left intact — only the effective id falls back.
        expect(useDataOpsModelStore.getState().modelId).toBe('ghost-model');
    });
});
