import { describe, it, expect } from 'vitest';
import { useAuth, useRequireAuth, useRequireAdmin, usePermission, default as useAuthDefault } from './useAuth';

describe('useAuth', () => {
    it('should export useAuth hook', () => {
        expect(useAuth).toBeDefined();
        expect(typeof useAuth).toBe('function');
    });

    it('should export useRequireAuth hook', () => {
        expect(useRequireAuth).toBeDefined();
        expect(typeof useRequireAuth).toBe('function');
    });

    it('should export useRequireAdmin hook', () => {
        expect(useRequireAdmin).toBeDefined();
        expect(typeof useRequireAdmin).toBe('function');
    });

    it('should export usePermission hook', () => {
        expect(usePermission).toBeDefined();
        expect(typeof usePermission).toBe('function');
    });

    it('should export default useAuth', () => {
        expect(useAuthDefault).toBeDefined();
        expect(typeof useAuthDefault).toBe('function');
    });
});
