/**
 * Tests for stores/rbac.ts
 */

import { describe, it, expect } from 'vitest';

describe('stores/rbac', () => {
    it('should export useRbacStore', async () => {
        const rbacModule = await import('./rbac');
        expect(rbacModule.useRbacStore).toBeDefined();
        expect(typeof rbacModule.useRbacStore).toBe('function');
    });

    it('should export RBAC_PERMISSIONS constants', async () => {
        const rbacModule = await import('./rbac');
        expect(rbacModule.RBAC_PERMISSIONS).toBeDefined();
        expect(typeof rbacModule.RBAC_PERMISSIONS).toBe('object');
    });

    it('should export selectors', async () => {
        const rbacModule = await import('./rbac');
        expect(typeof rbacModule.selectRbacUser).toBe('function');
        expect(typeof rbacModule.selectRbacRoles).toBe('function');
        expect(typeof rbacModule.selectRbacPermissions).toBe('function');
        expect(typeof rbacModule.selectIsRbacAuthenticated).toBe('function');
        expect(typeof rbacModule.selectIsRbacLoading).toBe('function');
    });
});
