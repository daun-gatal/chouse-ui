import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAiModelSelection } from './AiModelSelect';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactElement {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: ReactNode }): ReactElement {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

describe('useAiModelSelection', () => {
    it('loads the shared model list and selects the configured default', async () => {
        const { result } = renderHook(() => useAiModelSelection(true), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.models).toHaveLength(2);
        expect(result.current.selectedModelId).toBe('model-1');
    });

    it('does not fetch models while its AI window is closed', () => {
        const { result } = renderHook(() => useAiModelSelection(false), { wrapper: createWrapper() });

        expect(result.current.models).toEqual([]);
        expect(result.current.selectedModelId).toBe('');
        expect(result.current.isLoading).toBe(false);
    });
});
