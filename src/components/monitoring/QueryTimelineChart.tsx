import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { Activity, RefreshCw, BarChart3, AreaChart as AreaIcon, LineChart as LineIcon } from "lucide-react";

import {
  useQueryTimeline,
  useQueryResourceTimeline,
  type AbsoluteRange,
  type TimelineBucket,
} from "@/hooks/useMonitoringTimeline";
import { SkeletonChart } from "@/components/common/Skeletons";
import { useChartColors, type ChartColors } from "@/hooks/useChartColors";
import { cn } from "@/lib/utils";

interface Series {
  Select: number;
  Insert: number;
  Delete: number;
  Other: number;
}

const SERIES: { key: keyof Series; label: string; color: string }[] = [
  { key: "Select", label: "Select", color: "#ffcc01" },
  { key: "Insert", label: "Insert", color: "#34d399" },
  { key: "Delete", label: "Delete", color: "#f87171" },
  { key: "Other", label: "Other", color: "#71717a" },
];

// The chart shows one of these "dimensions": the count breakdown by query
// kind, or a single resource metric drawn from system.query_log.
type ResourceMetric = "memory_bytes" | "peak_memory_bytes" | "cpu_seconds" | "read_bytes";
type Dimension = "kind" | ResourceMetric;

const DIMENSIONS: { key: Dimension; label: string; unit: "count" | "bytes" | "seconds"; color: string }[] = [
  { key: "kind", label: "Kind", unit: "count", color: "#ffcc01" },
  { key: "memory_bytes", label: "Memory", unit: "bytes", color: "#ffcc01" },
  { key: "peak_memory_bytes", label: "Peak", unit: "bytes", color: "#fb923c" },
  { key: "cpu_seconds", label: "CPU", unit: "seconds", color: "#34d399" },
  { key: "read_bytes", label: "Read", unit: "bytes", color: "#60a5fa" },
];

type ChartType = "bar" | "area" | "line";

const CHART_TYPES: { value: ChartType; icon: typeof BarChart3 }[] = [
  { value: "bar", icon: BarChart3 },
  { value: "area", icon: AreaIcon },
  { value: "line", icon: LineIcon },
];

interface QueryTimelineChartProps {
  hoursBack?: number;
  bucket?: TimelineBucket;
  refreshKey?: number;
  /** Absolute window; overrides hoursBack when both ends are set. */
  customRange?: AbsoluteRange;
}

