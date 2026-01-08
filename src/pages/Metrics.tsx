import React, { useState } from "react";
import { motion } from "framer-motion";
import { Activity, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import UPlotMetricItemComponent from "@/features/metrics/components/UPlotMetricItemComponent";
import { useMetrics } from "@/hooks";

export default function Metrics() {
  const [refreshInterval, setRefreshInterval] = useState<number>(0);
  const [timeRange, setTimeRange] = useState<string>("1h");

  const { data: metrics, isLoading, refetch, error } = useMetrics(timeRange);

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  // Auto-refresh effect
  React.useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(() => refetch(), refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, refetch]);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="container mx-auto p-6 space-y-6 h-full overflow-auto"
    >
      <motion.div variants={item} className="flex justify-between items-start flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-white/90 flex items-center gap-3">
            <Activity className="h-8 w-8 text-emerald-400" />
            Metrics
          </h1>
          <p className="text-gray-400">Monitor your ClickHouse server performance.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[120px] bg-white/5">
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15m">15 minutes</SelectItem>
                <SelectItem value="1h">1 hour</SelectItem>
                <SelectItem value="6h">6 hours</SelectItem>
                <SelectItem value="24h">24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Select value={String(refreshInterval)} onValueChange={(v) => setRefreshInterval(Number(v))}>
            <SelectTrigger className="w-[140px] bg-white/5">
              <SelectValue placeholder="Auto refresh" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Manual</SelectItem>
              <SelectItem value="5">Every 5s</SelectItem>
              <SelectItem value="10">Every 10s</SelectItem>
              <SelectItem value="30">Every 30s</SelectItem>
              <SelectItem value="60">Every 60s</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </motion.div>

      {error ? (
        <motion.div variants={item}>
          <GlassCard>
            <GlassCardContent className="p-8 text-center">
              <p className="text-red-400">{error.message}</p>
              <Button variant="outline" onClick={() => refetch()} className="mt-4">
                Retry
              </Button>
            </GlassCardContent>
          </GlassCard>
        </motion.div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Query Performance */}
          <motion.div variants={item}>
            <GlassCard className="h-[350px]">
              <GlassCardHeader>
                <GlassCardTitle>Queries per Second</GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent className="h-[280px]">
                {metrics?.queriesPerSecond ? (
                  <UPlotMetricItemComponent
                    data={metrics.queriesPerSecond}
                    title="Queries/s"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    {isLoading ? "Loading..." : "No data available"}
                  </div>
                )}
              </GlassCardContent>
            </GlassCard>
          </motion.div>

          {/* Memory Usage */}
          <motion.div variants={item}>
            <GlassCard className="h-[350px]">
              <GlassCardHeader>
                <GlassCardTitle>Memory Usage</GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent className="h-[280px]">
                {metrics?.memoryUsage ? (
                  <UPlotMetricItemComponent
                    data={metrics.memoryUsage}
                    title="Memory (GB)"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    {isLoading ? "Loading..." : "No data available"}
                  </div>
                )}
              </GlassCardContent>
            </GlassCard>
          </motion.div>

          {/* CPU Usage */}
          <motion.div variants={item}>
            <GlassCard className="h-[350px]">
              <GlassCardHeader>
                <GlassCardTitle>CPU Usage</GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent className="h-[280px]">
                {metrics?.cpuUsage ? (
                  <UPlotMetricItemComponent
                    data={metrics.cpuUsage}
                    title="CPU %"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    {isLoading ? "Loading..." : "No data available"}
                  </div>
                )}
              </GlassCardContent>
            </GlassCard>
          </motion.div>

          {/* Disk I/O */}
          <motion.div variants={item}>
            <GlassCard className="h-[350px]">
              <GlassCardHeader>
                <GlassCardTitle>Disk I/O</GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent className="h-[280px]">
                {metrics?.diskIO ? (
                  <UPlotMetricItemComponent
                    data={metrics.diskIO}
                    title="MB/s"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    {isLoading ? "Loading..." : "No data available"}
                  </div>
                )}
              </GlassCardContent>
            </GlassCard>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
