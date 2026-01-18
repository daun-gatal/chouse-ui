/**
 * Tests for stores/workspace.ts
 */

import { describe, it, expect } from 'vitest';

describe('stores/workspace', () => {
    it('should export useWorkspaceStore', async () => {
        const workspaceModule = await import('./workspace');
        expect(workspaceModule.useWorkspaceStore).toBeDefined();
        expect(typeof workspaceModule.useWorkspaceStore).toBe('function');
    });

    it('should export genTabId utility', async () => {
        const workspaceModule = await import('./workspace');
        expect(workspaceModule.genTabId).toBeDefined();
        expect(typeof workspaceModule.genTabId).toBe('function');
    });

    it('genTabId should generate unique IDs', async () => {
        const { genTabId } = await import('./workspace');
        const id1 = genTabId();
        const id2 = genTabId();

        expect(id1).toMatch(/^tab-/);
        expect(id2).toMatch(/^tab-/);
        expect(id1).not.toBe(id2);
    });
});
