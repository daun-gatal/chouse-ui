/**
 * Tests for useAuth (deprecated hook)
 */

import { describe, it, expect } from 'vitest';

describe('useAuth', () => {
    it('should export useAuth hook', () => {
        const { useAuth } = require('./useAuth');
        expect(useAuth).toBeDefined();
        expect(typeof useAuth).toBe('function');
    });

    it('should export useRequireAuth hook', () => {
        const { useRequireAuth } = require('./useAuth');
        expect(useRequireAuth).toBeDefined();
        expect(typeof useRequireAuth).toBe('function');
    });

    it('should export useRequireAdmin hook', () => {
        const { useRequireAdmin } = require('./useAuth');
        expect(useRequireAdmin).toBeDefined();
        expect(typeof useRequireAdmin).toBe('function');
    });

    it('should export usePermission hook', () => {
        const { usePermission } = require('./useAuth');
        expect(usePermission).toBeDefined();
        expect(typeof usePermission).toBe('function');
    });

    it('should export default useAuth', () => {
        const useAuthDefault = require('./useAuth').default;
        expect(useAuthDefault).toBeDefined();
        expect(typeof useAuthDefault).toBe('function');
    });
});
