import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, Server } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExplorerStore } from "@/stores";
import { useDatabases, useCreateDatabase, useClusterNames } from "@/hooks";

const CreateDatabase: React.FC = () => {
  const { createDatabaseModalOpen, closeCreateDatabaseModal } = useExplorerStore();
  const { refetch: refetchDatabases } = useDatabases();
  const { data: clusters = [] } = useClusterNames();
  const createDatabase = useCreateDatabase();

  const [databaseName, setDatabaseName] = useState("");
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!databaseName.trim()) {
      toast.error("Please enter a database name");
      return;
    }

    // Validate database name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
      toast.error(
        "Invalid database name. Must start with a letter or underscore and contain only alphanumeric characters."
      );
      return;
    }

    if (useCluster && !selectedCluster) {
      toast.error("Please select a cluster");
      return;
    }

    try {
      await createDatabase.mutateAsync({
        name: databaseName,
        cluster: useCluster ? selectedCluster : undefined,
      });
      toast.success(`Database "${databaseName}" created successfully${useCluster ? ` on cluster ${selectedCluster}` : ""}`);
      await refetchDatabases();
      handleClose();
    } catch (error) {
      console.error("Failed to create database:", error);
      toast.error(`Failed to create database: ${(error as Error).message}`);
    }
  };

  const handleClose = () => {
    setDatabaseName("");
    setUseCluster(false);
    setSelectedCluster("");
    closeCreateDatabaseModal();
  };

  return (
    <Dialog open={createDatabaseModalOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Database</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="database-name">Database Name</Label>
              <Input
                id="database-name"
                value={databaseName}
                onChange={(e) => setDatabaseName(e.target.value)}
                placeholder="my_database"
                autoFocus
              />
            </div>

            {/* Cluster Option */}
            {clusters.length > 0 && (
              <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-orange-400" />
                    <Label className="text-gray-300">Create on Cluster</Label>
                  </div>
                  <Switch checked={useCluster} onCheckedChange={setUseCluster} />
                </div>
                <AnimatePresence>
                  {useCluster && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                        <SelectTrigger className="bg-white/5 border-white/10">
                          <SelectValue placeholder="Select cluster" />
                        </SelectTrigger>
                        <SelectContent>
                          {clusters.map((cluster) => (
                            <SelectItem key={cluster} value={cluster}>
                              {cluster}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createDatabase.isPending}>
              {createDatabase.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Database"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateDatabase;
