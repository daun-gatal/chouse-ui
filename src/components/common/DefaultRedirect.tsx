import { Navigate } from "react-router-dom";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { Loader2 } from "lucide-react";

/**
 * Redirects users to the appropriate default page based on their role and permissions.
 * Checks what pages the user has access to and redirects to the first available one.
 */
export const DefaultRedirect = () => {
  const { 
    isAuthenticated, 
    isInitialized, 
    isLoading, 
    isAdmin, 
    hasPermission,
    hasAnyPermission,
  } = useRbacStore();

  // Show loading while checking authentication
  if (!isInitialized || isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check what pages user has access to, in priority order
  const canViewOverview = isAdmin();
  const canViewExplorer = hasAnyPermission([
    RBAC_PERMISSIONS.DB_VIEW,
    RBAC_PERMISSIONS.TABLE_VIEW,
  ]);
  const canViewMetrics = hasAnyPermission([
    RBAC_PERMISSIONS.METRICS_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
  ]);
  const canViewLogs = hasAnyPermission([
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW,
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
  ]);
  const canViewAdmin = hasAnyPermission([
    RBAC_PERMISSIONS.USERS_VIEW,
    RBAC_PERMISSIONS.USERS_CREATE,
    RBAC_PERMISSIONS.ROLES_VIEW,
    RBAC_PERMISSIONS.AUDIT_VIEW,
  ]);
  const canViewSettings = hasPermission(RBAC_PERMISSIONS.SETTINGS_VIEW);

  // Redirect to first available page in priority order
  if (canViewOverview) {
    return <Navigate to="/overview" replace />;
  }
  if (canViewExplorer) {
    return <Navigate to="/explorer" replace />;
  }
  if (canViewMetrics) {
    return <Navigate to="/metrics" replace />;
  }
  if (canViewLogs) {
    return <Navigate to="/logs" replace />;
  }
  if (canViewAdmin) {
    return <Navigate to="/admin" replace />;
  }
  if (canViewSettings) {
    return <Navigate to="/settings" replace />;
  }

  // If user has no access to any page, show a message
  // (This should rarely happen as most roles have at least Explorer access)
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">No Access</h1>
        <p className="text-gray-400">
          You don't have permission to access any pages. Please contact an administrator.
        </p>
      </div>
    </div>
  );
};

export default DefaultRedirect;
