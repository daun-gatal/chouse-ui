import { useEffect, useState, ReactNode } from "react";
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader";
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
        logout().catch((err) => {
          console.error("[AppInit] Failed to logout on user change:", err);
        });
      }
    });

    return cleanup;
  }, [logout]);

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
