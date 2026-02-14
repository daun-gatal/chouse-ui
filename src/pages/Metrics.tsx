import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  RefreshCw,
  Clock,
  HardDrive,
  MemoryStick,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Server,
  Database,
  Timer,
  BarChart3,
  Users,
  Play,
  Pause,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Layers,
  Table2,
  ArrowUpDown,
  Gauge,
  CircleDot,
  AlertCircle,
  Combine,
  FileStack,
  Percent,
  Network,
  GitMerge,
  HardDriveDownload,
  Disc,
  Cpu,
  FileText,
  Wifi,
  Cloud,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import UPlotMetricItemComponent from "@/features/metrics/components/UPlotMetricItemComponent";
import { useMetrics, useProductionMetrics } from "@/hooks";
import { cn, formatBytes as formatBytesUtil, formatCompactNumber, formatNumber } from "@/lib/utils";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

interface StatCardProps {
  title: string;
  value: string;
  unit?: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  trend?: number;
  isLoading?: boolean;
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  icon: Icon,
  color,
  bgColor,
  trend,
  isLoading,
  subtitle,
}) => {
  const TrendIcon = trend && trend > 0 ? TrendingUp : trend && trend < 0 ? TrendingDown : Minus;
  const trendColor = trend && trend > 0 ? "text-green-400" : trend && trend < 0 ? "text-red-400" : "text-gray-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 p-4",
        "bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl",
        "hover:border-white/20 transition-all duration-300 group"
      )}
    >
      <div className={cn("absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20", bgColor)} />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-2">
          <div className={cn("p-2 rounded-xl", bgColor)}>
            <Icon className={cn("h-4 w-4", color)} />
          </div>
          {trend !== undefined && (
            <div className={cn("flex items-center gap-1 text-xs", trendColor)}>
              <TrendIcon className="h-3 w-3" />
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </div>
          )}
        </div>

        <div className="space-y-0.5">
          <p className="text-xs text-gray-400">{title}</p>
          {isLoading ? (
            <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-white">{value}</span>
              {unit && <span className="text-xs text-gray-500">{unit}</span>}
            </div>
          )}
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
    </motion.div>
  );
};

interface MetricData {
  timestamps: number[];
  values: number[] | number[][]; // Support both single and multi-series
  labels?: string[]; // Labels for each series
  colors?: string[]; // Explicit colors for each series
}

interface MetricChartCardProps {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  data?: MetricData;
  isLoading: boolean;
  chartTitle: string;
  hideLatestValues?: boolean;
}

