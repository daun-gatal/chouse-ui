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
import UPlotMetricItemComponent from "@/features/metrics/components/UPlotMetricItemComponent";
import { useMetrics } from "@/hooks";
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

export default function Metrics() {
  const [refreshInterval, setRefreshInterval] = useState<number>(0);
  const [timeRange, setTimeRange] = useState<string>("1h");
  const [activeTab, setActiveTab] = useState("overview");
  const [isRefreshCooldown, setIsRefreshCooldown] = useState(false);

  const { data: metrics, isLoading, refetch, error, dataUpdatedAt } = useMetrics(timeRange);

  // Debounced refresh
  const handleRefresh = React.useCallback(() => {
    if (isRefreshCooldown || isLoading) return;
    setIsRefreshCooldown(true);
    refetch();
    setTimeout(() => setIsRefreshCooldown(false), 3000);
  }, [isRefreshCooldown, isLoading, refetch]);

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
      const interval = setInterval(() => refetch(), refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, refetch]);

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "--:--:--";
  const stats = metrics?.currentStats;

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
                  Real-time server monitoring
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
              disabled={isLoading || isRefreshCooldown}
              className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
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
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
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
            title="Memory"
            value={stats?.memoryUsage.toFixed(2) || "0"}
            unit="GB"
            icon={MemoryStick}
            color="text-purple-400"
            bgColor="bg-purple-500/20"
            isLoading={isLoading}
          />
          <StatCard
            title="Active Queries"
            value={String(stats?.activeQueries || 0)}
            icon={Cpu}
            color="text-blue-400"
            bgColor="bg-blue-500/20"
            isLoading={isLoading}
          />
          <StatCard
            title="Connections"
            value={String(stats?.connections || 0)}
            icon={Users}
            color="text-cyan-400"
            bgColor="bg-cyan-500/20"
            isLoading={isLoading}
          />
          <StatCard
            title="Failed Queries"
            value={String(stats?.failedQueries || 0)}
            icon={stats?.failedQueries ? XCircle : CheckCircle2}
            color={stats?.failedQueries ? "text-red-400" : "text-green-400"}
            bgColor={stats?.failedQueries ? "bg-red-500/20" : "bg-green-500/20"}
            isLoading={isLoading}
            subtitle={`of ${stats?.totalQueries || 0} total`}
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

        {/* Secondary Stats */}
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
              <p className="text-lg font-semibold text-white">{stats?.totalQueries.toLocaleString() || 0}</p>
            </div>
          </div>
        </motion.div>

        {/* Tabs for Charts */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-white/5 border border-white/10 p-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white/10 gap-2">
              <BarChart3 className="h-4 w-4" />
              Query Activity
            </TabsTrigger>
            <TabsTrigger value="breakdown" className="data-[state=active]:bg-white/10 gap-2">
              <Layers className="h-4 w-4" />
              Query Breakdown
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
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
                title="Failed Queries"
                subtitle="Queries with errors"
                icon={XCircle}
                color="red"
                data={metrics?.failedQueries}
                isLoading={isLoading}
                chartTitle="Failed"
              />
            </div>
          </TabsContent>

          <TabsContent value="breakdown" className="space-y-4">
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
