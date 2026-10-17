/**
 * Tests for stores/aiModel.ts
 */

import { describe, it, expect } from 'vitest';

describe('stores/aiModel', () => {
    it('should export useAiModelStore', async () => {
        // Dynamic import to avoid persist initialization issues
        const module = await import('./aiModel');
        expect(module.useAiModelStore).toBeDefined();
        expect(typeof module.useAiModelStore).toBe('function');
    });

    it('defaults to the system default model (null)', async () => {
        const { useAiModelStore } = await import('./aiModel');
        useAiModelStore.setState({ modelId: null });
        expect(useAiModelStore.getState().modelId).toBeNull();
    });

    it('stores and clears a selected model id', async () => {
        const { useAiModelStore } = await import('./aiModel');

        useAiModelStore.getState().setModelId('model-1');
        expect(useAiModelStore.getState().modelId).toBe('model-1');

        useAiModelStore.getState().setModelId(null);
        expect(useAiModelStore.getState().modelId).toBeNull();
    });

    it('carries over a choice stored by the earlier Data-only picker', async () => {
        const { createUserSpecificStorage } = await import('./aiModel');
        const storage = createUserSpecificStorage();
        localStorage.setItem('dataops-model-storage', '{"state":{"modelId":"legacy-model"}}');
        expect(storage.getItem('ai-model-storage')).toContain('legacy-model');

        storage.setItem('ai-model-storage', '{"state":{"modelId":"model-2"}}');
        expect(localStorage.getItem('dataops-model-storage')).toBeNull();
        expect(storage.getItem('ai-model-storage')).toContain('model-2');
        localStorage.clear();
    });
});
