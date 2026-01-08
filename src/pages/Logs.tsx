import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  RefreshCw,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Pause,
  Download,
  BarChart3,
  Timer,
  Database,
  User,
  Zap,
  ChevronDown,
  ChevronUp,
  Copy,
  ArrowUpDown,
} from "lucide-react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, themeBalham, colorSchemeDark, ColDef } from "ag-grid-community";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/components/common/theme-provider";
import { useQueryLogs } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";

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

// Summary stat component
interface LogStatProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

const LogStat: React.FC<LogStatProps> = ({ title, value, icon: Icon, color, bgColor }) => (
  <div className={cn("flex items-center gap-3 p-3 rounded-xl", bgColor)}>
    <Icon className={cn("h-4 w-4", color)} />
    <div>
      <p className="text-xs text-gray-400">{title}</p>
      <p className="text-lg font-bold text-white">{value}</p>
    </div>
  </div>
);

// Query detail modal/expanded view
interface QueryDetailProps {
  log: LogEntry;
  onClose: () => void;
}

const QueryDetail: React.FC<QueryDetailProps> = ({ log, onClose }) => {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="col-span-full bg-white/5 rounded-xl p-4 border border-white/10"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          {log.type === "QueryFinish" ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : log.type === "ExceptionWhileProcessing" ? (
            <XCircle className="h-5 w-5 text-red-500" />
          ) : (
            <Play className="h-5 w-5 text-blue-500" />
          )}
          <span className="font-medium text-white">{log.type}</span>
          <Badge variant="secondary" className="text-xs bg-white/10">
            {log.query_id.slice(0, 8)}...
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronUp className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Query */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Query</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => copyToClipboard(log.query)}
            >
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
          <pre className="bg-black/30 rounded-lg p-3 text-sm text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {log.query}
          </pre>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Duration</p>
            <p className="font-mono text-white">{log.query_duration_ms}ms</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Rows Read</p>
            <p className="font-mono text-white">{log.read_rows.toLocaleString()}</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Data Read</p>
            <p className="font-mono text-white">{(log.read_bytes / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Memory</p>
            <p className="font-mono text-white">{(log.memory_usage / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        </div>

        {/* Exception if exists */}
        {log.exception && (
          <div>
            <span className="text-xs text-red-400 uppercase tracking-wider">Exception</span>
            <pre className="mt-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-300 font-mono overflow-x-auto whitespace-pre-wrap">
              {log.exception}
            </pre>
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {log.user}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {log.event_date} {log.event_time}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default function Logs() {
  const { theme } = useTheme();
  const { isAdmin, username } = useAuthStore();
  const [limit, setLimit] = useState(100);
  const [searchTerm, setSearchTerm] = useState("");
  const [logType, setLogType] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Non-admin users only see their own queries
  const usernameFilter = isAdmin ? undefined : username || undefined;
  const { data: logs = [], isLoading, refetch, error, dataUpdatedAt } = useQueryLogs(limit, usernameFilter);

  // Auto refresh
  React.useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => refetch(), 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refetch]);

  const gridTheme = theme === "light" ? themeBalham : themeBalham.withPart(colorSchemeDark);

  const columnDefs: ColDef<LogEntry>[] = [
    {
      headerName: "Status",
      field: "type",
      width: 100,
      cellRenderer: (params: { value: string }) => {
        const type = params.value;
        if (type === "QueryFinish") return "✅ Success";
        if (type === "ExceptionWhileProcessing") return "❌ Error";
        return "🔄 Running";
      },
    },
    { headerName: "Time", field: "event_time", width: 100 },
    { headerName: "User", field: "user", width: 100 },
    { headerName: "Query", field: "query", flex: 2, tooltipField: "query" },
    {
      headerName: "Duration",
      field: "query_duration_ms",
      width: 100,
      type: "numericColumn",
      valueFormatter: (params) => `${params.value}ms`,
    },
    {
      headerName: "Rows",
      field: "read_rows",
      width: 100,
      type: "numericColumn",
      valueFormatter: (params) => params.value?.toLocaleString(),
    },
    { headerName: "Exception", field: "exception", flex: 1 },
  ];

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesSearch =
        !searchTerm ||
        log.query?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.query_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.user?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = logType === "all" || log.type === logType;
      return matchesSearch && matchesType;
    });
  }, [logs, searchTerm, logType]);

  // Summary stats
  const stats = useMemo(() => {
    const total = filteredLogs.length;
    const success = filteredLogs.filter((l) => l.type === "QueryFinish").length;
    const failed = filteredLogs.filter((l) => l.type === "ExceptionWhileProcessing").length;
    const running = filteredLogs.filter((l) => l.type === "QueryStart").length;
    const avgDuration =
      total > 0
        ? Math.round(filteredLogs.reduce((sum, l) => sum + (l.query_duration_ms || 0), 0) / total)
        : 0;
    return { total, success, failed, running, avgDuration };
  }, [filteredLogs]);

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "--:--:--";

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 space-y-6 flex flex-col h-full">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-between items-start flex-wrap gap-4"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg shadow-blue-500/20">
              <FileText className="h-7 w-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight text-white">Query Logs</h1>
                {!isAdmin && username && (
                  <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    <User className="h-3 w-3 mr-1" />
                    Your queries only
                  </Badge>
                )}
              </div>
              <p className="text-gray-400 text-sm flex items-center gap-2">
                <Clock className="h-3 w-3" />
                Last updated: {lastUpdated}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={cn(
                "gap-2",
                autoRefresh
                  ? "bg-green-500/20 border-green-500/30 text-green-400"
                  : "bg-white/5 border-white/10"
              )}
            >
              {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {autoRefresh ? "Stop Auto" : "Auto Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="gap-2 bg-white/5 border-white/10"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {/* Summary Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-5 gap-3"
        >
          <LogStat
            title="Total Queries"
            value={stats.total}
            icon={Database}
            color="text-blue-400"
            bgColor="bg-blue-500/10"
          />
          <LogStat
            title="Successful"
            value={stats.success}
            icon={CheckCircle2}
            color="text-green-400"
            bgColor="bg-green-500/10"
          />
          <LogStat
            title="Failed"
            value={stats.failed}
            icon={XCircle}
            color="text-red-400"
            bgColor="bg-red-500/10"
          />
          <LogStat
            title="Running"
            value={stats.running}
            icon={Zap}
            color="text-amber-400"
            bgColor="bg-amber-500/10"
          />
          <LogStat
            title="Avg Duration"
            value={`${stats.avgDuration}ms`}
            icon={Timer}
            color="text-purple-400"
            bgColor="bg-purple-500/10"
          />
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex flex-wrap gap-3 p-4 rounded-xl bg-white/5 border border-white/10"
        >
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search queries, users, IDs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white/5 border-white/10"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <Select value={logType} onValueChange={setLogType}>
              <SelectTrigger className="w-[140px] bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="QueryFinish">Success</SelectItem>
                <SelectItem value="QueryStart">Running</SelectItem>
                <SelectItem value="ExceptionWhileProcessing">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
            <SelectTrigger className="w-[120px] bg-white/5 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 rows</SelectItem>
              <SelectItem value="100">100 rows</SelectItem>
              <SelectItem value="500">500 rows</SelectItem>
              <SelectItem value="1000">1000 rows</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("grid")}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("table")}
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3"
            >
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <p className="text-red-400">{error.message}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Logs Content */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex-1 rounded-xl bg-white/5 border border-white/10 overflow-hidden"
        >
          {viewMode === "table" ? (
            <div className="h-full">
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
            </div>
          ) : (
            <div className="h-full overflow-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <RefreshCw className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Loading logs...</span>
                  </div>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                  <FileText className="h-16 w-16 opacity-20 mb-4" />
                  <p className="text-lg font-medium">No logs found</p>
                  <p className="text-sm">Try adjusting your filters</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLogs.map((log, i) => (
                    <React.Fragment key={log.query_id + i}>
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.5) }}
                        onClick={() => setExpandedLog(expandedLog === log.query_id ? null : log.query_id)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-xl cursor-pointer",
                          "bg-white/5 hover:bg-white/10 transition-all",
                          "border border-transparent hover:border-white/10",
                          expandedLog === log.query_id && "border-white/20 bg-white/10"
                        )}
                      >
                        {/* Status Icon */}
                        <div className="flex-shrink-0">
                          {log.type === "QueryFinish" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : log.type === "ExceptionWhileProcessing" ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <Zap className="h-4 w-4 text-amber-500" />
                          )}
                        </div>

                        {/* Query Preview */}
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm text-gray-300 font-mono truncate">{log.query}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {log.user}
                            </span>
                            <span className="flex items-center gap-1">
                              <Timer className="h-3 w-3" />
                              {log.query_duration_ms}ms
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {log.event_time}
                            </span>
                          </div>
                        </div>

                        {/* Expand Icon */}
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-gray-500 transition-transform",
                            expandedLog === log.query_id && "rotate-180"
                          )}
                        />
                      </motion.div>

                      <AnimatePresence>
                        {expandedLog === log.query_id && (
                          <QueryDetail log={log} onClose={() => setExpandedLog(null)} />
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
