/**
 * Tests for utils/sessionCleanup.ts
 */

import { describe, it, expect } from 'vitest';

describe('utils/sessionCleanup', () => {
    it('should export cleanupUserSession', async () => {
        const module = await import('./sessionCleanup');
        expect(module.cleanupUserSession).toBeDefined();
        expect(typeof module.cleanupUserSession).toBe('function');
    });

    it('should export broadcastUserChange', async () => {
        const module = await import('./sessionCleanup');
        expect(module.broadcastUserChange).toBeDefined();
        expect(typeof module.broadcastUserChange).toBe('function');
    });

    it('should export listenForUserChanges', async () => {
        const module = await import('./sessionCleanup');
        expect(module.listenForUserChanges).toBeDefined();
        expect(typeof module.listenForUserChanges).toBe('function');
    });
});
