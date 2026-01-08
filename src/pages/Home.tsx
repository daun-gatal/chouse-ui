import { motion } from "framer-motion";
import { Activity, Database, HardDrive, Clock, Server, Terminal, CheckCircle, XCircle, Cpu, Zap, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { useSystemStats, useRecentQueries } from "@/hooks";

export default function HomePage() {
  const navigate = useNavigate();
  
  // Use React Query hooks for data fetching
  const { data: stats, isLoading: statsLoading } = useSystemStats();
  const { data: recentQueries = [], isLoading: queriesLoading } = useRecentQueries(5);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
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

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="container mx-auto p-6 space-y-6"
    >
      <motion.div variants={item} className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white/90">Overview</h1>
        <p className="text-gray-400">Welcome to your ClickHouse Dashboard.</p>
      </motion.div>

      {/* Cluster Overview */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <motion.div variants={item}>
          <GlassCard>
            <GlassCardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-gray-400">Total Databases</p>
                <Database className="h-4 w-4 text-purple-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? "-" : displayStats.databaseCount}
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>

        <motion.div variants={item}>
          <GlassCard>
            <GlassCardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-gray-400">Total Tables</p>
                <Database className="h-4 w-4 text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? "-" : displayStats.tableCount}
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>

        <motion.div variants={item}>
          <GlassCard>
            <GlassCardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-gray-400">Total Rows</p>
                <Activity className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? "-" : displayStats.totalRows}
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>

        <motion.div variants={item}>
          <GlassCard>
            <GlassCardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-gray-400">Storage Used</p>
                <HardDrive className="h-4 w-4 text-orange-400" />
              </div>
              <div className="text-2xl font-bold text-white">
                {statsLoading ? "-" : displayStats.totalSize}
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>
      </div>

      {/* Detailed Health Metrics */}
      <motion.div variants={item} className="grid gap-6 md:grid-cols-4">
        <GlassCard className="col-span-4 p-0 overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-white/10 bg-white/5">
            <div className="p-6 flex flex-col items-center justify-center text-center gap-2">
              <div className="p-2 bg-pink-500/10 rounded-full">
                <Cpu className="h-5 w-5 text-pink-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">CPU Load</p>
                <p className="text-xl font-bold text-white font-mono">
                  {statsLoading ? "-" : displayStats.cpuLoad.toFixed(2)}
                </p>
              </div>
            </div>
            <div className="p-6 flex flex-col items-center justify-center text-center gap-2">
              <div className="p-2 bg-yellow-500/10 rounded-full">
                <HardDrive className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Memory Usage</p>
                <p className="text-xl font-bold text-white font-mono">
                  {statsLoading ? "-" : displayStats.memoryUsage}
                </p>
              </div>
            </div>
            <div className="p-6 flex flex-col items-center justify-center text-center gap-2">
              <div className="p-2 bg-cyan-500/10 rounded-full">
                <Network className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">TCP Connections</p>
                <p className="text-xl font-bold text-white font-mono">
                  {statsLoading ? "-" : displayStats.activeConnections}
                </p>
              </div>
            </div>
            <div className="p-6 flex flex-col items-center justify-center text-center gap-2">
              <div className="p-2 bg-green-500/10 rounded-full">
                <Zap className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Running Queries</p>
                <p className="text-xl font-bold text-white font-mono">
                  {statsLoading ? "-" : displayStats.activeQueries}
                </p>
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-7">
        <motion.div variants={item} className="md:col-span-4">
          <GlassCard className="h-full">
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-purple-400" />
                Recent Queries
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              <ScrollArea className="h-[300px] w-full pr-4">
                <div className="space-y-4">
                  {queriesLoading ? (
                    <div className="text-center text-gray-500 py-10">Loading...</div>
                  ) : recentQueries.length > 0 ? (
                    recentQueries.map((q, i) => (
                      <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                        <div className="space-y-1 overflow-hidden">
                          <p className="text-sm text-gray-300 font-mono truncate max-w-[400px]" title={q.query}>
                            {q.query}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {q.duration}ms
                            </span>
                            <span>{new Date(q.time).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <div>
                          {q.status === 'Success' ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 py-10">No recent queries found</div>
                  )}
                </div>
              </ScrollArea>
            </GlassCardContent>
          </GlassCard>
        </motion.div>

        <motion.div variants={item} className="md:col-span-3 space-y-6">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-blue-400" />
                Cluster Info
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <div className="flex justify-between items-center p-3 rounded-lg bg-white/5">
                <span className="text-sm text-gray-400">Version</span>
                <span className="font-mono text-white">
                  {statsLoading ? "-" : displayStats.version}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-white/5">
                <span className="text-sm text-gray-400">Uptime</span>
                <span className="font-mono text-white">
                  {statsLoading ? "-" : formatUptime(displayStats.uptime)}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-lg bg-white/5">
                <span className="text-sm text-gray-400">Status</span>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400 font-medium text-sm">Active</span>
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>

          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle>Quick Actions</GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2 bg-white/5 border-white/10 hover:bg-purple-500/20 hover:text-purple-200 hover:border-purple-500/30 transition-all"
                onClick={() => navigate('/explorer')}
              >
                <Database className="h-6 w-6" />
                Explore Data
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2 bg-white/5 border-white/10 hover:bg-blue-500/20 hover:text-blue-200 hover:border-blue-500/30 transition-all"
                onClick={() => navigate('/metrics')}
              >
                <Activity className="h-6 w-6" />
                View Metrics
              </Button>
            </GlassCardContent>
          </GlassCard>
        </motion.div>
      </div>
    </motion.div>
  );
}
