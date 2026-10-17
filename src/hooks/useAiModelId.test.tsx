import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAiModelStore } from '@/stores';
import { useAiModelId } from './useAiModelId';

describe('useAiModelId', () => {
    beforeEach(() => {
        useAiModelStore.setState({ modelId: null });
    });

    it('returns undefined when the user chose the system default', () => {
        const { result } = renderHook(() => useAiModelId());
        expect(result.current).toBeUndefined();
    });

    it('returns the picked model immediately, without waiting for the model list', () => {
        useAiModelStore.setState({ modelId: 'model-1' });
        const { result } = renderHook(() => useAiModelId());
        expect(result.current).toBe('model-1');
    });

    it('still sends a model that is no longer active, so the server reports it', () => {
        useAiModelStore.setState({ modelId: 'ghost-model' });
        const { result } = renderHook(() => useAiModelId());
        expect(result.current).toBe('ghost-model');
    });
});
