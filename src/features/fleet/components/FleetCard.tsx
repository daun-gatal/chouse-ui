/**
 * FleetCard — one card per ClickHouse connection on the /fleet page.
 *
 * The card is a dumb renderer: it takes the connection metadata as a prop
 * and runs three React Query hooks scoped to that connectionId. Status dot
 * colour is computed from the latest summary (see `computeFleetStatus`).
 *
 * Clicking the open button sets the active connection in the auth store and
 * navigates the user to /monitoring — the existing single-cluster shell
 * picks up the connection and renders the per-cluster drill-down.
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Skull, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  useFleetSummary,
  useFleetLongestQuery,
  useFleetLastException,
  computeFleetStatus,
  isSnapshotFresh,
  summaryFromSnapshot,
  longestQueryFromSnapshot,
  lastExceptionFromSnapshot,
  type FleetCardStatus,
} from "@/hooks/useFleetMetrics";
import type { FleetConnectionSnapshot } from "@/api/fleet";
import Sparkline from "./Sparkline";
import { activateConnection } from "@/lib/activateConnection";
import type { ClickHouseConnection } from "@/api/rbac";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";
import { log } from "@/lib/log";

interface FleetCardProps {
  connection: ClickHouseConnection;
  refetchIntervalMs: number;
  /**
   * Pre-fetched snapshot from the M2 backend poller. When fresh (within
   * 2 × pollIntervalSeconds), the card reads from this and skips the live
   * `/api/fleet/query` hooks entirely — one HTTP call paints N cards
   * instead of N × 3. When undefined or stale, the card falls back to the
   * M1 live-polling path so the UI stays responsive even if the worker is
   * down or hasn't caught up yet.
   */
  snapshot?: FleetConnectionSnapshot;
  /** Poll interval the backend worker is configured for — used for freshness check. */
  snapshotPollIntervalSeconds?: number;
  /** Memory-% history for the inline sparkline (from the page's bulk fetch). */
  memoryHistory?: { time: number; value: number | null }[];
}

const STATUS_STYLES: Record<FleetCardStatus, { dot: string; label: string }> = {
  healthy: {
    dot: "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]",
    label: "Healthy",
  },
  degraded: {
    dot: "bg-amber-500 dark:bg-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.20)]",
    label: "Degraded",
  },
  down: {
    dot: "bg-red-500 dark:bg-red-400 shadow-[0_0_0_3px_rgba(239,68,68,0.22)]",
    label: "Down",
  },
  loading: {
    dot: "bg-ink-500 motion-safe:animate-pulse",
    label: "Loading",
  },
};

/** Format elapsed seconds → "2m 14s" / "47s" / "1h 12m". */
function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Server uptime → "5d 3h" / "3h 12m" / "47m" / "12s". */
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

