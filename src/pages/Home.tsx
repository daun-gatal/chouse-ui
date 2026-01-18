import React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Database,
  HardDrive,
  Clock,
  Server,
  Terminal,
  CheckCircle,
  XCircle,
  Cpu,
  Zap,
  Network,
  TrendingUp,
  ArrowRight,
  BarChart3,
  FileText,
  Users,
  Settings,
  Layers,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useSystemStats, useRecentQueries } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { cn } from "@/lib/utils";

// Stat card component with gradient background
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  bgGradient: string;
  isLoading?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  bgGradient,
  isLoading,
}) => (
  <motion.div
    whileHover={{ scale: 1.02, y: -2 }}
    className={cn(
      "relative overflow-hidden rounded-2xl p-5",
      "bg-gradient-to-br backdrop-blur-xl",
      "border border-white/10 hover:border-white/20 transition-all duration-300",
      bgGradient
    )}
  >
    <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-white/5 blur-2xl" />
    <div className="relative z-10 flex items-start justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</p>
        {isLoading ? (
          <div className="h-8 w-20 bg-white/10 rounded animate-pulse" />
        ) : (
          <div className="text-2xl font-bold text-white">{value}</div>
        )}
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      <div className={cn("p-2.5 rounded-xl", color.replace("text-", "bg-").replace("400", "500/20"))}>
        <Icon className={cn("h-5 w-5", color)} />
      </div>
    </div>
  </motion.div>
);

// Quick action card
interface ActionCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  onClick: () => void;
}

const ActionCard: React.FC<ActionCardProps> = ({
  title,
  description,
  icon: Icon,
  color,
  onClick,
}) => (
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={cn(
      "relative overflow-hidden rounded-xl p-4 text-left",
      "bg-white/5 border border-white/10",
      "hover:border-white/20 hover:bg-white/10 transition-all duration-300",
      "group"
    )}
  >
    <div className="flex items-center gap-3">
      <div className={cn("p-2 rounded-lg transition-colors", color)}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1">
        <h3 className="font-medium text-white text-sm">{title}</h3>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
    </div>
  </motion.button>
);

