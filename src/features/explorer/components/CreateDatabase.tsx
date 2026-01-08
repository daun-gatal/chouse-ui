import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useExplorerStore } from "@/stores";
import { useDatabases, useExecuteQuery } from "@/hooks";

const CreateDatabase: React.FC = () => {
  const { createDatabaseModalOpen, closeCreateDatabaseModal } = useExplorerStore();
  const { refetch: refetchDatabases } = useDatabases();
  const executeQuery = useExecuteQuery();

  const [databaseName, setDatabaseName] = useState("");

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

    try {
      await executeQuery.mutateAsync({
        query: `CREATE DATABASE IF NOT EXISTS ${databaseName}`,
      });
      toast.success(`Database "${databaseName}" created successfully`);
      await refetchDatabases();
      setDatabaseName("");
      closeCreateDatabaseModal();
    } catch (error) {
      console.error("Failed to create database:", error);
      toast.error(`Failed to create database: ${(error as Error).message}`);
    }
  };

  const handleClose = () => {
    setDatabaseName("");
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={executeQuery.isPending}>
              {executeQuery.isPending ? (
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
