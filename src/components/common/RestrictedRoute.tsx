import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores";
import { Loader2 } from "lucide-react";

interface RestrictedRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
  requireAdmin?: boolean;
}

/**
 * Route that requires authentication.
 * If requireAdmin is true, also requires admin privileges.
 */
export const RestrictedRoute = ({
  children,
  redirectTo = "/login",
  requireAdmin = false,
}: RestrictedRouteProps) => {
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
    return <Navigate to={redirectTo} replace />;
  }

  // If admin is required but user is not admin, redirect to home
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default RestrictedRoute;
