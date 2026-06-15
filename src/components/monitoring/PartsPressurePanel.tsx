import type { ElementType } from "react";
import { FileStack, Database, TrendingUp, AlertTriangle, Gauge, Timer, Activity } from "lucide-react";

import type { PartsPressureRow } from "@/api/metrics";
import { cn, formatCompactNumber } from "@/lib/utils";

interface SummaryProps {
  data: PartsPressureRow[];
  /** Rate lookback in minutes — chosen via the header range control (short by design). */
  windowMinutes: number;
  isLoading?: boolean;
}

interface TableProps {
  data: PartsPressureRow[];
  isLoading?: boolean;
  error?: Error | null;
}

/** "≈3h", "12m", "<1m", or "—" when not approaching the threshold. */
function formatEta(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function formatRate(perMin: number): string {
  if (!Number.isFinite(perMin) || perMin === 0) return "0";
  if (Math.abs(perMin) < 1) return perMin.toFixed(2);
  return formatCompactNumber(Math.round(perMin * 100) / 100);
}

/** Tables crossing this fraction of parts_to_throw_insert are flagged amber. */
const PARTS_WARN_RATIO = 0.7;
/** A projected eta below this (minutes) is treated as imminent (red). */
const ETA_DANGER_MIN = 180;

function rowRisk(row: PartsPressureRow): "danger" | "warn" | "ok" {
  const ratio = row.parts_threshold > 0 ? row.max_parts_in_partition / row.parts_threshold : 0;
  const diverging = row.net_parts_per_min > 0;
  if (ratio >= 1 || (diverging && row.eta_minutes >= 0 && row.eta_minutes < ETA_DANGER_MIN)) {
    return "danger";
  }
  if (ratio >= PARTS_WARN_RATIO || diverging) return "warn";
  return "ok";
}

/**
 * Parts pressure summary — section header + KPI cards. Rendered as its own
 * standalone card in the Parts Pressure tab (the per-table detail lives in a
 * separate card below, matching the other Metrics sub-tabs' layout).
 */
export function PartsPressureSummary({ data, windowMinutes, isLoading }: SummaryProps) {
  const diverging = data.filter((r) => r.net_parts_per_min > 0).length;
  const atRisk = data.filter((r) => rowRisk(r) === "danger").length;

  const worst = data.reduce<{ ratio: number; table: string } | null>((acc, r) => {
    const ratio = r.parts_threshold > 0 ? r.max_parts_in_partition / r.parts_threshold : 0;
    return !acc || ratio > acc.ratio ? { ratio, table: `${r.database}.${r.table}` } : acc;
  }, null);
  const soonest = data
    .filter((r) => r.net_parts_per_min > 0 && r.eta_minutes >= 0)
    .reduce<{ eta: number; table: string } | null>(
      (acc, r) => (!acc || r.eta_minutes < acc.eta ? { eta: r.eta_minutes, table: `${r.database}.${r.table}` } : acc),
      null,
    );
  const netTotal = data.reduce((s, r) => s + r.net_parts_per_min, 0);

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
          <FileStack className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[14px] font-semibold tracking-tight text-paper">Parts pressure</h3>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            Insert vs merge race · rate over last {windowMinutes}m
          </p>
        </div>
      </div>

      {isLoading && data.length === 0 ? (
        <div className="grid grid-cols-2 gap-px md:grid-cols-3 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xs bg-ink-300" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <p className="text-[12px] text-paper-muted">No MergeTree parts to summarize.</p>
      ) : (
        <div className="grid grid-cols-2 border-l border-t border-ink-500 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Tables" icon={Database} value={String(data.length)} sub="tracked" tone="ok" />
          <StatCard
            label="Diverging"
            icon={TrendingUp}
            value={String(diverging)}
            sub="net parts rising"
            tone={diverging > 0 ? "warn" : "ok"}
          />
          <StatCard
            label="At risk"
            icon={AlertTriangle}
            value={String(atRisk)}
            sub="ETA under 3h"
            tone={atRisk > 0 ? "danger" : "ok"}
          />
          <StatCard
            label="Worst fill"
            icon={Gauge}
            value={worst ? `${Math.round(worst.ratio * 100)}%` : "—"}
            sub={worst ? worst.table : "no tables"}
            tone={worst && worst.ratio >= 1 ? "danger" : worst && worst.ratio >= PARTS_WARN_RATIO ? "warn" : "ok"}
          />
          <StatCard
            label="Soonest ETA"
            icon={Timer}
            value={soonest ? formatEta(soonest.eta) : "—"}
            sub={soonest ? soonest.table : "all converging"}
            tone={soonest && soonest.eta < ETA_DANGER_MIN ? "danger" : soonest ? "warn" : "ok"}
          />
          <StatCard
            label="Net parts/min"
            icon={Activity}
            value={`${netTotal > 0 ? "+" : ""}${formatRate(netTotal)}`}
            sub={netTotal > 0 ? "accumulating" : netTotal < 0 ? "merges winning" : "steady"}
            tone={netTotal > 0 ? "warn" : "ok"}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Per-table parts pressure detail — its own standalone card. Worst partitions
 * sort to the top; rows turn amber approaching parts_to_throw_insert and red
 * when a positive net part rate projects an imminent breach.
 */
export function PartsPressureTable({ data, isLoading, error }: TableProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-end justify-between gap-3 px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Per-table detail
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {data.length} tables
        </span>
      </div>

      {isLoading && data.length === 0 ? (
        <div className="space-y-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded-xs bg-ink-300" />
          ))}
        </div>
      ) : error ? (
        <p className="text-[12px] text-paper-muted">Couldn't load parts pressure — {error.message}</p>
      ) : data.length === 0 ? (
        <p className="text-[12px] text-paper-muted">
          No MergeTree parts found, or part activity is unavailable on this server.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-ink-500">
                <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Table
                </th>
                <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                  Worst partition
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Active parts
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Insert/min
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Merge/min
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Net/min
                </th>
                <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  ETA to limit
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <PartsRow key={`${row.database}.${row.table}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * KPI tile mirroring the Metrics-tab StatCard (label + icon row, big value,
 * subtitle) with a tone color for at-risk/diverging signals. The border-b/r
 * pairs with the grid's border-l/t to draw clean editorial gridlines.
 */
function StatCard({
  label,
  icon: Icon,
  value,
  sub,
  tone,
}: {
  label: string;
  icon: ElementType;
  value: string;
  sub: string;
  tone: "danger" | "warn" | "ok";
}) {
  const valueColor = tone === "danger" ? "text-red-400" : tone === "warn" ? "text-amber-500" : "text-paper";
  return (
    <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">{label}</span>
        <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
      </div>
      <span className={cn("font-mono text-[20px] font-semibold leading-none tabular-nums", valueColor)}>
        {value}
      </span>
      <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint" title={sub}>
        {sub}
      </span>
    </div>
  );
}

function PartsRow({ row }: { row: PartsPressureRow }) {
  const risk = rowRisk(row);
  const ratio =
    row.parts_threshold > 0
      ? Math.min(1, row.max_parts_in_partition / row.parts_threshold)
      : 0;
  const barColor =
    risk === "danger" ? "bg-red-500" : risk === "warn" ? "bg-amber-500" : "bg-brand";
  const netColor =
    row.net_parts_per_min > 0
      ? "text-red-400"
      : row.net_parts_per_min < 0
        ? "text-emerald-400"
        : "text-paper-muted";

  return (
    <tr className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
      <td className="py-1.5 pr-3 font-mono text-[11px] text-paper whitespace-nowrap">
        <span className="text-paper-muted">{row.database}.</span>
        {row.table}
      </td>
      <td className="py-1.5 pr-3 min-w-[160px]">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-300">
            <div className={cn("h-full rounded-full", barColor)} style={{ width: `${ratio * 100}%` }} />
          </div>
          <span className="font-mono text-[11px] text-paper-muted whitespace-nowrap">
            {formatCompactNumber(row.max_parts_in_partition)}/{formatCompactNumber(row.parts_threshold)}
          </span>
        </div>
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-[11px] text-paper-muted">
        {formatCompactNumber(row.active_parts)}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-[11px] text-paper-muted">
        {formatRate(row.insert_parts_per_min)}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-[11px] text-paper-muted">
        {formatRate(row.merge_parts_per_min)}
      </td>
      <td className={cn("py-1.5 pr-3 text-right font-mono text-[11px]", netColor)}>
        {row.net_parts_per_min > 0 ? "+" : ""}
        {formatRate(row.net_parts_per_min)}
      </td>
      <td
        className={cn(
          "py-1.5 text-right font-mono text-[11px]",
          risk === "danger" ? "text-red-400 font-semibold" : "text-paper-muted",
        )}
      >
        {formatEta(row.eta_minutes)}
      </td>
    </tr>
  );
}
