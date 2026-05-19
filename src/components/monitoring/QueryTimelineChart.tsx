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
  type AbsoluteRange,
  type TimelineBucket,
} from "@/hooks/useMonitoringTimeline";
import { SkeletonChart } from "@/components/common/Skeletons";
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

type ChartType = "stacked-bar" | "stacked-area" | "line";

const CHART_TYPES: { value: ChartType; label: string; icon: typeof BarChart3 }[] = [
  { value: "stacked-bar", label: "Stacked bar", icon: BarChart3 },
  { value: "stacked-area", label: "Stacked area", icon: AreaIcon },
  { value: "line", label: "Line", icon: LineIcon },
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
  return bucket === "hour" ? format(parsed, "MMM d HH:mm") : format(parsed, "HH:mm");
}

export function QueryTimelineChart({
  hoursBack = 6,
  bucket = "minute",
  refreshKey,
  customRange,
}: QueryTimelineChartProps) {
  const { data, isLoading, isFetching, error, refetch } = useQueryTimeline(
    hoursBack,
    bucket,
    undefined,
    customRange
  );
  const [chartType, setChartType] = useState<ChartType>("stacked-bar");

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const totals = useMemo(() => {
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
  }, [data]);

  const isEmpty = !isLoading && (!data || data.length === 0);

  return (
    <section
      aria-label="Query timeline"
      className="flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100"
    >
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 border-b border-ink-500 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Activity className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              {customRange
                ? `Custom · by query kind`
                : `Last ${hoursBack < 1 ? Math.round(hoursBack * 60) + "m" : hoursBack + "h"} · by query kind`}
            </span>
            <span className="text-[13px] font-medium text-paper">Query timeline</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <div
            role="radiogroup"
            aria-label="Chart type"
            className="flex items-center gap-0.5 rounded-xs border border-ink-500 bg-ink-200 p-0.5"
          >
            {CHART_TYPES.map((t) => {
              const Icon = t.icon;
              const active = chartType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChartType(t.value)}
                  title={t.label}
                  className={cn(
                    "grid h-6 w-7 place-items-center rounded-xs transition-colors",
                    active
                      ? "bg-brand text-ink-50"
                      : "text-paper-muted hover:bg-ink-300 hover:text-paper"
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                </button>
              );
            })}
          </div>

          <span className="font-mono uppercase tracking-[0.14em] text-paper-faint">
            {totals.all.toLocaleString()} queries
          </span>
          {isFetching && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-paper-dim" aria-hidden />
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="p-4">
        {isLoading ? (
          <SkeletonChart height={192} />
        ) : error ? (
          <div className="flex h-48 items-center justify-center text-[13px] text-paper-muted">
            Couldn't load timeline — {error.message}
          </div>
        ) : isEmpty ? (
          <div className="flex h-48 flex-col items-center justify-center gap-1">
            <span className="text-[13px] text-paper">Nothing to chart</span>
            <span className="text-[12px] text-paper-muted">
              No queries logged in the last {hoursBack}h.
            </span>
          </div>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {renderChart(chartType, data ?? [], bucket)}
            </ResponsiveContainer>
          </div>
        )}

        {/* Legend */}
        {!isLoading && !isEmpty && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-500 pt-3">
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className="h-2 w-3 rounded-xs"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                  {s.label}
                </span>
                <span
                  className={cn(
                    "font-mono text-[11px]",
                    totals[s.key] === 0 ? "text-paper-faint" : "text-paper"
                  )}
                >
                  {totals[s.key].toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function sharedTooltip(bucket: TimelineBucket) {
  return (
    <Tooltip
      cursor={{ fill: "rgba(255,255,255,0.03)" }}
      contentStyle={{
        backgroundColor: "#141414",
        border: "1px solid #262626",
        borderRadius: 2,
        fontSize: 11,
        color: "#ffffff",
      }}
      labelStyle={{ color: "#a1a1aa", fontSize: 10, marginBottom: 4 }}
      labelFormatter={(label) => formatTime(String(label ?? ""), bucket)}
      formatter={(value: unknown, name?: unknown) => [
        Number(value ?? 0).toLocaleString(),
        String(name ?? ""),
      ]}
      itemSorter={(item) => {
        const order: Record<string, number> = { Select: 0, Insert: 1, Delete: 2, Other: 3 };
        return order[String(item.dataKey ?? "")] ?? 99;
      }}
    />
  );
}

function sharedAxes(bucket: TimelineBucket) {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
      <XAxis
        dataKey="time"
        tickFormatter={(t) => formatTime(t, bucket)}
        tick={{ fontSize: 10, fill: "#71717a", fontFamily: "var(--font-mono, monospace)" }}
        axisLine={{ stroke: "#262626" }}
        tickLine={{ stroke: "#262626" }}
        minTickGap={32}
      />
      <YAxis
        tick={{ fontSize: 10, fill: "#71717a", fontFamily: "var(--font-mono, monospace)" }}
        axisLine={{ stroke: "#262626" }}
        tickLine={{ stroke: "#262626" }}
        width={36}
        tickFormatter={(v) => v.toLocaleString()}
        allowDecimals={false}
      />
    </>
  );
}

function renderChart(type: ChartType, data: unknown[], bucket: TimelineBucket) {
  const dataAny = data as Array<Record<string, number | string>>;
  if (type === "stacked-area") {
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
        {sharedAxes(bucket)}
        {sharedTooltip(bucket)}
        {SERIES.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stackId="qk"
            stroke={s.color}
            strokeWidth={1}
            fill={`url(#qt-grad-${s.key})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  }

  if (type === "line") {
    return (
      <LineChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {sharedAxes(bucket)}
        {sharedTooltip(bucket)}
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }

  return (
    <BarChart data={dataAny} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      {sharedAxes(bucket)}
      {sharedTooltip(bucket)}
      {SERIES.map((s) => (
        <Bar key={s.key} dataKey={s.key} stackId="qk" fill={s.color} fillOpacity={0.9} />
      ))}
    </BarChart>
  );
}
