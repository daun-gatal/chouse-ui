/**
 * Tests for stores/index.ts exports
 * Note: We test the module structure without fully instantiating stores
 * to avoid circular dependency issues in the test environment.
 */

import { describe, it, expect } from 'vitest';

describe('stores/index exports', () => {
    it('should export store hooks and utilities', async () => {
        // Dynamic import to avoid initialization issues
        const storesModule = await import('./index');

        // Check that key exports exist
        expect(storesModule.useAuthStore).toBeDefined();
        expect(storesModule.useRbacStore).toBeDefined();
        expect(storesModule.useWorkspaceStore).toBeDefined();
        expect(storesModule.useExplorerStore).toBeDefined();
        expect(storesModule.genTabId).toBeDefined();
        expect(storesModule.RBAC_PERMISSIONS).toBeDefined();
    });

    it('should export RBAC selectors', async () => {
        const storesModule = await import('./index');

        expect(storesModule.selectRbacUser).toBeDefined();
        expect(storesModule.selectRbacRoles).toBeDefined();
        expect(storesModule.selectRbacPermissions).toBeDefined();
        expect(storesModule.selectIsRbacAuthenticated).toBeDefined();
        expect(storesModule.selectIsRbacLoading).toBeDefined();
    });
});
