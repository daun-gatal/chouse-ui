import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Plus,
  Trash2,
  Settings2,
  Columns,
  Server,
  AlertTriangle,
  Check,
  X,
  Edit3,
  RefreshCw,
} from "lucide-react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useExplorerStore } from "@/stores";
import { useDatabases, useExecuteQuery, useClusterNames } from "@/hooks";
import { escapeIdentifier, validateColumnType } from "@/helpers/sqlUtils";

interface TableColumn {
  name: string;
  type: string;
  default_type: string;
  default_expression: string;
  comment: string;
}

const COMMON_TYPES = [
  "String",
  "Int32",
  "Int64",
  "UInt32",
  "UInt64",
  "Float32",
  "Float64",
  "DateTime",
  "DateTime64(3)",
  "Date",
  "Bool",
  "UUID",
  "JSON",
  "Array(String)",
  "Nullable(String)",
];

const AlterTable: React.FC = () => {
  const { alterTableModalOpen, closeAlterTableModal, selectedDatabase, selectedTableForAlter } = useExplorerStore();
  const { refetch: refetchDatabases } = useDatabases();
  const { data: clusters = [] } = useClusterNames();
  const executeQuery = useExecuteQuery();

  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");

  // New column state
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState("String");
  const [newColumnAfter, setNewColumnAfter] = useState("");

  // Rename column state
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  // Modify column state
  const [modifyColumn, setModifyColumn] = useState("");
  const [modifyType, setModifyType] = useState("");

  // Comment state
  const [tableComment, setTableComment] = useState("");

  // Display table name (for UI)
  const tableName = selectedDatabase && selectedTableForAlter 
    ? `${selectedDatabase}.${selectedTableForAlter}` 
    : "";

  // Validate table identifiers and return escaped version for SQL queries
  const getEscapedTableName = (): string => {
    try {
      const escapedDb = escapeIdentifier(selectedDatabase);
      const escapedTable = escapeIdentifier(selectedTableForAlter);
      return `${escapedDb}.${escapedTable}`;
    } catch (error) {
      throw new Error(`Invalid table identifier: ${(error as Error).message}`);
    }
  };

  const getClusterClause = (): string => {
    if (useCluster && selectedCluster) {
      try {
        const escapedCluster = escapeIdentifier(selectedCluster);
        return ` ON CLUSTER ${escapedCluster}`;
      } catch (error) {
        throw new Error(`Invalid cluster name: ${(error as Error).message}`);
      }
    }
    return "";
  };

  // Fetch table structure
  const fetchTableStructure = async () => {
    if (!selectedDatabase || !selectedTableForAlter) return;
    
    setIsLoading(true);
    try {
      const escapedTableName = getEscapedTableName();
      const result = await executeQuery.mutateAsync({
        query: `DESCRIBE TABLE ${escapedTableName}`,
      });
      setColumns(result.data as unknown as TableColumn[]);
    } catch (error) {
      log.error("Failed to fetch table structure:", error);
      toast.error("Failed to fetch table structure");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (alterTableModalOpen && selectedDatabase && selectedTableForAlter) {
      fetchTableStructure();
    }
  }, [alterTableModalOpen, selectedDatabase, selectedTableForAlter]);

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) {
      toast.error("Please enter a column name");
      return;
    }

    try {
      // Validate identifiers and column type
      let escapedTableName: string;
      let escapedColumnName: string;
      let escapedAfterColumn: string | undefined;
      let clusterClause: string;
      
      try {
        escapedTableName = getEscapedTableName();
        escapedColumnName = escapeIdentifier(newColumnName.trim());
        clusterClause = getClusterClause();
        
        if (newColumnAfter) {
          escapedAfterColumn = escapeIdentifier(newColumnAfter);
        }
        
        if (!validateColumnType(newColumnType)) {
          toast.error(`Invalid column type: ${newColumnType}`);
          return;
        }
      } catch (error) {
        toast.error(`Invalid identifier: ${(error as Error).message}`);
        return;
      }

      let query = `ALTER TABLE ${escapedTableName}${clusterClause} ADD COLUMN ${escapedColumnName} ${newColumnType}`;
      if (escapedAfterColumn) {
        query += ` AFTER ${escapedAfterColumn}`;
      }

      await executeQuery.mutateAsync({ query });
      toast.success(`Column "${newColumnName}" added successfully`);
      setNewColumnName("");
      setNewColumnType("String");
      setNewColumnAfter("");
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      log.error("Failed to add column:", error);
      toast.error(`Failed to add column: ${(error as Error).message}`);
    }
  };

  const handleDropColumn = async (columnName: string) => {
    try {
      // Validate identifiers
      let escapedTableName: string;
      let escapedColumnName: string;
      let clusterClause: string;
      
      try {
        escapedTableName = getEscapedTableName();
        escapedColumnName = escapeIdentifier(columnName);
        clusterClause = getClusterClause();
      } catch (error) {
        toast.error(`Invalid identifier: ${(error as Error).message}`);
        return;
      }

      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${escapedTableName}${clusterClause} DROP COLUMN ${escapedColumnName}`,
      });
      toast.success(`Column "${columnName}" dropped successfully`);
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      log.error("Failed to drop column:", error);
      toast.error(`Failed to drop column: ${(error as Error).message}`);
    }
  };

  const handleRenameColumn = async () => {
    if (!renameFrom || !renameTo.trim()) {
      toast.error("Please select a column and enter a new name");
      return;
    }

    try {
      // Validate identifiers
      let escapedTableName: string;
      let escapedFromColumn: string;
      let escapedToColumn: string;
      let clusterClause: string;
      
      try {
        escapedTableName = getEscapedTableName();
        escapedFromColumn = escapeIdentifier(renameFrom);
        escapedToColumn = escapeIdentifier(renameTo.trim());
        clusterClause = getClusterClause();
      } catch (error) {
        toast.error(`Invalid identifier: ${(error as Error).message}`);
        return;
      }

      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${escapedTableName}${clusterClause} RENAME COLUMN ${escapedFromColumn} TO ${escapedToColumn}`,
      });
      toast.success(`Column renamed from "${renameFrom}" to "${renameTo}"`);
      setRenameFrom("");
      setRenameTo("");
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      log.error("Failed to rename column:", error);
      toast.error(`Failed to rename column: ${(error as Error).message}`);
    }
  };

  const handleModifyColumn = async () => {
    if (!modifyColumn || !modifyType) {
      toast.error("Please select a column and new type");
      return;
    }

    try {
      // Validate identifiers and column type
      let escapedTableName: string;
      let escapedColumnName: string;
      let clusterClause: string;
      
      try {
        escapedTableName = getEscapedTableName();
        escapedColumnName = escapeIdentifier(modifyColumn);
        clusterClause = getClusterClause();
        
        if (!validateColumnType(modifyType)) {
          toast.error(`Invalid column type: ${modifyType}`);
          return;
        }
      } catch (error) {
        toast.error(`Invalid identifier: ${(error as Error).message}`);
        return;
      }

      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${escapedTableName}${clusterClause} MODIFY COLUMN ${escapedColumnName} ${modifyType}`,
      });
      toast.success(`Column "${modifyColumn}" type changed to ${modifyType}`);
      setModifyColumn("");
      setModifyType("");
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      log.error("Failed to modify column:", error);
      toast.error(`Failed to modify column: ${(error as Error).message}`);
    }
  };

  const handleUpdateComment = async () => {
    try {
      // Validate table identifier and escape comment
      let escapedTableName: string;
      let clusterClause: string;
      
      try {
        escapedTableName = getEscapedTableName();
        clusterClause = getClusterClause();
      } catch (error) {
        toast.error(`Invalid identifier: ${(error as Error).message}`);
        return;
      }

      // Escape single quotes in comment
      const escapedComment = tableComment.replace(/'/g, "''");
      
      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${escapedTableName}${clusterClause} MODIFY COMMENT '${escapedComment}'`,
      });
      toast.success("Table comment updated");
    } catch (error) {
      log.error("Failed to update comment:", error);
      toast.error(`Failed to update comment: ${(error as Error).message}`);
    }
  };

  const handleClose = () => {
    setColumns([]);
    setNewColumnName("");
    setNewColumnType("String");
    setNewColumnAfter("");
    setRenameFrom("");
    setRenameTo("");
    setModifyColumn("");
    setModifyType("");
    setTableComment("");
    setUseCluster(false);
    setSelectedCluster("");
    closeAlterTableModal();
  };

  return (
    <Dialog open={alterTableModalOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader className="flex-none pb-4 border-b border-ink-500">
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Settings2 className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">Alter table</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                {tableName || "Modify table structure"}
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-6 px-1">
          {/* Cluster Option */}
          {clusters.length > 0 && (
            <div className="rounded-xs border border-ink-500 bg-ink-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Apply on Cluster</Label>
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
                      <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
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

          {/* Current Structure */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                <Columns className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                Current Columns ({columns.length})
              </Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={fetchTableStructure}
                disabled={isLoading}
                className="h-8 w-8 rounded-xs text-paper-muted hover:bg-ink-200 hover:text-paper"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 p-2 rounded-xs border border-ink-500 bg-ink-200">
                {columns.map((col, index) => (
                  <div
                    key={col.name}
                    className="flex items-center justify-between p-2 rounded-xs bg-ink-100 hover:bg-ink-300 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-paper-faint w-6">{index + 1}</span>
                      <span className="font-medium text-paper">{col.name}</span>
                      <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[11px] text-paper-muted">
                        {col.type}
                      </span>
                      {col.default_expression && (
                        <span className="font-mono text-[11px] text-paper-faint">
                          = {col.default_expression}
                        </span>
                      )}
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-xs opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-3 text-paper">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xs border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                              <AlertTriangle className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="flex flex-col gap-0.5 text-left">
                              <span className="text-[16px] font-semibold tracking-tight">Drop column</span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                Destructive action
                              </span>
                            </span>
                          </AlertDialogTitle>
                          <AlertDialogDescription className="text-paper-muted">
                            Are you sure you want to drop column <strong className="text-paper">{col.name}</strong>?
                            This action cannot be undone and all data in this column will be lost.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDropColumn(col.name)}
                            className="h-9 gap-2 rounded-xs border border-red-700 bg-red-600 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper hover:bg-red-700"
                          >
                            Drop Column
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabs for different operations */}
          <Tabs defaultValue="add" className="space-y-4">
            <TabsList className="h-9 w-full justify-start rounded-xs border border-ink-500 bg-ink-200 p-0.5">
              <TabsTrigger value="add" className="h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add Column
              </TabsTrigger>
              <TabsTrigger value="rename" className="h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                <Edit3 className="h-3.5 w-3.5 mr-2" />
                Rename
              </TabsTrigger>
              <TabsTrigger value="modify" className="h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper">
                <Settings2 className="h-3.5 w-3.5 mr-2" />
                Modify Type
              </TabsTrigger>
            </TabsList>

            {/* Add Column Tab */}
            <TabsContent value="add" className="space-y-4">
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-4 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Column Name</Label>
                    <Input
                      value={newColumnName}
                      onChange={(e) => setNewColumnName(e.target.value)}
                      placeholder="new_column"
                      className="rounded-xs border-ink-500 bg-ink-100 text-paper"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Type</Label>
                    <Select value={newColumnType} onValueChange={setNewColumnType}>
                      <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMON_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Position (After)</Label>
                    <Select value={newColumnAfter || "__first__"} onValueChange={(v) => setNewColumnAfter(v === "__first__" ? "" : v)}>
                      <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                        <SelectValue placeholder="End of table" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__first__">End of table</SelectItem>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            After {col.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={handleAddColumn}
                  disabled={executeQuery.isPending || !newColumnName.trim()}
                  className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
                >
                  {executeQuery.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Add Column
                </Button>
              </div>
            </TabsContent>

            {/* Rename Column Tab */}
            <TabsContent value="rename" className="space-y-4">
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Column to Rename</Label>
                    <Select value={renameFrom} onValueChange={setRenameFrom}>
                      <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">New Name</Label>
                    <Input
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      placeholder="new_name"
                      className="rounded-xs border-ink-500 bg-ink-100 text-paper"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleRenameColumn}
                  disabled={executeQuery.isPending || !renameFrom || !renameTo.trim()}
                  className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
                >
                  {executeQuery.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Edit3 className="h-3.5 w-3.5" />
                  )}
                  Rename Column
                </Button>
              </div>
            </TabsContent>

            {/* Modify Type Tab */}
            <TabsContent value="modify" className="space-y-4">
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Column to Modify</Label>
                    <Select value={modifyColumn} onValueChange={(v) => {
                      setModifyColumn(v);
                      const col = columns.find(c => c.name === v);
                      if (col) setModifyType(col.type);
                    }}>
                      <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name} ({col.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">New Type</Label>
                    <Select value={modifyType} onValueChange={setModifyType}>
                      <SelectTrigger className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMON_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-xs border border-amber-900/60 bg-amber-950/40 p-3 text-[12px] text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-300 shrink-0" aria-hidden />
                  <span>Changing column types may cause data loss if types are incompatible</span>
                </div>
                <Button
                  onClick={handleModifyColumn}
                  disabled={executeQuery.isPending || !modifyColumn || !modifyType}
                  className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
                >
                  {executeQuery.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Settings2 className="h-3.5 w-3.5" />
                  )}
                  Modify Column Type
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex-none pt-4 border-t border-ink-500">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AlterTable;

