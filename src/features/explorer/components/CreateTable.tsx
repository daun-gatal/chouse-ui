import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExplorerStore } from "@/stores";
import { useDatabases, useExecuteQuery } from "@/hooks";

interface Column {
  name: string;
  type: string;
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
  "Date",
  "Bool",
  "UUID",
  "Array(String)",
  "Nullable(String)",
];

const CreateTable: React.FC = () => {
  const { createTableModalOpen, closeCreateTableModal, selectedDatabase } = useExplorerStore();
  const { data: databases = [], refetch: refetchDatabases } = useDatabases();
  const executeQuery = useExecuteQuery();

  const [database, setDatabase] = useState(selectedDatabase || "");
  const [tableName, setTableName] = useState("");
  const [engine, setEngine] = useState("MergeTree");
  const [columns, setColumns] = useState<Column[]>([{ name: "", type: "String" }]);
  const [orderByColumn, setOrderByColumn] = useState("");

  const handleAddColumn = () => {
    setColumns([...columns, { name: "", type: "String" }]);
  };

  const handleRemoveColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns(columns.filter((_, i) => i !== index));
    }
  };

  const handleColumnChange = (
    index: number,
    field: keyof Column,
    value: string
  ) => {
    const newColumns = [...columns];
    newColumns[index][field] = value;
    setColumns(newColumns);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!database) {
      toast.error("Please select a database");
      return;
    }

    if (!tableName.trim()) {
      toast.error("Please enter a table name");
      return;
    }

    const validColumns = columns.filter((col) => col.name.trim());
    if (validColumns.length === 0) {
      toast.error("Please add at least one column");
      return;
    }

    if (engine === "MergeTree" && !orderByColumn) {
      toast.error("MergeTree engine requires an ORDER BY column");
      return;
    }

    const columnDefs = validColumns
      .map((col) => `${col.name} ${col.type}`)
      .join(", ");

    let query = `CREATE TABLE ${database}.${tableName} (${columnDefs}) ENGINE = ${engine}`;
    if (engine === "MergeTree" && orderByColumn) {
      query += ` ORDER BY ${orderByColumn}`;
    }

    try {
      await executeQuery.mutateAsync({ query });
      toast.success(`Table "${tableName}" created successfully`);
      await refetchDatabases();
      handleClose();
    } catch (error) {
      console.error("Failed to create table:", error);
      toast.error(`Failed to create table: ${(error as Error).message}`);
    }
  };

  const handleClose = () => {
    setDatabase(selectedDatabase || "");
    setTableName("");
    setEngine("MergeTree");
    setColumns([{ name: "", type: "String" }]);
    setOrderByColumn("");
    closeCreateTableModal();
  };

  return (
    <Dialog open={createTableModalOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Table</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Database</Label>
                <Select value={database} onValueChange={setDatabase}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select database" />
                  </SelectTrigger>
                  <SelectContent>
                    {databases.map((db) => (
                      <SelectItem key={db.name} value={db.name}>
                        {db.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Table Name</Label>
                <Input
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="my_table"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Engine</Label>
              <Select value={engine} onValueChange={setEngine}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MergeTree">MergeTree</SelectItem>
                  <SelectItem value="Log">Log</SelectItem>
                  <SelectItem value="Memory">Memory</SelectItem>
                  <SelectItem value="TinyLog">TinyLog</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Columns</Label>
                <Button type="button" size="sm" variant="outline" onClick={handleAddColumn}>
                  <Plus className="h-4 w-4 mr-1" /> Add Column
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {columns.map((column, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Column name"
                      value={column.name}
                      onChange={(e) =>
                        handleColumnChange(index, "name", e.target.value)
                      }
                      className="flex-1"
                    />
                    <Select
                      value={column.type}
                      onValueChange={(value) =>
                        handleColumnChange(index, "type", value)
                      }
                    >
                      <SelectTrigger className="w-40">
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
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemoveColumn(index)}
                      disabled={columns.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {engine === "MergeTree" && (
              <div className="space-y-2">
                <Label>ORDER BY Column</Label>
                <Select value={orderByColumn} onValueChange={setOrderByColumn}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select order by column" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns
                      .filter((col) => col.name.trim())
                      .map((col) => (
                        <SelectItem key={col.name} value={col.name}>
                          {col.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                "Create Table"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTable;
