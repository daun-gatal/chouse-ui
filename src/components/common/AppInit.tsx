import { useEffect, useState, ReactNode } from "react";
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader";
import { useNavigate } from "react-router-dom";
import { useRbacStore } from "@/stores";
import { toast } from "sonner";
import { listenForUserChanges } from "@/utils/sessionCleanup";

const AppInitializer = ({ children }: { children: ReactNode }) => {
  const loadingStates = [
    { text: "Initializing application..." },
    { text: "Checking session..." },
    { text: "Loading permissions..." },
    { text: "Preparing workspace..." },
  ];

  const { checkAuth, error, isInitialized, logout } = useRbacStore();
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      try {
        await checkAuth();
      } catch (err) {
        console.error("Initialization failed:", err);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [checkAuth]);

  // Listen for user changes from other tabs
  useEffect(() => {
    const cleanup = listenForUserChanges((newUserId) => {
      // If user changed in another tab, logout current session
      if (newUserId === null) {
        // Only trigger logout if we are currently authenticated
        // This prevents infinite loops if the broadcast was triggered by our own logout
        const { isAuthenticated } = useRbacStore.getState();
        if (isAuthenticated) {
          logout().catch((err) => {
            console.error("[AppInit] Failed to logout on user change:", err);
          });
        }
      }
    });

    return cleanup;
  }, [logout]);

  // Listen for unauthorized events (e.g. 401 from API)
  useEffect(() => {
    const handleUnauthorized = () => {
      logout().catch((err) => {
        console.error("[AppInit] Logout error:", err);
      });
      navigate("/login");
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, [logout, navigate]);

  useEffect(() => {
    if (error) {
      toast.error(`Initialization error: ${error}`);
    }
  }, [error]);

  if (isLoading || !isInitialized) {
    return (
      <Loader
        loadingStates={loadingStates}
        loading={isLoading}
        duration={800}
      />
    );
  }

  return <>{children}</>;
};

export default AppInitializer;
