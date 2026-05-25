/**
 * FleetRow + FleetList — compact, table-aligned view of the fleet.
 *
 * The card grid is great at a handful of nodes; past ~10 it wastes vertical
 * space. This row view packs one node per ~44px line so 20+ nodes fit on a
 * screen — the density an SRE wants. Snapshot-driven (the row view is the
 * scale scenario, where the poller is running); falls back to dashes when a
 * node has no fresh snapshot.
 *
 * Healthy rows recede (muted) so degraded/down rows pop without the eye
 * having to scan.
 */

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import {
  nodeStatusFromSnapshot,
  summaryFromSnapshot,
  longestQueryFromSnapshot,
  lastExceptionFromSnapshot,
  type FleetCardStatus,
} from "@/hooks/useFleetMetrics";
import { activateConnection } from "@/lib/activateConnection";
import type { ClickHouseConnection } from "@/api/rbac";
import type { FleetConnectionSnapshot } from "@/api/fleet";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";
import { log } from "@/lib/log";
import Sparkline from "./Sparkline";

const STATUS_DOT: Record<FleetCardStatus, string> = {
  healthy: "bg-emerald-500 dark:bg-emerald-400",
  degraded: "bg-amber-500 dark:bg-amber-400",
  down: "bg-red-500 dark:bg-red-400",
  loading: "bg-ink-500 motion-safe:animate-pulse",
};

function fmtElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function memColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "#d4a300";
}

// Shared grid template so the header and every row align like a table.
const GRID =
  "grid items-center gap-3 px-4 grid-cols-[14px_minmax(130px,1.6fr)_minmax(116px,1fr)_60px_minmax(96px,1fr)_64px_64px_auto]";

export interface FleetRowProps {
  connection: ClickHouseConnection;
  snapshot?: FleetConnectionSnapshot;
  pollIntervalSeconds: number;
  memoryHistory?: { time: number; value: number | null }[];
}

export function FleetListHeader() {
  return (
    <div
      className={cn(
        GRID,
        "h-9 border-b border-ink-500 bg-ink-200/60 font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint",
      )}
    >
      <span aria-hidden />
      <span>Node</span>
      <span>Memory</span>
      <span className="text-right">Queries</span>
      <span>Longest</span>
      <span className="text-right">Lag</span>
      <span className="text-right">Exc</span>
      <span className="text-right">Open</span>
    </div>
  );
}

export default function FleetRow({
  connection,
  snapshot,
  pollIntervalSeconds,
  memoryHistory,
}: FleetRowProps) {
  const queryClient = useQueryClient();
  const [isOpening, setIsOpening] = useState(false);

  const status = nodeStatusFromSnapshot(snapshot, pollIntervalSeconds);
  const summary = summaryFromSnapshot(snapshot);
  const longest = longestQueryFromSnapshot(snapshot);
  const exception = lastExceptionFromSnapshot(snapshot);
  const pct = summary ? Math.max(0, Math.min(100, summary.memoryPercent)) : null;
  const recede = status === "healthy"; // healthy rows recede so problems pop
  const hasTrend = (memoryHistory?.filter((p) => p.value != null).length ?? 0) >= 2;

  const handleOpen = async () => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      await activateConnection({
        connectionId: connection.id,
        connectionName: connection.name,
        queryClient,
      });
      // Full navigation (not SPA) — see FleetCard: re-initialise on the new
      // connection so the page lands ready without a manual refresh.
      window.location.assign("/monitoring");
    } catch (e) {
      log.error("[FleetRow] Failed to open connection", {
        connectionId: connection.id,
        err: e instanceof Error ? e.message : String(e),
      });
      toast.error("Could not connect to this node");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div
      className={cn(
        GRID,
        "h-12 border-b border-ink-500 transition-colors last:border-b-0 hover:bg-ink-200/50",
        status === "down" && "bg-red-500/[0.04]",
        recede && "opacity-[0.72] hover:opacity-100",
      )}
    >
      {/* status dot */}
      <span
        className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])}
        aria-label={`Status: ${status}`}
      />

      {/* name + host */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-paper">{connection.name}</span>
          {(status === "degraded" || status === "down") && (
            <span
              className={cn(
                "shrink-0 rounded-xs border px-1 py-px font-mono text-[8px] uppercase tracking-[0.12em]",
                status === "degraded"
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
              )}
            >
              {status}
            </span>
          )}
        </div>
        <span className="truncate font-mono text-[10px] text-paper-dim">
          {connection.host}:{connection.port}
        </span>
      </div>

      {/* memory: % + bar + sparkline */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "font-mono text-[12px] font-semibold tabular-nums",
              pct != null && pct >= 90 ? "text-red-600 dark:text-red-400" : "text-paper",
            )}
          >
            {pct != null ? `${pct.toFixed(0)}%` : "—"}
          </span>
          <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-ink-200">
            <div
              className={cn(
                "h-full",
                pct == null
                  ? ""
                  : pct >= 90
                    ? "bg-red-500 dark:bg-red-400"
                    : pct >= 70
                      ? "bg-amber-500 dark:bg-amber-400"
                      : "bg-brand",
              )}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        </div>
        {hasTrend && pct != null && (
          <Sparkline series={memoryHistory!} color={memColor(pct)} domainMax={100} width={48} height={18} />
        )}
      </div>

      {/* queries */}
      <span className="text-right font-mono text-[12px] tabular-nums text-paper">
        {summary ? formatCompactNumber(summary.activeQueries) : "—"}
        {summary && summary.longRunningQueries > 0 && (
          <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
            +{summary.longRunningQueries}
          </span>
        )}
      </span>

      {/* longest running */}
      <span className="truncate font-mono text-[11px] tabular-nums text-paper-muted">
        {longest ? fmtElapsed(longest.elapsedSeconds) : "—"}
      </span>

      {/* replica lag */}
      <span className="text-right font-mono text-[11px] tabular-nums text-paper-muted">
        {summary ? `${summary.maxReplicaLagSeconds.toFixed(1)}s` : "—"}
      </span>

      {/* last exception */}
      <span className="flex justify-end">
        {exception ? (
          <span
            className="inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums text-amber-600 dark:text-amber-400"
            title={`Exception #${exception.exceptionCode} · ${exception.eventTime}`}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {exception.exceptionCode}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-paper-faint">—</span>
        )}
      </span>

      {/* open */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={isOpening}
        aria-label={`Open ${connection.name} in monitoring view`}
        className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper transition-colors hover:border-brand hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset disabled:opacity-50"
      >
        {isOpening ? (
          <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
        ) : (
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        )}
      </button>
    </div>
  );
}
