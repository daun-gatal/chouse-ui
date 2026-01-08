/**
 * Authentication Hook
 * 
 * Provides authentication utilities and state.
 */

import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, hasPermission } from '@/stores';

/**
 * Main authentication hook
 */
export function useAuth() {
  const store = useAuthStore();
  const navigate = useNavigate();

  // Listen for unauthorized events
  useEffect(() => {
    const handleUnauthorized = () => {
      store.logout();
      navigate('/login');
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [store, navigate]);

  const logout = useCallback(async () => {
    await store.logout();
    navigate('/login');
  }, [store, navigate]);

  return {
    ...store,
    logout,
    hasPermission: (permission: string) => hasPermission(store, permission),
  };
}

/**
 * Hook to require authentication
 * Redirects to login if not authenticated
 */
export function useRequireAuth(redirectTo: string = '/login') {
  const { isAuthenticated, isInitialized, checkSession } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      if (!isInitialized) {
        const hasSession = await checkSession();
        if (!hasSession) {
          navigate(redirectTo);
        }
      } else if (!isAuthenticated) {
        navigate(redirectTo);
      }
    };

    check();
  }, [isAuthenticated, isInitialized, checkSession, navigate, redirectTo]);

  return { isAuthenticated, isInitialized };
}

/**
 * Hook to require admin privileges
 */
export function useRequireAdmin(redirectTo: string = '/') {
  const { isAuthenticated, isAdmin, isInitialized } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isInitialized && isAuthenticated && !isAdmin) {
      navigate(redirectTo);
    }
  }, [isAuthenticated, isAdmin, isInitialized, navigate, redirectTo]);

  return { isAuthenticated, isAdmin, isInitialized };
}

/**
 * Hook to check if user has a specific permission
 */
export function usePermission(permission: string) {
  const store = useAuthStore();
  return hasPermission(store, permission);
}

export default useAuth;

