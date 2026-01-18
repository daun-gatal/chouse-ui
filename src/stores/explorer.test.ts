/**
 * Tests for stores/explorer.ts
 */

import { describe, it, expect } from 'vitest';

describe('stores/explorer', () => {
    it('should export useExplorerStore', async () => {
        const explorerModule = await import('./explorer');
        expect(explorerModule.useExplorerStore).toBeDefined();
        expect(typeof explorerModule.useExplorerStore).toBe('function');
    });
});
