import { useEffect, useMemo, useState } from "react";
import { Search, AlertTriangle, CheckCircle2, Network, Wrench } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/common/Skeletons";
import { PaginationBar } from "@/components/monitoring/PaginationBar";
import {
  useMutations,
  useReplicationQueue,
  type MutationRow,
  type ReplicationQueueRow,
} from "@/hooks/useMonitoringTimeline";
import { cn } from "@/lib/utils";

type ClusterView = "mutations" | "replication";

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
  const active = view === "mutations" ? mutations : replication;
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
    const data = (active.data ?? []) as Array<MutationRow | ReplicationQueueRow>;
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

  return (
    <div className="h-full overflow-hidden">
      <div className={cn("flex h-full flex-col gap-4", embedded ? "p-4" : "p-6")}>
        {/* Sub-tabs */}
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-500">
          {(Object.keys(COPY) as ClusterView[]).map((id) => {
            const tab = COPY[id];
            const activeTab = view === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
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
            {view === "mutations" ? (
              <Wrench className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Network className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <p className="text-[12px] leading-[1.6] text-paper-muted">{COPY[view].rationale}</p>
        </div>

        {/* Filter + summary strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-500 bg-ink-100 p-3">
          <div className="flex w-full items-center gap-2 md:w-[320px]">
            <Search className="h-4 w-4 text-paper-dim" />
            <Input
              placeholder={
                view === "mutations"
                  ? "Search database, table, mutation, command…"
                  : "Search database, table, replica, exception…"
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
            ) : (
              <ReplicationTable rows={paginatedRows as ReplicationQueueRow[]} />
            )}
          </div>

          {totalRows > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalRows}
              rowLabel={view === "mutations" ? "mutations" : "tasks"}
              onPrev={() => setCurrentPage((p) => Math.max(0, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              onFirst={() => setCurrentPage(0)}
              onLast={() => setCurrentPage(totalPages - 1)}
            />
          )}
        </div>
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
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xs border border-emerald-500/30 bg-emerald-950/20 text-emerald-300">
        <CheckCircle2 className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-[13px] text-paper">
        {view === "mutations" ? "No mutations to report" : "Replication queue is clean"}
      </span>
      <span className="text-[12px] text-paper-muted">
        {hasSearch
          ? "Adjust the search filter."
          : view === "mutations"
            ? "No in-flight ALTER UPDATE/DELETE and nothing finished in the last 7 days."
            : "Every replica is caught up."}
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
          {["Status", "Database", "Table", "Command", "Parts left", "Created", "Last failure"].map((h, i) => (
            <th
              key={h}
              className={cn(
                "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                i === 4 ? "text-right" : "text-left"
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
          return (
            <tr
              key={`${m.mutation_id}-${i}`}
              className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
            >
              <td className="px-3 py-1.5">
                <StatusChip
                  state={m.is_done ? "done" : isFailing ? "failing" : "active"}
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

function StatusChip({ state }: { state: "active" | "done" | "failing" }) {
  const map = {
    active: { label: "Active", tone: "border-amber-500/40 text-amber-300" },
    done: { label: "Done", tone: "border-emerald-500/40 text-emerald-300" },
    failing: { label: "Failing", tone: "border-red-500/40 text-red-300" },
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
