import { useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, CheckCircle2, Network, Wrench, Activity, Layers, Database, Hourglass, Boxes, GitBranch, ServerCog, FlaskConical, type LucideIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/common/Skeletons";
import { PaginationBar } from "@/components/monitoring/PaginationBar";
import { DdlSimulator } from "@/components/monitoring/DdlSimulator";
import {
  useMutations,
  useReplicationQueue,
  useReplicaStatus,
  useBlockedTaskSummary,
  useClusterTopology,
  useDistributionQueue,
  useDistributedDDLQueue,
  type MutationRow,
  type ReplicationQueueRow,
  type ClusterTopologyRow,
  type DistributionQueueRow,
  type DistributedDDLRow,
} from "@/hooks/useMonitoringTimeline";
import { cn } from "@/lib/utils";

function formatLagSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

type ClusterView = "mutations" | "replication" | "topology" | "distribution" | "ddl" | "simulator";

interface ClusterActivityPageProps {
  embedded?: boolean;
  refreshKey?: number;
  autoRefresh?: boolean;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

const COPY: Record<ClusterView, { title: string; hint: string; rationale: string }> = {
  mutations: {
    title: "Mutations",
    hint: "ALTER UPDATE / DELETE",
    rationale:
      "ClickHouse mutations are not in-place — they rewrite affected parts in the background. Long-running entries with a failure reason often need an operator's attention.",
  },
  replication: {
    title: "Replication queue",
    hint: "Pending replica work",
    rationale:
      "Each Replicated*MergeTree replica drives a queue of fetches, merges, and mutations. Rising num_tries with a non-empty last_exception is the canonical replica-is-sick signal.",
  },
  topology: {
    title: "Topology",
    hint: "Shards & replicas",
    rationale:
      "system.clusters lists every shard/replica in each named cluster. errors_count and slowdowns_count per host expose flaky nodes; a non-zero estimated_recovery_time means ClickHouse has temporarily benched that host from distributed queries.",
  },
  distribution: {
    title: "Insert backlog",
    hint: "Pending shard inserts",
    rationale:
      "Async inserts into Distributed tables are staged on disk before forwarding to shards. A growing data_files or non-zero error_count means inserts aren't draining — a stuck shard or a serialization problem.",
  },
  ddl: {
    title: "DDL queue",
    hint: "ON CLUSTER DDL",
    rationale:
      "ON CLUSTER DDL is applied node-by-node through ZooKeeper/Keeper. Entries that aren't 'Finished', or carry an exception, mean a schema change didn't propagate everywhere — a classic source of replica divergence.",
  },
  simulator: {
    title: "DDL simulator",
    hint: "Estimate an ALTER before running it",
    rationale:
      "Mutations (ALTER UPDATE/DELETE) rewrite whole parts in the background and can run for hours. This estimates the cost — rows matched, parts and bytes rewritten, projected duration, and whether free disk can hold the transient rewrite — without executing anything.",
  },
};

/** Per-view icon, shared by the sub-tabs and the rationale strip. */
const VIEW_ICON: Record<ClusterView, LucideIcon> = {
  mutations: Wrench,
  replication: Network,
  topology: ServerCog,
  distribution: Boxes,
  ddl: GitBranch,
  simulator: FlaskConical,
};

export default function ClusterActivityPage({
  embedded = false,
  refreshKey = 0,
  autoRefresh = false,
  onRefreshChange,
}: ClusterActivityPageProps) {
  const [view, setView] = useState<ClusterView>("mutations");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 50;

  const mutations = useMutations({ enabled: view === "mutations" });
  const replication = useReplicationQueue({ enabled: view === "replication" });
  const blockedSummary = useBlockedTaskSummary();
  const replicaStatus = useReplicaStatus({ enabled: view === "replication" });
  const topology = useClusterTopology({ enabled: view === "topology" });
  const distribution = useDistributionQueue({ enabled: view === "distribution" });
  const ddl = useDistributedDDLQueue({ enabled: view === "ddl" });
  const active =
    view === "mutations"
      ? mutations
      : view === "replication"
        ? replication
        : view === "topology"
          ? topology
          : view === "distribution"
            ? distribution
            : ddl;
  const { isLoading, isFetching, error, refetch } = active;

  useEffect(() => {
    onRefreshChange?.(isFetching);
  }, [isFetching, onRefreshChange]);

  useEffect(() => {
    if (refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refetch(), 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, refetch]);

  useEffect(() => {
    setCurrentPage(0);
  }, [view, searchTerm]);

  const rows = useMemo(() => {
    const data = (active.data ?? []) as Array<
      | MutationRow
      | ReplicationQueueRow
      | ClusterTopologyRow
      | DistributionQueueRow
      | DistributedDDLRow
    >;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return data;
    return data.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(term)
    );
  }, [active.data, searchTerm]);

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [rows, startIndex, endIndex]
  );

  // Counts for header strip
  const stuckMutations = view === "mutations"
    ? (mutations.data ?? []).filter((m) => !m.is_done).length
    : 0;
  const failingTasks = view === "replication"
    ? (replication.data ?? []).filter((r) => r.num_tries >= 3 || r.last_exception).length
    : 0;
  const flakyHosts = view === "topology"
    ? (topology.data ?? []).filter((h) => h.errors_count > 0 || h.slowdowns_count > 0 || h.estimated_recovery_time > 0).length
    : 0;
  const stuckInserts = view === "distribution"
    ? (distribution.data ?? []).filter((d) => d.error_count > 0 || d.broken_data_files > 0 || d.is_blocked === 1).length
    : 0;
  const failedDDL = view === "ddl"
    ? (ddl.data ?? []).filter((d) => d.exception_code > 0 || (d.status && d.status !== "Finished")).length
    : 0;
  const isCoreView = view === "mutations" || view === "replication";

  return (
    <div className="h-full overflow-hidden">
      <div className={cn("flex h-full flex-col gap-4", embedded ? "p-4" : "p-6")}>
        {/* Sub-tabs — same title · hint underline pattern as the Parts tab, so
            the Monitoring sub-tabs stay consistent. The row scrolls on narrow
            widths instead of cramping (this view has more tabs than Parts). */}
        <div className="scrollbar-hide flex shrink-0 items-center gap-2 overflow-x-auto border-b border-ink-500">
          {(Object.keys(COPY) as ClusterView[]).map((id) => {
            const tab = COPY[id];
            const activeTab = view === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "group relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  activeTab ? "text-paper" : "text-paper-muted hover:text-paper"
                )}
              >
                <span>{tab.title}</span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-paper-faint">
                  · {tab.hint}
                </span>
                {activeTab && (
                  <span
                    className="absolute -bottom-px left-0 right-0 h-px bg-brand"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Rationale strip */}
        <div className="flex items-start gap-3 rounded-xs border border-ink-500 bg-ink-100 px-4 py-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            {(() => {
              const Icon = VIEW_ICON[view];
              return <Icon className="h-3.5 w-3.5" aria-hidden />;
            })()}
          </span>
          <p className="text-[12px] leading-[1.6] text-paper-muted">{COPY[view].rationale}</p>
        </div>

        {/* Blocked-task indicator strip — only on the replicated-table views
            (mutations / replication) where it's relevant; the distributed
            sub-views have their own per-row health signals. */}
        {isCoreView && blockedSummary.data && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <BlockedChip
              icon={Activity}
              label="Long queries"
              value={blockedSummary.data.long_running_queries}
              hint=">60s"
              warnThreshold={1}
            />
            <BlockedChip
              icon={Layers}
              label="Long merges"
              value={blockedSummary.data.long_running_merges}
              hint=">5min"
              warnThreshold={1}
            />
            <BlockedChip
              icon={Database}
              label="Open mutations"
              value={blockedSummary.data.open_mutations}
              hint="not done"
              warnThreshold={1}
            />
            <BlockedChip
              icon={Hourglass}
              label="Max replica lag"
              value={formatLagSeconds(blockedSummary.data.max_replica_lag_seconds)}
              numericValue={blockedSummary.data.max_replica_lag_seconds}
              hint={`${blockedSummary.data.sick_replicas} sick`}
              warnThreshold={60}
            />
          </div>
        )}

        {/* Replica status panel — only on the replication view */}
        {view === "replication" && replicaStatus.data && replicaStatus.data.length > 0 && (
          <div className="rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center justify-between border-b border-ink-500 px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                Replica status · top {Math.min(replicaStatus.data.length, 6)}
              </span>
              <span className="font-mono text-[10px] tracking-[0.14em] text-paper-faint">
                {replicaStatus.data.length} replicas
              </span>
            </div>
            <div className="grid grid-cols-1 divide-y divide-ink-500/60 md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-3">
              {replicaStatus.data.slice(0, 6).map((r) => {
                const sick = r.absolute_delay > 60 || r.is_readonly === 1 || r.is_session_expired === 1;
                return (
                  <div
                    key={`${r.database}.${r.table}.${r.replica_name}`}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] text-paper" title={`${r.database}.${r.table}`}>
                        {r.database}.{r.table}
                      </div>
                      <div className="truncate font-mono text-[10px] text-paper-faint" title={r.replica_name}>
                        {r.replica_name}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className={cn(
                        "font-mono text-[11px] tabular-nums",
                        sick ? "text-red-600 dark:text-red-300" : "text-paper"
                      )}>
                        {formatLagSeconds(r.absolute_delay)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
                        q{r.queue_size.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DDL simulator — self-contained; bypasses the tabular row/search/pagination body. */}
        {view === "simulator" && (
          <div className="flex-1 min-h-0 overflow-auto pr-1">
            <DdlSimulator />
          </div>
        )}

        {view !== "simulator" && (
          <>
        {/* Filter + summary strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-500 bg-ink-100 p-3">
          <div className="flex w-full items-center gap-2 md:w-[320px]">
            <Search className="h-4 w-4 text-paper-dim" />
            <Input
              placeholder={
                view === "mutations"
                  ? "Search database, table, mutation, command…"
                  : view === "replication"
                    ? "Search database, table, replica, exception…"
                    : view === "topology"
                      ? "Search cluster, host…"
                      : view === "distribution"
                        ? "Search database, table, exception…"
                        : "Search cluster, host, query, exception…"
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
            />
          </div>

          <div className="ml-auto flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            {view === "mutations" && stuckMutations > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {stuckMutations.toLocaleString()} in flight
              </span>
            )}
            {view === "replication" && failingTasks > 0 && (
              <span className="inline-flex items-center gap-1.5 text-red-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {failingTasks.toLocaleString()} sick tasks
              </span>
            )}
            {view === "topology" && flakyHosts > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {flakyHosts.toLocaleString()} flaky
              </span>
            )}
            {view === "distribution" && stuckInserts > 0 && (
              <span className="inline-flex items-center gap-1.5 text-red-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {stuckInserts.toLocaleString()} stuck
              </span>
            )}
            {view === "ddl" && failedDDL > 0 && (
              <span className="inline-flex items-center gap-1.5 text-red-300">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {failedDDL.toLocaleString()} unfinished
              </span>
            )}
            <span>
              Total · <span className="text-paper">{totalRows.toLocaleString()}</span>
            </span>
          </div>
        </div>

        {/* Table card */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100">
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <table className="w-full">
                <tbody>
                  <SkeletonRows count={8} cols={7} />
                </tbody>
              </table>
            ) : error ? (
              <ErrorState message={error.message} />
            ) : totalRows === 0 ? (
              <EmptyState view={view} hasSearch={!!searchTerm} />
            ) : view === "mutations" ? (
              <MutationsTable rows={paginatedRows as MutationRow[]} />
            ) : view === "replication" ? (
              <ReplicationTable rows={paginatedRows as ReplicationQueueRow[]} />
            ) : view === "topology" ? (
              <TopologyTable rows={paginatedRows as ClusterTopologyRow[]} />
            ) : view === "distribution" ? (
              <DistributionTable rows={paginatedRows as DistributionQueueRow[]} />
            ) : (
              <DDLTable rows={paginatedRows as DistributedDDLRow[]} />
            )}
          </div>

          {totalRows > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalRows}
              rowLabel={
                view === "mutations" ? "mutations"
                : view === "replication" ? "tasks"
                : view === "topology" ? "hosts"
                : view === "distribution" ? "tables"
                : "entries"
              }
              onPrev={() => setCurrentPage((p) => Math.max(0, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              onFirst={() => setCurrentPage(0)}
              onLast={() => setCurrentPage(totalPages - 1)}
            />
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xs border border-red-900/60 bg-red-950/30 text-red-300">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-[13px] text-paper">Couldn't load cluster activity</span>
      <span className="text-[12px] text-paper-muted">{message}</span>
    </div>
  );
}

function EmptyState({ view, hasSearch }: { view: ClusterView; hasSearch: boolean }) {
  const TITLE: Record<ClusterView, string> = {
    mutations: "No mutations to report",
    replication: "Replication queue is clean",
    topology: "No clusters",
    distribution: "Backlog is clean",
    ddl: "DDL queue is clean",
    simulator: "DDL simulator",
  };
  const BODY: Record<ClusterView, string> = {
    mutations: "No in-flight ALTER UPDATE/DELETE and nothing finished in the last 7 days.",
    replication: "Every replica is caught up.",
    topology: "No clusters defined — this server isn't part of a distributed setup.",
    distribution: "No Distributed-table insert backlog (or there are no Distributed tables).",
    ddl: "No ON CLUSTER DDL in the last day (or no ZooKeeper/Keeper is configured).",
    simulator: "Enter an ALTER … UPDATE/DELETE above to estimate its impact.",
  };
  const Icon = view === "topology" ? ServerCog : CheckCircle2;
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xs border border-emerald-500/30 bg-emerald-950/20 text-emerald-300">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-[13px] text-paper">{TITLE[view]}</span>
      <span className="max-w-md text-[12px] text-paper-muted">
        {hasSearch ? "Adjust the search filter." : BODY[view]}
      </span>
    </div>
  );
}

interface MutationsTableProps {
  rows: MutationRow[];
}

function MutationsTable({ rows }: MutationsTableProps) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {["Status", "Database", "Table", "Command", "Progress", "Parts left", "Created", "Last failure"].map((h, i) => (
            <th
              key={h}
              className={cn(
                "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                i === 5 ? "text-right" : "text-left"
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => {
          const isFailing = !!m.latest_fail_reason;
          // Best-effort progress: 1 − remaining/total. Only meaningful while
          // running (done rows render full; no denominator → no bar).
          const pct =
            m.is_done
              ? 1
              : m.total_parts > 0
                ? Math.min(1, Math.max(0, 1 - m.parts_to_do / m.total_parts))
                : null;
          return (
            <tr
              key={`${m.mutation_id}-${i}`}
              className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
            >
              <td className="px-3 py-1.5">
                <StatusChip
                  state={m.is_killed ? "killed" : m.is_done ? "done" : isFailing ? "failing" : "active"}
                />
              </td>
              <td className="px-3 py-1.5 font-mono text-paper-muted">{m.database}</td>
              <td className="px-3 py-1.5 text-paper">{m.table}</td>
              <td
                className="max-w-[420px] truncate px-3 py-1.5 font-mono text-paper"
                title={m.command}
              >
                {m.command}
              </td>
              <td className="px-3 py-1.5">
                {pct === null ? (
                  <span className="font-mono text-paper-faint">—</span>
                ) : (
                  <div className="flex items-center gap-2 min-w-[120px]">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-300">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          isFailing ? "bg-red-500" : m.is_done ? "bg-emerald-500" : "bg-brand"
                        )}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-paper-muted tabular-nums">
                      {Math.round(pct * 100)}%
                    </span>
                  </div>
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-paper">
                {m.parts_to_do.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 font-mono text-paper-muted whitespace-nowrap">
                {m.create_time}
              </td>
              <td
                className="max-w-[260px] truncate px-3 py-1.5 font-mono text-red-300"
                title={m.latest_fail_reason}
              >
                {m.latest_fail_reason || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface ReplicationTableProps {
  rows: ReplicationQueueRow[];
}

function ReplicationTable({ rows }: ReplicationTableProps) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {[
            "Status",
            "Database",
            "Table",
            "Replica",
            "Type",
            "Tries",
            "Last attempt",
            "Last exception",
          ].map((h, i) => (
            <th
              key={h}
              className={cn(
                "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                i === 5 ? "text-right" : "text-left"
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const sick = r.num_tries >= 3 || !!r.last_exception;
          return (
            <tr
              key={`${r.replica_name}-${r.new_part_name}-${i}`}
              className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
            >
              <td className="px-3 py-1.5">
                <StatusChip state={sick ? "failing" : "active"} />
              </td>
              <td className="px-3 py-1.5 font-mono text-paper-muted">{r.database}</td>
              <td className="px-3 py-1.5 text-paper">{r.table}</td>
              <td className="px-3 py-1.5 font-mono text-paper">{r.replica_name}</td>
              <td className="px-3 py-1.5 font-mono text-paper-muted">{r.type}</td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right font-mono tabular-nums",
                  r.num_tries >= 3 ? "text-red-300" : "text-paper"
                )}
              >
                {r.num_tries.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 font-mono text-paper-muted whitespace-nowrap">
                {r.last_attempt_time}
              </td>
              <td
                className="max-w-[280px] truncate px-3 py-1.5 font-mono text-red-300"
                title={r.last_exception}
              >
                {r.last_exception || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BlockedChip({
  icon: Icon,
  label,
  value,
  hint,
  warnThreshold,
  numericValue,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number | string;
  hint?: string;
  warnThreshold: number;
  numericValue?: number;
}) {
  const compareValue = typeof numericValue === "number" ? numericValue : (typeof value === "number" ? value : 0);
  const isWarn = compareValue >= warnThreshold;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xs border px-3 py-2",
        isWarn
          ? "border-amber-500/40 bg-amber-500/[0.06]"
          : "border-ink-500 bg-ink-100"
      )}
    >
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-xs border",
          isWarn
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-ink-500 bg-ink-200 text-paper-muted"
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
          {label}
          {hint && <span className="ml-1 text-paper-faint/70">· {hint}</span>}
        </div>
        <div
          className={cn(
            "font-mono text-[16px] font-semibold leading-tight tabular-nums",
            isWarn ? "text-amber-800 dark:text-amber-100" : "text-paper"
          )}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ state }: { state: "active" | "done" | "failing" | "killed" }) {
  const map = {
    active: { label: "Active", tone: "border-amber-500/40 text-amber-300" },
    done: { label: "Done", tone: "border-emerald-500/40 text-emerald-300" },
    failing: { label: "Failing", tone: "border-red-500/40 text-red-300" },
    killed: { label: "Killed", tone: "border-paper-faint/40 text-paper-faint" },
  } as const;
  const c = map[state];
  return (
    <span
      className={cn(
        "rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        c.tone
      )}
    >
      {c.label}
    </span>
  );
}

function TopologyTable({ rows }: { rows: ClusterTopologyRow[] }) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {["Health", "Cluster", "Shard", "Replica", "Host", "Errors", "Slowdowns", "Recovery"].map((h, i) => (
            <th
              key={h}
              className={cn(
                "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                i >= 5 ? "text-right" : "text-left"
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((h, i) => {
          const flaky = h.errors_count > 0 || h.slowdowns_count > 0 || h.estimated_recovery_time > 0;
          return (
            <tr key={`${h.cluster}-${h.shard_num}-${h.replica_num}-${i}`} className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
              <td className="px-3 py-1.5">
                <span className={cn("rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", flaky ? "border-amber-500/40 text-amber-300" : "border-emerald-500/40 text-emerald-300")}>
                  {flaky ? "Flaky" : "OK"}
                </span>
              </td>
              <td className="px-3 py-1.5 font-mono text-paper">{h.cluster}</td>
              <td className="px-3 py-1.5 text-paper-muted tabular-nums">{h.shard_num}</td>
              <td className="px-3 py-1.5 text-paper-muted tabular-nums">{h.replica_num}</td>
              <td className="px-3 py-1.5 font-mono text-paper" title={`${h.host_address}:${h.port}`}>
                {h.host_name}
                {h.is_local === 1 && (
                  <span className="ml-2 rounded-xs border border-brand/40 px-1 py-px font-mono text-[9px] uppercase tracking-[0.14em] text-brand">local</span>
                )}
              </td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", h.errors_count > 0 ? "text-red-300" : "text-paper-muted")}>{h.errors_count.toLocaleString()}</td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", h.slowdowns_count > 0 ? "text-amber-300" : "text-paper-muted")}>{h.slowdowns_count.toLocaleString()}</td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", h.estimated_recovery_time > 0 ? "text-amber-300" : "text-paper-faint")}>{h.estimated_recovery_time > 0 ? `${h.estimated_recovery_time}s` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DistributionTable({ rows }: { rows: DistributionQueueRow[] }) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {["Status", "Database", "Table", "Files", "Size", "Broken", "Last exception"].map((h, i) => (
            <th key={h} className={cn("px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint", i >= 3 && i <= 5 ? "text-right" : "text-left")}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((d, i) => {
          const stuck = d.error_count > 0 || d.broken_data_files > 0 || d.is_blocked === 1;
          return (
            <tr key={`${d.database}.${d.table}-${i}`} className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
              <td className="px-3 py-1.5">
                <span className={cn("rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", stuck ? "border-red-500/40 text-red-300" : "border-emerald-500/40 text-emerald-300")}>{stuck ? "Stuck" : "Draining"}</span>
              </td>
              <td className="px-3 py-1.5 font-mono text-paper-muted">{d.database}</td>
              <td className="px-3 py-1.5 text-paper">{d.table}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper">{d.data_files.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper-muted">{formatBytes(d.data_compressed_bytes)}</td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", d.broken_data_files > 0 ? "text-red-300" : "text-paper-faint")}>{d.broken_data_files.toLocaleString()}</td>
              <td className="max-w-[300px] truncate px-3 py-1.5 font-mono text-red-300" title={d.last_exception}>{d.last_exception || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DDLTable({ rows }: { rows: DistributedDDLRow[] }) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {["Status", "Cluster", "Host", "Query", "Started", "Duration", "Exception"].map((h, i) => (
            <th key={h} className={cn("px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint", i === 5 ? "text-right" : "text-left")}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((d, i) => {
          const failed = d.exception_code > 0;
          const finished = d.status === "Finished";
          return (
            <tr key={`${d.entry}-${d.host_name}-${i}`} className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
              <td className="px-3 py-1.5">
                <span className={cn("rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", failed ? "border-red-500/40 text-red-300" : finished ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300")}>{failed ? "Failed" : d.status || "—"}</span>
              </td>
              <td className="px-3 py-1.5 font-mono text-paper-muted">{d.cluster}</td>
              <td className="px-3 py-1.5 font-mono text-paper">{d.host_name}</td>
              <td className="max-w-[360px] truncate px-3 py-1.5 font-mono text-paper" title={d.query_preview}>{d.query_preview}</td>
              <td className="px-3 py-1.5 font-mono text-paper-muted whitespace-nowrap">{d.query_start_time || "—"}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper-muted">{d.query_duration_ms ? `${d.query_duration_ms.toLocaleString()}ms` : "—"}</td>
              <td className="max-w-[240px] truncate px-3 py-1.5 font-mono text-red-300" title={d.exception_text}>{d.exception_text || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
