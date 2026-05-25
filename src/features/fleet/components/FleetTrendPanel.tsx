/**
 * FleetTrendPanel — per-node trend over the last hour, metric-selectable.
 *
 * Reads from the M2 bulk history endpoint via useFleetHistory (one request
 * feeds this chart AND every per-card sparkline). The metric selector flips
 * between memory %, active queries, and replica lag — all extracted from the
 * same summary snapshot payload, so switching needs no extra fetch.
 *
 * One overlaid line per node. Theme-aware. Shows a "collecting…" state until
 * the poller has accumulated ≥2 ticks.
 */

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { LineChart as LineIcon, RefreshCw } from "lucide-react";
import {
  useFleetHistory,
  pivotHistory,
  FLEET_TREND_FIELDS,
  type FleetTrendField,
} from "@/hooks/useFleetMetrics";
import { useChartColors } from "@/hooks/useChartColors";
import { SkeletonChart } from "@/components/common/Skeletons";
import { cn } from "@/lib/utils";

// Stable line palette — assigned by node index.
const NODE_COLORS = [
  "#ffcc01", "#34d399", "#60a5fa", "#f472b6",
  "#a78bfa", "#fb923c", "#22d3ee", "#facc15",
];

const METRIC_TABS: { value: FleetTrendField; label: string }[] = [
  { value: "memory", label: "Memory" },
  { value: "cpu", label: "CPU" },
  { value: "queries", label: "Queries" },
  { value: "replica_lag", label: "Replica lag" },
];

interface FleetTrendPanelProps {
  connections: { id: string; name: string }[];
  /** History window in hours — driven by the page's range picker. */
  hoursBack: number;
  /** Human label for the window (e.g. "1h", "6h", "24h"). */
  rangeLabel: string;
}

export default function FleetTrendPanel({ connections, hoursBack, rangeLabel }: FleetTrendPanelProps) {
  const [metric, setMetric] = useState<FleetTrendField>("memory");
  const { byNode, isLoading, isFetching } = useFleetHistory(hoursBack, 30_000);
  const chartColors = useChartColors();

  const field = FLEET_TREND_FIELDS[metric];
  const series = useMemo(
    () => pivotHistory(byNode, connections, metric),
    [byNode, connections, metric],
  );
  const nodeNames = useMemo(() => connections.map((c) => c.name), [connections]);
  const hasEnough = series.length >= 2;

  // Percent-style metrics (memory, cpu) render with a % suffix and a fixed
  // 0–100 axis; count-style metrics (queries, replica lag) use raw numbers.
  const isPercent = field.unit === "%";
  const fmtValue = (v: number) =>
    isPercent ? `${v.toFixed(0)}%` : v.toLocaleString();

  return (
    <section
      aria-label="Fleet metric trend"
      className="flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-500 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <LineIcon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              Last {rangeLabel} · {field.label.toLowerCase()}
            </span>
            <span className="text-[13px] font-medium text-paper">Trend</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Metric selector */}
          <div role="radiogroup" aria-label="Trend metric" className="inline-flex overflow-hidden rounded-xs border border-ink-500">
            {METRIC_TABS.map((t, idx) => {
              const active = metric === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMetric(t.value)}
                  className={cn(
                    "h-7 px-2.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
                    idx > 0 && "border-l border-ink-500",
                    active ? "bg-brand text-ink-50" : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {isFetching && (
            <RefreshCw className="h-3.5 w-3.5 text-paper-dim motion-safe:animate-spin" aria-hidden />
          )}
        </div>
      </div>

      <div className="p-4">
        {isLoading && series.length === 0 ? (
          <SkeletonChart height={192} />
        ) : !hasEnough ? (
          <div className="flex h-48 flex-col items-center justify-center gap-1 text-center">
            <span className="text-[13px] text-paper">Collecting history…</span>
            <span className="max-w-xs text-[12px] text-paper-muted">
              The snapshot worker needs a few ticks before a trend appears. Leave
              this page open — points fill in as it polls.
            </span>
          </div>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => format(new Date(Number(t) * 1000), "HH:mm")}
                  tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "var(--font-mono, monospace)" }}
                  axisLine={{ stroke: chartColors.grid }}
                  tickLine={{ stroke: chartColors.grid }}
                  minTickGap={40}
                />
                <YAxis
                  domain={field.domainMax ? [0, field.domainMax] : [0, "auto"]}
                  tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "var(--font-mono, monospace)" }}
                  axisLine={{ stroke: chartColors.grid }}
                  tickLine={{ stroke: chartColors.grid }}
                  width={36}
                  tickFormatter={(v) => (isPercent ? `${v}%` : `${v}`)}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: 2,
                    fontSize: 11,
                    color: chartColors.tooltipText,
                  }}
                  labelStyle={{ color: chartColors.tooltipLabel, fontSize: 10, marginBottom: 4 }}
                  labelFormatter={(label) => format(new Date(Number(label) * 1000), "MMM d HH:mm:ss")}
                  formatter={(value: unknown, name?: unknown) => [
                    value == null ? "—" : fmtValue(Number(value)),
                    String(name ?? ""),
                  ]}
                />
                {nodeNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={NODE_COLORS[i % NODE_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {hasEnough && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-500 pt-3">
            {nodeNames.map((name, i) => (
              <div key={name} className="flex items-center gap-2">
                <span
                  className="h-2 w-3 rounded-xs"
                  style={{ backgroundColor: NODE_COLORS[i % NODE_COLORS.length] }}
                  aria-hidden
                />
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                  {name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
