import { useEffect, useMemo, useState } from "react";
import { Search, Stethoscope, AlertTriangle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/common/Skeletons";
import { PaginationBar } from "@/components/monitoring/PaginationBar";
import {
  useSchemaNullables,
  useSchemaOversized,
  type SchemaLintRow,
} from "@/hooks/useMonitoringTimeline";
import { cn } from "@/lib/utils";

type LintView = "nullable" | "oversized";

interface SchemaDoctorPageProps {
  embedded?: boolean;
  refreshKey?: number;
  onRefreshChange?: (isRefreshing: boolean) => void;
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

const COPY: Record<LintView, { title: string; hint: string; rationale: string }> = {
  nullable: {
    title: "Nullable",
    hint: "Wrapped in Nullable(T)",
    rationale:
      "Nullable carries a per-row null bitmap. If a column never holds NULL — or holds it for less than ~5% of rows — drop the wrapper to save bytes and let codecs compress harder.",
  },
  oversized: {
    title: "Oversized integers",
    hint: "Int64 / UInt64 / wider",
    rationale:
      "Wide integer types cost 2-8× the bytes of their smaller siblings. If the actual range fits Int32 (or UInt16, etc.), downcast — both storage and compression improve.",
  },
};

export default function SchemaDoctorPage({
  embedded = false,
  refreshKey = 0,
  onRefreshChange,
}: SchemaDoctorPageProps) {
  const [view, setView] = useState<LintView>("nullable");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 100;

  const nullable = useSchemaNullables({ enabled: view === "nullable" });
  const oversized = useSchemaOversized({ enabled: view === "oversized" });

  const active = view === "nullable" ? nullable : oversized;
  const { data = [], isLoading, isFetching, error, refetch } = active;

  useEffect(() => {
    onRefreshChange?.(isFetching);
  }, [isFetching, onRefreshChange]);

  useEffect(() => {
    if (refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const rows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return data;
    return data.filter(
      (r) =>
        r.database.toLowerCase().includes(term) ||
        r.table.toLowerCase().includes(term) ||
        r.column.toLowerCase().includes(term) ||
        r.type.toLowerCase().includes(term)
    );
  }, [data, searchTerm]);

  useEffect(() => {
    setCurrentPage(0);
  }, [view, searchTerm]);

  const totalRows = rows.length;
  const totalCompressed = useMemo(
    () => rows.reduce((s, r) => s + r.compressed_bytes, 0),
    [rows]
  );
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [rows, startIndex, endIndex]
  );

  return (
    <div className="h-full overflow-hidden">
      <div className={cn("flex h-full flex-col gap-4", embedded ? "p-4" : "p-6")}>
        {/* Tab strip — nullable vs oversized */}
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-500">
          {(Object.keys(COPY) as LintView[]).map((id) => {
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
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
          </span>
          <p className="text-[12px] leading-[1.6] text-paper-muted">{COPY[view].rationale}</p>
        </div>

        {/* Filter + summary strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-500 bg-ink-100 p-3">
          <div className="flex w-full items-center gap-2 md:w-[320px]">
            <Search className="h-4 w-4 text-paper-dim" />
            <Input
              placeholder="Search database, table, column…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
            />
          </div>

          <div className="ml-auto flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            <span>
              Columns · <span className="text-paper">{totalRows.toLocaleString()}</span>
            </span>
            <span>
              On-disk · <span className="text-paper">{formatBytes(totalCompressed)}</span>
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
              <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-xs border border-red-900/60 bg-red-950/30 text-red-300">
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[13px] text-paper">Couldn't run schema check</span>
                <span className="text-[12px] text-paper-muted">{error.message}</span>
              </div>
            ) : totalRows === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                  <Stethoscope className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[13px] text-paper">
                  {view === "nullable" ? "No Nullable columns found" : "No oversized integers found"}
                </span>
                <span className="text-[12px] text-paper-muted">
                  {searchTerm
                    ? "Adjust the search filter."
                    : "Either the schema is already tight, or this connection has no user tables yet."}
                </span>
              </div>
            ) : (
              <SchemaTable rows={paginatedRows} totalCompressed={totalCompressed} />
            )}
          </div>

          {totalRows > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalRows}
              rowLabel="columns"
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

interface SchemaTableProps {
  rows: SchemaLintRow[];
  totalCompressed: number;
}

function SchemaTable({ rows, totalCompressed }: SchemaTableProps) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {["Database", "Table", "Column", "Type", "Rows", "On-disk", "% of total"].map(
            (h, i) => (
              <th
                key={h}
                className={cn(
                  "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                  i >= 4 ? "text-right" : "text-left"
                )}
              >
                {h}
              </th>
            )
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const pct = totalCompressed > 0 ? (r.compressed_bytes / totalCompressed) * 100 : 0;
          return (
            <tr
              key={`${r.database}.${r.table}.${r.column}-${i}`}
              className="relative border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
            >
              <td className="px-3 py-1.5 font-mono text-paper-muted">{r.database}</td>
              <td className="px-3 py-1.5 text-paper">{r.table}</td>
              <td className="px-3 py-1.5 font-mono text-paper">{r.column}</td>
              <td className="px-3 py-1.5 font-mono text-amber-300">{r.type}</td>
              <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
                {r.total_rows.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-paper">
                {formatBytes(r.compressed_bytes)}
              </td>
              <td className="px-3 py-1.5 text-right">
                <RatioBar pct={pct} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RatioBar({ pct }: { pct: number }) {
  return (
    <div className="inline-flex w-[100px] items-center gap-2">
      <div className="relative h-1.5 flex-1 rounded-xs bg-ink-300">
        <div
          className="absolute inset-y-0 left-0 rounded-xs bg-brand"
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          aria-hidden
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono tabular-nums text-[10px] text-paper-muted">
        {pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`}
      </span>
    </div>
  );
}
