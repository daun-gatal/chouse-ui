/**
 * Fleet page — `/fleet`.
 *
 * Grid of connection cards. Each card polls its own connection independently,
 * so a slow / down cluster does not block the rest of the grid. The page-level
 * controls (auto-refresh toggle, interval picker) propagate to all cards via
 * the `refetchIntervalMs` prop.
 *
 * M1 scope: read-only, client-polled, no alerts, no history. See PROJECT_SPEC.md.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Globe2, InfoIcon, Plug, RefreshCw, Search, X } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import InfoDialog from "@/components/common/InfoDialog";
import {
  useFleetConnections,
  useFleetSnapshots,
  fetchFleetSummary,
  fleetSummaryQueryKey,
  computeFleetStatus,
  isSnapshotFresh,
  nodeStatusFromSnapshot,
  summaryFromSnapshot,
  FLEET_STATUS_RANK,
  useFleetHistory,
  nodeSeries,
} from "@/hooks/useFleetMetrics";
import FleetCard from "@/features/fleet/components/FleetCard";
import FleetRow, { FleetListHeader } from "@/features/fleet/components/FleetRow";
import FleetTrendPanel from "@/features/fleet/components/FleetTrendPanel";
import FleetExceptionsFeed from "@/features/fleet/components/FleetExceptionsFeed";
import FleetInventoryStrip from "@/features/fleet/components/FleetInventoryStrip";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { ClickHouseConnection } from "@/api/rbac";
import { cn } from "@/lib/utils";

type FleetSort = "status" | "memory" | "name";
type StatusFilter = "all" | "healthy" | "degraded" | "down";
type FleetView = "cards" | "rows";

const INTERVAL_OPTIONS = [
  { label: "15s", value: 15_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
  { label: "Off", value: 0 },
] as const;

const DEFAULT_INTERVAL_MS = 30_000;

const RANGE_OPTIONS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
] as const;

export default function FleetPage() {
  const [refetchIntervalMs, setRefetchIntervalMs] = useState<number>(DEFAULT_INTERVAL_MS);
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const connectionsQuery = useFleetConnections();
  const connections = useMemo(
    () => (connectionsQuery.data ?? []).filter((c) => c.isActive),
    [connectionsQuery.data],
  );

  // M2 snapshot cache — one HTTP call paints all N cards when the poller is
  // running. Cards fall back to their own live polling when a snapshot is
  // stale, so the UI never blanks even if the worker dies.
  const snapshotsQuery = useFleetSnapshots(10_000);
  const snapshotsByConnection = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snapshotsQuery.data>["connections"][number]>();
    for (const s of snapshotsQuery.data?.connections ?? []) {
      map.set(s.connectionId, s);
    }
    return map;
  }, [snapshotsQuery.data]);

  const workerEnabled = snapshotsQuery.data?.workerEnabled ?? false;
  const pollIntervalSeconds = snapshotsQuery.data?.pollIntervalSeconds ?? 30;

  // Time-travel: history window for the trend, sparklines, and exceptions
  // feed. The cards stay live (current state); this drives the historical
  // panels so an operator can widen to 24h to spot, say, a 3am spike.
  const [historyHours, setHistoryHours] = useState<number>(1);
  const rangeLabel = RANGE_OPTIONS.find((r) => r.hours === historyHours)?.label ?? `${historyHours}h`;

  // Bulk history (one request) → per-card memory sparklines. The trend panel
  // calls the same hook (same query key) so React Query dedupes to 1 fetch.
  const { byNode: historyByNode } = useFleetHistory(historyHours, 30_000);

  // "Stale" banner — fires when the poller IS enabled (so we expected fresh
  // snapshots) but every connection's snapshot is older than 2× the poll
  // interval. Don't show the banner when the worker is off — that's
  // intentional, the live path is the only path then.
  const showStaleBanner = useMemo(() => {
    if (!workerEnabled) return false;
    if (connections.length === 0) return false;
    if (snapshotsByConnection.size === 0) return true; // poller never wrote
    return connections.every(
      (c) => !isSnapshotFresh(snapshotsByConnection.get(c.id), pollIntervalSeconds),
    );
  }, [workerEnabled, connections, snapshotsByConnection, pollIntervalSeconds]);

  // Sort / filter / search — the affordances that keep the grid usable as the
  // node count grows. Default sort is status worst-first so problems float up.
  const [sortBy, setSortBy] = useState<FleetSort>("status");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<FleetView>("cards");

  const visibleConnections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const decorated = connections.map((c) => {
      const snap = snapshotsByConnection.get(c.id);
      const status = nodeStatusFromSnapshot(snap, pollIntervalSeconds);
      const memPct = summaryFromSnapshot(snap)?.memoryPercent ?? -1;
      return { conn: c, status, memPct };
    });

    const filtered = decorated.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (q) {
        const hay = `${d.conn.name} ${d.conn.host}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "status") {
        const r = FLEET_STATUS_RANK[a.status] - FLEET_STATUS_RANK[b.status];
        if (r !== 0) return r;
        return a.conn.name.localeCompare(b.conn.name);
      }
      if (sortBy === "memory") {
        return b.memPct - a.memPct; // highest pressure first
      }
      return a.conn.name.localeCompare(b.conn.name);
    });

    return filtered.map((d) => d.conn);
  }, [connections, snapshotsByConnection, pollIntervalSeconds, sortBy, statusFilter, search]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50">
      {/* Header */}
      <header className="flex-none border-b border-ink-500 px-6 pb-4 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <Globe2 className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col gap-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                Observability · Multi-node
              </span>
              <div className="flex items-baseline gap-2">
                <h1 className="text-[18px] font-semibold leading-tight tracking-tight text-paper">
                  Fleet
                </h1>
                {connections.length > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-paper-muted">
                    {connections.length}{" "}
                    <span className="text-paper-dim">
                      {connections.length === 1 ? "node" : "nodes"}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <FleetStatusStrip connections={connections} refetchIntervalMs={refetchIntervalMs} />

          <div className="flex items-center gap-3">
            <IntervalPicker
              value={refetchIntervalMs}
              onChange={setRefetchIntervalMs}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsInfoOpen(true)}
              className="h-9 w-9 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
              aria-label="About fleet view"
            >
              <InfoIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {showStaleBanner && <FleetStaleBanner pollIntervalSeconds={pollIntervalSeconds} />}
        {connectionsQuery.isLoading ? (
          <FleetLoadingSkeleton />
        ) : connectionsQuery.isError ? (
          <FleetErrorState message={connectionsQuery.error?.message ?? "Failed to load connections"} />
        ) : connections.length === 0 ? (
          <FleetEmptyState />
        ) : (
          <>
            {/* Sort / filter toolbar — shown for 2+ nodes (pointless with a
                single node). */}
            {connections.length > 1 && (
              <FleetToolbar
                sortBy={sortBy}
                onSortChange={setSortBy}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                search={search}
                onSearchChange={setSearch}
                view={view}
                onViewChange={setView}
                total={connections.length}
                shown={visibleConnections.length}
              />
            )}

            {visibleConnections.length === 0 ? (
              <FleetNoMatchState onClear={() => { setStatusFilter("all"); setSearch(""); }} />
            ) : view === "rows" ? (
              <div className="overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <FleetListHeader />
                {visibleConnections.map((c) => (
                  <FleetRow
                    key={c.id}
                    connection={c}
                    snapshot={snapshotsByConnection.get(c.id)}
                    pollIntervalSeconds={pollIntervalSeconds}
                    memoryHistory={nodeSeries(historyByNode.get(c.id), "memory")}
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
                {visibleConnections.map((c) => (
                  <FleetCard
                    key={c.id}
                    connection={c}
                    refetchIntervalMs={refetchIntervalMs}
                    snapshot={snapshotsByConnection.get(c.id)}
                    snapshotPollIntervalSeconds={pollIntervalSeconds}
                    memoryHistory={nodeSeries(historyByNode.get(c.id), "memory")}
                  />
                ))}
              </div>
            )}

            {/* Fleet inventory — schema census (databases / tables / views /
                rows) summed across every node, from the snapshot cache. */}
            <div className="mt-6 mb-3 flex items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                Fleet inventory
              </span>
            </div>
            <FleetInventoryStrip
              snapshots={snapshotsQuery.data?.connections ?? []}
              nodeCount={connections.length}
              isLoading={snapshotsQuery.isLoading}
            />

            {/* History window control — drives the panels below (not the live
                cards). Widen to 24h to investigate a past incident. */}
            <div className="mt-6 mb-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                History window
              </span>
              <HistoryRangePicker value={historyHours} onChange={setHistoryHours} />
            </div>

            {/* Fleet-wide panels — trend + consolidated exceptions feed over the
                selected window. Trend takes the wider column on desktop. */}
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <FleetTrendPanel
                connections={connections}
                hoursBack={historyHours}
                rangeLabel={rangeLabel}
              />
              <FleetExceptionsFeed
                connections={connections}
                hoursBack={historyHours}
                rangeLabel={rangeLabel}
              />
            </div>
          </>
        )}
      </div>

      <InfoDialog
        title="Fleet view"
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        variant="info"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-paper-muted">
            One pane for every ClickHouse node you can access. Each card polls
            its connection independently — a slow or unreachable node does
            not block the rest of the grid.
          </p>
          <ul className="flex flex-col gap-2 text-[12px] text-paper-muted">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
              <span>
                <strong className="text-paper">Healthy</strong> — memory under 70%, no long-running queries or merges, replicas in sync.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
              <span>
                <strong className="text-paper">Degraded</strong> — memory ≥ 70%, replica lag ≥ 30s, or at least one long-running query / merge.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />
              <span>
                <strong className="text-paper">Down</strong> — memory ≥ 90%, replica lag ≥ 5 min, a sick replica, OR three consecutive failed polls.
              </span>
            </li>
          </ul>
          <p className="text-[12px] text-paper-muted">
            Click <span className="font-mono uppercase tracking-[0.14em] text-paper">Open</span> on any card to drill into the per-node monitoring view.
          </p>
        </div>
      </InfoDialog>
    </div>
  );
}

/**
 * Aggregate status strip — counts how many cards are in each state right now.
 * Uses `useQueries` with the same key as the per-card hook, so this does not
 * trigger extra fetches: whichever component mounts first wins, the other
 * subscribes. The `staleTime: Infinity` here means this hook never triggers
 * a fetch itself — cards drive polling, this just reads cached values.
 */
function FleetStatusStrip({
  connections,
  refetchIntervalMs,
}: {
  connections: ClickHouseConnection[];
  refetchIntervalMs: number;
}) {
  const queries = useQueries({
    queries: connections.map((c) => ({
      queryKey: fleetSummaryQueryKey(c.id),
      queryFn: () => fetchFleetSummary(c.id),
      // Cards drive the actual poll cadence; this aggregator just subscribes
      // to the cache. Setting refetchInterval here too would double the
      // requests if the cards happen to use a different interval.
      refetchInterval: false as const,
      staleTime: refetchIntervalMs,
      retry: false,
    })),
  });

  if (connections.length === 0) return null;

  const counts = queries.reduce(
    (acc, q) => {
      const status = computeFleetStatus(q.data ?? undefined, q.isError, 0);
      if (status === "loading") acc.loading += 1;
      else if (status === "healthy") acc.healthy += 1;
      else if (status === "degraded") acc.degraded += 1;
      else if (status === "down") acc.down += 1;
      return acc;
    },
    { healthy: 0, degraded: 0, down: 0, loading: 0 },
  );

  return (
    <div className="hidden items-center gap-3 rounded-xs border border-ink-500 bg-ink-100 px-3 py-1.5 md:inline-flex">
      <StatusChip
        dotCls="bg-emerald-500 dark:bg-emerald-400"
        count={counts.healthy}
        label="healthy"
      />
      <span className="h-3 w-px bg-ink-500" aria-hidden />
      <StatusChip
        dotCls="bg-amber-500 dark:bg-amber-400"
        count={counts.degraded}
        label="degraded"
      />
      <span className="h-3 w-px bg-ink-500" aria-hidden />
      <StatusChip
        dotCls="bg-red-500 dark:bg-red-400"
        count={counts.down}
        label="down"
      />
    </div>
  );
}

function StatusChip({ dotCls, count, label }: { dotCls: string; count: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dotCls)} />
      <span className={cn("tabular-nums", count === 0 ? "text-paper-dim" : "text-paper")}>
        {count}
      </span>
      <span className="text-paper-muted">{label}</span>
    </span>
  );
}

