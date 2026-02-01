import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Database,
  HardDrive,
  Clock,
  Zap,
  Network,
  ArrowRight,
  BarChart3,
  Layers,
  AlertTriangle,
  RefreshCw,
  Server,
  Terminal,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useSystemStats, useRecentQueries, useMetrics, useTopTables } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import UPlotMetricItemComponent from "@/features/metrics/components/UPlotMetricItemComponent";
import { useQueryClient } from "@tanstack/react-query";

// --- Styled Components ---

const DashboardCard = ({ children, className, title, icon: Icon, action }: any) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.98 }}
    animate={{ opacity: 1, scale: 1 }}
    className={cn(
      "relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0f]/80 backdrop-blur-xl shadow-2xl shadow-black/50 flex flex-col",
      className
    )}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />

    {(title || Icon) && (
      <div className="flex items-center justify-between p-5 pb-2 relative z-10">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="p-2 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/5 shadow-inner">
              <Icon className="w-4 h-4 text-gray-300" />
            </div>
          )}
          {title && (
            <h3 className="text-sm font-semibold text-gray-300 tracking-wide uppercase font-mono">
              {title}
            </h3>
          )}
        </div>
        {action}
      </div>
    )}

    <div className="flex-1 relative z-10">
      {children}
    </div>
  </motion.div>
);

const MetricValue = ({ label, value, unit, subtext, color = "text-white" }: any) => (
  <div>
    <p className="text-xs font-medium text-gray-500 mb-0.5">{label}</p>
    <div className="flex items-baseline gap-1.5">
      <span className={cn("text-2xl font-bold tracking-tight", color)}>{value}</span>
      {unit && <span className="text-sm font-medium text-gray-500">{unit}</span>}
    </div>
    {subtext && <p className="text-[10px] text-gray-600 font-mono mt-1">{subtext}</p>}
  </div>
);


// --- Main Page Component ---

