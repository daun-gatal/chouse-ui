import { useEffect, useState, ReactNode } from "react";
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader";
import { useAuthStore } from "@/stores";
import { toast } from "sonner";

const AppInitializer = ({ children }: { children: ReactNode }) => {
  const loadingStates = [
    { text: "Initializing application..." },
    { text: "Checking session..." },
    { text: "Loading permissions..." },
    { text: "Preparing workspace..." },
  ];

  const { checkSession, error, isInitialized } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await checkSession();
      } catch (err) {
        console.error("Initialization failed:", err);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [checkSession]);

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
