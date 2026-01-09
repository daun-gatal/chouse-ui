import { Navigate, useLocation } from "react-router-dom";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { Loader2 } from "lucide-react";

interface AdminRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
  /**
   * Required permission(s) for this route.
   * If not specified, defaults to admin role check.
   */
  requiredPermission?: string | string[];
}

/**
 * Route that requires admin privileges or specific permissions.
 */
export const AdminRoute = ({ 
  children, 
  redirectTo = "/",
  requiredPermission,
}: AdminRouteProps) => {
  const location = useLocation();
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
    const loginUrl = `/login?redirect=${encodeURIComponent(location.pathname)}`;
    return <Navigate to={loginUrl} replace />;
  }

  // Check specific permissions if provided
  if (requiredPermission) {
    const permissions = Array.isArray(requiredPermission) 
      ? requiredPermission 
      : [requiredPermission];
    
    if (!hasAnyPermission(permissions)) {
      return <Navigate to={redirectTo} replace />;
    }
  } else {
    // Default: require admin role
    if (!isAdmin()) {
      return <Navigate to={redirectTo} replace />;
    }
  }

  return <>{children}</>;
};

export default AdminRoute;