/** "5s" / "1m" / "12m" / "2h" — for poll age display. */
function formatRelativeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function FleetCard({
  connection,
  refetchIntervalMs,
  snapshot,
  snapshotPollIntervalSeconds = 30,
  memoryHistory,
}: FleetCardProps) {
  const queryClient = useQueryClient();
  const [isOpening, setIsOpening] = useState(false);

  // Decide whether to serve from the M2 snapshot cache or fall back to live
  // polling. Snapshot wins when it's fresh enough; if the worker is dead or
  // hasn't caught up, the live hooks take over so the card never goes blank.
  const useSnapshot = isSnapshotFresh(snapshot, snapshotPollIntervalSeconds);
  const liveInterval = useSnapshot ? 0 : refetchIntervalMs;

  // Live hooks — `refetchInterval: 0` disables polling when we're reading
  // from the snapshot cache. They still mount so React Query keeps the
  // last-known-good data available if the snapshot goes stale mid-session.
  const summary = useFleetSummary(connection.id, liveInterval);
  const longest = useFleetLongestQuery(connection.id, liveInterval);
  const lastException = useFleetLastException(connection.id, liveInterval);

  // Merge snapshot and live sources — snapshot wins when fresh, else live.
  const snapshotSummary = useSnapshot ? summaryFromSnapshot(snapshot) : undefined;
  const snapshotLongest = useSnapshot ? longestQueryFromSnapshot(snapshot) : undefined;
  const snapshotException = useSnapshot ? lastExceptionFromSnapshot(snapshot) : undefined;

  const effectiveSummary = snapshotSummary ?? summary.data;
  const effectiveLongest =
    snapshotLongest !== undefined ? snapshotLongest : longest.data;
  const effectiveException =
    snapshotException !== undefined ? snapshotException : lastException.data;
  const effectiveError = useSnapshot ? false : summary.isError;
  const effectiveUpdatedAt = useSnapshot
    ? (snapshot?.capturedAt ?? 0) * 1000
    : summary.dataUpdatedAt;
  const effectiveIsFetching = useSnapshot ? false : summary.isFetching;
  const effectiveIsLoadingException = useSnapshot
    ? false
    : lastException.isLoading;

  // Track consecutive errors on the summary stream — drives the 3-strike rule
  // that flips the status dot to red. Reset to 0 on any successful fetch.
  // State (not ref) so the card actually re-renders when the count advances
  // — `computeFleetStatus` reads it during render and we need the dot to flip
  // when the third strike lands, not when the next poll happens to settle.
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  useEffect(() => {
    // Use the settle timestamps (not isError/data identity) as the trigger so
    // we count one strike per poll round-trip, not per re-render.
    if (summary.isError) {
      setConsecutiveErrors((n) => n + 1);
    } else if (summary.data) {
      setConsecutiveErrors(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.dataUpdatedAt, summary.errorUpdatedAt]);

  const status = computeFleetStatus(effectiveSummary, effectiveError, consecutiveErrors);
  const statusStyle = STATUS_STYLES[status];

  // Re-render the "polled Xs ago" line every 10 seconds without refetching.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const pollAgeMs = effectiveUpdatedAt ? Date.now() - effectiveUpdatedAt : null;

  const handleOpen = async () => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      await activateConnection({
        connectionId: connection.id,
        connectionName: connection.name,
        queryClient,
      });
      // Full navigation (not SPA): the app re-initialises on the persisted
      // connection, so the page lands ready on the new node instead of needing
      // a manual refresh to shake off the previous connection's state.
      window.location.assign("/monitoring");
    } catch (e) {
      log.error("[FleetCard] Failed to open connection", {
        connectionId: connection.id,
        err: e instanceof Error ? e.message : String(e),
      });
      toast.error("Could not connect to this node");
    } finally {
      setIsOpening(false);
    }
  };

  const memoryUsedDisplay = effectiveSummary
    ? `${formatBytes(effectiveSummary.memoryUsedBytes)} / ${formatBytes(effectiveSummary.memoryTotalBytes)}`
    : "—";
  const memoryPercentValue = effectiveSummary?.memoryPercent ?? 0;
  const memoryPercentDisplay = effectiveSummary
    ? `${memoryPercentValue.toFixed(0)}%`
    : "—";

  return (
    <TooltipProvider delayDuration={250}>
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100 transition-[opacity,box-shadow,border-color] duration-200",
        // Healthy recedes slightly so degraded/down cards pop when the grid is
        // mixed; hover restores full weight.
        status === "healthy" && "opacity-[0.9] hover:opacity-100",
        status === "degraded" && "shadow-[inset_3px_0_0_0_rgba(245,158,11,0.45)]",
        // Triple visual reinforcement for "down" so colorblind operators still
        // notice without the status pill: red border + red left rail + red
        // outer ring. Each independently sufficient.
        status === "down" &&
          "border-red-500/50 shadow-[inset_3px_0_0_0_rgba(239,68,68,0.55),0_0_0_1px_rgba(239,68,68,0.20)]",
      )}
    >
      {/* Header — status + connection name + drill-down button */}
      <header className="flex items-start gap-3 border-b border-ink-500 px-4 py-3">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full transition-shadow motion-safe:transition-shadow",
            statusStyle.dot,
          )}
        />
        {/* Polite aria-live region — screen readers announce when status text
            changes (not on every 30s poll, only on a real flip). */}
        <span role="status" aria-live="polite" className="sr-only">
          {connection.name}: {statusStyle.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold leading-tight tracking-tight text-paper">
              {connection.name}
            </h3>
            {(status === "degraded" || status === "down") && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
                  status === "degraded"
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
                )}
              >
                {statusStyle.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim">
            {connection.host}:{connection.port}
            {effectiveSummary?.serverVersion && (
              <>
                <span className="mx-2 text-ink-700">·</span>
                {effectiveSummary.serverVersion}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          disabled={isOpening}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper transition-colors",
            "hover:border-brand hover:bg-ink-100 hover:text-brand",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-100",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          aria-label={`Open ${connection.name} in monitoring view`}
        >
          {isOpening ? (
            <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
          ) : (
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          )}
          Open
        </button>
      </header>

      {/* Body — 2-column KPI grid */}
      <div className="grid grid-cols-2 [&>*]:border-b [&>*]:border-r [&>*]:border-ink-500 [&>*:nth-child(2n)]:border-r-0">
        <MemoryTile
          percent={memoryPercentValue}
          percentDisplay={memoryPercentDisplay}
          subDisplay={memoryUsedDisplay}
          hasData={!!effectiveSummary}
          history={memoryHistory}
        />
        <Tile
          label="Queries"
          value={effectiveSummary ? formatCompactNumber(effectiveSummary.activeQueries) : "—"}
          sub={
            effectiveSummary && effectiveSummary.longRunningQueries > 0
              ? `${effectiveSummary.longRunningQueries} long`
              : "0 long"
          }
        />
        {effectiveLongest ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                aria-label={`Longest running query: ${effectiveLongest.queryPreview}`}
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">
                  Longest running
                </span>
                <span className="truncate font-mono text-[15px] font-semibold tabular-nums leading-tight text-paper">
                  {formatElapsed(effectiveLongest.elapsedSeconds)}
                </span>
                <span className="truncate text-[11px] text-paper-muted">
                  {effectiveLongest.user} · {effectiveLongest.queryPreview.slice(0, 36)}
                  {effectiveLongest.queryPreview.length > 36 ? "…" : ""}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-md whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed"
            >
              <div className="mb-1 font-sans text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                {effectiveLongest.user} · {formatBytes(effectiveLongest.memoryUsage)} peak
              </div>
              {effectiveLongest.queryPreview}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tile label="Longest running" value="—" sub="no running query" mono />
        )}
        <Tile
          label="Uptime"
          value={effectiveSummary ? formatUptime(effectiveSummary.uptimeSeconds) : "—"}
          sub="since restart"
          mono
        />
        <Tile
          label="Max replica lag"
          value={effectiveSummary ? `${effectiveSummary.maxReplicaLagSeconds.toFixed(1)}s` : "—"}
          sub={effectiveSummary?.maxLagReplica || "no replicas"}
          mono
        />
        {effectiveException ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                aria-label={`Last exception in past hour: code ${effectiveException.exceptionCode}`}
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">
                  Last exception (1h)
                </span>
                <span className="inline-flex items-center gap-1 truncate text-[15px] font-semibold tabular-nums leading-tight text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  #{effectiveException.exceptionCode}
                </span>
                <span className="truncate text-[11px] text-paper-muted">
                  {effectiveException.eventTime} · {effectiveException.user}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              className="max-w-md whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed"
            >
              <div className="mb-1 font-sans text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                exception #{effectiveException.exceptionCode} · {effectiveException.eventTime}
              </div>
              {effectiveException.exceptionPreview}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tile
            label="Last exception (1h)"
            value={effectiveIsLoadingException ? "—" : "clean"}
            sub="no errors"
          />
        )}
      </div>

      {/* Footer — last poll info + error indicator */}
      <footer className="flex items-center justify-between gap-2 border-t border-ink-500 bg-ink-200/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
        <span className="inline-flex items-center gap-1.5">
          {effectiveIsFetching && (
            <RefreshCw className="h-3 w-3 text-paper-dim motion-safe:animate-spin" aria-hidden />
          )}
          {status === "down" ? (
            <span className="inline-flex items-center gap-1.5 text-red-500 dark:text-red-400">
              <Skull className="h-3 w-3" aria-hidden />
              Unreachable
              {consecutiveErrors > 0 && (
                <span className="text-paper-dim">
                  · {consecutiveErrors} failed polls
                </span>
              )}
            </span>
          ) : pollAgeMs !== null ? (
            <span>polled {formatRelativeAge(pollAgeMs)}</span>
          ) : (
            <span>polling…</span>
          )}
        </span>
        <span className="text-paper-dim">
          {refetchIntervalMs > 0 ? `${refetchIntervalMs / 1000}s interval` : "paused"}
        </span>
      </footer>
    </article>
    </TooltipProvider>
  );
}

