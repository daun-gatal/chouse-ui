import React, { useState } from "react";
import { motion } from "framer-motion";
import { Save, Loader2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { useSavedQueriesStatus, useExecuteQuery } from "@/hooks";

const ActivateSavedQueries: React.FC = () => {
  const { data: isEnabled, isLoading: checkingStatus, refetch } = useSavedQueriesStatus();
  const executeQuery = useExecuteQuery();
  const [isActivating, setIsActivating] = useState(false);

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      // Create the CH_UI database first
      await executeQuery.mutateAsync({ query: "CREATE DATABASE IF NOT EXISTS CH_UI" });
      
      // Create the saved_queries table (matching backend schema)
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS CH_UI.saved_queries (
          id String,
          name String,
          query String,
          created_at DateTime64(3) DEFAULT now64(),
          updated_at DateTime64(3) DEFAULT now64(),
          owner String DEFAULT currentUser(),
          is_public Boolean DEFAULT false
        ) ENGINE = MergeTree()
        ORDER BY (id, created_at)
        SETTINGS index_granularity = 8192
      `;

      await executeQuery.mutateAsync({ query: createTableQuery });
      toast.success("Saved queries feature enabled successfully!");
      await refetch();
    } catch (error) {
      console.error("Failed to enable saved queries:", error);
      toast.error(`Failed to enable: ${(error as Error).message}`);
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-3">
        <Save className="h-6 w-6 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Saved Queries</h2>
      </div>

      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle>Feature Status</GlassCardTitle>
        </GlassCardHeader>
        <GlassCardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
            <div className="flex items-center gap-3">
              {checkingStatus ? (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              ) : isEnabled ? (
                <CheckCircle className="h-5 w-5 text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              <div>
                <p className="text-white font-medium">Saved Queries Feature</p>
                <p className="text-sm text-gray-400">
                  {checkingStatus
                    ? "Checking status..."
                    : isEnabled
                    ? "Feature is enabled and ready to use"
                    : "Feature is not enabled"}
                </p>
              </div>
            </div>
            {!checkingStatus && !isEnabled && (
              <Button
                onClick={handleActivate}
                disabled={isActivating}
                className="gap-2"
              >
                {isActivating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Enable
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="text-sm text-gray-400 space-y-2">
            <p>
              When enabled, the saved queries feature creates a <code className="text-cyan-400">CH_UI</code> database
              with a <code className="text-cyan-400">saved_queries</code> table to store your SQL queries. This allows you to:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Save frequently used queries</li>
              <li>Access saved queries from the explorer</li>
              <li>Share queries across sessions</li>
            </ul>
          </div>
        </GlassCardContent>
      </GlassCard>
    </motion.div>
  );
};

export default ActivateSavedQueries;
