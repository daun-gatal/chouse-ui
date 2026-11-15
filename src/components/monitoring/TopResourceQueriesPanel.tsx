import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

import {
  useTopMemoryQueries,
  useTopCpuQueries,
  type TopResourceQueryRow,
} from "@/hooks/useMonitoringTimeline";
import { StatementLogsNotice } from "@/components/common/StatementLogsNotice";
import { useCanReadStatementLogs } from "@/hooks/useCanReadStatementLogs";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";

interface TopResourceQueriesPanelProps {
  metric: "memory" | "cpu";
  hoursBack?: number;
  limit?: number;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatCpuTime(microseconds: number): string {
  if (!Number.isFinite(microseconds) || microseconds <= 0) return "—";
  const ms = microseconds / 1000;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(0)}s`;
}

/**
 * "What used the most X over the window" table — sits below the time-series
 * inside the Memory / CPU sub-tabs of Metrics. Operators want a single
 * scannable list of culprits without paginating, so we cap at 10 rows.
 */
export function TopResourceQueriesPanel({
  metric,
  hoursBack = 1,
  limit = 10,
}: TopResourceQueriesPanelProps) {
  const isMemory = metric === "memory";
  const canReadLogs = useCanReadStatementLogs();
  const memQuery = useTopMemoryQueries(hoursBack, limit, undefined, { enabled: isMemory });
  const cpuQuery = useTopCpuQueries(hoursBack, limit, undefined, { enabled: !isMemory });
  const active = isMemory ? memQuery : cpuQuery;
  const { data = [], isLoading, error } = active;

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Header metric={metric} hoursBack={hoursBack} count={data.length} />

      {!canReadLogs ? (
        <StatementLogsNotice subject={`Top ${metric} queries`} />
      ) : isLoading ? (
        <div className="space-y-1">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded-xs bg-ink-300" />
          ))}
        </div>
      ) : error ? (
        <p className="text-[12px] text-paper-muted">
          Couldn't load top {metric} queries — {error.message}
        </p>
      ) : data.length === 0 ? (
        <p className="text-[12px] text-paper-muted">
          No queries in the last {hoursBack}h.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-ink-500">
                <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Time
                </th>
                <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  User
                </th>
                <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Query
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Duration
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                  {isMemory ? "Memory" : "CPU"}
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  {isMemory ? "CPU" : "Memory"}
                </th>
                <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  Rows
                </th>
                <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  ID
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <ResourceRow
                  key={row.query_id + row.event_time}
                  row={row}
                  isMemoryPrimary={isMemory}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Header({
  metric,
  hoursBack,
  count,
}: {
  metric: "memory" | "cpu";
  hoursBack: number;
  count: number;
}) {
  const label = metric === "memory" ? "Top memory queries" : "Top CPU queries";
  const sub =
    metric === "memory"
      ? "Heaviest by memory_usage from query log"
      : "Heaviest by OSCPUVirtualTimeMicroseconds";
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
          <span className="font-mono text-[11px] font-semibold">{count}</span>
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Last {hoursBack}h · top offenders
          </span>
          <span className="text-[13px] font-medium text-paper">{label}</span>
        </div>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
        {sub}
      </span>
    </div>
  );
}

function ResourceRow({
  row,
  isMemoryPrimary,
}: {
  row: TopResourceQueryRow;
  isMemoryPrimary: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isFailed = row.type !== "QueryFinish";

  const copyId = () => {
    navigator.clipboard.writeText(row.query_id).then(() => {
      setCopied(true);
      toast.success("Query ID copied");
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <tr className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
      <td className="py-1.5 pr-3 font-mono text-[11px] text-paper-muted whitespace-nowrap">
        {row.event_time.slice(-8)}
      </td>
      <td className="py-1.5 pr-3 font-mono text-[11px] text-paper-muted whitespace-nowrap">
        {row.user || "—"}
      </td>
      <td className="py-1.5 pr-3 max-w-[360px]">
        <div className="flex items-center gap-1.5">
          {isFailed && (
            <span
              className="inline-flex items-center rounded-xs border border-red-300 bg-red-50 px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              title={row.type}
            >
              ✕
            </span>
          )}
          <code className="truncate font-mono text-[11px] text-paper" title={row.query}>
            {row.query}
          </code>
        </div>
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums text-paper-muted">
        {formatDuration(row.query_duration_ms)}
      </td>
      <td
        className={cn(
          "py-1.5 pr-3 text-right font-mono text-[11px] font-semibold tabular-nums",
          isMemoryPrimary ? "text-brand" : "text-brand"
        )}
      >
        {isMemoryPrimary
          ? formatBytes(row.memory_usage) || "0 B"
          : formatCpuTime(row.cpu_microseconds)}
        {!isMemoryPrimary && row.thread_count > 0 && (
          <span className="ml-1 font-normal text-paper-faint">/ {row.thread_count}thr</span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums text-paper-muted">
        {isMemoryPrimary
          ? formatCpuTime(row.cpu_microseconds)
          : formatBytes(row.memory_usage) || "0 B"}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-[11px] tabular-nums text-paper-muted">
        {formatCompactNumber(row.read_rows)}
      </td>
      <td className="py-1.5 text-right">
        <button
          type="button"
          onClick={copyId}
          className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] text-paper-faint transition-colors hover:bg-ink-300 hover:text-paper"
          title={`Copy ${row.query_id}`}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {row.query_id.slice(0, 8)}…
        </button>
      </td>
    </tr>
  );
}
