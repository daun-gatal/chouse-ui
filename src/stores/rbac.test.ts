/**
 * Tests for stores/rbac.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sessionCleanup so dynamic imports inside actions don't pull in heavy deps
vi.mock('@/utils/sessionCleanup', () => ({
  cleanupUserSession: vi.fn().mockResolvedValue(undefined),
  broadcastUserChange: vi.fn(),
}));

// Mock the rbac API module so ssoApi.completeCallback can be controlled per-test
vi.mock('@/api/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/rbac')>();
  return {
    ...actual,
    ssoApi: {
      ...actual.ssoApi,
      completeCallback: vi.fn(),
    },
  };
});

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

  describe('completeSsoLogin', () => {
    beforeEach(() => {
      // Reset the store state between tests
      vi.resetModules();
    });

    it('completeSsoLogin sets authenticated state from callback response', async () => {
      const { ssoApi } = await import('@/api/rbac');

      // Arrange: success response
      vi.mocked(ssoApi.completeCallback).mockResolvedValueOnce({
        user: {
          id: 'u1',
          email: 'user@example.com',
          username: 'user1',
          displayName: null,
          avatarUrl: null,
          isActive: true,
          roles: ['viewer'],
          permissions: ['query:execute'],
          lastLoginAt: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
        tokens: {
          accessToken: 'sso-access-token',
          refreshToken: 'sso-refresh-token',
          expiresIn: 900,
          tokenType: 'Bearer' as const,
        },
        redirect: '/fleet',
      });

      const { useRbacStore } = await import('./rbac');

      // Reset store to unauthenticated state
      useRbacStore.setState({
        isAuthenticated: false,
        isLoading: false,
        error: null,
        user: null,
        roles: [],
        permissions: [],
      });

      const redirect = await useRbacStore.getState().completeSsoLogin('okta', 'code1', 'state1');

      expect(redirect).toBe('/fleet');
      const s = useRbacStore.getState();
      expect(s.isAuthenticated).toBe(true);
      expect(s.user?.id).toBe('u1');
      expect(s.roles).toEqual(['viewer']);
      expect(s.permissions).toEqual(['query:execute']);
      expect(s.error).toBeNull();
      expect(s.isLoading).toBe(false);
    });

    it('completeSsoLogin sets error state on failure', async () => {
      const { ssoApi } = await import('@/api/rbac');

      // Arrange: failure
      vi.mocked(ssoApi.completeCallback).mockRejectedValueOnce(
        new Error('SSO sign-in failed')
      );

      const { useRbacStore } = await import('./rbac');

      // Reset store to unauthenticated state
      useRbacStore.setState({
        isAuthenticated: false,
        isLoading: false,
        error: null,
        user: null,
        roles: [],
        permissions: [],
      });

      await expect(
        useRbacStore.getState().completeSsoLogin('okta', 'bad', 's')
      ).rejects.toThrow();

      expect(useRbacStore.getState().isAuthenticated).toBe(false);
      expect(useRbacStore.getState().error).toBeTruthy();
      expect(useRbacStore.getState().isLoading).toBe(false);
    });
  });
});
