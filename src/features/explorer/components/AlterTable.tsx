import React, { useState, useEffect } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
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

  const tableName = `${selectedDatabase}.${selectedTableForAlter}`;
  const clusterClause = useCluster && selectedCluster ? ` ON CLUSTER '${selectedCluster}'` : "";

  // Fetch table structure
  const fetchTableStructure = async () => {
    if (!selectedDatabase || !selectedTableForAlter) return;
    
    setIsLoading(true);
    try {
      const result = await executeQuery.mutateAsync({
        query: `DESCRIBE TABLE ${tableName}`,
      });
      setColumns(result.data as unknown as TableColumn[]);
    } catch (error) {
      console.error("Failed to fetch table structure:", error);
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
      let query = `ALTER TABLE ${tableName}${clusterClause} ADD COLUMN \`${newColumnName}\` ${newColumnType}`;
      if (newColumnAfter) {
        query += ` AFTER \`${newColumnAfter}\``;
      }

      await executeQuery.mutateAsync({ query });
      toast.success(`Column "${newColumnName}" added successfully`);
      setNewColumnName("");
      setNewColumnType("String");
      setNewColumnAfter("");
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      console.error("Failed to add column:", error);
      toast.error(`Failed to add column: ${(error as Error).message}`);
    }
  };

  const handleDropColumn = async (columnName: string) => {
    try {
      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${tableName}${clusterClause} DROP COLUMN \`${columnName}\``,
      });
      toast.success(`Column "${columnName}" dropped successfully`);
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      console.error("Failed to drop column:", error);
      toast.error(`Failed to drop column: ${(error as Error).message}`);
    }
  };

  const handleRenameColumn = async () => {
    if (!renameFrom || !renameTo.trim()) {
      toast.error("Please select a column and enter a new name");
      return;
    }

    try {
      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${tableName}${clusterClause} RENAME COLUMN \`${renameFrom}\` TO \`${renameTo}\``,
      });
      toast.success(`Column renamed from "${renameFrom}" to "${renameTo}"`);
      setRenameFrom("");
      setRenameTo("");
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      console.error("Failed to rename column:", error);
      toast.error(`Failed to rename column: ${(error as Error).message}`);
    }
  };

  const handleModifyColumn = async () => {
    if (!modifyColumn || !modifyType) {
      toast.error("Please select a column and new type");
      return;
    }

    try {
      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${tableName}${clusterClause} MODIFY COLUMN \`${modifyColumn}\` ${modifyType}`,
      });
      toast.success(`Column "${modifyColumn}" type changed to ${modifyType}`);
      setModifyColumn("");
      setModifyType("");
      await fetchTableStructure();
      await refetchDatabases();
    } catch (error) {
      console.error("Failed to modify column:", error);
      toast.error(`Failed to modify column: ${(error as Error).message}`);
    }
  };

  const handleUpdateComment = async () => {
    try {
      await executeQuery.mutateAsync({
        query: `ALTER TABLE ${tableName}${clusterClause} MODIFY COMMENT '${tableComment.replace(/'/g, "\\'")}'`,
      });
      toast.success("Table comment updated");
    } catch (error) {
      console.error("Failed to update comment:", error);
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-gray-900 to-gray-950 border-white/10">
        <DialogHeader className="flex-none pb-4 border-b border-white/10">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
              <Settings2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <span>Alter Table</span>
              <span className="ml-2 text-sm font-normal text-gray-400">{tableName}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-6 px-1">
          {/* Cluster Option */}
          {clusters.length > 0 && (
            <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-orange-400" />
                  <Label className="text-gray-300">Apply on Cluster</Label>
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

          {/* Current Structure */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-gray-300">
                <Columns className="h-4 w-4 text-blue-400" />
                Current Columns ({columns.length})
              </Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={fetchTableStructure}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 p-2 rounded-lg bg-black/30">
                {columns.map((col, index) => (
                  <div
                    key={col.name}
                    className="flex items-center justify-between p-2 rounded bg-white/5 hover:bg-white/10 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-6">{index + 1}</span>
                      <span className="text-white font-medium">{col.name}</span>
                      <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 text-xs">
                        {col.type}
                      </Badge>
                      {col.default_expression && (
                        <span className="text-xs text-gray-500">
                          = {col.default_expression}
                        </span>
                      )}
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            Drop Column
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to drop column <strong>{col.name}</strong>? 
                            This action cannot be undone and all data in this column will be lost.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDropColumn(col.name)}
                            className="bg-red-600 hover:bg-red-700"
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
            <TabsList className="bg-white/5 border border-white/10 p-1 w-full justify-start">
              <TabsTrigger value="add" className="data-[state=active]:bg-green-500/20">
                <Plus className="h-4 w-4 mr-2" />
                Add Column
              </TabsTrigger>
              <TabsTrigger value="rename" className="data-[state=active]:bg-blue-500/20">
                <Edit3 className="h-4 w-4 mr-2" />
                Rename
              </TabsTrigger>
              <TabsTrigger value="modify" className="data-[state=active]:bg-orange-500/20">
                <Settings2 className="h-4 w-4 mr-2" />
                Modify Type
              </TabsTrigger>
            </TabsList>

            {/* Add Column Tab */}
            <TabsContent value="add" className="space-y-4">
              <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Column Name</Label>
                    <Input
                      value={newColumnName}
                      onChange={(e) => setNewColumnName(e.target.value)}
                      placeholder="new_column"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Type</Label>
                    <Select value={newColumnType} onValueChange={setNewColumnType}>
                      <SelectTrigger className="bg-white/5 border-white/10">
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
                    <Label className="text-gray-300">Position (After)</Label>
                    <Select value={newColumnAfter || "__first__"} onValueChange={(v) => setNewColumnAfter(v === "__first__" ? "" : v)}>
                      <SelectTrigger className="bg-white/5 border-white/10">
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
                  className="bg-green-600 hover:bg-green-700"
                >
                  {executeQuery.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add Column
                </Button>
              </div>
            </TabsContent>

            {/* Rename Column Tab */}
            <TabsContent value="rename" className="space-y-4">
              <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Column to Rename</Label>
                    <Select value={renameFrom} onValueChange={setRenameFrom}>
                      <SelectTrigger className="bg-white/5 border-white/10">
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
                    <Label className="text-gray-300">New Name</Label>
                    <Input
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                      placeholder="new_name"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleRenameColumn}
                  disabled={executeQuery.isPending || !renameFrom || !renameTo.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {executeQuery.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Edit3 className="h-4 w-4 mr-2" />
                  )}
                  Rename Column
                </Button>
              </div>
            </TabsContent>

            {/* Modify Type Tab */}
            <TabsContent value="modify" className="space-y-4">
              <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Column to Modify</Label>
                    <Select value={modifyColumn} onValueChange={(v) => {
                      setModifyColumn(v);
                      const col = columns.find(c => c.name === v);
                      if (col) setModifyType(col.type);
                    }}>
                      <SelectTrigger className="bg-white/5 border-white/10">
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
                    <Label className="text-gray-300">New Type</Label>
                    <Select value={modifyType} onValueChange={setModifyType}>
                      <SelectTrigger className="bg-white/5 border-white/10">
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
                <div className="flex items-center gap-2 text-sm text-yellow-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Changing column types may cause data loss if types are incompatible</span>
                </div>
                <Button
                  onClick={handleModifyColumn}
                  disabled={executeQuery.isPending || !modifyColumn || !modifyType}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  {executeQuery.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Settings2 className="h-4 w-4 mr-2" />
                  )}
                  Modify Column Type
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex-none pt-4 border-t border-white/10">
          <Button type="button" variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AlterTable;

