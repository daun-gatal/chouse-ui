import { useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { Layers, RefreshCw } from "lucide-react";

import { usePartLogTimeline, type TimelineBucket } from "@/hooks/useMonitoringTimeline";
import { SkeletonChart } from "@/components/common/Skeletons";
import { useChartColors } from "@/hooks/useChartColors";
import { cn } from "@/lib/utils";

interface Series {
  NewPart: number;
  MergeParts: number;
  DownloadPart: number;
  RemovePart: number;
  MutatePart: number;
  Other: number;
}

const SERIES: { key: keyof Series; label: string; color: string }[] = [
  { key: "MergeParts", label: "MergeParts", color: "#ffcc01" },
  { key: "NewPart", label: "NewPart", color: "#34d399" },
  { key: "DownloadPart", label: "DownloadPart", color: "#38bdf8" },
  { key: "MutatePart", label: "MutatePart", color: "#fbbf24" },
  { key: "RemovePart", label: "RemovePart", color: "#a78bfa" },
  { key: "Other", label: "Other", color: "#71717a" },
];

interface PartLogTimelineChartProps {
  hoursBack?: number;
  bucket?: TimelineBucket;
  refreshKey?: number;
}

function formatTime(t: string, bucket: TimelineBucket): string {
  const parsed = new Date(t.replace(" ", "T"));
  if (isNaN(parsed.getTime())) return t;
  return bucket === "hour" ? format(parsed, "MMM d HH:mm") : format(parsed, "HH:mm");
}

export function PartLogTimelineChart({
  hoursBack = 6,
  bucket = "minute",
  refreshKey,
}: PartLogTimelineChartProps) {
  const { data, isLoading, isFetching, error, refetch } = usePartLogTimeline(hoursBack, bucket);
  const c = useChartColors();

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const totals = useMemo(() => {
    const acc: Series & { all: number } = {
      NewPart: 0,
      MergeParts: 0,
      DownloadPart: 0,
      RemovePart: 0,
      MutatePart: 0,
      Other: 0,
      all: 0,
    };
    if (!data) return acc;
    for (const row of data) {
      acc.NewPart += row.NewPart;
      acc.MergeParts += row.MergeParts;
      acc.DownloadPart += row.DownloadPart;
      acc.RemovePart += row.RemovePart;
      acc.MutatePart += row.MutatePart;
      acc.Other += row.Other;
      acc.all +=
        row.NewPart + row.MergeParts + row.DownloadPart + row.RemovePart + row.MutatePart + row.Other;
    }
    return acc;
  }, [data]);

  const isEmpty = !isLoading && (!data || data.length === 0);

  return (
    <section
      aria-label="Part log timeline"
      className="flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-500 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Layers className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              Last {hoursBack}h · by event type
            </span>
            <span className="text-[13px] font-medium text-paper">Part activity</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[11px]">
          <span className="font-mono uppercase tracking-[0.14em] text-paper-faint">
            {totals.all.toLocaleString()} events
          </span>
          {isFetching && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-paper-dim" aria-hidden />
          )}
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <SkeletonChart height={192} />
        ) : error ? (
          <div className="flex h-48 items-center justify-center text-center text-[13px] text-paper-muted">
            Couldn't load part_log — {error.message}
          </div>
        ) : isEmpty ? (
          <div className="flex h-48 flex-col items-center justify-center gap-1">
            <span className="text-[13px] text-paper">No part events</span>
            <span className="text-[12px] text-paper-muted">
              No merges, mutations, or part movements in the last {hoursBack}h.
            </span>
          </div>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient
                      key={s.key}
                      id={`pl-grad-${s.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.55} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>
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
                  width={36}
                  tickFormatter={(v) => v.toLocaleString()}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: c.tooltipBg,
                    border: `1px solid ${c.tooltipBorder}`,
                    borderRadius: 2,
                    fontSize: 11,
                    color: c.tooltipText,
                  }}
                  labelStyle={{ color: c.tooltipLabel, fontSize: 10, marginBottom: 4 }}
                  labelFormatter={(label) => formatTime(String(label ?? ""), bucket)}
                  formatter={(value: unknown, name?: unknown) => [
                    Number(value ?? 0).toLocaleString(),
                    String(name ?? ""),
                  ]}
                />
                {SERIES.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stackId="pl"
                    stroke={s.color}
                    strokeWidth={1}
                    fill={`url(#pl-grad-${s.key})`}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

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