export default function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, username, activeConnectionName, url: connectionUrl } = useAuthStore();
  const { data: stats, isLoading: statsLoading } = useSystemStats();
  const { data: metrics, isLoading: metricsLoading } = useMetrics("24h");
  const { data: topTables = [], isLoading: tablesLoading } = useTopTables(5);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Recent Activity Data
  const usernameFilter = isAdmin ? undefined : username || undefined;
  const { data: recentQueries = [], isLoading: queriesLoading } = useRecentQueries(10, usernameFilter);

  // --- Derived State & Formatters ---

  const displayStats = stats || {
    version: "-",
    uptime: 0,
    databaseCount: 0,
    tableCount: 0,
    totalRows: 0,
    totalSize: "0 B",
    memoryUsage: "0",
    activeConnections: 0,
    activeQueries: 0,
  };

  const currentQps = useMemo(() => {
    if (metrics?.queriesPerSecond?.values && metrics.queriesPerSecond.values.length > 0) {
      return metrics.queriesPerSecond.values[metrics.queriesPerSecond.values.length - 1];
    }
    return 0;
  }, [metrics]);

  const memoryUsageGB = useMemo(() => {
    if (metrics?.currentStats?.memoryUsage) return metrics.currentStats.memoryUsage;
    const str = displayStats.memoryUsage || "0";
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  }, [metrics, displayStats]);

  const MEMORY_LIMIT_VISUAL_BASELINE = 32;

  // Error count from metrics (last 24h)
  const errorCount = useMemo(() => {
    return metrics?.currentStats?.failedQueries || 0;
  }, [metrics]);

  const formatUptime = (seconds: number) => {
    if (!seconds) return "0s";
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${bytes} B`;
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      // Add a minimum delay of 500ms to allow user to see the spinner
      await new Promise(resolve => setTimeout(resolve, 500));
      // Dispatch event for other listeners if any (legacy compatibility)
      window.dispatchEvent(new CustomEvent('clickhouse:refresh'));
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#050508] text-white p-4 md:p-8 font-sans selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* 1. Header Section: Summary */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-2">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center shadow-[0_0_30px_rgba(249,115,22,0.3)]">
                <Database className="w-7 h-7 text-white" />
              </div>
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                {activeConnectionName || "Local ClickHouse"}
                <Badge variant="outline" className="bg-white/5 border-white/10 text-gray-400 font-mono font-normal text-xs py-0.5">
                  v{displayStats.version}
                </Badge>
              </h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-400 font-medium font-mono">
                <div className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5" />
                  {connectionUrl ? new URL(connectionUrl).host : "localhost"}
                </div>
                <div className="w-1 h-1 rounded-full bg-gray-700" />
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Up: {formatUptime(displayStats.uptime)}
                </div>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            className="border-white/10 bg-white/5 hover:bg-white/10 hover:text-white text-gray-400 transition-all active:scale-95"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
            Refresh Data
          </Button>
        </header>

        {/* 2. KPI Grid (Bento Top Row) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* QPS */}
          <DashboardCard className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                <Activity className="w-5 h-5" />
              </div>
            </div>
            <MetricValue
              label="Queries / Sec"
              value={currentQps.toFixed(1)}
              unit="QPS"
              color="text-blue-100"
            />
            <div className="mt-4 h-1 w-full bg-blue-500/10 rounded-full overflow-hidden">
              <div
                style={{
                  width: `${Math.min(100, currentQps * 2)}%` // Dynamic visual
                }}
                className="h-full bg-blue-500 shadow-[0_0_10px_#3b82f6]"
              />
            </div>
          </DashboardCard>

          {/* System Processes */}
          <DashboardCard className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
                <Zap className="w-5 h-5" />
              </div>
            </div>
            <MetricValue
              label="System Processes"
              value={displayStats.activeQueries}
              subtext="Active & Background"
              color="text-amber-100"
            />
          </DashboardCard>

          {/* Error Rate */}
          <DashboardCard className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>
            <MetricValue
              label="Errors (24h)"
              value={errorCount}
              subtext={errorCount === 0 ? "All clear" : "Check logs"}
              color={errorCount > 0 ? "text-red-100" : "text-green-100"}
            />
          </DashboardCard>

          {/* Memory Usage */}
          <DashboardCard className="p-5">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                <HardDrive className="w-5 h-5" />
              </div>
            </div>
            <MetricValue
              label="RAM Usage"
              value={memoryUsageGB.toFixed(2)}
              unit="GB"
              color="text-emerald-100"
            />
            <div className="mt-4 h-1 w-full bg-emerald-500/10 rounded-full overflow-hidden">
              <div
                style={{
                  width: `${Math.min(100, (memoryUsageGB / MEMORY_LIMIT_VISUAL_BASELINE) * 100)}%`
                }}
                className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981]"
              />
            </div>
          </DashboardCard>
        </div>

        {/* 3. Middle Section: Chart & Storage */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[350px]">

          {/* Main Chart */}
          <DashboardCard title="Query Traffic (24h)" icon={BarChart3} className="lg:col-span-2">
            <div className="flex-1 w-full h-full p-4 pt-0">
              {metricsLoading ? (
                <div className="flex items-center justify-center h-full text-gray-600">Loading Chart...</div>
              ) : metrics?.queriesPerSecond ? (
                <UPlotMetricItemComponent
                  data={metrics.queriesPerSecond}
                  title=""
                  color="rgb(59, 130, 246)"
                  fill="rgba(59, 130, 246, 0.15)"
                  unit=" qps"
                  height={280}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600">No chart data</div>
              )}
            </div>
          </DashboardCard>

          {/* Storage Summary - Redesigned Grid */}
          <DashboardCard title="Storage Overview" icon={Server} className="p-6">
            <div className="grid grid-cols-2 gap-4 h-full content-center">
              {/* Box 1: Databases */}
              <div className="bg-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2 text-indigo-400 mb-1">
                  <Database className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Databases</span>
                </div>
                <p className="text-2xl font-bold text-white">{displayStats.databaseCount}</p>
              </div>

              {/* Box 2: Tables */}
              <div className="bg-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2 text-sky-400 mb-1">
                  <Layers className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Tables</span>
                </div>
                <p className="text-2xl font-bold text-white">{displayStats.tableCount}</p>
              </div>

              {/* Box 3: Total Size */}
              <div className="bg-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2 text-orange-400 mb-1">
                  <HardDrive className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Size</span>
                </div>
                <p className="text-lg font-bold text-white truncate" title={displayStats.totalSize as string}>
                  {parseInt(displayStats.totalSize as string) ? displayStats.totalSize : "0 B"}
                </p>
              </div>

              {/* Box 4: Total Rows */}
              <div className="bg-white/5 rounded-2xl p-4 flex flex-col justify-center gap-1 hover:bg-white/10 transition-colors">
                <div className="flex items-center gap-2 text-emerald-400 mb-1">
                  <Server className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total Rows</span>
                </div>
                <p className="text-lg font-bold text-white truncate">
                  {displayStats.totalRows || '0'}
                </p>
              </div>
            </div>
          </DashboardCard>
        </div>

        {/* 4. Bottom Section: Top Tables & Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Top Tables */}
          <DashboardCard
            title="Largest Tables"
            icon={Search}
            className="h-[400px]"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate("/explorer")} className="text-xs h-7 text-gray-400 hover:text-white">
                View All <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            }
          >
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {tablesLoading ? (
                  <div className="p-8 text-center text-gray-500 text-sm">Loading tables...</div>
                ) : topTables.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">No tables found</div>
                ) : (
                  topTables.map((table, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-xs">
                          {i + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-200 truncate group-hover:text-white">{table.table}</p>
                          <p className="text-[10px] text-gray-500 font-mono">{table.database}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-300">{formatSize(table.bytes_on_disk)}</p>
                        <p className="text-[10px] text-gray-600 font-mono">{parseInt(table.rows as any).toLocaleString()} rows</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </DashboardCard>

          {/* Recent Activity */}
          <DashboardCard
            title="Recent Activity"
            icon={Terminal}
            className="h-[400px]"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate("/logs")} className="text-xs h-7 text-gray-400 hover:text-white">
                View Logs <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            }
          >
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {queriesLoading ? (
                  <div className="p-8 text-center text-gray-500 text-sm">Loading logs...</div>
                ) : recentQueries.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">No recent activity</div>
                ) : (
                  recentQueries.map((q, i) => (
                    <div key={i} className="p-3 rounded-xl hover:bg-white/5 transition-colors group">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-gray-500 font-mono">{new Date(q.time).toLocaleTimeString()}</span>
                        <Badge variant="outline" className={cn(
                          "text-[10px] px-1.5 py-0 border-0",
                          q.status === "Success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                        )}>
                          {q.duration < 1 ? "<1ms" : `${q.duration}ms`}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-300 font-mono line-clamp-2 group-hover:text-white transition-colors" title={q.query}>
                        {q.query}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