export default function HomePage() {
  const navigate = useNavigate();
  const { isAdmin, username } = useAuthStore();
  const { hasPermission, hasAnyPermission } = useRbacStore();
  const { data: stats, isLoading: statsLoading } = useSystemStats();
  
  // Check permissions for quick actions
  const canViewExplorer = hasAnyPermission([
    RBAC_PERMISSIONS.DB_VIEW,
    RBAC_PERMISSIONS.TABLE_VIEW,
  ]);
  const canViewMetrics = hasAnyPermission([
    RBAC_PERMISSIONS.METRICS_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
  ]);
  const canViewLogs = hasAnyPermission([
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW,
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
  ]);
  const canViewAdmin = hasAnyPermission([
    RBAC_PERMISSIONS.USERS_VIEW,
    RBAC_PERMISSIONS.USERS_CREATE,
    RBAC_PERMISSIONS.ROLES_VIEW,
    RBAC_PERMISSIONS.AUDIT_VIEW,
  ]);
  
  // Non-admin users only see their own queries
  const usernameFilter = isAdmin ? undefined : username || undefined;
  const { data: recentQueries = [], isLoading: queriesLoading } = useRecentQueries(7, usernameFilter);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatBytes = (bytes: string | number) => {
    const num = typeof bytes === "string" ? parseFloat(bytes) : bytes;
    if (num >= 1e12) return `${(num / 1e12).toFixed(2)} TB`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)} GB`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)} MB`;
    return bytes.toString();
  };

  // Format is now handled by backend - this just ensures proper display
  const formatNumber = (value: string | number) => {
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") {
      if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
      if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
      return value.toLocaleString();
    }
    return "0";
  };

  const defaultStats = {
    version: "-",
    uptime: 0,
    databaseCount: 0,
    tableCount: 0,
    totalRows: "0",
    totalSize: "0 B",
    memoryUsage: "0 B",
    cpuLoad: 0,
    activeConnections: 0,
    activeQueries: 0,
  };

  const displayStats = stats || defaultStats;

  const successfulQueries = recentQueries.filter((q) => q.status === "Success").length;
  const failedQueries = recentQueries.filter((q) => q.status !== "Success").length;

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header with Status */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-between items-start flex-wrap gap-4"
        >
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-purple-500/20">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-[#0a0a0f]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">
                Welcome Back
              </h1>
              <p className="text-gray-400 text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                ClickHouse {statsLoading ? "..." : displayStats.version} • {formatUptime(displayStats.uptime)} uptime
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-green-500/10 border-green-500/30 text-green-400 gap-1.5 py-1.5">
              <CheckCircle className="h-3.5 w-3.5" />
              Server Healthy
            </Badge>
          </div>
        </motion.div>

        {/* Key Stats Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
        >
          <StatCard
            title="Databases"
            value={displayStats.databaseCount}
            icon={Database}
            color="text-purple-400"
            bgGradient="from-purple-500/10 to-transparent"
            isLoading={statsLoading}
          />
          <StatCard
            title="Tables"
            value={displayStats.tableCount}
            icon={Layers}
            color="text-blue-400"
            bgGradient="from-blue-500/10 to-transparent"
            isLoading={statsLoading}
          />
          <StatCard
            title="Total Rows"
            value={formatNumber(displayStats.totalRows)}
            icon={Activity}
            color="text-emerald-400"
            bgGradient="from-emerald-500/10 to-transparent"
            isLoading={statsLoading}
          />
          <StatCard
            title="Storage"
            value={formatBytes(displayStats.totalSize)}
            icon={HardDrive}
            color="text-orange-400"
            bgGradient="from-orange-500/10 to-transparent"
            isLoading={statsLoading}
          />
          <StatCard
            title="Memory"
            value={displayStats.memoryUsage}
            icon={Cpu}
            color="text-pink-400"
            bgGradient="from-pink-500/10 to-transparent"
            isLoading={statsLoading}
          />
          <StatCard
            title="Connections"
            value={displayStats.activeConnections}
            icon={Network}
            color="text-cyan-400"
            bgGradient="from-cyan-500/10 to-transparent"
            isLoading={statsLoading}
          />
        </motion.div>

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent Queries - Takes 2 columns */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-2 rounded-2xl bg-white/5 border border-white/10 overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Terminal className="h-4 w-4 text-purple-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">Recent Queries</h2>
                  <p className="text-xs text-gray-500">{recentQueries.length} latest queries</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {successfulQueries > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10">
                    <CheckCircle className="h-3 w-3 text-green-400" />
                    <span className="text-xs text-green-400 font-medium">{successfulQueries}</span>
                  </div>
                )}
                {failedQueries > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/10">
                    <XCircle className="h-3 w-3 text-red-400" />
                    <span className="text-xs text-red-400 font-medium">{failedQueries}</span>
                  </div>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="divide-y divide-white/5">
                {queriesLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-3 text-gray-500">
                      <div className="w-8 h-8 border-2 border-gray-600 border-t-purple-500 rounded-full animate-spin" />
                      <span className="text-sm">Loading queries...</span>
                    </div>
                  </div>
                ) : recentQueries.length > 0 ? (
                  recentQueries.map((q, i) => {
                    // Detect query type
                    const queryUpper = q.query.trim().toUpperCase();
                    const queryType = queryUpper.startsWith("SELECT") ? "SELECT" :
                                     queryUpper.startsWith("INSERT") ? "INSERT" :
                                     queryUpper.startsWith("CREATE") ? "CREATE" :
                                     queryUpper.startsWith("ALTER") ? "ALTER" :
                                     queryUpper.startsWith("DROP") ? "DROP" :
                                     queryUpper.startsWith("SHOW") ? "SHOW" : "OTHER";
                    
                    const typeColors: Record<string, string> = {
                      SELECT: "bg-blue-500/20 text-blue-400",
                      INSERT: "bg-green-500/20 text-green-400",
                      CREATE: "bg-purple-500/20 text-purple-400",
                      ALTER: "bg-orange-500/20 text-orange-400",
                      DROP: "bg-red-500/20 text-red-400",
                      SHOW: "bg-cyan-500/20 text-cyan-400",
                      OTHER: "bg-gray-500/20 text-gray-400",
                    };

                    // Format duration
                    const formatDuration = (ms: number) => {
                      if (ms < 1) return "<1ms";
                      if (ms < 1000) return `${ms}ms`;
                      return `${(ms / 1000).toFixed(2)}s`;
                    };

                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        className={cn(
                          "group px-4 py-3 hover:bg-white/5 transition-colors cursor-default"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {/* Status indicator */}
                          <div className={cn(
                            "mt-1 w-2 h-2 rounded-full flex-shrink-0",
                            q.status === "Success" ? "bg-green-500" : "bg-red-500"
                          )} />
                          
                          {/* Query content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                typeColors[queryType]
                              )}>
                                {queryType}
                              </span>
                              <span className="text-[10px] text-gray-500">
                                {new Date(q.time).toLocaleTimeString()}
                              </span>
                            </div>
                            <p 
                              className="text-sm text-gray-300 font-mono leading-relaxed line-clamp-2 group-hover:text-white transition-colors" 
                              title={q.query}
                            >
                              {q.query}
                            </p>
                          </div>

                          {/* Duration */}
                          <div className={cn(
                            "flex-shrink-0 px-2 py-1 rounded text-xs font-mono",
                            q.duration > 1000 ? "bg-amber-500/20 text-amber-400" : "bg-white/10 text-gray-400"
                          )}>
                            {formatDuration(q.duration)}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                    <Terminal className="h-12 w-12 opacity-20 mb-3" />
                    <span className="text-sm font-medium">No recent queries</span>
                    <span className="text-xs text-gray-600 mt-1">Execute a query to see it here</span>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="mt-auto px-4 py-2 border-t border-white/10 bg-white/[0.02]">
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-gray-400 hover:text-white gap-1.5 hover:bg-white/5"
                onClick={() => navigate("/logs")}
              >
                View All Logs
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </motion.div>

          {/* Right Column - Quick Actions & Server Info */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-4"
          >
            {/* Quick Actions */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-amber-400" />
                <h3 className="font-semibold text-white text-sm">Quick Actions</h3>
              </div>
              <div className="space-y-2">
                {canViewExplorer && (
                  <ActionCard
                    title="Explore Data"
                    description="Browse databases & tables"
                    icon={Database}
                    color="bg-purple-500/80"
                    onClick={() => navigate("/explorer")}
                  />
                )}
                {canViewMetrics && (
                  <ActionCard
                    title="View Metrics"
                    description="Monitor performance"
                    icon={BarChart3}
                    color="bg-blue-500/80"
                    onClick={() => navigate("/metrics")}
                  />
                )}
                {canViewLogs && (
                  <ActionCard
                    title="Query Logs"
                    description="View execution history"
                    icon={FileText}
                    color="bg-emerald-500/80"
                    onClick={() => navigate("/logs")}
                  />
                )}
                {canViewAdmin && (
                  <ActionCard
                    title="Admin Panel"
                    description="Manage users & roles"
                    icon={Users}
                    color="bg-orange-500/80"
                    onClick={() => navigate("/admin")}
                  />
                )}
              </div>
            </div>

            {/* Server Status */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Server className="h-4 w-4 text-blue-400" />
                <h3 className="font-semibold text-white text-sm">Server Status</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                  <span className="text-xs text-gray-400">Version</span>
                  <span className="font-mono text-sm text-white">
                    {statsLoading ? "-" : displayStats.version}
                  </span>
                </div>
                <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                  <span className="text-xs text-gray-400">Uptime</span>
                  <span className="font-mono text-sm text-white">
                    {statsLoading ? "-" : formatUptime(displayStats.uptime)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                  <span className="text-xs text-gray-400">Active Queries</span>
                  <span className="font-mono text-sm text-white">
                    {statsLoading ? "-" : displayStats.activeQueries}
                  </span>
                </div>
                <div className="flex justify-between items-center p-2 rounded-lg bg-white/5">
                  <span className="text-xs text-gray-400">CPU Load</span>
                  <span className="font-mono text-sm text-white">
                    {statsLoading ? "-" : displayStats.cpuLoad.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-2 rounded-lg bg-green-500/10">
                  <span className="text-xs text-gray-400">Status</span>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm text-green-400 font-medium">Active</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
