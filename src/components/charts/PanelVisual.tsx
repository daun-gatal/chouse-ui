/**
 * Draws one panel's result per its viz spec (ADR 0021 §2): a stat, a table or
 * a chart through the shared chart renderer. Anything that cannot be drawn is
 * shown as an explicit error naming what to change — never an empty chart.
 */

import React, { useMemo } from "react";
import { AlertTriangle } from "lucide-react";

import { ChartView, type PanelOverlays } from "@/components/common/AiChartRenderer";
import { crossedThreshold, resolveChart, resolveStat, type ResolvedChart, type ResultData } from "@/lib/viz/resolve";
import { TIME_SERIES_TYPES, type VizSpec } from "@/lib/viz/spec";
import { formatValue } from "@/lib/viz/units";

export const THRESHOLD_COLORS: Record<VizSpec["thresholds"][number]["severity"], string> = {
  warning: "#F59E0B",
  critical: "#EF4444",
};

export function PanelMessage({ tone, children }: { tone: "error" | "muted"; children: React.ReactNode }): React.ReactElement {
  return (
    <div role={tone === "error" ? "alert" : undefined} className="flex h-full min-h-20 w-full items-center justify-center gap-2 px-4 text-center">
      {tone === "error" && <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />}
      <span className={tone === "error" ? "text-xs leading-relaxed text-red-300" : "text-xs text-paper-faint"}>{children}</span>
    </div>
  );
}

function StatValue({ spec, data, height }: { spec: VizSpec; data: ResultData; height: number }): React.ReactElement {
  const stat = resolveStat(spec, data);
  if (!stat.ok) return <PanelMessage tone="error">{stat.error}</PanelMessage>;
  const threshold = crossedThreshold(spec, stat.value);
  return (
    <div className="flex w-full flex-col items-center justify-center" style={{ height }}>
      <span
        className="font-mono text-3xl font-semibold tabular-nums"
        style={{ color: threshold ? THRESHOLD_COLORS[threshold.severity] : undefined }}
        data-testid="stat-value"
      >
        {formatValue(stat.value, spec.unit, spec.decimals)}
      </span>
      {threshold && <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{threshold.severity} · ≥ {formatValue(threshold.value, spec.unit, spec.decimals)}</span>}
    </div>
  );
}

function ResultTable({ data, height, onRowClick }: { data: ResultData; height: number; onRowClick?: (row: Record<string, unknown>) => void }): React.ReactElement {
  if (data.rows.length === 0) return <PanelMessage tone="muted">The query returned no rows</PanelMessage>;
  return (
    <div className="w-full overflow-auto" style={{ height }}>
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 bg-ink-100">
          <tr>
            {data.columns.map((c) => (
              <th key={c.name} className="whitespace-nowrap border-b border-ink-500 px-2 py-1 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className={onRowClick ? "cursor-pointer border-b border-ink-500/40 hover:bg-ink-200/60" : "border-b border-ink-500/40"} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {data.columns.map((c) => {
                const v = row[c.name];
                return (
                  <td key={c.name} className="max-w-[28rem] truncate px-2 py-1 font-mono text-paper-muted" title={v === null || v === undefined ? "" : String(v)}>
                    {v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PanelVisualProps {
  spec: VizSpec;
  data: ResultData;
  height: number;
  title?: string;
  /** More lines to draw on a chart, such as alert thresholds. */
  extraLines?: Array<{ value: number; color: string }>;
  /**
   * Line and area charts: what to draw over the resolved chart — annotations,
   * compare, the band, the selection (ADR 0023). Gets the rows as drawn.
   */
  decorate?: (chart: ResolvedChart) => { rows: Array<Record<string, unknown>>; overlays: PanelOverlays };
  /** A bar, a point or a table row was clicked: its row as drawn (a split chart's row has x and one column per series). */
  onDatumClick?: (row: Record<string, unknown>) => void;
}

export function PanelVisual({ spec, data, height, title, extraLines, decorate, onDatumClick }: PanelVisualProps): React.ReactElement {
  const chart = useMemo(() => (spec.type === "stat" || spec.type === "table" ? null : resolveChart(spec, data)), [spec, data]);
  const decorated = useMemo(() => (chart?.ok && decorate && TIME_SERIES_TYPES.has(spec.type) ? decorate(chart.value) : null), [chart, decorate, spec.type]);
  const formatter = useMemo(() => (v: unknown): string => formatValue(v, spec.unit, spec.decimals), [spec.unit, spec.decimals]);
  const thresholds = useMemo(
    () => [...spec.thresholds.map((t) => ({ value: t.value, color: THRESHOLD_COLORS[t.severity] })), ...(extraLines ?? [])],
    [spec.thresholds, extraLines],
  );

  if (spec.type === "stat") return <StatValue spec={spec} data={data} height={height} />;
  if (spec.type === "table") return <ResultTable data={data} height={height} onRowClick={onDatumClick} />;
  if (!chart || !chart.ok) return <PanelMessage tone="error">{chart ? chart.error : "Not a chart"}</PanelMessage>;
  return (
    <ChartView
      spec={{
        chartType: spec.type,
        title,
        columns: chart.value.columns,
        rows: decorated ? decorated.rows : chart.value.rows,
        xAxis: chart.value.x,
        yAxis: chart.value.y,
        colorScheme: spec.colorScheme,
      }}
      options={{
        variant: "panel",
        height,
        formatValue: formatter,
        thresholds,
        seriesMeasure: spec.series === null ? null : spec.y[0] ?? null,
        overlays: decorated?.overlays,
        onDatumClick: onDatumClick ? (index) => { const row = chart.value.rows[index]; if (row) onDatumClick(row); } : undefined,
      }}
    />
  );
}
