import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores";
import { Loader2 } from "lucide-react";

/**
 * Redirects users to the appropriate default page based on their role.
 * - Admin users: Overview/Home page
 * - Non-admin users: Explorer page
 */
export const DefaultRedirect = () => {
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

  // Redirect based on role
  if (isAdmin) {
    return <Navigate to="/overview" replace />;
  } else {
    return <Navigate to="/explorer" replace />;
  }
};

export default DefaultRedirect;