interface MemoryTileProps {
  percent: number;
  percentDisplay: string;
  subDisplay: string;
  hasData: boolean;
  history?: { time: number; value: number | null }[];
}

/** Memory threshold → sparkline/bar colour (hex so the SVG stroke resolves). */
function memoryColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "#d4a300"; // brand-ish amber-gold, reads on both themes
}

/**
 * Memory tile with hairline progress bar + 1h sparkline. The number gives the
 * precise reading, the bar the at-a-glance pressure, and the sparkline the
 * direction (climbing vs flat) — the three things an operator wants from a
 * memory cell without leaving the card.
 */
function MemoryTile({ percent, percentDisplay, subDisplay, hasData, history }: MemoryTileProps) {
  const pct = Math.max(0, Math.min(100, percent));
  const fillCls =
    pct >= 90
      ? "bg-red-500 dark:bg-red-400"
      : pct >= 70
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-brand";
  const hasTrend = (history?.filter((p) => p.value != null).length ?? 0) >= 2;
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">
        Memory
      </span>
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[15px] font-semibold tabular-nums leading-tight text-paper",
            pct >= 90 && "text-red-600 dark:text-red-400",
          )}
        >
          {percentDisplay}
        </span>
        {hasTrend && (
          <Sparkline
            series={history!}
            color={memoryColor(pct)}
            domainMax={100}
            width={72}
            height={20}
            ariaLabel={`Memory trend, now ${percentDisplay}`}
          />
        )}
      </div>
      {/* Hairline progress track — editorial: thin ink track, brand-coloured
          fill that recolours at the same thresholds as the status dot. */}
      <div
        className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-ink-200"
        role="progressbar"
        aria-label="Memory usage"
        aria-valuenow={hasData ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full transition-[width] duration-300 ease-out", fillCls)}
          style={{ width: `${hasData ? pct : 0}%` }}
        />
      </div>
      <span className="truncate text-[11px] text-paper-muted">{subDisplay}</span>
    </div>
  );
}

interface TileProps {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  warn?: boolean;
  pulse?: boolean;
}

function Tile({ label, value, sub, mono, warn, pulse }: TileProps) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-dim">
        {label}
      </span>
      <span
        className={cn(
          "truncate text-[15px] font-semibold tabular-nums leading-tight",
          mono && "font-mono",
          warn ? "text-amber-400" : "text-paper",
          pulse && "text-red-400",
        )}
      >
        {warn && (
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-0.5" aria-hidden />
        )}
        {value}
      </span>
      {sub && (
        <span className="truncate text-[11px] text-paper-muted">{sub}</span>
      )}
    </div>
  );
}
