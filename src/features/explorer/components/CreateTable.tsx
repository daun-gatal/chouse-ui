import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Plus,
  Trash2,
  Table2,
  Database,
  Server,
  Layers,
  Settings2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Sparkles,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useExplorerStore } from "@/stores";
import { useDatabases, useExecuteQuery, useClusterNames } from "@/hooks";

interface Column {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
}

const COMMON_TYPES = [
  { value: "String", label: "String", icon: "📝" },
  { value: "Int32", label: "Int32", icon: "🔢" },
  { value: "Int64", label: "Int64", icon: "🔢" },
  { value: "UInt32", label: "UInt32", icon: "🔢" },
  { value: "UInt64", label: "UInt64", icon: "🔢" },
  { value: "Float32", label: "Float32", icon: "📊" },
  { value: "Float64", label: "Float64", icon: "📊" },
  { value: "DateTime", label: "DateTime", icon: "📅" },
  { value: "DateTime64(3)", label: "DateTime64", icon: "📅" },
  { value: "Date", label: "Date", icon: "📆" },
  { value: "Bool", label: "Boolean", icon: "✓" },
  { value: "UUID", label: "UUID", icon: "🔑" },
  { value: "JSON", label: "JSON", icon: "{ }" },
  { value: "Array(String)", label: "Array(String)", icon: "[]" },
  { value: "Map(String, String)", label: "Map", icon: "🗺️" },
];

const ENGINES = [
  { value: "MergeTree", label: "MergeTree", description: "Default engine for analytics", requiresOrderBy: true },
  { value: "ReplacingMergeTree", label: "ReplacingMergeTree", description: "Deduplicates by ORDER BY", requiresOrderBy: true },
  { value: "SummingMergeTree", label: "SummingMergeTree", description: "Pre-aggregates numeric columns", requiresOrderBy: true },
  { value: "AggregatingMergeTree", label: "AggregatingMergeTree", description: "Stores aggregate states", requiresOrderBy: true },
  { value: "CollapsingMergeTree", label: "CollapsingMergeTree", description: "For collapsing rows", requiresOrderBy: true },
  { value: "Log", label: "Log", description: "Simple append-only", requiresOrderBy: false },
  { value: "TinyLog", label: "TinyLog", description: "Minimal storage", requiresOrderBy: false },
  { value: "Memory", label: "Memory", description: "In-memory only", requiresOrderBy: false },
];

const generateId = () => Math.random().toString(36).substring(2, 9);

