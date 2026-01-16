import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  RefreshCw,
  Clock,
  Cpu,
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
import { cn } from "@/lib/utils";

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

interface MetricChartCardProps {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  data?: { timestamps: number[]; values: number[] };
  isLoading: boolean;
  chartTitle: string;
}

const MetricChartCard: React.FC<MetricChartCardProps> = ({
  title,
  subtitle,
  icon: Icon,
  color,
  data,
  isLoading,
  chartTitle,
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
        {data && data.values.length > 0 && (
          <Badge variant="secondary" className="bg-white/10 text-gray-300">
            Latest: {data.values[data.values.length - 1]?.toFixed(2)}
          </Badge>
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
          <UPlotMetricItemComponent data={data} title={chartTitle} />
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

export default function Metrics() {
  const [refreshInterval, setRefreshInterval] = useState<number>(0);
  const [timeRange, setTimeRange] = useState<string>("1h");
  const [activeTab, setActiveTab] = useState("overview");
  const [isRefreshCooldown, setIsRefreshCooldown] = useState(false);

  const intervalMinutes = getIntervalMinutes(timeRange);
  
  const { data: metrics, isLoading, isFetching, refetch, error, dataUpdatedAt } = useMetrics(timeRange);
  const { 
    data: prodMetrics, 
    isLoading: prodLoading, 
    isFetching: prodFetching,
    refetch: refetchProd 
  } = useProductionMetrics(intervalMinutes);

  // Combined loading/fetching state
  const isAnyLoading = isLoading || prodLoading;
  const isAnyFetching = isFetching || prodFetching;

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

  // Auto-refresh effect
  React.useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(() => {
        refetch();
        refetchProd();
      }, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, refetch, refetchProd]);

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

  // Get primary disk stats
  const primaryDisk = prodMetrics?.disks?.[0];

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
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

            <Select value={timeRange} onValueChange={setTimeRange}>
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

            <Select value={String(refreshInterval)} onValueChange={(v) => setRefreshInterval(Number(v))}>
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

        {/* Key Metrics Row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3"
        >
          <StatCard
            title="Queries/sec"
            value={metrics?.queriesPerSecond?.values.slice(-1)[0]?.toFixed(1) || "0"}
            unit="qps"
            icon={Zap}
            color="text-amber-400"
            bgColor="bg-amber-500/20"
            trend={qpsTrend}
            isLoading={isLoading}
          />
          <StatCard
            title="p95 Latency"
            value={formatMs(prodMetrics?.latency?.p95_ms || 0)}
            icon={Gauge}
            color="text-orange-400"
            bgColor="bg-orange-500/20"
            isLoading={prodLoading}
          />
          <StatCard
            title="p99 Latency"
            value={formatMs(prodMetrics?.latency?.p99_ms || 0)}
            icon={Gauge}
            color="text-red-400"
            bgColor="bg-red-500/20"
            isLoading={prodLoading}
          />
          <StatCard
            title="Memory"
            value={stats?.memoryUsage.toFixed(2) || "0"}
            unit="GB"
            icon={MemoryStick}
            color="text-purple-400"
            bgColor="bg-purple-500/20"
            isLoading={isLoading}
          />
          <StatCard
            title="Disk Used"
            value={primaryDisk ? `${primaryDisk.used_percent.toFixed(0)}` : "0"}
            unit="%"
            icon={HardDrive}
            color="text-cyan-400"
            bgColor="bg-cyan-500/20"
            isLoading={prodLoading}
            subtitle={primaryDisk ? formatBytes(primaryDisk.free_space) + " free" : undefined}
          />
          <StatCard
            title="Active Merges"
            value={String(prodMetrics?.merges?.active_merges || 0)}
            icon={GitMerge}
            color="text-blue-400"
            bgColor="bg-blue-500/20"
            isLoading={prodLoading}
          />
          <StatCard
            title="Connections"
            value={String(stats?.connections || 0)}
            icon={Users}
            color="text-green-400"
            bgColor="bg-green-500/20"
            isLoading={isLoading}
          />
          <StatCard
            title="Uptime"
            value={formatUptime(stats?.uptime || 0)}
            icon={Server}
            color="text-emerald-400"
            bgColor="bg-emerald-500/20"
            isLoading={isLoading}
          />
        </motion.div>

        {/* Tabs for different metric views */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-white/5 border border-white/10 p-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white/10 gap-2">
              <BarChart3 className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-white/10 gap-2">
              <Gauge className="h-4 w-4" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="storage" className="data-[state=active]:bg-white/10 gap-2">
              <HardDrive className="h-4 w-4" />
              Storage
            </TabsTrigger>
            <TabsTrigger value="merges" className="data-[state=active]:bg-white/10 gap-2">
              <GitMerge className="h-4 w-4" />
              Merges
            </TabsTrigger>
            <TabsTrigger value="errors" className="data-[state=active]:bg-white/10 gap-2">
              <AlertCircle className="h-4 w-4" />
              Errors
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            {/* Secondary Stats Row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-3"
            >
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <Database className="h-5 w-5 text-blue-400" />
                <div>
                  <p className="text-xs text-gray-400">Databases</p>
                  <p className="text-lg font-semibold text-white">{stats?.databasesCount || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <Table2 className="h-5 w-5 text-green-400" />
                <div>
                  <p className="text-xs text-gray-400">Tables</p>
                  <p className="text-lg font-semibold text-white">{stats?.tablesCount || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <Layers className="h-5 w-5 text-orange-400" />
                <div>
                  <p className="text-xs text-gray-400">Active Parts</p>
                  <p className="text-lg font-semibold text-white">{stats?.partsCount || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                <ArrowUpDown className="h-5 w-5 text-purple-400" />
                <div>
                  <p className="text-xs text-gray-400">Total Queries</p>
                  <p className="text-lg font-semibold text-white">{stats?.totalQueries?.toLocaleString() || 0}</p>
                </div>
              </div>
            </motion.div>

            <div className="grid gap-6 lg:grid-cols-2">
              <MetricChartCard
                title="Total Queries per Second"
                subtitle="All query types combined"
                icon={Zap}
                color="amber"
                data={metrics?.queriesPerSecond}
                isLoading={isLoading}
                chartTitle="Queries/s"
              />
              <MetricChartCard
                title="Insert Throughput"
                subtitle="Rows inserted per second"
                icon={HardDriveDownload}
                color="emerald"
                data={insertThroughputData}
                isLoading={prodLoading}
                chartTitle="Rows/s"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <MetricChartCard
                title="SELECT Queries"
                subtitle="Read operations per second"
                icon={Database}
                color="blue"
                data={metrics?.selectQueries}
                isLoading={isLoading}
                chartTitle="Select/s"
              />
              <MetricChartCard
                title="INSERT Queries"
                subtitle="Write operations per second"
                icon={HardDrive}
                color="emerald"
                data={metrics?.insertQueries}
                isLoading={isLoading}
                chartTitle="Insert/s"
              />
            </div>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="space-y-4">
            {/* Latency Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
                title="p95 Latency"
                value={formatMs(prodMetrics?.latency?.p95_ms || 0)}
                icon={Gauge}
                color="text-orange-400"
                bgColor="bg-orange-500/20"
                isLoading={prodLoading}
              />
              <StatCard
                title="p99 Latency"
                value={formatMs(prodMetrics?.latency?.p99_ms || 0)}
                icon={Gauge}
                color="text-red-400"
                bgColor="bg-red-500/20"
                isLoading={prodLoading}
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

            {/* Cache Performance */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-cyan-500/20">
                  <Cpu className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Cache Performance</h3>
                  <p className="text-xs text-gray-500">Hit ratios indicate cache efficiency</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Mark Cache Hit Ratio</span>
                    <span className="text-white font-medium">
                      {prodMetrics?.cache?.mark_cache_hit_ratio?.toFixed(1) || 0}%
                    </span>
                  </div>
                  <Progress 
                    value={prodMetrics?.cache?.mark_cache_hit_ratio || 0} 
                    className="h-2 bg-white/10"
                  />
                  <p className="text-xs text-gray-500">
                    {(prodMetrics?.cache?.mark_cache_hits || 0).toLocaleString()} hits / {(prodMetrics?.cache?.mark_cache_misses || 0).toLocaleString()} misses
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Uncompressed Cache Hit Ratio</span>
                    <span className="text-white font-medium">
                      {prodMetrics?.cache?.uncompressed_cache_hit_ratio?.toFixed(1) || 0}%
                    </span>
                  </div>
                  <Progress 
                    value={prodMetrics?.cache?.uncompressed_cache_hit_ratio || 0} 
                    className="h-2 bg-white/10"
                  />
                  <p className="text-xs text-gray-500">
                    {(prodMetrics?.cache?.uncompressed_cache_hits || 0).toLocaleString()} hits / {(prodMetrics?.cache?.uncompressed_cache_misses || 0).toLocaleString()} misses
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Resource Usage */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                title="CPU Load"
                value={((prodMetrics?.resources?.cpu_load ?? 0) * 100).toFixed(1)}
                unit="%"
                icon={Cpu}
                color="text-red-400"
                bgColor="bg-red-500/20"
                isLoading={prodLoading}
              />
              <StatCard
                title="Memory Resident"
                value={prodMetrics?.resources?.memory_resident?.toFixed(2) || "0"}
                unit="GB"
                icon={MemoryStick}
                color="text-purple-400"
                bgColor="bg-purple-500/20"
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
                title="Background Tasks"
                value={String(prodMetrics?.resources?.background_pool_tasks || 0)}
                icon={Layers}
                color="text-green-400"
                bgColor="bg-green-500/20"
                isLoading={prodLoading}
              />
            </div>
          </TabsContent>

          {/* Storage Tab */}
          <TabsContent value="storage" className="space-y-4">
            {/* Loading State */}
            {prodLoading && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-8 text-center"
              >
                <RefreshCw className="h-8 w-8 text-gray-500 mx-auto mb-4 animate-spin" />
                <p className="text-gray-400">Loading storage metrics...</p>
              </motion.div>
            )}

            {/* Disk Stats */}
            {!prodLoading && prodMetrics?.disks && prodMetrics.disks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-cyan-500/20">
                    <Disc className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Disk Usage</h3>
                    <p className="text-xs text-gray-500">Storage space across all disks</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {prodMetrics.disks.map((disk) => (
                    <div key={disk.name} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-gray-400" />
                          <span className="text-white font-medium">{disk.name}</span>
                          <span className="text-xs text-gray-500">{disk.path}</span>
                        </div>
                        <span className={cn(
                          "text-sm font-medium",
                          disk.used_percent > 90 ? "text-red-400" :
                          disk.used_percent > 75 ? "text-orange-400" : "text-green-400"
                        )}>
                          {disk.used_percent.toFixed(1)}% used
                        </span>
                      </div>
                      <Progress 
                        value={disk.used_percent} 
                        className={cn(
                          "h-3 bg-white/10",
                          disk.used_percent > 90 && "[&>div]:bg-red-500",
                          disk.used_percent > 75 && disk.used_percent <= 90 && "[&>div]:bg-orange-500"
                        )}
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Used: {formatBytes(disk.used_space)}</span>
                        <span>Free: {formatBytes(disk.free_space)}</span>
                        <span>Total: {formatBytes(disk.total_space)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Empty disk state */}
            {!prodLoading && (!prodMetrics?.disks || prodMetrics.disks.length === 0) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-cyan-500/20">
                    <Disc className="h-5 w-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Disk Usage</h3>
                    <p className="text-xs text-gray-500">Storage space across all disks</p>
                  </div>
                </div>
                <div className="text-center py-8">
                  <HardDrive className="h-12 w-12 text-gray-500 mx-auto mb-4 opacity-50" />
                  <p className="text-gray-400">No disk metrics available</p>
                  <p className="text-xs text-gray-500 mt-2">Check your ClickHouse permissions or connection</p>
                </div>
              </motion.div>
            )}

            {/* Top Tables by Size */}
            {!prodLoading && prodMetrics?.topTables && prodMetrics.topTables.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Table2 className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Top Tables by Size</h3>
                    <p className="text-xs text-gray-500">Largest tables in your cluster</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs text-gray-400 font-medium pb-3">Table</th>
                        <th className="text-right text-xs text-gray-400 font-medium pb-3">Rows</th>
                        <th className="text-right text-xs text-gray-400 font-medium pb-3">Size</th>
                        <th className="text-right text-xs text-gray-400 font-medium pb-3">Parts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodMetrics.topTables.map((table, idx) => (
                        <tr key={`${table.database}.${table.table}`} className="border-b border-white/5">
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500 text-xs w-5">{idx + 1}.</span>
                              <span className="text-white">{table.database}.<span className="text-blue-400">{table.table}</span></span>
                            </div>
                          </td>
                          <td className="text-right text-gray-300">{table.rows.toLocaleString()}</td>
                          <td className="text-right text-gray-300">{table.compressed_size}</td>
                          <td className="text-right">
                            <Badge variant="secondary" className={cn(
                              "bg-white/10",
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
              </motion.div>
            )}

            {/* Empty tables state */}
            {!prodLoading && (!prodMetrics?.topTables || prodMetrics.topTables.length === 0) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Table2 className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Top Tables by Size</h3>
                    <p className="text-xs text-gray-500">Largest tables in your cluster</p>
                  </div>
                </div>
                <div className="text-center py-8">
                  <Table2 className="h-12 w-12 text-gray-500 mx-auto mb-4 opacity-50" />
                  <p className="text-gray-400">No tables found</p>
                  <p className="text-xs text-gray-500 mt-2">Create some tables to see storage metrics</p>
                </div>
              </motion.div>
            )}
          </TabsContent>

          {/* Merges Tab */}
          <TabsContent value="merges" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard
                title="Active Merges"
                value={String(prodMetrics?.merges?.active_merges || 0)}
                icon={GitMerge}
                color="text-blue-400"
                bgColor="bg-blue-500/20"
                isLoading={prodLoading}
              />
              <StatCard
                title="Merge Queue"
                value={String(prodMetrics?.merges?.merge_queue_size || 0)}
                icon={FileStack}
                color="text-purple-400"
                bgColor="bg-purple-500/20"
                isLoading={prodLoading}
              />
              <StatCard
                title="Pending Mutations"
                value={String(prodMetrics?.merges?.pending_mutations || 0)}
                icon={Combine}
                color="text-orange-400"
                bgColor="bg-orange-500/20"
                isLoading={prodLoading}
              />
              <StatCard
                title="Parts to Merge"
                value={String(prodMetrics?.merges?.parts_to_merge || 0)}
                icon={Layers}
                color="text-cyan-400"
                bgColor="bg-cyan-500/20"
                isLoading={prodLoading}
              />
              <StatCard
                title="Active Parts"
                value={String(stats?.partsCount || 0)}
                icon={CircleDot}
                color="text-green-400"
                bgColor="bg-green-500/20"
                isLoading={isLoading}
              />
            </div>

            {/* Replication Status */}
            {prodMetrics?.replication && prodMetrics.replication.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <Network className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Replication Status</h3>
                    <p className="text-xs text-gray-500">ReplicatedMergeTree tables status</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs text-gray-400 font-medium pb-3">Table</th>
                        <th className="text-center text-xs text-gray-400 font-medium pb-3">Leader</th>
                        <th className="text-center text-xs text-gray-400 font-medium pb-3">Readonly</th>
                        <th className="text-right text-xs text-gray-400 font-medium pb-3">Delay</th>
                        <th className="text-right text-xs text-gray-400 font-medium pb-3">Queue</th>
                        <th className="text-right text-xs text-gray-400 font-medium pb-3">Replicas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodMetrics.replication.map((rep) => (
                        <tr key={`${rep.database}.${rep.table}`} className="border-b border-white/5">
                          <td className="py-3">
                            <span className="text-white">{rep.database}.<span className="text-blue-400">{rep.table}</span></span>
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
                              <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-green-400 mx-auto" />
                            )}
                          </td>
                          <td className="text-right">
                            <span className={cn(
                              rep.absolute_delay > 300 ? "text-red-400" :
                              rep.absolute_delay > 60 ? "text-orange-400" : "text-gray-300"
                            )}>
                              {rep.absolute_delay}s
                            </span>
                          </td>
                          <td className="text-right text-gray-300">{rep.queue_size}</td>
                          <td className="text-right">
                            <span className={cn(
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
              </motion.div>
            )}

            {/* No replicated tables message */}
            {(!prodMetrics?.replication || prodMetrics.replication.length === 0) && !prodLoading && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-8 text-center"
              >
                <Network className="h-12 w-12 text-gray-500 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400">No replicated tables found</p>
                <p className="text-xs text-gray-500 mt-2">ReplicatedMergeTree tables will appear here</p>
              </motion.div>
            )}
          </TabsContent>

          {/* Errors Tab */}
          <TabsContent value="errors" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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

            <MetricChartCard
              title="Failed Queries Over Time"
              subtitle="Queries with errors"
              icon={XCircle}
              color="red"
              data={metrics?.failedQueries}
              isLoading={isLoading}
              chartTitle="Failed"
            />

            {/* Error Breakdown Table */}
            {prodMetrics?.errors && prodMetrics.errors.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-red-500/20">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Error Breakdown</h3>
                    <p className="text-xs text-gray-500">Grouped by exception type</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {prodMetrics.errors.map((err) => (
                    <div key={err.exception_code} className="p-4 rounded-lg bg-white/5 border border-white/10">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" className="bg-red-500/20 text-red-400">
                              {err.exception_name}
                            </Badge>
                            <span className="text-xs text-gray-500">Code: {err.exception_code}</span>
                          </div>
                          <p className="text-xs text-gray-400 truncate">{err.sample_error}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xl font-bold text-white">{err.count}</p>
                          <p className="text-xs text-gray-500">occurrences</p>
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
                className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl p-8 text-center"
              >
                <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-4" />
                <p className="text-green-400 font-medium">No errors in the selected time range</p>
                <p className="text-xs text-gray-500 mt-2">All queries completed successfully</p>
              </motion.div>
            )}
          </TabsContent>
        </Tabs>

        {/* Quick Actions */}
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
            onClick={() => setTimeRange("15m")}
          >
            15min
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
            onClick={() => setTimeRange("1h")}
          >
            1 Hour
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
            onClick={() => setTimeRange("24h")}
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
            onClick={() => setRefreshInterval(refreshInterval > 0 ? 0 : 30)}
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
      </div>
    </div>
  );
}