function formatTime(t: string, bucket: TimelineBucket): string {
  const parsed = new Date(t.replace(" ", "T"));
  if (isNaN(parsed.getTime())) return t;
  if (bucket === "day") return format(parsed, "MMM d");
  return bucket === "hour" ? format(parsed, "MMM d HH:mm") : format(parsed, "HH:mm");
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

function fmtCpu(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0s";
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtUnit(unit: "count" | "bytes" | "seconds", v: number): string {
  if (unit === "bytes") return fmtBytes(v);
  if (unit === "seconds") return fmtCpu(v);
  return Math.round(v).toLocaleString();
}

export function QueryTimelineChart({
  hoursBack = 6,
  bucket = "minute",
  refreshKey,
  customRange,
}: QueryTimelineChartProps) {
  const [dimension, setDimension] = useState<Dimension>("kind");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const chartColors = useChartColors();

  const isKind = dimension === "kind";
  const kind = useQueryTimeline(hoursBack, bucket, undefined, customRange, {
    enabled: isKind,
  });
  const resource = useQueryResourceTimeline(hoursBack, bucket, customRange, {
    enabled: !isKind,
  });
  const active = isKind ? kind : resource;
  const { isLoading, isFetching, error, refetch } = active;

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const dim = DIMENSIONS.find((d) => d.key === dimension)!;

  const kindTotals = useMemo(() => {
    const data = kind.data;
    if (!data) return { Select: 0, Insert: 0, Delete: 0, Other: 0, all: 0 };
    return data.reduce(
      (acc, row) => {
        acc.Select += row.Select;
        acc.Insert += row.Insert;
        acc.Delete += row.Delete;
        acc.Other += row.Other;
        acc.all += row.Select + row.Insert + row.Delete + row.Other;
        return acc;
      },
      { Select: 0, Insert: 0, Delete: 0, Other: 0, all: 0 }
    );
  }, [kind.data]);

  const resourceTotal = useMemo(() => {
    if (isKind || !resource.data) return 0;
    if (dimension === "peak_memory_bytes") {
      return resource.data.reduce((mx, r) => Math.max(mx, r.peak_memory_bytes), 0);
    }
    return resource.data.reduce((acc, r) => acc + ((r[dimension as ResourceMetric] as number) ?? 0), 0);
  }, [isKind, resource.data, dimension]);

  const data = isKind ? kind.data : resource.data;
  const isEmpty = !isLoading && (!data || data.length === 0);

  return (
    <section
      aria-label="Query timeline"
      className="flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100"
    >
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-500 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Activity className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              {customRange
                ? "Custom"
                : `Last ${hoursBack < 1 ? Math.round(hoursBack * 60) + "m" : hoursBack + "h"}`}
              {" · "}
              {isKind ? "by query kind" : `${dim.label.toLowerCase()} · ${bucket === "day" ? "by day" : bucket === "hour" ? "by hour" : "by minute"}`}
            </span>
            <span className="text-[13px] font-medium text-paper">Query timeline</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          {/* Dimension selector — query kind or a resource metric */}
          <div role="radiogroup" aria-label="Metric" className="inline-flex overflow-hidden rounded-xs border border-ink-500">
            {DIMENSIONS.map((d, idx) => {
              const activeDim = dimension === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  role="radio"
                  aria-checked={activeDim}
                  onClick={() => setDimension(d.key)}
                  className={cn(
                    "h-7 px-2.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                    idx > 0 && "border-l border-ink-500",
                    activeDim ? "bg-brand text-ink-50" : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper"
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          {/* Chart type */}
          <div role="radiogroup" aria-label="Chart type" className="flex items-center gap-0.5 rounded-xs border border-ink-500 bg-ink-200 p-0.5">
            {CHART_TYPES.map((t) => {
              const Icon = t.icon;
              const activeType = chartType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={activeType}
                  onClick={() => setChartType(t.value)}
                  className={cn(
                    "grid h-6 w-7 place-items-center rounded-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                    activeType ? "bg-brand text-ink-50" : "text-paper-muted hover:bg-ink-300 hover:text-paper"
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                </button>
              );
            })}
          </div>

          <span className="font-mono uppercase tracking-[0.14em] text-paper-faint">
            {isKind ? (
              <>
                <span className="text-paper">{kindTotals.all.toLocaleString()}</span> queries
              </>
            ) : (
              <>
                {dimension === "peak_memory_bytes" ? "peak " : "Σ "}
                <span className="text-paper">{fmtUnit(dim.unit, resourceTotal)}</span>
              </>
            )}
          </span>
          {isFetching && <RefreshCw className="h-3.5 w-3.5 text-paper-dim motion-safe:animate-spin" aria-hidden />}
        </div>
      </div>

      {/* Chart body */}
      <div className="p-4">
        {isLoading ? (
          <SkeletonChart height={192} />
        ) : error ? (
          <div className="flex h-40 items-center justify-center text-[13px] text-paper-muted">
            Couldn't load timeline — {error.message}
          </div>
        ) : isEmpty ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1">
            <span className="text-[13px] text-paper">Nothing to chart</span>
            <span className="text-[12px] text-paper-muted">No queries logged in this window.</span>
          </div>
        ) : (
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {isKind
                ? renderKindChart(chartType, kind.data ?? [], bucket, chartColors)
                : renderResourceChart(chartType, resource.data ?? [], bucket, dimension as ResourceMetric, dim, chartColors)}
            </ResponsiveContainer>
          </div>
        )}

        {/* Legend — only for the query-kind breakdown */}
        {isKind && !isLoading && !isEmpty && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-500 pt-3">
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="h-2 w-3 rounded-xs" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">{s.label}</span>
                <span className={cn("font-mono text-[11px]", kindTotals[s.key] === 0 ? "text-paper-faint" : "text-paper")}>
                  {kindTotals[s.key].toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function sharedTooltipKind(bucket: TimelineBucket, c: ChartColors) {
  return (
    <Tooltip
      cursor={{ fill: c.cursor }}
      contentStyle={{ backgroundColor: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 2, fontSize: 11, color: c.tooltipText }}
      labelStyle={{ color: c.tooltipLabel, fontSize: 10, marginBottom: 4 }}
      labelFormatter={(label) => formatTime(String(label ?? ""), bucket)}
      formatter={(value: unknown, name?: unknown) => [Number(value ?? 0).toLocaleString(), String(name ?? "")]}
      itemSorter={(item) => {
        const order: Record<string, number> = { Select: 0, Insert: 1, Delete: 2, Other: 3 };
        return order[String(item.dataKey ?? "")] ?? 99;
      }}
    />
  );
}

function axes(bucket: TimelineBucket, c: ChartColors, fmtY: (v: number) => string, width: number) {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
      <XAxis
        dataKey="time"
        tickFormatter={(t) => formatTime(t, bucket)}
        tick={{ fontSize: 10, fill: c.tick, fontFamily: "var(--font-mono, monospace)" }}
        axisLine={{ stroke: c.grid }}
        tickLine={{ stroke: c.grid }}
        minTickGap={32}
      />
      <YAxis
        tick={{ fontSize: 10, fill: c.tick, fontFamily: "var(--font-mono, monospace)" }}
        axisLine={{ stroke: c.grid }}
        tickLine={{ stroke: c.grid }}
        width={width}
        tickFormatter={fmtY}
        allowDecimals={false}
      />
    </>
  );
}

function renderKindChart(type: ChartType, data: unknown[], bucket: TimelineBucket, c: ChartColors) {
  const dataAny = data as Array<Record<string, number | string>>;
  const yAxes = axes(bucket, c, (v) => v.toLocaleString(), 36);
  if (type === "area") {
    return (
      <AreaChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {SERIES.map((s) => (
            <linearGradient key={s.key} id={`qt-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.55} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        {yAxes}
        {sharedTooltipKind(bucket, c)}
        {SERIES.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} stackId="qk" stroke={s.color} strokeWidth={1} fill={`url(#qt-grad-${s.key})`} isAnimationActive={false} />
        ))}
      </AreaChart>
    );
  }
  if (type === "line") {
    return (
      <LineChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {yAxes}
        {sharedTooltipKind(bucket, c)}
        {SERIES.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    );
  }
  return (
    <BarChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      {yAxes}
      {sharedTooltipKind(bucket, c)}
      {SERIES.map((s) => (
        <Bar key={s.key} dataKey={s.key} stackId="qk" fill={s.color} fillOpacity={0.9} />
      ))}
    </BarChart>
  );
}

function renderResourceChart(
  type: ChartType,
  data: unknown[],
  bucket: TimelineBucket,
  metric: ResourceMetric,
  dim: { label: string; unit: "count" | "bytes" | "seconds"; color: string },
  c: ChartColors
) {
  const dataAny = data as Array<Record<string, number | string>>;
  const fmtY = (v: number) => fmtUnit(dim.unit, v);
  const yAxes = axes(bucket, c, fmtY, 52);
  const tip = (
    <Tooltip
      cursor={{ fill: c.cursor }}
      contentStyle={{ backgroundColor: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 2, fontSize: 11, color: c.tooltipText }}
      labelStyle={{ color: c.tooltipLabel, fontSize: 10, marginBottom: 4 }}
      labelFormatter={(label) => formatTime(String(label ?? ""), bucket)}
      formatter={(value: unknown) => [fmtUnit(dim.unit, Number(value ?? 0)), dim.label]}
    />
  );
  if (type === "line") {
    return (
      <LineChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {yAxes}
        {tip}
        <Line type="monotone" dataKey={metric} stroke={dim.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    );
  }
  if (type === "area") {
    return (
      <AreaChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`rt-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={dim.color} stopOpacity={0.5} />
            <stop offset="95%" stopColor={dim.color} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        {yAxes}
        {tip}
        <Area type="monotone" dataKey={metric} stroke={dim.color} strokeWidth={1.5} fill={`url(#rt-grad-${metric})`} isAnimationActive={false} />
      </AreaChart>
    );
  }
  return (
    <BarChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      {yAxes}
      {tip}
      <Bar dataKey={metric} fill={dim.color} fillOpacity={0.9} />
    </BarChart>
  );
}