const MetricChartCard: React.FC<MetricChartCardProps> = ({
  title,
  subtitle,
  icon: Icon,
  color,
  data,
  isLoading,
  chartTitle,
  hideLatestValues = false,
}) => {
  const colorMap: Record<string, string> = {
    amber: "bg-amber-500/20 text-amber-400",
    purple: "bg-purple-500/20 text-purple-400",
    blue: "bg-blue-500/20 text-blue-400",
    emerald: "bg-emerald-500/20 text-emerald-400",
    red: "bg-red-500/20 text-red-400",
    cyan: "bg-cyan-500/20 text-cyan-400",
    orange: "bg-orange-500/20 text-orange-400",
    pink: "bg-pink-500/20 text-pink-400",
  };

  const iconColors = colorMap[color] || colorMap.blue;
  const [bgClass, textClass] = iconColors.split(" ");

  // Normalize data to multi-series format
  const normalizedValues = data ? (Array.isArray(data.values[0]) ? data.values as number[][] : [data.values as number[]]) : [];
  const normalizedLabels = data?.labels || [chartTitle];
  // Generate colors if not provided
  const baseColorHex = {
    amber: "#f59e0b",
    purple: "#a855f7",
    blue: "#3b82f6",
    emerald: "#10b981",
    red: "#ef4444",
    cyan: "#06b6d4",
    orange: "#f97316",
    pink: "#ec4899",
  }[color] || "#3b82f6";

  const normalizedColors = data?.colors || [baseColorHex];

  const formatValue = (val: number | undefined) => {
    if (val === undefined) return "-";
    if (chartTitle.includes("Bytes")) return formatBytes(val);
    if (chartTitle.includes("%")) return `${val?.toFixed(1)}%`;
    if (chartTitle.includes("ms")) return `${val?.toFixed(1)}ms`;
    if (chartTitle.includes("Connections") || chartTitle === "Conn") return Math.round(val).toString();
    return formatCompactNumber(val);
  };

  const unit = chartTitle.replace("Bytes", "").replace("%", "").replace("ms", "");

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10",
        "bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl",
        "hover:border-white/20 transition-all duration-300"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", bgClass)}>
            <Icon className={cn("h-4 w-4", textClass)} />
          </div>
          <div>
            <h3 className="font-semibold text-white">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>

        {/* Render Latest Value Cards */}
        {data && normalizedValues.length > 0 && !hideLatestValues && (
          <div className="flex items-center gap-3">
            {normalizedValues.map((series, idx) => {
              const latestVal = series[series.length - 1];
              // For single series, don't show label unless it differs from chart title
              const showLabel = normalizedValues.length > 1;

              return (
                <div key={idx} className="flex flex-col items-end">
                  {showLabel && (
                    <span className="text-xs text-gray-500 mb-0.5" style={{ color: normalizedColors[idx % normalizedColors.length] }}>
                      {normalizedLabels[idx] || `Series ${idx + 1}`}
                    </span>
                  )}
                  <div className={cn(
                    "flex items-baseline gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10",
                    !showLabel && "bg-transparent border-none p-0"
                  )}>
                    {!showLabel && (
                      <Badge variant="outline" className="mr-2 bg-white/5 text-gray-400 border-white/10 font-mono text-[10px] px-1 h-5">
                        Latest
                      </Badge>
                    )}
                    <span className={cn("font-bold text-white", showLabel ? "text-sm" : "text-xl")}>
                      {formatValue(latestVal)}
                    </span>
                    <span className="text-[10px] text-gray-500 font-normal">
                      {unit}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-[250px] p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="h-8 w-8 text-gray-500 animate-spin" />
              <span className="text-sm text-gray-500">Loading metrics...</span>
            </div>
          </div>
        ) : data && data.timestamps.length > 0 ? (
          <UPlotMetricItemComponent
            data={{
              ...data,
              values: normalizedValues,
              labels: normalizedLabels,
              colors: normalizedColors
            }}
            title={chartTitle}
            colors={normalizedColors}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <BarChart3 className="h-12 w-12 opacity-30" />
              <span className="text-sm">No data available</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// Format uptime in human readable format
const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
};

// Format bytes to readable size
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Format milliseconds to readable time
const formatMs = (ms: number): string => {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

// Get interval minutes from time range string
const getIntervalMinutes = (timeRange: string): number => {
  const config: Record<string, number> = {
    '15m': 15,
    '1h': 60,
    '6h': 360,
    '24h': 1440,
  };
  return config[timeRange] || 60;
};

interface MetricsProps {
  embedded?: boolean;
  refreshKey?: number;
  autoRefresh?: boolean;
  timeRange?: string;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

export default function Metrics({
  embedded = false,
  refreshKey,
  autoRefresh: externalAutoRefresh = false,
  timeRange: externalTimeRange = "1h",
  onRefreshChange
}: MetricsProps) {
  const { hasPermission } = useRbacStore();
  const hasAdvancedMetrics = hasPermission(RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED);

  const [internalRefreshInterval, setInternalRefreshInterval] = useState<number>(0);
  const [internalTimeRange, setInternalTimeRange] = useState<string>("1h");
  const [activeTab, setActiveTab] = useState("overview");
  const [isRefreshCooldown, setIsRefreshCooldown] = useState(false);

  // Use external timeRange if embedded, otherwise internal
  const timeRange = embedded ? externalTimeRange : internalTimeRange;

  // Use external autoRefresh if embedded (fixed 10s), otherwise internal
  const refreshInterval = embedded
    ? (externalAutoRefresh ? 10 : 0)
    : internalRefreshInterval;

  // Ensure users without advanced permission can't access advanced tabs
  React.useEffect(() => {
    if (!hasAdvancedMetrics && activeTab !== "overview") {
      setActiveTab("overview");
    }
  }, [hasAdvancedMetrics, activeTab]);

  const intervalMinutes = getIntervalMinutes(timeRange);

  const { data: metrics, isLoading, isFetching, refetch, error, dataUpdatedAt } = useMetrics(timeRange, {
    refetchInterval: refreshInterval > 0 ? refreshInterval * 1000 : false,
    refetchOnWindowFocus: false,
  });

  const {
    data: prodMetrics,
    isLoading: prodLoading,
    isFetching: prodFetching,
    refetch: refetchProd
  } = useProductionMetrics(intervalMinutes, {
    refetchInterval: refreshInterval > 0 ? refreshInterval * 1000 : false,
    refetchOnWindowFocus: false,
  });

  // Combined loading/fetching state
  const isAnyLoading = isLoading || prodLoading;
  const isAnyFetching = isFetching || prodFetching;

  // Notify parent of refresh status change
  React.useEffect(() => {
    onRefreshChange?.(isAnyFetching);
  }, [isAnyFetching, onRefreshChange]);

  // Debounced refresh
  const handleRefresh = React.useCallback(() => {
    if (isRefreshCooldown || isAnyFetching) return;
    setIsRefreshCooldown(true);
    refetch();
    refetchProd();
    setTimeout(() => setIsRefreshCooldown(false), 3000);
  }, [isRefreshCooldown, isAnyFetching, refetch, refetchProd]);

  // Calculate QPS trend
  const qpsTrend = useMemo(() => {
    const data = metrics?.queriesPerSecond;
    if (!data || data.values.length < 2) return 0;
    const latest = data.values[data.values.length - 1];
    const prev = data.values[Math.max(0, data.values.length - 5)];
    return prev !== 0 ? ((latest - prev) / prev) * 100 : 0;
  }, [metrics?.queriesPerSecond]);

  // Manual refresh effect from prop
  React.useEffect(() => {
    if (refreshKey) {
      refetch();
      refetchProd();
    }
  }, [refreshKey, refetch, refetchProd]);

  // Listen for connection changes and refetch metrics
  React.useEffect(() => {
    const handleConnectionChange = () => {
      refetch();
      refetchProd();
    };

    window.addEventListener('clickhouse:connected', handleConnectionChange);
    return () => window.removeEventListener('clickhouse:connected', handleConnectionChange);
  }, [refetch, refetchProd]);

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "--:--:--";
  const stats = metrics?.currentStats;

  // Transform insert throughput data for chart
  const insertThroughputData = useMemo(() => {
    if (!prodMetrics?.insertThroughput?.length) return undefined;
    return {
      timestamps: prodMetrics.insertThroughput.map(d => d.timestamp),
      values: prodMetrics.insertThroughput.map(d => d.rows_per_second),
    };
  }, [prodMetrics?.insertThroughput]);

  // Transform memory history data for chart
  const memoryHistoryData = useMemo(() => {
    if (!prodMetrics?.memory_history?.length) return undefined;
    return {
      timestamps: prodMetrics.memory_history.map(d => d.timestamp),
      values: prodMetrics.memory_history.map(d => d.memory_resident_gb),
    };
  }, [prodMetrics?.memory_history]);

  // Transform System history data for charts
  const activeQueriesData = useMemo(() => {
    if (!prodMetrics?.system_history?.length) return undefined;
    return {
      timestamps: prodMetrics.system_history.map(d => d.timestamp),
      values: prodMetrics.system_history.map(d => d.queries),
    };
  }, [prodMetrics?.system_history]);

  const activePartsData = useMemo(() => {
    if (!prodMetrics?.system_history?.length) return undefined;
    return {
      timestamps: prodMetrics.system_history.map(d => d.timestamp),
      values: prodMetrics.system_history.map(d => d.parts),
    };
  }, [prodMetrics?.system_history]);

  const activeMergesData = useMemo(() => {
    if (!prodMetrics?.system_history?.length) return undefined;
    return {
      timestamps: prodMetrics.system_history.map(d => d.timestamp),
      values: prodMetrics.system_history.map(d => d.merges),
    };
  }, [prodMetrics?.system_history]);

  const activeMutationsData = useMemo(() => {
    if (!prodMetrics?.system_history?.length) return undefined;
    return {
      timestamps: prodMetrics.system_history.map(d => d.timestamp),
      values: prodMetrics.system_history.map(d => d.mutations),
    };
  }, [prodMetrics?.system_history]);



  // Get primary disk stats
  const primaryDisk = prodMetrics?.disks?.[0];

  // ===== NEW COMPREHENSIVE METRICS DATA TRANSFORMATIONS =====

  // CPU Breakdown Data (for stacked area chart)
  const cpuBreakdownData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: [
        prodMetrics.performance_history.map(d => d.cpu_user * 100),
        prodMetrics.performance_history.map(d => d.cpu_system * 100),
        prodMetrics.performance_history.map(d => d.cpu_wait * 100),
        prodMetrics.performance_history.map(d => d.cpu_io_wait * 100),
      ],
      labels: ['User', 'System', 'Wait', 'IO Wait'],
      colors: ['#10b981', '#3b82f6', '#ef4444', '#f59e0b'],
    };
  }, [prodMetrics?.performance_history]);

  // Query Throughput Data
  const queryThroughputData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: [
        prodMetrics.performance_history.map(d => d.queries_per_sec),
        prodMetrics.performance_history.map(d => d.selected_rows_per_sec),
      ],
      labels: ['Queries/s', 'Rows/s'],
      colors: ['#3b82f6', '#10b981'],
    };
  }, [prodMetrics?.performance_history]);

  // Data Throughput (bytes)
  const dataThroughputData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      datasets: [
        { label: 'Selected Bytes/sec', values: prodMetrics.performance_history.map(d => d.selected_bytes_per_sec) },
        { label: 'Inserted Bytes/sec', values: prodMetrics.performance_history.map(d => d.inserted_bytes_per_sec) },
        { label: 'Read from Disk', values: prodMetrics.performance_history.map(d => d.read_from_disk_bytes_per_sec) },
        { label: 'Read from FS', values: prodMetrics.performance_history.map(d => d.read_from_fs_bytes_per_sec) },
      ],
    };
  }, [prodMetrics?.performance_history]);

  // Process Throughput (rows)
  const processThroughputData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: [
        prodMetrics.performance_history.map(d => d.inserted_rows_per_sec),
        prodMetrics.performance_history.map(d => d.merged_rows_per_sec),
      ],
      labels: ['Inserted Rows/s', 'Merged Rows/s'],
      colors: ['#10b981', '#3b82f6'],
    };
  }, [prodMetrics?.performance_history]);

  //  Detailed Memory Breakdown Data
  const memoryBreakdownData = useMemo(() => {
    if (!prodMetrics?.detailed_memory_history?.length) return undefined;
    return {
      timestamps: prodMetrics.detailed_memory_history.map(d => d.timestamp),
      values: [
        prodMetrics.detailed_memory_history.map(d => d.memory_resident),
        prodMetrics.detailed_memory_history.map(d => d.memory_tracking),
        prodMetrics.detailed_memory_history.map(d => d.cache_bytes),
        prodMetrics.detailed_memory_history.map(d => d.primary_key_memory),
        prodMetrics.detailed_memory_history.map(d => d.index_granularity_memory),
      ],
      labels: ['OS RSS', 'Tracked', 'Cache', 'Primary Keys', 'Index Granularity'],
      colors: ['#a855f7', '#3b82f6', '#10b981', '#ec4899', '#f59e0b'],
    };
  }, [prodMetrics?.detailed_memory_history]);

  // Allocator Memory Data
  const allocatorMemoryData = useMemo(() => {
    if (!prodMetrics?.detailed_memory_history?.length) return undefined;
    return {
      timestamps: prodMetrics.detailed_memory_history.map(d => d.timestamp),
      values: [
        prodMetrics.detailed_memory_history.map(d => d.jemalloc_allocated),
        prodMetrics.detailed_memory_history.map(d => d.jemalloc_resident),
      ],
      labels: ['Allocated', 'Resident'],
      colors: ['#10b981', '#06b6d4'],
    };
  }, [prodMetrics?.detailed_memory_history]);

  // Storage/Cache Metrics
  const s3TrafficData = useMemo(() => {
    if (!prodMetrics?.storage_cache_history?.length) return undefined;
    return {
      timestamps: prodMetrics.storage_cache_history.map(d => d.timestamp),
      values: prodMetrics.storage_cache_history.map(d => d.s3_read_bytes_per_sec),
    };
  }, [prodMetrics?.storage_cache_history]);

  const s3LatencyData = useMemo(() => {
    if (!prodMetrics?.storage_cache_history?.length) return undefined;
    return {
      timestamps: prodMetrics.storage_cache_history.map(d => d.timestamp),
      values: prodMetrics.storage_cache_history.map(d => d.s3_read_microseconds / 1000), // Convert to ms
    };
  }, [prodMetrics?.storage_cache_history]);

  const cacheHitRateData = useMemo(() => {
    if (!prodMetrics?.storage_cache_history?.length) return undefined;
    return {
      timestamps: prodMetrics.storage_cache_history.map(d => d.timestamp),
      values: [
        prodMetrics.storage_cache_history.map(d => d.fs_cache_hit_rate * 100),
        prodMetrics.storage_cache_history.map(d => d.page_cache_hit_rate * 100),
      ],
      labels: ['FS Cache', 'Page Cache'],
      colors: ['#10b981', '#06b6d4'],
    };
  }, [prodMetrics?.storage_cache_history]);

  // Concurrency Metrics
  const concurrencyData = useMemo(() => {
    if (!prodMetrics?.concurrency_history?.length) return undefined;
    return {
      timestamps: prodMetrics.concurrency_history.map(d => d.timestamp),
      values: [
        prodMetrics.concurrency_history.map(d => d.running_queries),
        prodMetrics.concurrency_history.map(d => d.running_merges),
      ],
      labels: ['Running Queries', 'Running Merges'],
      colors: ['#a855f7', '#3b82f6'],
    };
  }, [prodMetrics?.concurrency_history]);

  const networkConnectionsData = useMemo(() => {
    if (!prodMetrics?.concurrency_history?.length) return undefined;
    return {
      timestamps: prodMetrics.concurrency_history.map(d => d.timestamp),
      values: [
        prodMetrics.concurrency_history.map(d => d.tcp_connections),
        prodMetrics.concurrency_history.map(d => d.http_connections),
        prodMetrics.concurrency_history.map(d => d.interserver_connections),
        prodMetrics.concurrency_history.map(d => d.mysql_connections || 0),
      ],
      labels: ['TCP', 'HTTP', 'Interserver', 'MySQL'],
      colors: ['#3b82f6', '#10b981', '#f59e0b', '#06b6d4'],
    };
  }, [prodMetrics?.concurrency_history]);

  const diskUsageStats = useMemo(() => {
    if (!prodMetrics?.disks) return { total: 0, used: 0 };
    return prodMetrics.disks.reduce((acc, disk) => ({
      total: acc.total + disk.total_space,
      used: acc.used + disk.used_space
    }), { total: 0, used: 0 });
  }, [prodMetrics?.disks]);

  const networkThroughputData = useMemo(() => {
    if (!prodMetrics?.network_history?.length) return undefined;
    return {
      timestamps: prodMetrics.network_history.map(d => d.timestamp),
      values: [
        prodMetrics.network_history.map(d => d.network_send_speed || 0), // Bytes/s
        prodMetrics.network_history.map(d => d.network_receive_speed || 0), // Bytes/s
      ],
      labels: ['Sent (Bytes/s)', 'Received (Bytes/s)'],
      colors: ['#3b82f6', '#10b981'],
    };
  }, [prodMetrics?.network_history]);

  const partsData = useMemo(() => {
    if (!prodMetrics?.concurrency_history?.length) return undefined;
    return {
      timestamps: prodMetrics.concurrency_history.map(d => d.timestamp),
      values: [
        prodMetrics.concurrency_history.map(d => d.total_mergetree_parts),
        prodMetrics.concurrency_history.map(d => d.max_parts_per_partition),
      ],
      labels: ['Total Parts', 'Max Parts/Partition'],
      colors: ['#a855f7', '#ef4444'],
    };
  }, [prodMetrics?.concurrency_history]);

  const mergeQueueData = useMemo(() => {
    if (!prodMetrics?.merges_history?.length) return undefined;
    return {
      timestamps: prodMetrics.merges_history.map(d => d.timestamp),
      values: [
        prodMetrics.merges_history.map(d => d.merges_running),
        prodMetrics.merges_history.map(d => d.mutations_running),
      ],
      labels: ['Merges', 'Mutations'],
      colors: ['#a855f7', '#f59e0b'],
    };
  }, [prodMetrics?.merges_history]);

  const mergeThroughputData = useMemo(() => {
    if (!prodMetrics?.merges_history?.length) return undefined;
    return {
      timestamps: prodMetrics.merges_history.map(d => d.timestamp),
      values: [
        prodMetrics.merges_history.map(d => d.merged_rows_per_sec),
      ],
      labels: ['Rows/s'],
      colors: ['#06b6d4'],
    };
  }, [prodMetrics?.merges_history]);




  return (
    <div className="h-full overflow-hidden">
      <div className={cn(
        "mx-auto space-y-6 flex flex-col h-full",
        embedded ? "p-4" : "p-6"
      )}>
        {/* Header - hidden when embedded */}
        {!embedded && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-between items-start flex-wrap gap-4"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
                  <Activity className="h-7 w-7 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-white">
                    Metrics Dashboard
                  </h1>
                  <p className="text-gray-400 text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Production-grade monitoring
                  </p>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <Timer className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-400">{lastUpdated}</span>
              </div>

              <Select value={internalTimeRange} onValueChange={setInternalTimeRange}>
                <SelectTrigger className="w-[130px] bg-white/5 border-white/10">
                  <Clock className="h-4 w-4 mr-2 text-gray-400" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15m">15 minutes</SelectItem>
                  <SelectItem value="1h">1 hour</SelectItem>
                  <SelectItem value="6h">6 hours</SelectItem>
                  <SelectItem value="24h">24 hours</SelectItem>
                </SelectContent>
              </Select>

              <Select value={String(internalRefreshInterval)} onValueChange={(v) => setInternalRefreshInterval(Number(v))}>
                <SelectTrigger className="w-[140px] bg-white/5 border-white/10">
                  {refreshInterval > 0 ? (
                    <Play className="h-4 w-4 mr-2 text-green-400" />
                  ) : (
                    <Pause className="h-4 w-4 mr-2 text-gray-400" />
                  )}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Manual</SelectItem>
                  <SelectItem value="10">Every 10s</SelectItem>
                  <SelectItem value="30">Every 30s</SelectItem>
                  <SelectItem value="60">Every 60s</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={isAnyFetching || isRefreshCooldown}
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
              >
                <RefreshCw className={cn("h-4 w-4", isAnyFetching && "animate-spin")} />
                {isRefreshCooldown ? "Wait..." : "Refresh"}
              </Button>
            </div>
          </motion.div>
        )}

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <p className="text-red-400">{error.message}</p>
              </div>
              <Button variant="outline" onClick={handleRefresh} disabled={isRefreshCooldown} className="border-red-500/30 text-red-400">
                Retry
              </Button>
            </motion.div>
          )}
        </AnimatePresence>



        {/* Tabs for different metric views - hidden if only Overview is available */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 space-y-4">
          {hasAdvancedMetrics && (
            <TabsList className="bg-white/10 border border-white/10 p-1 w-fit rounded-xl justify-start backdrop-blur-md self-start">
              <TabsTrigger
                value="overview"
                className={cn(
                  "rounded-lg gap-2 px-4 transition-all duration-300",
                  "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                  "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                  "hover:bg-white/5 active:scale-95"
                )}
              >
                <BarChart3 className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <>
                <TabsTrigger
                  value="performance"
                  className={cn(
                    "rounded-lg gap-2 px-4 transition-all duration-300",
                    "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                    "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                    "hover:bg-white/5 active:scale-95"
                  )}
                >
                  <Gauge className="h-4 w-4" />
                  Performance
                </TabsTrigger>
                <TabsTrigger
                  value="storage"
                  className={cn(
                    "rounded-lg gap-2 px-4 transition-all duration-300",
                    "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                    "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                    "hover:bg-white/5 active:scale-95"
                  )}
                >
                  <HardDrive className="h-4 w-4" />
                  Storage
                </TabsTrigger>
                <TabsTrigger
                  value="merges"
                  className={cn(
                    "rounded-lg gap-2 px-4 transition-all duration-300",
                    "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                    "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                    "hover:bg-white/5 active:scale-95"
                  )}
                >
                  <GitMerge className="h-4 w-4" />
                  Merges
                </TabsTrigger>
                <TabsTrigger
                  value="errors"
                  className={cn(
                    "rounded-lg gap-2 px-4 transition-all duration-300",
                    "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                    "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                    "hover:bg-white/5 active:scale-95"
                  )}
                >
                  <AlertCircle className="h-4 w-4" />
                  Errors
                </TabsTrigger>
                <TabsTrigger
                  value="system"
                  className={cn(
                    "rounded-lg gap-2 px-4 transition-all duration-300",
                    "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                    "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                    "hover:bg-white/5 active:scale-95"
                  )}
                >
                  <Cpu className="h-4 w-4" />
                  System
                </TabsTrigger>

                <TabsTrigger
                  value="network"
                  className={cn(
                    "rounded-lg gap-2 px-4 transition-all duration-300",
                    "data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400",
                    "data-[state=active]:shadow-[0_0_15px_rgba(16,185,129,0.1)]",
                    "hover:bg-white/5 active:scale-95"
                  )}
                >
                  <Network className="h-4 w-4" />
                  Network
                </TabsTrigger>
              </>
            </TabsList>
          )}

          {/* Overview Tab */}
          <TabsContent value="overview" className="flex-1 overflow-auto space-y-4 pr-1 min-h-0 data-[state=active]:flex flex-col">
            {/* System Health Grid - Refactored */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-3"
            >
              <StatCard
                title="Active Queries"
                value={String(stats?.activeQueries || 0)}
                icon={Zap}
                color="text-amber-400"
                bgColor="bg-amber-500/20"
                isLoading={isLoading}
              />
              <StatCard
                title="Active Connections"
                value={String(stats?.connections || 0)}
                icon={Server}
                color="text-blue-400"
                bgColor="bg-blue-500/20"
                isLoading={isLoading}
              />
              <StatCard
                title="Failed Queries"
                value={String(stats?.failedQueries || 0)}
                icon={AlertCircle}
                color="text-red-400"
                bgColor="bg-red-500/20"
                isLoading={isLoading}
              />
              <StatCard
                title="Uptime"
                value={formatUptime(stats?.uptime || 0)}
                icon={Timer}
                color="text-emerald-400"
                bgColor="bg-emerald-500/20"
                isLoading={isLoading}
              />
            </motion.div>
            {/* Secondary Stats Row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-3"
            >
              <StatCard
                title="Databases"
                value={String(stats?.databasesCount || 0)}
                icon={Database}
                color="text-blue-400"
                bgColor="bg-blue-500/20"
                isLoading={isLoading}
              />
              <StatCard
                title="Tables"
                value={String(stats?.tablesCount || 0)}
                icon={Layers}
                color="text-green-400"
                bgColor="bg-green-500/20"
                isLoading={isLoading}
              />
              <StatCard
                title="Size"
                value={formatBytes(stats?.totalBytes || 0)}
                icon={HardDrive}
                color="text-orange-400"
                bgColor="bg-orange-500/20"
                isLoading={isLoading}
              />
              <StatCard
                title="Total Rows"
                value={formatCompactNumber(stats?.totalRows || 0)}
                icon={Server}
                color="text-purple-400"
                bgColor="bg-purple-500/20"
                isLoading={isLoading}
              />
            </motion.div>

            {/* Resource & Activity Summary */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Resource Utilization */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 h-full"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <Activity className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Resource Utilization</h3>
                    <p className="text-xs text-gray-500">Current system resource usage</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* CPU */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">CPU Usage</span>
                      <span className="text-white font-medium">
                        {((cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)).toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={(cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)}
                      className={cn(
                        "h-2 bg-white/10",
                        ((cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)) > 80 ? "[&>div]:bg-red-500" :
                          ((cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)) > 60 ? "[&>div]:bg-orange-500" : "[&>div]:bg-emerald-500"
                      )}
                    />
                  </div>

                  {/* Disk */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Disk Usage</span>
                      <span className="text-white font-medium">
                        {primaryDisk ? primaryDisk.used_percent.toFixed(1) : "0"}%
                      </span>
                    </div>
                    <Progress
                      value={primaryDisk?.used_percent || 0}
                      className={cn(
                        "h-2 bg-white/10",
                        (primaryDisk?.used_percent || 0) > 90 ? "[&>div]:bg-red-500" :
                          (primaryDisk?.used_percent || 0) > 75 ? "[&>div]:bg-orange-500" : "[&>div]:bg-cyan-500"
                      )}
                    />
                  </div>

                  {/* Memory */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Memory Usage</span>
                      <span className="text-white font-medium">
                        {stats?.memoryPercentage?.toFixed(1) || 0}%
                      </span>
                    </div>
                    <Progress
                      value={stats?.memoryPercentage || 0}
                      className={cn(
                        "h-2 bg-white/10",
                        (stats?.memoryPercentage || 0) > 90 ? "[&>div]:bg-red-500" :
                          (stats?.memoryPercentage || 0) > 75 ? "[&>div]:bg-orange-500" : "[&>div]:bg-purple-500"
                      )}
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{stats?.memoryUsage?.toFixed(2) || "0"} GB used</span>
                      <span>{stats?.memoryTotal?.toFixed(2) || "0"} GB total</span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Activity Summary */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 h-full"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-amber-500/20">
                    <Zap className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Activity Summary</h3>
                    <p className="text-xs text-gray-500">Real-time system activity</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold text-white mb-1">
                      {formatCompactNumber(metrics?.queriesPerSecond?.values?.slice(-1)[0] || 0)}
                    </div>
                    <div className="text-xs text-gray-500">Queries/s</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold text-white mb-1">
                      {Number(prodMetrics?.merges?.merges_running || 0).toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500">Active Merges</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold text-white mb-1">
                      {prodMetrics?.resources?.background_pool_tasks || 0}
                    </div>
                    <div className="text-xs text-gray-500">Background Tasks</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-2xl font-bold text-white mb-1">
                      {formatCompactNumber(prodMetrics?.merges?.merged_rows_per_sec || 0)}
                    </div>
                    <div className="text-xs text-gray-500">Merged Rows/s</div>
                  </div>
                </div>
              </motion.div>

              {/* Recent Errors */}
              {prodMetrics?.errors && prodMetrics.errors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="rounded-2xl border border-red-500/20 bg-red-500/5 backdrop-blur-xl p-6 h-full"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-400" />
                      <h3 className="font-semibold text-white">Recent Errors</h3>
                    </div>
                    <Badge variant="destructive" className="bg-red-500/20 text-red-400 hover:bg-red-500/30">
                      {prodMetrics.errors.length} Issues
                    </Badge>
                  </div>
                  <div className="space-y-3">
                    {prodMetrics.errors.slice(0, 3).map((err, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/10">
                        <span className="text-sm font-medium text-red-400 truncate max-w-[180px]" title={err.exception_name}>
                          {err.exception_name}
                        </span>
                        <Badge variant="secondary" className="bg-red-950/30 text-red-300">
                          {err.count}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Largest Tables */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className={cn(
                  "rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 h-full",
                  (prodMetrics?.errors && prodMetrics.errors.length > 0) ? "" : "md:col-span-2"
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Table2 className="h-5 w-5 text-purple-400" />
                    <h3 className="font-semibold text-white">Largest Tables</h3>
                  </div>
                </div>
                <div className="space-y-2">
                  {prodMetrics?.topTables?.slice(0, 5).map((table, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-4">{idx + 1}.</span>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-white">{table.table}</span>
                          <span className="text-xs text-gray-500">{table.database}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-400">{formatCompactNumber(table.rows)} rows</span>
                        <Badge variant="secondary" className="bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          {table.compressed_size}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {(!prodMetrics?.topTables || prodMetrics.topTables.length === 0) && (
                    <div className="text-center py-4 text-gray-500 text-sm">No tables found</div>
                  )}
                </div>
              </motion.div>
            </div>
          </TabsContent>

          {/* Performance Tab - Advanced only */}
          {hasAdvancedMetrics && (
            <TabsContent value="performance" className="flex-1 overflow-auto grid gap-6 md:grid-cols-2 pr-1 min-h-0">


              {/* Query Latency Group */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-1 h-full"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <Timer className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Query Latency</h3>
                    <p className="text-xs text-gray-500">Response time analysis</p>
                  </div>
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <StatCard
                    title="Avg Latency"
                    value={formatMs(prodMetrics?.latency?.avg_ms || 0)}
                    icon={Timer}
                    color="text-blue-400"
                    bgColor="bg-blue-500/20"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="p50 Latency"
                    value={formatMs(prodMetrics?.latency?.p50_ms || 0)}
                    icon={Gauge}
                    color="text-green-400"
                    bgColor="bg-green-500/20"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Max Latency"
                    value={formatMs(prodMetrics?.latency?.max_ms || 0)}
                    icon={AlertTriangle}
                    color="text-red-400"
                    bgColor="bg-red-500/20"
                    isLoading={prodLoading}
                    subtitle="Worst case"
                  />
                  <StatCard
                    title="Slow Queries"
                    value={String(prodMetrics?.latency?.slow_queries_count || 0)}
                    subtitle=">1 second"
                    icon={AlertTriangle}
                    color="text-amber-400"
                    bgColor="bg-amber-500/20"
                    isLoading={prodLoading}
                  />
                </div>
              </motion.div>



              {/* Throughput & IO Group */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-1"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-orange-500/20">
                    <Activity className="h-5 w-5 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Throughput & IO</h3>
                    <p className="text-xs text-gray-500">Read/Write operations and background tasks</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    title="Read Rate"
                    value={formatBytes(prodMetrics?.resources?.read_rate || 0)}
                    unit="/s"
                    icon={HardDriveDownload}
                    color="text-cyan-400"
                    bgColor="bg-cyan-500/20"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Background Tasks"
                    value={String(prodMetrics?.resources?.background_pool_tasks || 0)}
                    icon={Layers}
                    color="text-green-400"
                    bgColor="bg-green-500/20"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Rows Selected"
                    value={formatCompactNumber(queryThroughputData?.values[1]?.slice(-1)[0] || 0)}
                    unit="/s"
                    icon={Database}
                    color="text-cyan-400"
                    bgColor="bg-cyan-500/20"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Rows Inserted"
                    value={formatCompactNumber(processThroughputData?.values[0]?.slice(-1)[0] || 0)}
                    unit="/s"
                    icon={HardDriveDownload}
                    color="text-emerald-400"
                    bgColor="bg-emerald-500/20"
                    isLoading={prodLoading}
                  />
                </div>
              </motion.div>

              {/* Detailed Analysis Group */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-2"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-indigo-500/20">
                    <Activity className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Detailed Analysis</h3>
                    <p className="text-xs text-gray-500">Historical throughput trends</p>
                  </div>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <MetricChartCard
                    title="Query Throughput"
                    subtitle="Queries and rows processed per second"
                    icon={Activity}
                    color="blue"
                    data={queryThroughputData}
                    isLoading={prodLoading}
                    chartTitle="Queries/s"
                    hideLatestValues
                  />
                  <MetricChartCard
                    title="Process Throughput"
                    subtitle="Rows inserted and merged per second"
                    icon={HardDriveDownload}
                    color="emerald"
                    data={processThroughputData}
                    isLoading={prodLoading}
                    chartTitle="Rows/s"
                    hideLatestValues
                  />
                </div>
              </motion.div>
            </TabsContent>
          )}

          {/* Storage Tab - Advanced only */}
          {hasAdvancedMetrics && (
            <TabsContent value="storage" className="flex-1 overflow-auto grid gap-6 md:grid-cols-3 pr-1 min-h-0">
              {/* Loading State */}
              {prodLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-8 text-center md:col-span-3"
                >
                  <RefreshCw className="h-8 w-8 text-gray-500 mx-auto mb-4 animate-spin" />
                  <p className="text-gray-400">Loading storage metrics...</p>
                </motion.div>
              )}

              {!prodLoading && (
                <>
                  {/* SECTION 1: DISK CAPACITY */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-cyan-500/20">
                        <HardDrive className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Disk Capacity</h3>
                        <p className="text-xs text-gray-500">Volume usage and availability</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard
                        title="Total Storage"
                        value={formatBytes(prodMetrics?.disks?.reduce((sum, d) => sum + d.total_space, 0) || 0)}
                        icon={HardDrive}
                        color="text-cyan-400"
                        bgColor="bg-cyan-500/20"
                        isLoading={false}
                      />
                      <StatCard
                        title="Used Storage"
                        value={formatBytes(prodMetrics?.disks?.reduce((sum, d) => sum + d.used_space, 0) || 0)}
                        icon={Database}
                        color="text-orange-400"
                        bgColor="bg-orange-500/20"
                        isLoading={false}
                      />
                      <StatCard
                        title="Free Storage"
                        value={formatBytes(prodMetrics?.disks?.reduce((sum, d) => sum + d.free_space, 0) || 0)}
                        icon={Server}
                        color="text-green-400"
                        bgColor="bg-green-500/20"
                        isLoading={false}
                      />
                      <StatCard
                        title="Disk Count"
                        value={String(prodMetrics?.disks?.length || 0)}
                        icon={Disc}
                        color="text-purple-400"
                        bgColor="bg-purple-500/20"
                        isLoading={false}
                      />
                    </div>
                  </motion.div>

                  {/* SECTION 2: MERJETREE HEALTH */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-indigo-500/20">
                        <Layers className="h-5 w-5 text-indigo-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">MergeTree Diagnostics</h3>
                        <p className="text-xs text-gray-500">Parts count and partition health</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <StatCard
                        title="Total Parts"
                        value={formatCompactNumber(prodMetrics?.resources?.total_parts || 0)}
                        icon={Layers}
                        color="text-indigo-400"
                        bgColor="bg-indigo-500/20"
                        isLoading={prodLoading}
                      />
                      <StatCard
                        title="Max Parts/Partition"
                        value={formatCompactNumber(prodMetrics?.resources?.max_parts_per_partition || 0)}
                        icon={AlertTriangle}
                        color={(prodMetrics?.resources?.max_parts_per_partition || 0) > 3000 ? "text-red-400" : "text-gray-400"}
                        bgColor={(prodMetrics?.resources?.max_parts_per_partition || 0) > 3000 ? "bg-red-500/20" : "bg-gray-500/20"}
                        isLoading={prodLoading}
                      />

                      {/* Total Rows Context */}
                      <StatCard
                        title="Total Rows"
                        value={formatCompactNumber(prodMetrics?.topTables?.reduce((sum, t) => sum + (t.rows || 0), 0) || 0)}
                        icon={List}
                        color="text-blue-400"
                        bgColor="bg-blue-500/20"
                        isLoading={prodLoading}
                      />
                    </div>
                  </motion.div>

                  {/* SECTION 3: DETAILED BREAKDOWN */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-white/5">
                        <List className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Detailed Breakdown</h3>
                        <p className="text-xs text-gray-500">Per-disk usage and largest tables</p>
                      </div>
                    </div>

                    {/* Disk Usage & Top Tables Grid */}
                    <div className="grid gap-6 lg:grid-cols-2">
                      {/* Disk Usage */}
                      <div>
                        <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                          <Disc className="h-4 w-4 text-cyan-400" />
                          Disk Usage
                        </h4>
                        {prodMetrics?.disks && prodMetrics.disks.length > 0 ? (
                          <div className="space-y-4">
                            {prodMetrics.disks.map((disk) => (
                              <div key={disk.name} className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <HardDrive className="h-4 w-4 text-gray-400" />
                                    <span className="text-white font-medium text-sm">{disk.name}</span>
                                    <span className="text-xs text-gray-500">{disk.path}</span>
                                  </div>
                                  <span className={cn(
                                    "text-sm font-medium",
                                    disk.used_percent > 90 ? "text-red-400" :
                                      disk.used_percent > 75 ? "text-orange-400" : "text-green-400"
                                  )}>
                                    {disk.used_percent.toFixed(1)}%
                                  </span>
                                </div>
                                <Progress
                                  value={disk.used_percent}
                                  className={cn(
                                    "h-2 bg-white/10",
                                    disk.used_percent > 90 && "[&>div]:bg-red-500",
                                    disk.used_percent > 75 && disk.used_percent <= 90 && "[&>div]:bg-orange-500"
                                  )}
                                />
                                <div className="flex justify-between text-xs text-gray-500">
                                  <span>Used: {formatBytes(disk.used_space)}</span>
                                  <span>Free: {formatBytes(disk.free_space)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <HardDrive className="h-10 w-10 text-gray-500 mx-auto mb-3 opacity-50" />
                            <p className="text-sm text-gray-400">No disk metrics available</p>
                          </div>
                        )}
                      </div>

                      {/* Top Tables */}
                      <div>
                        <h4 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                          <Table2 className="h-4 w-4 text-purple-400" />
                          Top Tables by Size
                        </h4>
                        {prodMetrics?.topTables && prodMetrics.topTables.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-white/10">
                                  <th className="text-left text-xs text-gray-400 font-medium pb-2">Table</th>
                                  <th className="text-right text-xs text-gray-400 font-medium pb-2">Size</th>
                                  <th className="text-right text-xs text-gray-400 font-medium pb-2">Parts</th>
                                </tr>
                              </thead>
                              <tbody>
                                {prodMetrics.topTables.slice(0, 5).map((table, idx) => (
                                  <tr key={`${table.database}.${table.table}`} className="border-b border-white/5">
                                    <td className="py-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 text-xs w-4">{idx + 1}.</span>
                                        <span className="text-white text-sm truncate max-w-[150px]" title={`${table.database}.${table.table}`}>
                                          {table.database}.<span className="text-blue-400">{table.table}</span>
                                        </span>
                                      </div>
                                    </td>
                                    <td className="text-right text-gray-300 text-sm">{table.compressed_size}</td>
                                    <td className="text-right">
                                      <Badge variant="secondary" className={cn(
                                        "bg-white/10 text-xs",
                                        table.parts_count > 100 ? "text-orange-400" : "text-gray-300"
                                      )}>
                                        {table.parts_count}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <Table2 className="h-10 w-10 text-gray-500 mx-auto mb-3 opacity-50" />
                            <p className="text-sm text-gray-400">No table data available</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* Cache Performance Group - Complete */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-emerald-500/20">
                        <Zap className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Cache Performance</h3>
                        <p className="text-xs text-gray-500">Filesystem and page cache efficiency</p>
                      </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-5">
                      {/* Cache Quick Stats - Clean sidebar */}
                      <div className="lg:col-span-1 flex flex-col justify-center gap-4">
                        <div className="flex-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-4 w-4 text-emerald-400" />
                            <span className="text-xs text-gray-400">FS Cache</span>
                          </div>
                          <div className="text-lg font-semibold text-white">
                            {cacheHitRateData?.values[0]?.slice(-1)[0]?.toFixed(1) || "0"}
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                        </div>
                        <div className="flex-1 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-4 w-4 text-cyan-400" />
                            <span className="text-xs text-gray-400">Page Cache</span>
                          </div>
                          <div className="text-lg font-semibold text-white">
                            {cacheHitRateData?.values[1]?.slice(-1)[0]?.toFixed(1) || "0"}
                            <span className="text-xs text-gray-400">%</span>
                          </div>
                        </div>
                      </div>

                      {/* Cache Chart - Wider */}
                      <div className="lg:col-span-4">
                        <MetricChartCard
                          title="Cache Hit Rates"
                          subtitle="Filesystem and Page cache hit rates"
                          icon={Zap}
                          color="emerald"
                          data={cacheHitRateData}
                          isLoading={prodLoading}
                          chartTitle="Hit Rate (%)"
                          hideLatestValues
                        />
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </TabsContent>
          )}

          {/* Merges Tab - Advanced only */}
          {hasAdvancedMetrics && (
            <TabsContent value="merges" className="flex-1 overflow-auto space-y-6 pr-1 min-h-0 data-[state=active]:flex flex-col">


              {/* SECTION 1: KPI COMMAND CENTER */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-indigo-500/20">
                    <Layers className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Merge Command Center</h3>
                    <p className="text-xs text-gray-500">Real-time background processing health & throughput</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <StatCard
                    title="Running Merges"
                    value={Number(prodMetrics?.merges?.merges_running || 0).toFixed(2)}
                    icon={GitMerge}
                    color="text-purple-400"
                    bgColor="bg-purple-500/10"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Active Mutations"
                    value={Number(prodMetrics?.merges?.mutations_running || 0).toFixed(2)}
                    icon={Zap}
                    color="text-amber-400"
                    bgColor="bg-amber-500/10"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Pending Mutations"
                    value={String(prodMetrics?.merges?.pending_mutations || 0)}
                    icon={Combine}
                    color="text-orange-400"
                    bgColor="bg-orange-500/10"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Merged Rows/s"
                    value={formatCompactNumber(prodMetrics?.merges?.merged_rows_per_sec || 0)}
                    icon={FileStack}
                    color="text-cyan-400"
                    bgColor="bg-cyan-500/10"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Merged Bytes/s"
                    value={formatBytes(prodMetrics?.merges?.merged_bytes_per_sec || 0)}
                    icon={HardDrive}
                    color="text-emerald-400"
                    bgColor="bg-emerald-500/10"
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Merge Memory"
                    value={formatBytes(prodMetrics?.merges?.merges_mutations_memory || 0)}
                    icon={MemoryStick}
                    color="text-blue-400"
                    bgColor="bg-blue-500/10"
                    isLoading={prodLoading}
                  />
                </div>
              </motion.div>

              {/* SECTION 2: THROUGHPUT TREND (FULL WIDTH) */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <MetricChartCard
                  title="Merge Throughput Trend"
                  subtitle="Rows processed by background merges (avg over 5m buckets)"
                  icon={Activity}
                  color="cyan"
                  data={mergeThroughputData}
                  isLoading={prodLoading}
                  chartTitle="Rows/s"
                  hideLatestValues
                />
              </motion.div>

              {/* SECTION 3: ACTIVITY QUEUE & PARTS TRENDS */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-6"
              >
                <MetricChartCard
                  title="Task Queue Depth"
                  subtitle="Concurrent merges and mutations in progress"
                  icon={Layers}
                  color="purple"
                  data={mergeQueueData}
                  isLoading={prodLoading}
                  chartTitle="Tasks"
                  hideLatestValues
                />
                <MetricChartCard
                  title="Parts Analysis"
                  subtitle="Total MergeTree parts and partition density"
                  icon={Layers}
                  color="amber"
                  data={partsData}
                  isLoading={isLoading}
                  chartTitle="Parts"
                  hideLatestValues
                />
              </motion.div>

              {/* SECTION 4: REPLICATION STATUS DATA */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                {prodMetrics?.replication && prodMetrics.replication.length > 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-blue-500/20">
                        <Network className="h-5 w-5 text-blue-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Replication & Consistency</h3>
                        <p className="text-xs text-gray-500">Real-time health of replicated table clusters</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left text-xs text-gray-400 font-medium pb-3 uppercase tracking-wider">Table</th>
                            <th className="text-center text-xs text-gray-400 font-medium pb-3 uppercase tracking-wider">Leader</th>
                            <th className="text-center text-xs text-gray-400 font-medium pb-3 uppercase tracking-wider">Status</th>
                            <th className="text-right text-xs text-gray-400 font-medium pb-3 uppercase tracking-wider">Delay</th>
                            <th className="text-right text-xs text-gray-400 font-medium pb-3 uppercase tracking-wider">Queue</th>
                            <th className="text-right text-xs text-gray-400 font-medium pb-3 uppercase tracking-wider">Replicas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {prodMetrics.replication.map((rep) => (
                            <tr key={`${rep.database}.${rep.table}`} className="group hover:bg-white/[0.02] transition-colors">
                              <td className="py-4">
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500">{rep.database}</span>
                                  <span className="text-sm text-white font-medium group-hover:text-blue-400 transition-colors">{rep.table}</span>
                                </div>
                              </td>
                              <td className="text-center">
                                {rep.is_leader ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-400 mx-auto" />
                                ) : (
                                  <Minus className="h-4 w-4 text-gray-500 mx-auto" />
                                )}
                              </td>
                              <td className="text-center">
                                {rep.is_readonly ? (
                                  <Badge variant="outline" className="border-red-500/50 text-red-500 bg-red-500/10 text-[10px]">READONLY</Badge>
                                ) : (
                                  <Badge variant="outline" className="border-green-500/50 text-green-500 bg-green-500/10 text-[10px]">HEALTHY</Badge>
                                )}
                              </td>
                              <td className="text-right">
                                <span className={cn(
                                  "font-mono text-xs font-medium",
                                  rep.absolute_delay > 300 ? "text-red-400" :
                                    rep.absolute_delay > 60 ? "text-orange-400" : "text-gray-300"
                                )}>
                                  {rep.absolute_delay}s
                                </span>
                              </td>
                              <td className="text-right text-gray-400 font-mono text-xs">{rep.queue_size}</td>
                              <td className="text-right">
                                <span className={cn(
                                  "font-mono text-xs font-semibold",
                                  rep.active_replicas < rep.total_replicas ? "text-orange-400" : "text-green-400"
                                )}>
                                  {rep.active_replicas}/{rep.total_replicas}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  !prodLoading && (
                    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-16 text-center">
                      <Network className="h-12 w-12 text-gray-500 mx-auto mb-4 opacity-50" />
                      <p className="text-sm text-gray-400 max-w-[200px] mx-auto">No replicated tables found in this cluster</p>
                    </div>
                  )
                )}
              </motion.div>
            </TabsContent>
          )}

          {/* Errors Tab - Advanced only */}
          {
            hasAdvancedMetrics && (
              <TabsContent value="errors" className="flex-1 overflow-auto grid gap-6 md:grid-cols-3 pr-1 min-h-0">
                {/* SECTION 1: CRITICAL ALERTS */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-red-500/20">
                      <AlertTriangle className="h-5 w-5 text-red-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Critical Alerts</h3>
                      <p className="text-xs text-gray-500">Query failures and exceptions</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <StatCard
                      title="Failed Queries"
                      value={String(stats?.failedQueries || 0)}
                      icon={XCircle}
                      color="text-red-400"
                      bgColor="bg-red-500/20"
                      isLoading={isLoading}
                      subtitle={`of ${stats?.totalQueries || 0} total`}
                    />
                    <StatCard
                      title="Error Types"
                      value={String(prodMetrics?.errors?.length || 0)}
                      icon={AlertCircle}
                      color="text-orange-400"
                      bgColor="bg-orange-500/20"
                      isLoading={prodLoading}
                    />
                    {prodMetrics?.errors?.[0] ? (
                      <StatCard
                        title="Top Error"
                        value={String(prodMetrics.errors[0].count)}
                        icon={AlertTriangle}
                        color="text-red-400"
                        bgColor="bg-red-500/20"
                        isLoading={prodLoading}
                        subtitle={prodMetrics.errors[0].exception_name}
                      />
                    ) : (
                      <StatCard
                        title="Top Error"
                        value="None"
                        icon={CheckCircle2}
                        color="text-green-400"
                        bgColor="bg-green-500/20"
                        isLoading={prodLoading}
                        subtitle="System healthy"
                      />
                    )}
                  </div>
                </motion.div>

                {/* SECTION 2: FAILURE ANALYSIS */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-orange-500/20">
                      <Activity className="h-5 w-5 text-orange-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Failure Analysis</h3>
                      <p className="text-xs text-gray-500">Trends and distribution over time</p>
                    </div>
                  </div>

                  <MetricChartCard
                    title="Failed Queries Over Time"
                    subtitle="Queries with errors"
                    icon={XCircle}
                    color="red"
                    data={metrics?.failedQueries as any}
                    isLoading={isLoading}
                    chartTitle="Failed"
                    hideLatestValues
                  />
                </motion.div>

                {/* SECTION 3: EXCEPTION LOG */}
                {prodMetrics?.errors && prodMetrics.errors.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-white/5">
                        <List className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">Exception Log</h3>
                        <p className="text-xs text-gray-500">Detailed error breakdown</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {prodMetrics.errors.map((err) => (
                        <div key={err.exception_code} className="p-4 rounded-lg bg-white/5 border border-white/10 transition-colors hover:bg-white/10">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="secondary" className="bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                  {err.exception_name}
                                </Badge>
                                <code className="text-xs text-gray-500 bg-black/20 px-1.5 py-0.5 rounded">Code: {err.exception_code}</code>
                              </div>
                              <p className="text-xs text-gray-400 truncate font-mono bg-black/20 p-2 rounded mt-2 border border-white/5">
                                {err.sample_error}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0 flex flex-col items-end">
                              <span className="text-xl font-bold text-white tabular-nums">{err.count}</span>
                              <span className="text-xs text-gray-500">occurrences</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* No errors message */}
                {(!prodMetrics?.errors || prodMetrics.errors.length === 0) && !prodLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-8 text-center md:col-span-3"
                  >
                    <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-4" />
                    <p className="text-green-400 font-medium">No errors in the selected time range</p>
                    <p className="text-xs text-gray-500 mt-2">All queries completed successfully</p>
                  </motion.div>
                )}
              </TabsContent>
            )
          }

          {/* System Tab - Advanced only */}
          {
            hasAdvancedMetrics && (
              <TabsContent value="system" className="flex-1 overflow-auto space-y-6 pr-1 min-h-0 data-[state=active]:flex flex-col">

                {/* SECTION 1: SYSTEM RESOURCES */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                      <Server className="h-5 w-5 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">System Resources</h3>
                      <p className="text-xs text-gray-500">CPU usage, load, and thread pools</p>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2 mb-6">
                    {/* CPU Breakdown Chart - Prominent */}
                    <MetricChartCard
                      title="CPU Breakdown"
                      subtitle="User, System, Wait, I/O Wait"
                      icon={Cpu}
                      color="emerald"
                      data={cpuBreakdownData}
                      isLoading={prodLoading}
                      chartTitle="%"
                      hideLatestValues
                    />
                    {/* Concurrency Chart - Prominent */}
                    <MetricChartCard
                      title="Concurrency"
                      subtitle="Active and queued requests"
                      icon={Gauge}
                      color="purple"
                      data={concurrencyData}
                      isLoading={prodLoading}
                      chartTitle="Reqs"
                      hideLatestValues
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard
                      title="Load Average (15m)"
                      value={prodMetrics?.resources?.load_average_15?.toFixed(2) || "0.00"}
                      icon={Activity}
                      color={(prodMetrics?.resources?.load_average_15 || 0) > 4 ? "text-red-400" : "text-emerald-400"}
                      bgColor={(prodMetrics?.resources?.load_average_15 || 0) > 4 ? "bg-red-500/20" : "bg-emerald-500/20"}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Global Threads"
                      value={String(prodMetrics?.resources?.global_threads || 0)}
                      icon={Network}
                      color="text-blue-400"
                      bgColor="bg-blue-500/20"
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Schedule Pool"
                      value={String(prodMetrics?.resources?.background_schedule_pool_tasks || 0)}
                      icon={Clock}
                      color="text-purple-400"
                      bgColor="bg-purple-500/20"
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="File Descriptors"
                      value={String(prodMetrics?.resources?.file_descriptors_used || 0)}
                      icon={FileText}
                      color="text-yellow-400"
                      bgColor="bg-yellow-500/20"
                      isLoading={prodLoading}
                    />
                  </div>
                </motion.div>


                {/* SECTION 3: MEMORY ANALYSIS */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-purple-500/20">
                      <MemoryStick className="h-5 w-5 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Memory Analysis</h3>
                      <p className="text-xs text-gray-500">Detailed memory usage, caches, and allocators</p>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2 mb-6">
                    {/* Detailed Memory Breakdown */}
                    <MetricChartCard
                      title="Detailed Memory Breakdown"
                      subtitle="Memory usage by component (resident and virtual)"
                      icon={MemoryStick}
                      color="purple"
                      data={memoryBreakdownData}
                      isLoading={prodLoading}
                      chartTitle="Bytes"
                      hideLatestValues
                    />

                    {/* Allocator Memory */}
                    <MetricChartCard
                      title="Allocator Memory (jemalloc)"
                      subtitle="Memory usage by jemalloc allocator"
                      icon={Database}
                      color="emerald"
                      data={allocatorMemoryData}
                      isLoading={prodLoading}
                      chartTitle="Bytes"
                      hideLatestValues
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StatCard
                      title="Memory Cache"
                      value={formatBytes(memoryBreakdownData?.values[2]?.slice(-1)[0] || 0)}
                      icon={Zap}
                      color="text-emerald-400"
                      bgColor="bg-emerald-500/20"
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Jemalloc Allocated"
                      value={formatBytes(allocatorMemoryData?.values[0]?.slice(-1)[0] || 0)}
                      icon={Database}
                      color="text-emerald-400"
                      bgColor="bg-emerald-500/20"
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Jemalloc Resident"
                      value={formatBytes(allocatorMemoryData?.values[1]?.slice(-1)[0] || 0)}
                      icon={HardDrive}
                      color="text-cyan-400"
                      bgColor="bg-cyan-500/20"
                      isLoading={prodLoading}
                    />
                  </div>
                </motion.div>

              </TabsContent>
            )
          }



          {/* Network Tab - Advanced only */}
          {
            hasAdvancedMetrics && (
              <TabsContent value="network" className="flex-1 overflow-auto grid gap-6 md:grid-cols-3 pr-1 min-h-0">
                {/* SECTION 1: TRAFFIC OVERVIEW */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6 md:col-span-3"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-indigo-500/20">
                      <Activity className="h-5 w-5 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Network Traffic</h3>
                      <p className="text-xs text-gray-500">Real-time bandwidth usage</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <StatCard
                      title="Total Traffic"
                      value={formatBytesUtil((prodMetrics?.network?.network_receive_speed || 0) + (prodMetrics?.network?.network_send_speed || 0)) + "/s"}
                      icon={Activity}
                      color="text-indigo-400"
                      bgColor="bg-indigo-500/20"
                      isLoading={prodLoading}
                      subtitle="Inbound + Outbound"
                    />
                    <StatCard
                      title="Inbound"
                      value={formatBytesUtil(prodMetrics?.network?.network_receive_speed || 0) + "/s"}
                      icon={TrendingDown}
                      color="text-green-400"
                      bgColor="bg-green-500/20"
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Outbound"
                      value={formatBytesUtil(prodMetrics?.network?.network_send_speed || 0) + "/s"}
                      icon={TrendingUp}
                      color="text-blue-400"
                      bgColor="bg-blue-500/20"
                      isLoading={prodLoading}
                    />
                  </div>

                  <div className="mt-6">
                    <MetricChartCard
                      title="Network Throughput"
                      subtitle="Data transfer rate (Bytes/s)"
                      icon={Activity}
                      color="indigo"
                      data={networkThroughputData}
                      isLoading={prodLoading}
                      chartTitle="Bytes/s"
                      hideLatestValues
                    />
                  </div>
                </motion.div>
              </TabsContent>
            )
          }
        </Tabs >

        {/* Quick Actions */}
        {/* Quick Actions Footer - Hidden when embedded */}
        {
          !embedded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-center justify-center gap-4 pt-4 pb-8"
            >
              <Button
                variant="outline"
                size="sm"
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
                onClick={() => setInternalTimeRange("15m")}
              >
                15min
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
                onClick={() => setInternalTimeRange("1h")}
              >
                1 Hour
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
                onClick={() => setInternalTimeRange("24h")}
              >
                24 Hours
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-2 border-white/10",
                  refreshInterval > 0
                    ? "bg-green-500/20 border-green-500/30 text-green-400"
                    : "bg-white/5 hover:bg-white/10"
                )}
                onClick={() => setInternalRefreshInterval(refreshInterval > 0 ? 0 : 30)}
              >
                {refreshInterval > 0 ? (
                  <>
                    <Pause className="h-3 w-3" />
                    Stop Auto
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    Auto (30s)
                  </>
                )}
              </Button>
            </motion.div>
          )
        }
      </div >
    </div >
  );
}
