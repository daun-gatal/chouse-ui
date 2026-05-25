import { useEffect, useMemo, useState } from "react";
import {
  Search,
  TableProperties,
  AlertTriangle,
  Gauge,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/common/Skeletons";
import { PaginationBar } from "@/components/monitoring/PaginationBar";
import {
  useSchemaNullables,
  useSchemaOversized,
  useSchemaCompression,
  type SchemaLintRow,
} from "@/hooks/useMonitoringTimeline";
import { cn } from "@/lib/utils";

type LintView = "nullable" | "oversized" | "compression";

type SortKey =
  | "database"
  | "table"
  | "column"
  | "type"
  | "total_rows"
  | "compressed_bytes"
  | "uncompressed_bytes"
  | "ratio";
type SortDir = "asc" | "desc";
interface SortState {
  key: SortKey;
  dir: SortDir;
}

const TEXT_KEYS: SortKey[] = ["database", "table", "column", "type"];
const ratioOf = (r: SchemaLintRow) =>
  r.compressed_bytes > 0 ? r.uncompressed_bytes / r.compressed_bytes : 0;

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
  compression: {
    title: "Compression",
    hint: "On-disk vs raw, by column",
    rationale:
      "Compression ratio = uncompressed ÷ on-disk bytes. A large column that barely compresses (ratio near 1×) is wasting disk — usually fixable with a better codec: Delta / DoubleDelta / Gorilla for sequences & timestamps, a higher ZSTD level, or LowCardinality for repetitive strings. Sorted by on-disk size so the biggest wins surface first.",
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
  // Default order matches the SQL (biggest on-disk first).
  const [sort, setSort] = useState<SortState>({ key: "compressed_bytes", dir: "desc" });
  const pageSize = 100;

  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: TEXT_KEYS.includes(key) ? "asc" : "desc" }
    );

  const nullable = useSchemaNullables({ enabled: view === "nullable" });
  const oversized = useSchemaOversized({ enabled: view === "oversized" });
  const compression = useSchemaCompression({ enabled: view === "compression" });

  const active = view === "nullable" ? nullable : view === "oversized" ? oversized : compression;
  const { data = [], isLoading, isFetching, error, refetch } = active;

  useEffect(() => {
    onRefreshChange?.(isFetching);
  }, [isFetching, onRefreshChange]);

  useEffect(() => {
    if (refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const filtered = useMemo(() => {
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

  const rows = useMemo(() => {
    const arr = [...filtered];
    const { key } = sort;
    const mul = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (key === "ratio") return (ratioOf(a) - ratioOf(b)) * mul;
      if (TEXT_KEYS.includes(key)) {
        return String(a[key]).localeCompare(String(b[key])) * mul;
      }
      return (Number(a[key]) - Number(b[key])) * mul;
    });
    return arr;
  }, [filtered, sort]);

  useEffect(() => {
    setCurrentPage(0);
  }, [view, searchTerm, sort]);

  const totalRows = rows.length;
  const totalCompressed = useMemo(
    () => filtered.reduce((s, r) => s + r.compressed_bytes, 0),
    [filtered]
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
            {view === "compression" ? (
              <Gauge className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <TableProperties className="h-3.5 w-3.5" aria-hidden />
            )}
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
                  <TableProperties className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[13px] text-paper">
                  {view === "nullable"
                    ? "No Nullable columns found"
                    : view === "oversized"
                      ? "No oversized integers found"
                      : "No columns found"}
                </span>
                <span className="text-[12px] text-paper-muted">
                  {searchTerm
                    ? "Adjust the search filter."
                    : "Either the schema is already tight, or this connection has no user tables yet."}
                </span>
              </div>
            ) : view === "compression" ? (
              <CompressionTable rows={paginatedRows} sort={sort} onSort={toggleSort} />
            ) : (
              <SchemaTable rows={paginatedRows} totalCompressed={totalCompressed} sort={sort} onSort={toggleSort} />
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

/** A clickable, sort-aware header cell. Omit sortKey for a static header. */
function SortHeaderCell({
  label,
  sortKey,
  align,
  sort,
  onSort,
}: {
  label: string;
  sortKey?: SortKey;
  align: "left" | "right";
  sort: SortState;
  onSort: (k: SortKey) => void;
}) {
  const base = cn(
    "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]",
    align === "right" ? "text-right" : "text-left"
  );
  if (!sortKey) return <th className={cn(base, "text-paper-faint")}>{label}</th>;
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={base}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "group inline-flex items-center gap-1 transition-colors hover:text-paper focus:outline-none focus-visible:text-paper",
          align === "right" && "flex-row-reverse",
          active ? "text-paper" : "text-paper-faint"
        )}
      >
        <span>{label}</span>
        <Icon
          className={cn("h-3 w-3", active ? "text-brand" : "text-paper-faint/50 group-hover:text-paper-muted")}
          aria-hidden
        />
      </button>
    </th>
  );
}

interface SchemaTableProps {
  rows: SchemaLintRow[];
  totalCompressed: number;
  sort: SortState;
  onSort: (k: SortKey) => void;
}

function SchemaTable({ rows, totalCompressed, sort, onSort }: SchemaTableProps) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          <SortHeaderCell label="Database" sortKey="database" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Table" sortKey="table" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Column" sortKey="column" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Type" sortKey="type" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Rows" sortKey="total_rows" align="right" sort={sort} onSort={onSort} />
          <SortHeaderCell label="On-disk" sortKey="compressed_bytes" align="right" sort={sort} onSort={onSort} />
          <SortHeaderCell label="% of total" align="right" sort={sort} onSort={onSort} />
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

// "Poor compression" threshold — used only to gently de-emphasize good
// compressors so low ratios stand out on their own, without colour. Sort the
// Ratio column ascending to bring codec candidates to the top.
const GOOD_RATIO = 4;

function CompressionTable({
  rows,
  sort,
  onSort,
}: {
  rows: SchemaLintRow[];
  sort: SortState;
  onSort: (k: SortKey) => void;
}) {
  return (
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          <SortHeaderCell label="Database" sortKey="database" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Table" sortKey="table" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Column" sortKey="column" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Type" sortKey="type" align="left" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Rows" sortKey="total_rows" align="right" sort={sort} onSort={onSort} />
          <SortHeaderCell label="On-disk" sortKey="compressed_bytes" align="right" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Raw" sortKey="uncompressed_bytes" align="right" sort={sort} onSort={onSort} />
          <SortHeaderCell label="Ratio" sortKey="ratio" align="right" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const ratio = ratioOf(r);
          // Brighten low ratios, mute the good compressors — emphasis by weight,
          // not colour, so the table stays calm.
          const ratioTone = ratio === 0 || ratio >= GOOD_RATIO ? "text-paper-muted" : "text-paper";
          return (
            <tr
              key={`${r.database}.${r.table}.${r.column}-${i}`}
              className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
            >
              <td className="px-3 py-1.5 font-mono text-paper-muted">{r.database}</td>
              <td className="px-3 py-1.5 text-paper">{r.table}</td>
              <td className="px-3 py-1.5 font-mono text-paper">{r.column}</td>
              <td className="px-3 py-1.5 font-mono text-paper-muted">{r.type}</td>
              <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
                {r.total_rows.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-paper">
                {formatBytes(r.compressed_bytes)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
                {formatBytes(r.uncompressed_bytes)}
              </td>
              <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", ratioTone)}>
                {ratio === 0 ? "—" : ratio >= 100 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
