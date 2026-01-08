import React, { useState } from "react";
import { motion } from "framer-motion";
import { FileText, RefreshCw, Search, Filter } from "lucide-react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, themeBalham, colorSchemeDark, ColDef } from "ag-grid-community";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { useTheme } from "@/components/common/theme-provider";
import { useQueryLogs } from "@/hooks";

interface LogEntry {
  type: string;
  event_date: string;
  event_time: string;
  query_id: string;
  query: string;
  query_duration_ms: number;
  read_rows: number;
  read_bytes: number;
  memory_usage: number;
  user: string;
  exception?: string;
}

export default function Logs() {
  const { theme } = useTheme();
  const [limit, setLimit] = useState(100);
  const [searchTerm, setSearchTerm] = useState("");
  const [logType, setLogType] = useState<string>("all");

  const { data: logs = [], isLoading, refetch, error } = useQueryLogs(limit);

  const gridTheme =
    theme === "light" ? themeBalham : themeBalham.withPart(colorSchemeDark);

  const columnDefs: ColDef<LogEntry>[] = [
    { headerName: "Type", field: "type", width: 120, filter: true },
    { headerName: "Date", field: "event_date", width: 110 },
    { headerName: "Time", field: "event_time", width: 100 },
    { headerName: "Query ID", field: "query_id", width: 200 },
    { headerName: "Query", field: "query", flex: 2, tooltipField: "query" },
    { headerName: "Duration (ms)", field: "query_duration_ms", width: 120, type: "numericColumn" },
    { headerName: "Rows Read", field: "read_rows", width: 100, type: "numericColumn" },
    { headerName: "User", field: "user", width: 100 },
    { headerName: "Exception", field: "exception", flex: 1 },
  ];

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = !searchTerm ||
      log.query?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.query_id?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = logType === "all" || log.type === logType;
    return matchesSearch && matchesType;
  });

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="container mx-auto p-6 space-y-6 h-full flex flex-col"
    >
      <motion.div variants={item} className="flex justify-between items-start">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-white/90 flex items-center gap-3">
            <FileText className="h-8 w-8 text-blue-400" />
            Query Logs
          </h1>
          <p className="text-gray-400">View recent query logs and execution history.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </motion.div>

      {/* Filters */}
      <motion.div variants={item}>
        <GlassCard>
          <GlassCardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search className="h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search queries..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-white/5"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <Select value={logType} onValueChange={setLogType}>
                  <SelectTrigger className="w-[150px] bg-white/5">
                    <SelectValue placeholder="Log type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="QueryFinish">Query Finish</SelectItem>
                    <SelectItem value="QueryStart">Query Start</SelectItem>
                    <SelectItem value="ExceptionWhileProcessing">Exceptions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                  <SelectTrigger className="w-[120px] bg-white/5">
                    <SelectValue placeholder="Limit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50 rows</SelectItem>
                    <SelectItem value="100">100 rows</SelectItem>
                    <SelectItem value="500">500 rows</SelectItem>
                    <SelectItem value="1000">1000 rows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </GlassCardContent>
        </GlassCard>
      </motion.div>

      {/* Logs Table */}
      <motion.div variants={item} className="flex-1">
        <GlassCard className="h-full">
          <GlassCardHeader>
            <GlassCardTitle>
              Logs ({filteredLogs.length} entries)
            </GlassCardTitle>
          </GlassCardHeader>
          <GlassCardContent className="h-[calc(100%-60px)]">
            {error ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-red-400">{error.message}</p>
              </div>
            ) : (
              <AgGridReact
                rowData={filteredLogs}
                columnDefs={columnDefs}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                  resizable: true,
                }}
                modules={[AllCommunityModule]}
                theme={gridTheme}
                pagination={true}
                paginationPageSize={50}
                enableCellTextSelection={true}
                loading={isLoading}
              />
            )}
          </GlassCardContent>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
