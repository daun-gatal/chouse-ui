import { useEffect, useMemo, useState } from "react";
import { Layers, RefreshCw, Search, Filter } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PartLogTimelineChart } from "@/components/monitoring/PartLogTimelineChart";
import { PaginationBar } from "@/components/monitoring/PaginationBar";
import { AiDiagnoseButton } from "@/components/monitoring/AiDiagnoseButton";
import { SkeletonRows } from "@/components/common/Skeletons";
import { diagnoseTableParts } from "@/api/query";
import { usePartLog } from "@/hooks/useMonitoringTimeline";
import { ProjectionsView, SkipIndexesView } from "@/components/monitoring/MergeTreeObjects";
import { cn } from "@/lib/utils";

const PART_LOG_FETCH_LIMIT = 5000;

type PartsView = "log" | "projections" | "skipindex";

const SUBVIEWS: { id: PartsView; title: string; hint: string }[] = [
  { id: "log", title: "Part log", hint: "MergeTree part events" },
  { id: "projections", title: "Projections", hint: "Precomputed reorder / aggregate" },
  { id: "skipindex", title: "Skip indexes", hint: "Data-skipping (secondary)" },
];

interface PartsPageProps {
  embedded?: boolean;
  refreshKey?: number;
  autoRefresh?: boolean;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

const EVENT_TYPES = [
  "all",
  "MergeParts",
  "NewPart",
  "DownloadPart",
  "MutatePart",
  "RemovePart",
] as const;

const EVENT_COLOR: Record<string, string> = {
  MergeParts: "text-brand",
  NewPart: "text-emerald-400",
  DownloadPart: "text-sky-400",
  MutatePart: "text-amber-400",
  RemovePart: "text-violet-400",
};

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

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function PartsPage({
  embedded = false,
  refreshKey = 0,
  autoRefresh = false,
  onRefreshChange,
}: PartsPageProps) {
  const [view, setView] = useState<PartsView>("log");
  const [searchTerm, setSearchTerm] = useState("");
  const [eventType, setEventType] = useState<string>("all");
  const [pageSize, setPageSize] = useState(100);
  const [currentPage, setCurrentPage] = useState(0);

  const { data, isLoading, isFetching, error, refetch } = usePartLog(PART_LOG_FETCH_LIMIT, 6, {
    enabled: view === "log",
  });

  // Notify parent of refresh status — only the part-log view drives it from
  // here; the projections / skip-index views drive it themselves.
  useEffect(() => {
    if (view !== "log") return;
    onRefreshChange?.(isFetching);
  }, [isFetching, onRefreshChange, view]);

  // Manual refresh trigger from Monitoring header.
  useEffect(() => {
    if (refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Auto-refresh every 10s when toggled on.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refetch(), 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, refetch]);

  const rows = useMemo(() => {
    if (!data) return [];
    const term = searchTerm.trim().toLowerCase();
    return data.filter((r) => {
      if (eventType !== "all" && r.event_type !== eventType) return false;
      if (term.length === 0) return true;
      return (
        r.table.toLowerCase().includes(term) ||
        r.database.toLowerCase().includes(term) ||
        r.part_name.toLowerCase().includes(term) ||
        r.partition_id.toLowerCase().includes(term)
      );
    });
  }, [data, searchTerm, eventType]);

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [rows, startIndex, endIndex]
  );

  // Reset to the first page when filters or page size change.
  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm, eventType, pageSize]);

  return (
    <div className="h-full overflow-hidden">
      <div className={cn("flex h-full flex-col gap-4", embedded ? "p-4" : "p-6")}>
        {/* Sub-tabs */}
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-500">
          {SUBVIEWS.map((sv) => {
            const activeTab = view === sv.id;
            return (
              <button
                key={sv.id}
                type="button"
                onClick={() => setView(sv.id)}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  activeTab ? "text-paper" : "text-paper-muted hover:text-paper"
                )}
              >
                <span>{sv.title}</span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-paper-faint">· {sv.hint}</span>
                {activeTab && (
                  <span className="absolute -bottom-px left-0 right-0 h-px bg-brand" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        {view === "projections" && (
          <ProjectionsView refreshKey={refreshKey} onRefreshChange={onRefreshChange} />
        )}
        {view === "skipindex" && (
          <SkipIndexesView refreshKey={refreshKey} onRefreshChange={onRefreshChange} />
        )}

        {view === "log" && (
        <>
        {/* Chart card */}
        <PartLogTimelineChart hoursBack={6} bucket="minute" refreshKey={refreshKey} />

        {/* Filters strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-500 bg-ink-100 p-3">
          <div className="flex w-full items-center gap-2 md:w-[320px]">
            <Search className="h-4 w-4 text-paper-dim" />
            <Input
              placeholder="Search table, database, part…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-paper-dim" />
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="h-9 w-[160px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "all" ? "All events" : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-9 w-[130px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 / page</SelectItem>
              <SelectItem value="100">100 / page</SelectItem>
              <SelectItem value="250">250 / page</SelectItem>
              <SelectItem value="500">500 / page</SelectItem>
              <SelectItem value="1000">1000 / page</SelectItem>
            </SelectContent>
          </Select>

          <span
            className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint"
            title={
              (data?.length ?? 0) >= PART_LOG_FETCH_LIMIT
                ? `Showing the most recent ${PART_LOG_FETCH_LIMIT.toLocaleString()} events — narrow the filter or time range to see older ones.`
                : undefined
            }
          >
            Total · {totalRows.toLocaleString()}
            {(data?.length ?? 0) >= PART_LOG_FETCH_LIMIT && (
              <span className="ml-1 text-paper-dim">(latest)</span>
            )}
          </span>
        </div>

        {/* Table card */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100">
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <table className="w-full">
                <tbody>
                  <SkeletonRows count={8} cols={9} />
                </tbody>
              </table>
            ) : error ? (
              <div className="flex h-64 flex-col items-center justify-center gap-1 px-4 text-center">
                <span className="text-[13px] text-paper">Couldn't load part_log</span>
                <span className="text-[12px] text-paper-muted">{error.message}</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                  <Layers className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[13px] text-paper">No part events</span>
                <span className="text-[12px] text-paper-muted">
                  {searchTerm || eventType !== "all"
                    ? "Try adjusting the filters."
                    : "MergeTree activity will land here as merges, mutations, and downloads happen."}
                </span>
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
                  <tr className="border-b border-ink-500">
                    {[
                      "Event time",
                      "Event",
                      "Database",
                      "Table",
                      "Part",
                      "Partition",
                      "Duration",
                      "Rows",
                      "Size",
                      "",
                    ].map((h, i) => (
                      <th
                        key={h || "ai"}
                        className={cn(
                          "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                          i >= 6 ? "text-right" : "text-left"
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((r, i) => (
                    <tr
                      key={`${r.part_name}-${r.event_time}-${i}`}
                      className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
                    >
                      <td className="px-3 py-1.5 font-mono text-paper-muted whitespace-nowrap">
                        {r.event_time.slice(11)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "font-mono text-[11px]",
                            EVENT_COLOR[r.event_type] ?? "text-paper-muted"
                          )}
                        >
                          {r.event_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-paper">{r.database}</td>
                      <td className="px-3 py-1.5 text-paper">{r.table}</td>
                      <td
                        className="max-w-[260px] truncate px-3 py-1.5 font-mono text-paper-muted"
                        title={r.part_name}
                      >
                        {r.part_name}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-paper-muted">{r.partition_id}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-paper">
                        {formatDuration(r.duration_ms)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-paper">
                        {r.rows.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-paper">
                        {formatBytes(r.size_in_bytes)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <AiDiagnoseButton
                          compact
                          label="Diagnose"
                          title="Diagnose parts with Chouse AI"
                          badge={`${r.database}.${r.table}`}
                          subtitle="Chouse AI inspects this table's parts/partitions read-only and proposes a fix (merge pressure, too many parts, partition key). Review before acting."
                          runDiagnosis={(modelId) => diagnoseTableParts(r.database, r.table, modelId)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {totalRows > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalRows}
              rowLabel="events"
              onPrev={() => setCurrentPage((p) => Math.max(0, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              onFirst={() => setCurrentPage(0)}
              onLast={() => setCurrentPage(totalPages - 1)}
            />
          )}
        </div>

        {isFetching && (
          <div className="flex shrink-0 items-center justify-end text-[11px] text-paper-faint">
            <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.14em]">
              <RefreshCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
              Refreshing
            </span>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
