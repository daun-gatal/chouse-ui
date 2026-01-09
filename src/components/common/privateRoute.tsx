import { Navigate, useLocation } from "react-router-dom";
import { useRbacStore } from "@/stores";
import { Loader2 } from "lucide-react";

interface PrivateRouteProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export const PrivateRoute = ({ children, redirectTo = "/login" }: PrivateRouteProps) => {
  const location = useLocation();
  const { isAuthenticated, isInitialized, isLoading } = useRbacStore();

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
    const redirectUrl = `${redirectTo}?redirect=${encodeURIComponent(location.pathname)}`;
    return <Navigate to={redirectUrl} replace />;
  }

  return <>{children}</>;
};

export default PrivateRoute;