const CreateTable: React.FC = () => {
  const { createTableModalOpen, closeCreateTableModal, selectedDatabase } = useExplorerStore();
  const { data: databases = [], refetch: refetchDatabases } = useDatabases();
  const { data: clusters = [] } = useClusterNames();
  const executeQuery = useExecuteQuery();

  const [database, setDatabase] = useState(selectedDatabase || "");
  const [tableName, setTableName] = useState("");
  const [engine, setEngine] = useState("MergeTree");
  const [columns, setColumns] = useState<Column[]>([
    { id: generateId(), name: "", type: "String", nullable: false, defaultValue: "" },
  ]);
  const [orderByColumns, setOrderByColumns] = useState<string[]>([]);
  const [partitionBy, setPartitionBy] = useState("");
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [queryPreviewOpen, setQueryPreviewOpen] = useState(false);
  const [ttlExpression, setTtlExpression] = useState("");
  const [comment, setComment] = useState("");

  // Update database when selectedDatabase changes
  useEffect(() => {
    if (selectedDatabase) {
      setDatabase(selectedDatabase);
    }
  }, [selectedDatabase]);

  const selectedEngine = ENGINES.find((e) => e.value === engine);

  const handleAddColumn = () => {
    setColumns([
      ...columns,
      { id: generateId(), name: "", type: "String", nullable: false, defaultValue: "" },
    ]);
  };

  const handleRemoveColumn = (id: string) => {
    if (columns.length > 1) {
      setColumns(columns.filter((col) => col.id !== id));
      setOrderByColumns(orderByColumns.filter((name) => {
        const col = columns.find((c) => c.id === id);
        return col?.name !== name;
      }));
    }
  };

  const handleColumnChange = (id: string, field: keyof Column, value: string | boolean) => {
    setColumns(columns.map((col) => (col.id === id ? { ...col, [field]: value } : col)));
  };

  const toggleOrderByColumn = (columnName: string) => {
    if (orderByColumns.includes(columnName)) {
      setOrderByColumns(orderByColumns.filter((c) => c !== columnName));
    } else {
      setOrderByColumns([...orderByColumns, columnName]);
    }
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
      toast.error("Please add at least one column with a name");
      return;
    }

    if (selectedEngine?.requiresOrderBy && orderByColumns.length === 0) {
      toast.error(`${engine} engine requires at least one ORDER BY column`);
      return;
    }

    if (useCluster && !selectedCluster) {
      toast.error("Please select a cluster");
      return;
    }

    // Build column definitions
    const columnDefs = validColumns
      .map((col) => {
        let def = `\`${col.name}\` `;
        def += col.nullable ? `Nullable(${col.type})` : col.type;
        if (col.defaultValue) {
          def += ` DEFAULT ${col.defaultValue}`;
        }
        return def;
      })
      .join(",\n    ");

    // Build query
    let query = `CREATE TABLE ${database}.\`${tableName}\``;
    if (useCluster && selectedCluster) {
      query += ` ON CLUSTER '${selectedCluster}'`;
    }
    query += ` (\n    ${columnDefs}\n)`;
    query += `\nENGINE = ${engine}`;

    if (selectedEngine?.requiresOrderBy && orderByColumns.length > 0) {
      query += `\nORDER BY (${orderByColumns.map((c) => `\`${c}\``).join(", ")})`;
    }

    if (partitionBy) {
      query += `\nPARTITION BY ${partitionBy}`;
    }

    if (ttlExpression) {
      query += `\nTTL ${ttlExpression}`;
    }

    if (comment) {
      query += `\nCOMMENT '${comment.replace(/'/g, "\\'")}'`;
    }

    try {
      await executeQuery.mutateAsync({ query });
      toast.success(`Table "${tableName}" created successfully${useCluster ? ` on cluster ${selectedCluster}` : ""}`);
      await refetchDatabases();
      handleClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CreateTable] Failed to create table:', errorMessage);
      toast.error(`Failed to create table: ${errorMessage}`);
    }
  };

  const handleClose = () => {
    setDatabase(selectedDatabase || "");
    setTableName("");
    setEngine("MergeTree");
    setColumns([{ id: generateId(), name: "", type: "String", nullable: false, defaultValue: "" }]);
    setOrderByColumns([]);
    setPartitionBy("");
    setUseCluster(false);
    setSelectedCluster("");
    setAdvancedOpen(false);
    setQueryPreviewOpen(false);
    setTtlExpression("");
    setComment("");
    closeCreateTableModal();
  };

  const validColumnNames = columns.filter((col) => col.name.trim()).map((col) => col.name);

  // Generate query preview
  const generateQueryPreview = (): string => {
    if (!database || !tableName.trim()) {
      return "-- Fill in database and table name to see the query";
    }

    const validCols = columns.filter((col) => col.name.trim());
    if (validCols.length === 0) {
      return "-- Add at least one column to see the query";
    }

    const columnDefs = validCols
      .map((col) => {
        let def = `\`${col.name}\` `;
        def += col.nullable ? `Nullable(${col.type})` : col.type;
        if (col.defaultValue) {
          def += ` DEFAULT ${col.defaultValue}`;
        }
        return def;
      })
      .join(",\n    ");

    let query = `CREATE TABLE ${database}.\`${tableName}\``;
    if (useCluster && selectedCluster) {
      query += ` ON CLUSTER '${selectedCluster}'`;
    }
    query += ` (\n    ${columnDefs}\n)`;
    query += `\nENGINE = ${engine}`;

    if (selectedEngine?.requiresOrderBy && orderByColumns.length > 0) {
      query += `\nORDER BY (${orderByColumns.map((c) => `\`${c}\``).join(", ")})`;
    }

    if (partitionBy) {
      query += `\nPARTITION BY ${partitionBy}`;
    }

    if (ttlExpression) {
      query += `\nTTL ${ttlExpression}`;
    }

    if (comment) {
      query += `\nCOMMENT '${comment.replace(/'/g, "\\'")}'`;
    }

    return query;
  };

  const queryPreview = generateQueryPreview();

  return (
    <Dialog open={createTableModalOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-gradient-to-br from-gray-900 to-gray-950 border-white/10">
        <DialogHeader className="flex-none pb-4 border-b border-white/10">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Table2 className="h-5 w-5 text-white" />
            </div>
            Create New Table
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto py-4 space-y-6 px-1">
            {/* Basic Settings */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-gray-300">
                  <Database className="h-4 w-4 text-blue-400" />
                  Database
                </Label>
                <Select value={database} onValueChange={setDatabase}>
                  <SelectTrigger className="bg-white/5 border-white/10">
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
                <Label className="flex items-center gap-2 text-gray-300">
                  <Table2 className="h-4 w-4 text-green-400" />
                  Table Name
                </Label>
                <Input
                  value={tableName}
                  onChange={(e) => setTableName(e.target.value)}
                  placeholder="my_table"
                  className="bg-white/5 border-white/10"
                />
              </div>
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

            {/* Engine Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-gray-300">
                <Layers className="h-4 w-4 text-purple-400" />
                Table Engine
              </Label>
              <Select value={engine} onValueChange={setEngine}>
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENGINES.map((eng) => (
                    <SelectItem key={eng.value} value={eng.value}>
                      <div className="flex flex-col">
                        <span>{eng.label}</span>
                        <span className="text-xs text-gray-400">{eng.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Columns */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-gray-300">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  Columns
                </Label>
                <Button type="button" size="sm" variant="outline" onClick={handleAddColumn} className="gap-1">
                  <Plus className="h-4 w-4" /> Add Column
                </Button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                <AnimatePresence>
                  {columns.map((column, index) => (
                    <motion.div
                      key={column.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="flex items-center gap-2 p-3 rounded-lg bg-white/5 border border-white/10"
                    >
                      <span className="text-xs text-gray-500 w-6">{index + 1}</span>
                      <Input
                        placeholder="Column name"
                        value={column.name}
                        onChange={(e) => handleColumnChange(column.id, "name", e.target.value)}
                        className="flex-1 bg-white/5 border-white/10 h-9"
                      />
                      <Select
                        value={column.type}
                        onValueChange={(value) => handleColumnChange(column.id, "type", value)}
                      >
                        <SelectTrigger className="w-44 bg-white/5 border-white/10 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COMMON_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              <span className="flex items-center gap-2">
                                <span>{type.icon}</span>
                                <span>{type.label}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedEngine?.requiresOrderBy && column.name && (
                        <Button
                          type="button"
                          size="sm"
                          variant={orderByColumns.includes(column.name) ? "default" : "outline"}
                          className={`text-xs h-9 ${orderByColumns.includes(column.name) ? "bg-blue-600" : ""}`}
                          onClick={() => toggleOrderByColumn(column.name)}
                        >
                          {orderByColumns.includes(column.name) ? `#${orderByColumns.indexOf(column.name) + 1}` : "PK"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveColumn(column.id)}
                        disabled={columns.length === 1}
                        className="h-9 w-9 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {selectedEngine?.requiresOrderBy && orderByColumns.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>ORDER BY:</span>
                  {orderByColumns.map((col, i) => (
                    <Badge key={col} variant="secondary" className="bg-blue-500/20 text-blue-300">
                      {i + 1}. {col}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Query Preview */}
            <Collapsible open={queryPreviewOpen} onOpenChange={setQueryPreviewOpen}>
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between w-full p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                  <span className="flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    CREATE TABLE Query
                  </span>
                  {queryPreviewOpen ? (
                    <ChevronUp className="h-4 w-4 transition-transform" />
                  ) : (
                    <ChevronDown className="h-4 w-4 transition-transform" />
                  )}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <Textarea
                  readOnly
                  value={queryPreview}
                  className="min-h-[100px] max-h-[300px] font-mono text-xs sm:text-sm text-gray-300 bg-black/40 border-white/10 resize-none overflow-auto"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                />
              </CollapsibleContent>
            </Collapsible>

            {/* Advanced Settings */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between w-full p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Advanced Settings
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">Partition By</Label>
                  <Input
                    value={partitionBy}
                    onChange={(e) => setPartitionBy(e.target.value)}
                    placeholder="e.g., toYYYYMM(created_at) or leave empty for none"
                    className="bg-white/5 border-white/10"
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs text-gray-500">Quick:</span>
                    {validColumnNames.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setPartitionBy(col)}
                        className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
                      >
                        {col}
                      </button>
                    ))}
                    {validColumnNames
                      .filter(c => {
                        const colType = columns.find(col => col.name === c)?.type.toLowerCase() || "";
                        return colType.includes('date') || colType.includes('time');
                      })
                      .flatMap(col => [
                        <button
                          key={`${col}-yyyymm`}
                          type="button"
                          onClick={() => setPartitionBy(`toYYYYMM(${col})`)}
                          className="px-2 py-1 text-xs rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 transition-colors"
                        >
                          toYYYYMM({col})
                        </button>,
                        <button
                          key={`${col}-yyyymmdd`}
                          type="button"
                          onClick={() => setPartitionBy(`toYYYYMMDD(${col})`)}
                          className="px-2 py-1 text-xs rounded bg-green-500/20 hover:bg-green-500/30 text-green-300 transition-colors"
                        >
                          toYYYYMMDD({col})
                        </button>,
                      ])
                    }
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-300">TTL Expression</Label>
                    <Input
                      value={ttlExpression}
                      onChange={(e) => setTtlExpression(e.target.value)}
                      placeholder="e.g., created_at + INTERVAL 30 DAY"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Table Comment</Label>
                    <Input
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Description of this table"
                      className="bg-white/5 border-white/10"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <DialogFooter className="flex-none pt-4 border-t border-white/10">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={executeQuery.isPending}
              className="gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500"
            >
              {executeQuery.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Create Table
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTable;
