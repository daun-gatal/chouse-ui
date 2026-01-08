import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores";
import { Loader2 } from "lucide-react";

interface AdminRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Route that requires admin privileges.
 */
export const AdminRoute = ({ children, redirectTo = "/" }: AdminRouteProps) => {
  const { isAuthenticated, isInitialized, isLoading, isAdmin } = useAuthStore();

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

  // Redirect if not admin
  if (!isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
