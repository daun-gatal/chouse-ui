/**
 * RBAC Protected Route
 * 
 * A route wrapper that requires RBAC authentication and optionally specific permissions.
 */

import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, Shield } from 'lucide-react';

import { useRbacStore } from '@/stores/rbac';
import type { RbacPermission } from '@/stores/rbac';

// ============================================
// Types
// ============================================

interface RbacProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Required permission(s). If array, user must have at least one.
   */
  requiredPermission?: RbacPermission | RbacPermission[];
  /**
   * Required role(s). If array, user must have at least one.
   */
  requiredRole?: string | string[];
  /**
   * If true, requires ALL permissions instead of ANY.
   */
  requireAllPermissions?: boolean;
  /**
   * Custom fallback component when access is denied.
   */
  fallback?: React.ReactNode;
  /**
   * Redirect path when not authenticated.
   */
  loginPath?: string;
}

// ============================================
// Access Denied Component
// ============================================

const AccessDenied: React.FC<{ message?: string }> = ({ message }) => (
  <div className="min-h-screen flex items-center justify-center bg-gray-900">
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/30 mb-4">
        <Shield className="w-8 h-8 text-red-400" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
      <p className="text-gray-400 max-w-md">
        {message || "You don't have permission to access this page."}
      </p>
    </div>
  </div>
);

// ============================================
// Loading Component
// ============================================

const LoadingAuth: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-900">
    <div className="text-center">
      <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-4" />
      <p className="text-gray-400">Checking authentication...</p>
    </div>
  </div>
);

// ============================================
// Component
// ============================================

export const RbacProtectedRoute: React.FC<RbacProtectedRouteProps> = ({
  children,
  requiredPermission,
  requiredRole,
  requireAllPermissions = false,
  fallback,
  loginPath = '/rbac/login',
}) => {
  const location = useLocation();
  const {
    isAuthenticated,
    isInitialized,
    isLoading,
    checkAuth,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
  } = useRbacStore();

  // Check auth on mount
  useEffect(() => {
    if (!isInitialized) {
      checkAuth();
    }
  }, [isInitialized, checkAuth]);

  // Still loading
  if (!isInitialized || isLoading) {
    return <LoadingAuth />;
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    const redirectUrl = `${loginPath}?redirect=${encodeURIComponent(location.pathname)}`;
    return <Navigate to={redirectUrl} replace />;
  }

  // Check permissions
  if (requiredPermission) {
    const permissions = Array.isArray(requiredPermission)
      ? requiredPermission
      : [requiredPermission];

    const hasAccess = requireAllPermissions
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);

    if (!hasAccess) {
      return fallback ? <>{fallback}</> : <AccessDenied />;
    }
  }

  // Check roles
  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    const hasAccess = hasAnyRole(roles);

    if (!hasAccess) {
      return fallback ? <>{fallback}</> : <AccessDenied />;
    }
  }

  // All checks passed
  return <>{children}</>;
};

export default RbacProtectedRoute;
