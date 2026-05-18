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
  color?: string;    // accepted for API compat, ignored in editorial layout
  bgColor?: string;  // accepted for API compat, ignored in editorial layout
  trend?: number;
  isLoading?: boolean;
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  unit,
  icon: Icon,
  trend,
  isLoading,
  subtitle,
}) => {
  const TrendIcon = trend && trend > 0 ? TrendingUp : trend && trend < 0 ? TrendingDown : Minus;
  const trendColor = trend && trend > 0 ? "text-emerald-400" : trend && trend < 0 ? "text-red-400" : "text-paper-faint";

  return (
    <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {trend !== undefined && (
            <span className={cn("inline-flex items-center gap-1 font-mono text-[10px]", trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
        </div>
      </div>
      {isLoading ? (
        <div className="h-6 w-20 animate-pulse rounded-xs bg-ink-300" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[20px] font-semibold leading-none text-paper">{value}</span>
          {unit && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">{unit}</span>}
        </div>
      )}
      {subtitle && (
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {subtitle}
        </span>
      )}
    </div>
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
    // For metrics that commonly have small decimal values, use fixed precision
    if (chartTitle === "Cores" || chartTitle === "Load" || chartTitle === "Txn/s" || chartTitle === "Delayed") {
      if (val < 0.01) return val.toFixed(4);
      if (val < 1) return val.toFixed(3);
      if (val < 100) return val.toFixed(2);
      return val.toFixed(1);
    }
    return formatCompactNumber(val);
  };

  const unit = chartTitle.replace("Bytes", "").replace("%", "").replace("ms", "");

  return (
    <div className="relative overflow-hidden rounded-md border border-ink-500 bg-ink-100">
      <div className="flex items-center justify-between border-b border-ink-500 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[13px] font-semibold text-paper">{title}</h3>
            {subtitle && <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{subtitle}</p>}
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
                    <span className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: normalizedColors[idx % normalizedColors.length] }}>
                      {normalizedLabels[idx] || `Series ${idx + 1}`}
                    </span>
                  )}
                  <div className={cn(
                    "flex items-baseline gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-1",
                    !showLabel && "border-none bg-transparent p-0"
                  )}>
                    {!showLabel && (
                      <span className="mr-2 inline-flex h-5 items-center rounded-xs border border-ink-500 bg-ink-200 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                        Latest
                      </span>
                    )}
                    <span className={cn("font-mono font-semibold text-paper", showLabel ? "text-[13px]" : "text-[18px]")}>
                      {formatValue(latestVal)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
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
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-paper-dim">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Loading metrics…</span>
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
              <BarChart3 className="h-10 w-10 text-paper-dim" aria-hidden />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">No data available</span>
            </div>
          </div>
        )}
      </div>
    </div>
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

  // CPU Cores (actual CPU time in cores)
  const cpuCoresData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: prodMetrics.performance_history.map(d => d.cpu_cores),
    };
  }, [prodMetrics?.performance_history]);

  // Load Average (15 min) History
  const loadAverageData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: prodMetrics.performance_history.map(d => d.load_average_15),
    };
  }, [prodMetrics?.performance_history]);

  // Write I/O Throughput
  const writeIOData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: [
        prodMetrics.performance_history.map(d => d.write_to_disk_bytes_per_sec),
        prodMetrics.performance_history.map(d => d.write_to_fs_bytes_per_sec),
      ],
      labels: ['Write to Disk', 'Write to FS'],
      colors: ['#f97316', '#ef4444'],
    };
  }, [prodMetrics?.performance_history]);

  // Data Throughput (Bytes) - select + insert + read
  const dataThroughputBytesData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: [
        prodMetrics.performance_history.map(d => d.selected_bytes_per_sec),
        prodMetrics.performance_history.map(d => d.inserted_bytes_per_sec),
        prodMetrics.performance_history.map(d => d.read_from_disk_bytes_per_sec),
      ],
      labels: ['Selected', 'Inserted', 'Read from Disk'],
      colors: ['#3b82f6', '#10b981', '#f59e0b'],
    };
  }, [prodMetrics?.performance_history]);

  // Delayed Inserts
  const delayedInsertsData = useMemo(() => {
    if (!prodMetrics?.performance_history?.length) return undefined;
    return {
      timestamps: prodMetrics.performance_history.map(d => d.timestamp),
      values: [
        prodMetrics.performance_history.map(d => d.delayed_inserts_per_sec),
        prodMetrics.performance_history.map(d => d.delayed_inserts_wait_sec),
      ],
      labels: ['Delayed/s', 'Wait (s)'],
      colors: ['#ef4444', '#f59e0b'],
    };
  }, [prodMetrics?.performance_history]);

  // Merged Bytes/sec
  const mergedBytesData = useMemo(() => {
    if (!prodMetrics?.merges_history?.length) return undefined;
    return {
      timestamps: prodMetrics.merges_history.map(d => d.timestamp),
      values: prodMetrics.merges_history.map(d => d.merged_bytes_per_sec),
    };
  }, [prodMetrics?.merges_history]);

  // ZooKeeper metrics
  const zookeeperTransactionsData = useMemo(() => {
    if (!prodMetrics?.zookeeper_history?.length) return undefined;
    return {
      timestamps: prodMetrics.zookeeper_history.map(d => d.timestamp),
      values: prodMetrics.zookeeper_history.map(d => d.transactions_per_sec),
    };
  }, [prodMetrics?.zookeeper_history]);

  const zookeeperBytesData = useMemo(() => {
    if (!prodMetrics?.zookeeper_history?.length) return undefined;
    return {
      timestamps: prodMetrics.zookeeper_history.map(d => d.timestamp),
      values: [
        prodMetrics.zookeeper_history.map(d => d.bytes_sent_per_sec),
        prodMetrics.zookeeper_history.map(d => d.bytes_received_per_sec),
      ],
      labels: ['Sent', 'Received'],
      colors: ['#3b82f6', '#10b981'],
    };
  }, [prodMetrics?.zookeeper_history]);


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
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                <Activity className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  Observability
                </span>
                <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-paper">
                  Metrics dashboard
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                </h1>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 px-3 py-2">
                <Timer className="h-3.5 w-3.5 text-paper-dim" />
                <span className="font-mono text-[11px] text-paper-muted">{lastUpdated}</span>
              </div>

              <Select value={internalTimeRange} onValueChange={setInternalTimeRange}>
                <SelectTrigger className="h-10 w-[130px] rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper">
                  <Clock className="mr-2 h-3.5 w-3.5 text-paper-dim" />
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
                <SelectTrigger className="h-9 w-[140px] rounded-xs border-ink-500 bg-ink-100 text-paper hover:border-ink-700 hover:bg-ink-200">
                  {refreshInterval > 0 ? (
                    <Play className="h-3.5 w-3.5 mr-2 text-emerald-400" />
                  ) : (
                    <Pause className="h-3.5 w-3.5 mr-2 text-paper-dim" />
                  )}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
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
                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isAnyFetching && "animate-spin")} />
                {isRefreshCooldown ? "Wait…" : "Refresh"}
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
              className="flex items-center justify-between rounded-xs border border-red-900/60 bg-red-950/40 p-3"
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
            <TabsList className="h-9 self-start justify-start gap-0.5 rounded-xs border border-ink-500 bg-ink-100 p-0.5">
              <TabsTrigger
                value="overview"
                className={cn(
                  "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                  "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
                )}
              >
                <BarChart3 className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <>
                <TabsTrigger
                  value="performance"
                  className={cn(
                    "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                    "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
                  )}
                >
                  <Gauge className="h-4 w-4" />
                  Performance
                </TabsTrigger>
                <TabsTrigger
                  value="storage"
                  className={cn(
                    "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                    "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
                  )}
                >
                  <HardDrive className="h-4 w-4" />
                  Storage
                </TabsTrigger>
                <TabsTrigger
                  value="merges"
                  className={cn(
                    "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                    "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
                  )}
                >
                  <GitMerge className="h-4 w-4" />
                  Merges
                </TabsTrigger>
                <TabsTrigger
                  value="errors"
                  className={cn(
                    "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                    "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
                  )}
                >
                  <AlertCircle className="h-4 w-4" />
                  Errors
                </TabsTrigger>
                <TabsTrigger
                  value="system"
                  className={cn(
                    "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                    "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
                  )}
                >
                  <Cpu className="h-4 w-4" />
                  System
                </TabsTrigger>

                <TabsTrigger
                  value="network"
                  className={cn(
                    "rounded-xs gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                    "data-[state=active]:bg-ink-200 data-[state=active]:text-paper",
                    "data-[state=inactive]:text-paper-dim hover:text-paper hover:bg-ink-200"
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
                className="rounded-xs border border-ink-500 bg-ink-100 p-6 h-full"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Activity className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Resource utilization</h3>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Current system resource usage</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* CPU */}
                  <div className="space-y-2">
                    <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.14em]">
                      <span className="text-paper-dim">CPU</span>
                      <span className="font-semibold tabular-nums text-paper">
                        {((cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)).toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={(cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)}
                      className={cn(
                        "h-1.5 bg-ink-200",
                        ((cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)) > 80 ? "[&>div]:bg-red-500" :
                          ((cpuBreakdownData?.values[0]?.slice(-1)[0] || 0) + (cpuBreakdownData?.values[1]?.slice(-1)[0] || 0)) > 60 ? "[&>div]:bg-amber-500" : "[&>div]:bg-brand"
                      )}
                    />
                  </div>

                  {/* Disk */}
                  <div className="space-y-2">
                    <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.14em]">
                      <span className="text-paper-dim">Disk</span>
                      <span className="font-semibold tabular-nums text-paper">
                        {primaryDisk ? primaryDisk.used_percent.toFixed(1) : "0"}%
                      </span>
                    </div>
                    <Progress
                      value={primaryDisk?.used_percent || 0}
                      className={cn(
                        "h-1.5 bg-ink-200",
                        (primaryDisk?.used_percent || 0) > 90 ? "[&>div]:bg-red-500" :
                          (primaryDisk?.used_percent || 0) > 75 ? "[&>div]:bg-amber-500" : "[&>div]:bg-brand"
                      )}
                    />
                  </div>

                  {/* Memory */}
                  <div className="space-y-2">
                    <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.14em]">
                      <span className="text-paper-dim">Memory</span>
                      <span className="font-semibold tabular-nums text-paper">
                        {stats?.memoryPercentage?.toFixed(1) || 0}%
                      </span>
                    </div>
                    <Progress
                      value={stats?.memoryPercentage || 0}
                      className={cn(
                        "h-1.5 bg-ink-200",
                        (stats?.memoryPercentage || 0) > 90 ? "[&>div]:bg-red-500" :
                          (stats?.memoryPercentage || 0) > 75 ? "[&>div]:bg-amber-500" : "[&>div]:bg-brand"
                      )}
                    />
                    <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
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
                className="rounded-xs border border-ink-500 bg-ink-100 p-6 h-full"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Zap className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Activity summary</h3>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Real-time system activity</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 border-l border-t border-ink-500">
                  <div className="border-b border-r border-ink-500 p-4">
                    <div className="font-mono text-[20px] font-semibold tabular-nums text-paper">
                      {formatCompactNumber(metrics?.queriesPerSecond?.values?.slice(-1)[0] || 0)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Queries/s</div>
                  </div>
                  <div className="border-b border-r border-ink-500 p-4">
                    <div className="font-mono text-[20px] font-semibold tabular-nums text-paper">
                      {Number(prodMetrics?.merges?.merges_running || 0).toFixed(2)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Active merges</div>
                  </div>
                  <div className="border-b border-r border-ink-500 p-4">
                    <div className="font-mono text-[20px] font-semibold tabular-nums text-paper">
                      {prodMetrics?.resources?.background_pool_tasks || 0}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Background tasks</div>
                  </div>
                  <div className="border-b border-r border-ink-500 p-4">
                    <div className="font-mono text-[20px] font-semibold tabular-nums text-paper">
                      {formatCompactNumber(prodMetrics?.merges?.merged_rows_per_sec || 0)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Merged rows/s</div>
                  </div>
                </div>
              </motion.div>

              {/* Recent Errors */}
              {prodMetrics?.errors && prodMetrics.errors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="rounded-xs border border-red-900/60 bg-red-950/20 p-6 h-full"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-red-900/60 bg-red-950/40 text-red-300">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                      </span>
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">Recent errors</h3>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-xs border border-red-900/60 bg-red-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                      {prodMetrics.errors.length} issues
                    </span>
                  </div>
                  <div className="space-y-2">
                    {prodMetrics.errors.slice(0, 3).map((err, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-xs border border-red-900/60 bg-red-950/30 px-3 py-2">
                        <span className="truncate font-mono text-[12px] text-red-200 max-w-[180px]" title={err.exception_name}>
                          {err.exception_name}
                        </span>
                        <span className="rounded-xs border border-red-900/60 bg-red-950/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-red-300">
                          {err.count}
                        </span>
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
                  "rounded-xs border border-ink-500 bg-ink-100 p-6 h-full",
                  (prodMetrics?.errors && prodMetrics.errors.length > 0) ? "" : "md:col-span-2"
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <Table2 className="h-4 w-4" aria-hidden />
                    </span>
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Largest tables</h3>
                  </div>
                </div>
                <div className="space-y-1">
                  {prodMetrics?.topTables?.slice(0, 5).map((table, idx) => (
                    <div key={idx} className="flex items-center justify-between border-b border-ink-500 py-2 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="w-5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{String(idx + 1).padStart(2, "0")}</span>
                        <div className="flex flex-col">
                          <span className="text-[13px] font-medium text-paper">{table.table}</span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{table.database}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] tabular-nums text-paper-dim">{formatCompactNumber(table.rows)} rows</span>
                        <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-paper-muted">
                          {table.compressed_size}
                        </span>
                      </div>
                    </div>
                  ))}
                  {(!prodMetrics?.topTables || prodMetrics.topTables.length === 0) && (
                    <div className="py-4 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No tables found</div>
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
                className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-1 h-full"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Timer className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Query Latency</h3>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Response time analysis</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 border-l border-t border-ink-500">
                  <StatCard
                    title="Avg Latency"
                    value={formatMs(prodMetrics?.latency?.avg_ms || 0)}
                    icon={Timer}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="p50 Latency"
                    value={formatMs(prodMetrics?.latency?.p50_ms || 0)}
                    icon={Gauge}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Max Latency"
                    value={formatMs(prodMetrics?.latency?.max_ms || 0)}
                    icon={AlertTriangle}
                    isLoading={prodLoading}
                    subtitle="Worst case"
                  />
                  <StatCard
                    title="Slow Queries"
                    value={String(prodMetrics?.latency?.slow_queries_count || 0)}
                    subtitle=">1 second"
                    icon={AlertTriangle}
                    isLoading={prodLoading}
                  />
                </div>
              </motion.div>



              {/* Throughput & IO Group */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-1"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Activity className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Throughput & IO</h3>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Read/Write operations and background tasks</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 border-l border-t border-ink-500">
                  <StatCard
                    title="Read Rate"
                    value={formatBytes(prodMetrics?.resources?.read_rate || 0)}
                    unit="/s"
                    icon={HardDriveDownload}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Background Tasks"
                    value={String(prodMetrics?.resources?.background_pool_tasks || 0)}
                    icon={Layers}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Rows Selected"
                    value={formatCompactNumber(queryThroughputData?.values[1]?.slice(-1)[0] || 0)}
                    unit="/s"
                    icon={Database}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Rows Inserted"
                    value={formatCompactNumber(processThroughputData?.values[0]?.slice(-1)[0] || 0)}
                    unit="/s"
                    icon={HardDriveDownload}
                    isLoading={prodLoading}
                  />
                </div>
              </motion.div>

              {/* Detailed Analysis Group */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-2"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Activity className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Detailed Analysis</h3>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Historical throughput trends</p>
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
                  <MetricChartCard
                    title="CPU Usage (Cores)"
                    subtitle="Total CPU time consumed in core-seconds/sec"
                    icon={Cpu}
                    color="amber"
                    data={cpuCoresData}
                    isLoading={prodLoading}
                    chartTitle="Cores"
                  />
                  <MetricChartCard
                    title="Data Throughput (Bytes)"
                    subtitle="Selected, inserted, and disk read bytes/sec"
                    icon={HardDriveDownload}
                    color="blue"
                    data={dataThroughputBytesData}
                    isLoading={prodLoading}
                    chartTitle="Bytes"
                    hideLatestValues
                  />
                  <MetricChartCard
                    title="Write I/O"
                    subtitle="Bytes written to disk and filesystem per second"
                    icon={HardDrive}
                    color="orange"
                    data={writeIOData}
                    isLoading={prodLoading}
                    chartTitle="Bytes"
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
                  className="rounded-md border border-ink-500 bg-ink-100 p-8 text-center md:col-span-3"
                >
                  <RefreshCw className="h-8 w-8 text-paper-dim mx-auto mb-4 animate-spin" />
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-muted">Loading storage metrics…</p>
                </motion.div>
              )}

              {!prodLoading && (
                <>
                  {/* SECTION 1: DISK CAPACITY */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                        <HardDrive className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[14px] font-semibold tracking-tight text-paper">Disk Capacity</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Volume usage and availability</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 border-l border-t border-ink-500">
                      <StatCard
                        title="Total Storage"
                        value={formatBytes(prodMetrics?.disks?.reduce((sum, d) => sum + d.total_space, 0) || 0)}
                        icon={HardDrive}
                        isLoading={false}
                      />
                      <StatCard
                        title="Used Storage"
                        value={formatBytes(prodMetrics?.disks?.reduce((sum, d) => sum + d.used_space, 0) || 0)}
                        icon={Database}
                        isLoading={false}
                      />
                      <StatCard
                        title="Free Storage"
                        value={formatBytes(prodMetrics?.disks?.reduce((sum, d) => sum + d.free_space, 0) || 0)}
                        icon={Server}
                        isLoading={false}
                      />
                      <StatCard
                        title="Disk Count"
                        value={String(prodMetrics?.disks?.length || 0)}
                        icon={Disc}
                        isLoading={false}
                      />
                    </div>
                  </motion.div>

                  {/* SECTION 2: MERJETREE HEALTH */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                        <Layers className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[14px] font-semibold tracking-tight text-paper">MergeTree Diagnostics</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Parts count and partition health</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 border-l border-t border-ink-500">
                      <StatCard
                        title="Total Parts"
                        value={formatCompactNumber(prodMetrics?.resources?.total_parts || 0)}
                        icon={Layers}
                        isLoading={prodLoading}
                      />
                      <StatCard
                        title="Max Parts/Partition"
                        value={formatCompactNumber(prodMetrics?.resources?.max_parts_per_partition || 0)}
                        icon={AlertTriangle}
                        isLoading={prodLoading}
                      />

                      {/* Total Rows Context */}
                      <StatCard
                        title="Total Rows"
                        value={formatCompactNumber(prodMetrics?.topTables?.reduce((sum, t) => sum + (t.rows || 0), 0) || 0)}
                        icon={List}
                        isLoading={prodLoading}
                      />
                    </div>
                  </motion.div>

                  {/* SECTION 3: DETAILED BREAKDOWN */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                        <List className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[14px] font-semibold tracking-tight text-paper">Detailed Breakdown</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Per-disk usage and largest tables</p>
                      </div>
                    </div>

                    {/* Disk Usage & Top Tables Grid */}
                    <div className="grid gap-6 lg:grid-cols-2">
                      {/* Disk Usage */}
                      <div>
                        <h4 className="flex items-center gap-2 mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                          <Disc className="h-3.5 w-3.5" aria-hidden />
                          Disk Usage
                        </h4>
                        {prodMetrics?.disks && prodMetrics.disks.length > 0 ? (
                          <div className="space-y-4">
                            {prodMetrics.disks.map((disk) => (
                              <div key={disk.name} className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2">
                                    <HardDrive className="h-4 w-4 text-paper-dim" aria-hidden />
                                    <span className="text-[13px] font-medium text-paper">{disk.name}</span>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{disk.path}</span>
                                  </div>
                                  <span className={cn(
                                    "font-mono text-[12px] tabular-nums font-semibold",
                                    disk.used_percent > 90 ? "text-red-400" :
                                      disk.used_percent > 75 ? "text-amber-400" : "text-paper"
                                  )}>
                                    {disk.used_percent.toFixed(1)}%
                                  </span>
                                </div>
                                <Progress
                                  value={disk.used_percent}
                                  className={cn(
                                    "h-1.5 bg-ink-200",
                                    disk.used_percent > 90 ? "[&>div]:bg-red-500" :
                                      disk.used_percent > 75 ? "[&>div]:bg-amber-500" : "[&>div]:bg-brand"
                                  )}
                                />
                                <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                  <span>Used: {formatBytes(disk.used_space)}</span>
                                  <span>Free: {formatBytes(disk.free_space)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <HardDrive className="h-10 w-10 text-paper-dim mx-auto mb-3 opacity-50" aria-hidden />
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-muted">No disk metrics available</p>
                          </div>
                        )}
                      </div>

                      {/* Top Tables */}
                      <div>
                        <h4 className="flex items-center gap-2 mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                          <Table2 className="h-3.5 w-3.5" aria-hidden />
                          Top Tables by Size
                        </h4>
                        {prodMetrics?.topTables && prodMetrics.topTables.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-ink-500">
                                  <th className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Table</th>
                                  <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Size</th>
                                  <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Parts</th>
                                </tr>
                              </thead>
                              <tbody>
                                {prodMetrics.topTables.slice(0, 5).map((table, idx) => (
                                  <tr key={`${table.database}.${table.table}`} className="border-b border-ink-500/60">
                                    <td className="py-2">
                                      <div className="flex items-center gap-2">
                                        <span className="w-5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{String(idx + 1).padStart(2, "0")}</span>
                                        <span className="text-[13px] truncate max-w-[150px] text-paper" title={`${table.database}.${table.table}`}>
                                          <span className="text-paper-faint">{table.database}.</span>{table.table}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="text-right font-mono text-[12px] tabular-nums text-paper-muted">{table.compressed_size}</td>
                                    <td className="text-right">
                                      <span className={cn(
                                        "inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                                        table.parts_count > 100 ? "text-amber-400" : "text-paper-muted"
                                      )}>
                                        {table.parts_count}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <Table2 className="h-10 w-10 text-paper-dim mx-auto mb-3 opacity-50" aria-hidden />
                            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-muted">No table data available</p>
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
                    className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                        <Zap className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[14px] font-semibold tracking-tight text-paper">Cache Performance</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Filesystem and page cache efficiency</p>
                      </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-5">
                      {/* Cache Quick Stats - Clean sidebar */}
                      <div className="lg:col-span-1 flex flex-col justify-center gap-4">
                        <div className="flex-1 rounded-xs border border-ink-500 bg-ink-200 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">FS Cache</span>
                          </div>
                          <div className="font-mono text-[20px] font-semibold tabular-nums text-paper">
                            {cacheHitRateData?.values[0]?.slice(-1)[0]?.toFixed(1) || "0"}
                            <span className="ml-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">%</span>
                          </div>
                        </div>
                        <div className="flex-1 rounded-xs border border-ink-500 bg-ink-200 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Page Cache</span>
                          </div>
                          <div className="font-mono text-[20px] font-semibold tabular-nums text-paper">
                            {cacheHitRateData?.values[1]?.slice(-1)[0]?.toFixed(1) || "0"}
                            <span className="ml-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">%</span>
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
                className="rounded-md border border-ink-500 bg-ink-100 p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                    <Layers className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold tracking-tight text-paper">Merge Command Center</h3>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Real-time background processing health & throughput</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-l border-t border-ink-500">
                  <StatCard
                    title="Running Merges"
                    value={Number(prodMetrics?.merges?.merges_running || 0).toFixed(2)}
                    icon={GitMerge}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Active Mutations"
                    value={Number(prodMetrics?.merges?.mutations_running || 0).toFixed(2)}
                    icon={Zap}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Pending Mutations"
                    value={String(prodMetrics?.merges?.pending_mutations || 0)}
                    icon={Combine}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Merged Rows/s"
                    value={formatCompactNumber(prodMetrics?.merges?.merged_rows_per_sec || 0)}
                    icon={FileStack}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Merged Bytes/s"
                    value={formatBytes(prodMetrics?.merges?.merged_bytes_per_sec || 0)}
                    icon={HardDrive}
                    isLoading={prodLoading}
                  />
                  <StatCard
                    title="Merge Memory"
                    value={formatBytes(prodMetrics?.merges?.merges_mutations_memory || 0)}
                    icon={MemoryStick}
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
                  <div className="rounded-md border border-ink-500 bg-ink-100 p-6">
                    <div className="flex items-center gap-3 mb-6">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                        <Network className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[14px] font-semibold tracking-tight text-paper">Replication & Consistency</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Real-time health of replicated table clusters</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-ink-500">
                            <th className="pb-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Table</th>
                            <th className="pb-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Leader</th>
                            <th className="pb-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Status</th>
                            <th className="pb-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Delay</th>
                            <th className="pb-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Queue</th>
                            <th className="pb-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Replicas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-500/60">
                          {prodMetrics.replication.map((rep) => (
                            <tr key={`${rep.database}.${rep.table}`} className="group transition-colors hover:bg-ink-200">
                              <td className="py-4">
                                <div className="flex flex-col">
                                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{rep.database}</span>
                                  <span className="text-[13px] font-medium text-paper transition-colors group-hover:text-brand">{rep.table}</span>
                                </div>
                              </td>
                              <td className="text-center">
                                {rep.is_leader ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" aria-label="Leader" />
                                ) : (
                                  <Minus className="h-4 w-4 text-paper-faint mx-auto" aria-label="Replica" />
                                )}
                              </td>
                              <td className="text-center">
                                {rep.is_readonly ? (
                                  <span className="inline-flex items-center rounded-xs border border-red-900/60 bg-red-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">READONLY</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-xs border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">HEALTHY</span>
                                )}
                              </td>
                              <td className="text-right">
                                <span className={cn(
                                  "font-mono text-[12px] font-medium tabular-nums",
                                  rep.absolute_delay > 300 ? "text-red-400" :
                                    rep.absolute_delay > 60 ? "text-amber-400" : "text-paper-muted"
                                )}>
                                  {rep.absolute_delay}s
                                </span>
                              </td>
                              <td className="text-right font-mono text-[12px] tabular-nums text-paper-muted">{rep.queue_size}</td>
                              <td className="text-right">
                                <span className={cn(
                                  "font-mono text-[12px] font-semibold tabular-nums",
                                  rep.active_replicas < rep.total_replicas ? "text-amber-400" : "text-emerald-400"
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
                    <div className="rounded-md border border-ink-500 bg-ink-100 p-16 text-center">
                      <Network className="h-12 w-12 text-paper-dim mx-auto mb-4 opacity-50" aria-hidden />
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-muted max-w-[260px] mx-auto">No replicated tables found in this cluster</p>
                    </div>
                  )
                )}
              </motion.div>

              {/* SECTION 5: MERGE BYTES THROUGHPUT & DELAYED INSERTS */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-6"
              >
                <MetricChartCard
                  title="Merged Bytes Throughput"
                  subtitle="Bytes processed by background merges per second"
                  icon={HardDrive}
                  color="emerald"
                  data={mergedBytesData}
                  isLoading={prodLoading}
                  chartTitle="Bytes"
                />
                <MetricChartCard
                  title="Delayed Inserts"
                  subtitle="Insert backpressure: delayed inserts/sec and wait time"
                  icon={AlertTriangle}
                  color="red"
                  data={delayedInsertsData}
                  isLoading={prodLoading}
                  chartTitle="Delayed"
                  hideLatestValues
                />
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
                  className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <AlertTriangle className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">Critical Alerts</h3>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Query failures and exceptions</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 border-l border-t border-ink-500">
                    <StatCard
                      title="Failed Queries"
                      value={String(stats?.failedQueries || 0)}
                      icon={XCircle}
                      isLoading={isLoading}
                      subtitle={`of ${stats?.totalQueries || 0} total`}
                    />
                    <StatCard
                      title="Error Types"
                      value={String(prodMetrics?.errors?.length || 0)}
                      icon={AlertCircle}
                      isLoading={prodLoading}
                    />
                    {prodMetrics?.errors?.[0] ? (
                      <StatCard
                        title="Top Error"
                        value={String(prodMetrics.errors[0].count)}
                        icon={AlertTriangle}
                        isLoading={prodLoading}
                        subtitle={prodMetrics.errors[0].exception_name}
                      />
                    ) : (
                      <StatCard
                        title="Top Error"
                        value="None"
                        icon={CheckCircle2}
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
                  className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <Activity className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">Failure Analysis</h3>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Trends and distribution over time</p>
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
                    className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                        <List className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <h3 className="text-[14px] font-semibold tracking-tight text-paper">Exception Log</h3>
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Detailed error breakdown</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {prodMetrics.errors.map((err) => (
                        <div key={err.exception_code} className="rounded-xs border border-ink-500 bg-ink-200 p-4 transition-colors hover:border-ink-700">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="inline-flex items-center rounded-xs border border-red-900/60 bg-red-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                                  {err.exception_name}
                                </span>
                                <code className="rounded-xs border border-ink-500 bg-ink-300 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Code: {err.exception_code}</code>
                              </div>
                              <p className="mt-2 truncate rounded-xs border border-ink-500 bg-ink-300 p-2 font-mono text-[11px] text-paper-muted">
                                {err.sample_error}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0 flex flex-col items-end">
                              <span className="font-mono text-[20px] font-semibold tabular-nums text-paper">{err.count}</span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">occurrences</span>
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
                    className="rounded-md border border-ink-500 bg-ink-100 p-8 text-center md:col-span-3"
                  >
                    <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xs border border-emerald-900/60 bg-emerald-950/40 text-emerald-300">
                      <CheckCircle2 className="h-5 w-5" aria-hidden />
                    </span>
                    <p className="text-[13px] font-medium text-paper">No errors in the selected time range</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">All queries completed successfully</p>
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
                  className="rounded-md border border-ink-500 bg-ink-100 p-6"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <Server className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">System Resources</h3>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">CPU usage, load, and thread pools</p>
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

                  <div className="grid grid-cols-2 md:grid-cols-4 border-l border-t border-ink-500">
                    <StatCard
                      title="Load Average (15m)"
                      value={prodMetrics?.resources?.load_average_15?.toFixed(2) || "0.00"}
                      icon={Activity}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Global Threads"
                      value={String(prodMetrics?.resources?.global_threads || 0)}
                      icon={Network}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Schedule Pool"
                      value={String(prodMetrics?.resources?.background_schedule_pool_tasks || 0)}
                      icon={Clock}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="File Descriptors"
                      value={String(prodMetrics?.resources?.file_descriptors_used || 0)}
                      icon={FileText}
                      isLoading={prodLoading}
                    />
                  </div>
                </motion.div>


                {/* SECTION 3: MEMORY ANALYSIS */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="rounded-md border border-ink-500 bg-ink-100 p-6"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <MemoryStick className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">Memory Analysis</h3>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Detailed memory usage, caches, and allocators</p>
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

                  <div className="grid grid-cols-2 md:grid-cols-3 border-l border-t border-ink-500">
                    <StatCard
                      title="Memory Cache"
                      value={formatBytes(memoryBreakdownData?.values[2]?.slice(-1)[0] || 0)}
                      icon={Zap}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Jemalloc Allocated"
                      value={formatBytes(allocatorMemoryData?.values[0]?.slice(-1)[0] || 0)}
                      icon={Database}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Jemalloc Resident"
                      value={formatBytes(allocatorMemoryData?.values[1]?.slice(-1)[0] || 0)}
                      icon={HardDrive}
                      isLoading={prodLoading}
                    />
                  </div>
                </motion.div>

                {/* SECTION 4: LOAD AVERAGE & ZOOKEEPER */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="rounded-md border border-ink-500 bg-ink-100 p-6"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <Activity className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">System Load & ZooKeeper</h3>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Load average history and ZooKeeper/Keeper metrics</p>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <MetricChartCard
                      title="Load Average (15min)"
                      subtitle="System load average over time"
                      icon={Activity}
                      color="emerald"
                      data={loadAverageData}
                      isLoading={prodLoading}
                      chartTitle="Load"
                    />
                    <MetricChartCard
                      title="ZooKeeper Transactions"
                      subtitle="Keeper transactions per second (if using replicated tables)"
                      icon={Network}
                      color="blue"
                      data={zookeeperTransactionsData}
                      isLoading={prodLoading}
                      chartTitle="Txn/s"
                    />
                  </div>

                  {zookeeperBytesData && (
                    <div className="mt-6">
                      <MetricChartCard
                        title="ZooKeeper Traffic"
                        subtitle="Bytes sent and received from ZooKeeper/Keeper"
                        icon={Network}
                        color="cyan"
                        data={zookeeperBytesData}
                        isLoading={prodLoading}
                        chartTitle="Bytes"
                        hideLatestValues
                      />
                    </div>
                  )}
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
                  className="rounded-md border border-ink-500 bg-ink-100 p-6 md:col-span-3"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                      <Activity className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[14px] font-semibold tracking-tight text-paper">Network Traffic</h3>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Real-time bandwidth usage</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 border-l border-t border-ink-500">
                    <StatCard
                      title="Total Traffic"
                      value={formatBytesUtil((prodMetrics?.network?.network_receive_speed || 0) + (prodMetrics?.network?.network_send_speed || 0)) + "/s"}
                      icon={Activity}
                      isLoading={prodLoading}
                      subtitle="Inbound + Outbound"
                    />
                    <StatCard
                      title="Inbound"
                      value={formatBytesUtil(prodMetrics?.network?.network_receive_speed || 0) + "/s"}
                      icon={TrendingDown}
                      isLoading={prodLoading}
                    />
                    <StatCard
                      title="Outbound"
                      value={formatBytesUtil(prodMetrics?.network?.network_send_speed || 0) + "/s"}
                      icon={TrendingUp}
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
                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                onClick={() => setInternalTimeRange("15m")}
              >
                15 min
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                onClick={() => setInternalTimeRange("1h")}
              >
                1 hour
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                onClick={() => setInternalTimeRange("24h")}
              >
                24 hours
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 gap-2 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em]",
                  refreshInterval > 0
                    ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:border-emerald-800 hover:bg-emerald-950/60"
                    : "border-ink-500 bg-ink-100 text-paper hover:border-ink-700 hover:bg-ink-200"
                )}
                onClick={() => setInternalRefreshInterval(refreshInterval > 0 ? 0 : 30)}
              >
                {refreshInterval > 0 ? (
                  <>
                    <Pause className="h-3 w-3" />
                    Stop auto
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