const SORT_OPTIONS: { value: FleetSort; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "memory", label: "Memory" },
  { value: "name", label: "Name" },
];

const STATUS_FILTERS: { value: StatusFilter; label: string; dot?: string }[] = [
  { value: "all", label: "All" },
  { value: "healthy", label: "Healthy", dot: "bg-emerald-500 dark:bg-emerald-400" },
  { value: "degraded", label: "Degraded", dot: "bg-amber-500 dark:bg-amber-400" },
  { value: "down", label: "Down", dot: "bg-red-500 dark:bg-red-400" },
];

/**
 * Sort / filter / search toolbar for the node grid. Appears once the fleet
 * grows past a few nodes — keeps the grid scannable by letting the operator
 * float problems to the top (default), filter to a status, or jump to a node
 * by name/host.
 */
function FleetToolbar({
  sortBy,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  view,
  onViewChange,
  total,
  shown,
}: {
  sortBy: FleetSort;
  onSortChange: (s: FleetSort) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (s: StatusFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  view: FleetView;
  onViewChange: (v: FleetView) => void;
  total: number;
  shown: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Status filter pills */}
      <div role="radiogroup" aria-label="Filter by status" className="inline-flex overflow-hidden rounded-xs border border-ink-500">
        {STATUS_FILTERS.map((f, idx) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onStatusFilterChange(f.value)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
                idx > 0 && "border-l border-ink-500",
                active ? "bg-brand text-ink-50" : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
              )}
            >
              {f.dot && (
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-ink-50" : f.dot)} />
              )}
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Sort segmented control */}
      <div className="inline-flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">Sort</span>
        <div role="radiogroup" aria-label="Sort nodes" className="inline-flex overflow-hidden rounded-xs border border-ink-500">
          {SORT_OPTIONS.map((s, idx) => {
            const active = sortBy === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSortChange(s.value)}
                className={cn(
                  "h-9 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
                  idx > 0 && "border-l border-ink-500",
                  active ? "bg-brand text-ink-50" : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* View toggle: cards ⇄ rows */}
      <div role="radiogroup" aria-label="View density" className="ml-auto inline-flex overflow-hidden rounded-xs border border-ink-500">
        {([
          { value: "cards" as FleetView, icon: LayoutGrid, label: "Card view" },
          { value: "rows" as FleetView, icon: Rows3, label: "Compact row view" },
        ]).map((v, idx) => {
          const active = view === v.value;
          const Icon = v.icon;
          return (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={v.label}
              onClick={() => onViewChange(v.value)}
              className={cn(
                "grid h-9 w-9 place-items-center transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
                idx > 0 && "border-l border-ink-500",
                active ? "bg-brand text-ink-50" : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-dim" aria-hidden />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter by name or host…"
          aria-label="Filter nodes by name or host"
          className="h-9 w-[220px] rounded-xs border-ink-500 bg-ink-100 pl-8 pr-8 font-mono text-[11px] text-paper placeholder:text-paper-dim focus-visible:border-brand focus-visible:ring-0"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      {(statusFilter !== "all" || search) && (
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim tabular-nums">
          {shown}/{total}
        </span>
      )}
    </div>
  );
}

function FleetNoMatchState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
        <Search className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-[13px] text-paper">No nodes match</span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-8 items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-100 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper transition-colors hover:border-ink-700 hover:bg-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50"
      >
        <X className="h-3 w-3" aria-hidden />
        Clear filters
      </button>
    </div>
  );
}

function HistoryRangePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (hours: number) => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-xs border border-ink-500"
      role="radiogroup"
      aria-label="History window"
    >
      {RANGE_OPTIONS.map((opt, idx) => {
        const selected = value === opt.hours;
        return (
          <button
            key={opt.hours}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.hours)}
            className={cn(
              "h-8 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
              idx > 0 && "border-l border-ink-500",
              selected
                ? "bg-brand text-ink-50"
                : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function IntervalPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-xs border border-ink-500"
      role="radiogroup"
      aria-label="Auto-refresh interval"
    >
      {INTERVAL_OPTIONS.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-9 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
              idx > 0 && "border-l border-ink-500",
              selected
                ? "bg-brand text-ink-50"
                : "bg-ink-100 text-paper-muted hover:bg-ink-200 hover:text-paper",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function FleetLoadingSkeleton() {
  return (
    <div
      className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]"
      role="status"
      aria-label="Loading fleet connections"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton that mirrors the real FleetCard layout (header strip + 6-cell
 * tile grid + footer). Better than a single grey rectangle — the shape
 * primes the user for what's loading, and the eye doesn't have to re-parse
 * the layout once real data arrives.
 */
function SkeletonCard() {
  return (
    <div
      className="overflow-hidden rounded-md border border-ink-500 bg-ink-100 motion-safe:animate-pulse"
      aria-hidden
    >
      <div className="flex items-center gap-3 border-b border-ink-500 px-4 py-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ink-300" />
        <div className="flex-1 space-y-1.5">
          <span className="block h-3 w-1/2 rounded-xs bg-ink-300" />
          <span className="block h-2 w-2/3 rounded-xs bg-ink-200" />
        </div>
        <span className="h-9 w-16 shrink-0 rounded-xs bg-ink-200" />
      </div>
      <div className="grid grid-cols-2 [&>*]:border-b [&>*]:border-r [&>*]:border-ink-500 [&>*:nth-child(2n)]:border-r-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 px-4 py-3">
            <span className="block h-2 w-1/3 rounded-xs bg-ink-200" />
            <span className="block h-4 w-1/2 rounded-xs bg-ink-300" />
            <span className="block h-2 w-3/4 rounded-xs bg-ink-200" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-ink-500 bg-ink-200/60 px-4 py-2">
        <span className="block h-2 w-24 rounded-xs bg-ink-300" />
        <span className="block h-2 w-16 rounded-xs bg-ink-300" />
      </div>
    </div>
  );
}

function FleetEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
        <Globe2 className="h-5 w-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-paper">No connections yet</h2>
        <p className="max-w-md text-[12px] text-paper-muted">
          Add a ClickHouse connection to see it appear here. Each connection becomes one card.
        </p>
      </div>
      <Link
        to="/admin/connections"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 transition-colors",
          "hover:bg-brand-soft",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50",
        )}
      >
        <Plug className="h-3.5 w-3.5" aria-hidden />
        Add connection
      </Link>
    </div>
  );
}

/**
 * Banner shown when the FLEET_POLLER_ENABLED env is on but no fresh snapshot
 * has landed in `2 × pollInterval` — strong hint that the worker has stalled
 * or the DB writes are failing. Cards still render via the live-fallback
 * path; this is just a heads-up so the operator knows to check the server.
 */
function FleetStaleBanner({ pollIntervalSeconds }: { pollIntervalSeconds: number }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xs border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-900 dark:text-amber-300">
          Snapshot worker stalled
        </span>
        <p className="leading-relaxed">
          The backend poller hasn't written a fresh snapshot in over{" "}
          {pollIntervalSeconds * 2}s. Cards have fallen back to live polling — they're
          still accurate, but the node is doing more work. Check{" "}
          <code className="font-mono">FleetPoller</code> logs on the server.
        </p>
      </div>
    </div>
  );
}

function FleetErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xs border border-red-900/60 bg-red-950/40 text-red-300">
        <RefreshCw className="h-5 w-5" aria-hidden />
      </span>
      <h2 className="text-[15px] font-semibold text-paper">Could not load connections</h2>
      <p className="max-w-md text-[12px] text-paper-muted">{message}</p>
    </div>
  );
}
