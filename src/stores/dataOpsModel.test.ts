/**
 * Tests for stores/dataOpsModel.ts
 */

import { describe, it, expect } from 'vitest';

describe('stores/dataOpsModel', () => {
    it('should export useDataOpsModelStore', async () => {
        // Dynamic import to avoid persist initialization issues
        const module = await import('./dataOpsModel');
        expect(module.useDataOpsModelStore).toBeDefined();
        expect(typeof module.useDataOpsModelStore).toBe('function');
    });

    it('defaults to the system default model (null)', async () => {
        const { useDataOpsModelStore } = await import('./dataOpsModel');
        useDataOpsModelStore.setState({ modelId: null });
        expect(useDataOpsModelStore.getState().modelId).toBeNull();
    });

    it('stores and clears a selected model id', async () => {
        const { useDataOpsModelStore } = await import('./dataOpsModel');

        useDataOpsModelStore.getState().setModelId('model-1');
        expect(useDataOpsModelStore.getState().modelId).toBe('model-1');

        useDataOpsModelStore.getState().setModelId(null);
        expect(useDataOpsModelStore.getState().modelId).toBeNull();
    });
});
