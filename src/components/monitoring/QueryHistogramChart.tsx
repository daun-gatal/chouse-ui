import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Clock, HardDrive, Layers, Rows3, RefreshCw } from "lucide-react";

import {
  useQueryHistogram,
  type AbsoluteRange,
  type HistogramMetric,
} from "@/hooks/useMonitoringTimeline";
import { SkeletonChart } from "@/components/common/Skeletons";
import { cn } from "@/lib/utils";

interface QueryHistogramChartProps {
  hoursBack: number;
  customRange?: AbsoluteRange;
  metric: HistogramMetric;
  onMetricChange: (metric: HistogramMetric) => void;
}

const METRIC_TABS: { id: HistogramMetric; label: string; icon: typeof Clock }[] = [
  { id: "duration", label: "Duration", icon: Clock },
  { id: "memory", label: "Memory", icon: HardDrive },
  { id: "read_rows", label: "Read rows", icon: Rows3 },
  { id: "read_bytes", label: "Read bytes", icon: Layers },
];

export function QueryHistogramChart({
  hoursBack,
  customRange,
  metric,
  onMetricChange,
}: QueryHistogramChartProps) {
  const { data = [], isLoading, isFetching, error } = useQueryHistogram(
    metric,
    hoursBack,
    customRange
  );

  const totalCount = useMemo(
    () => data.reduce((s, b) => s + b.count, 0),
    [data]
  );
  const peakLabel = useMemo(() => {
    if (data.length === 0) return null;
    const peak = data.reduce((best, b) => (b.count > best.count ? b : best), data[0]);
    return peak.count > 0 ? peak.label : null;
  }, [data]);

  return (
    <section
      aria-label="Query histogram"
      className="flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-500 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <BarIcon />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              Distribution · {METRIC_TABS.find((t) => t.id === metric)?.label.toLowerCase()}
            </span>
            <span className="text-[13px] font-medium text-paper">Query histogram</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          {peakLabel && (
            <span className="font-mono uppercase tracking-[0.14em] text-paper-faint">
              Peak · <span className="text-paper">{peakLabel}</span>
            </span>
          )}
          <span className="font-mono uppercase tracking-[0.14em] text-paper-faint">
            {totalCount.toLocaleString()} queries
          </span>
          {isFetching && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-paper-dim" aria-hidden />
          )}
        </div>
      </div>

      {/* Metric tabs */}
      <div className="flex items-center gap-0 border-b border-ink-500 bg-ink-100 px-2 py-1">
        {METRIC_TABS.map((t) => {
          const active = metric === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onMetricChange(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xs px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                active
                  ? "bg-brand text-ink-50"
                  : "text-paper-muted hover:bg-ink-200 hover:text-paper"
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Chart body */}
      <div className="p-4">
        {isLoading ? (
          <SkeletonChart height={240} />
        ) : error ? (
          <div className="flex h-60 items-center justify-center text-[13px] text-paper-muted">
            Couldn't load histogram — {error.message}
          </div>
        ) : totalCount === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-1">
            <span className="text-[13px] text-paper">No queries in window</span>
            <span className="text-[12px] text-paper-muted">
              Widen the time range to see the distribution.
            </span>
          </div>
        ) : (
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{
                    fontSize: 10,
                    fill: "#71717a",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                  axisLine={{ stroke: "#262626" }}
                  tickLine={{ stroke: "#262626" }}
                  interval={0}
                />
                <YAxis
                  tick={{
                    fontSize: 10,
                    fill: "#71717a",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                  axisLine={{ stroke: "#262626" }}
                  tickLine={{ stroke: "#262626" }}
                  width={50}
                  allowDecimals={false}
                  tickFormatter={(v) => v.toLocaleString()}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{
                    backgroundColor: "#141414",
                    border: "1px solid #262626",
                    borderRadius: 2,
                    fontSize: 11,
                    color: "#ffffff",
                  }}
                  labelStyle={{ color: "#a1a1aa", fontSize: 10, marginBottom: 4 }}
                  formatter={(value: unknown) => [
                    Number(value ?? 0).toLocaleString(),
                    "Queries",
                  ]}
                />
                <Bar dataKey="count" fill="#ffcc01" fillOpacity={0.9} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}

function BarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="5" y="13" width="3" height="6" />
      <rect x="10" y="9" width="3" height="10" />
      <rect x="15" y="5" width="3" height="14" />
    </svg>
  );
}
