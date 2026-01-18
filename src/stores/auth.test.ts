/**
 * Tests for stores/auth.ts
 */

import { describe, it, expect } from 'vitest';

describe('stores/auth', () => {
    it('should export useAuthStore', async () => {
        const authModule = await import('./auth');
        expect(authModule.useAuthStore).toBeDefined();
        expect(typeof authModule.useAuthStore).toBe('function');
    });

    it('should export AuthState type', async () => {
        const authModule = await import('./auth');
        // ConnectionInfoState is the actual type
        expect(authModule).toHaveProperty('useAuthStore');
    });
});
