/**
 * Authentication Hook (DEPRECATED)
 * 
 * This hook is deprecated. Use useRbacStore directly for authentication.
 * 
 * @deprecated Use useRbacStore instead for all authentication needs.
 */

import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRbacStore } from '@/stores';

/**
 * Main authentication hook (DEPRECATED)
 * @deprecated Use useRbacStore directly
 */
export function useAuth() {
  const rbacStore = useRbacStore();
  const navigate = useNavigate();

  // Listen for unauthorized events
  useEffect(() => {
    const handleUnauthorized = () => {
      rbacStore.logout().catch((err) => {
        console.error('[useAuth] Logout error:', err);
      });
      navigate('/login');
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [rbacStore, navigate]);

  const logout = useCallback(async () => {
    await rbacStore.logout();
    navigate('/login');
  }, [rbacStore, navigate]);

  return {
    ...rbacStore,
    logout,
  };
}

/**
 * Hook to require authentication (DEPRECATED)
 * @deprecated Use useRbacStore and check isAuthenticated directly
 */
export function useRequireAuth(redirectTo: string = '/login') {
  const { isAuthenticated, isInitialized, checkAuth } = useRbacStore();
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      if (!isInitialized) {
        const hasSession = await checkAuth();
        if (!hasSession) {
          navigate(redirectTo);
        }
      } else if (!isAuthenticated) {
        navigate(redirectTo);
      }
    };

    check();
  }, [isAuthenticated, isInitialized, checkAuth, navigate, redirectTo]);

  return { isAuthenticated, isInitialized };
}

/**
 * Hook to require admin privileges (DEPRECATED)
 * @deprecated Use useRbacStore.isAdmin() or useRbacStore.isSuperAdmin() directly
 */
export function useRequireAdmin(redirectTo: string = '/') {
  const { isAuthenticated, isAdmin, isInitialized } = useRbacStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isInitialized && isAuthenticated && !isAdmin()) {
      navigate(redirectTo);
    }
  }, [isAuthenticated, isAdmin, isInitialized, navigate, redirectTo]);

  return { isAuthenticated, isAdmin: isAdmin(), isInitialized };
}

/**
 * Hook to check if user has a specific permission (DEPRECATED)
 * @deprecated Use useRbacStore.hasPermission() directly
 */
export function usePermission(permission: string) {
  const { hasPermission } = useRbacStore();
  return hasPermission(permission);
}

export default useAuth;
