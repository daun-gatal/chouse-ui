/**
 * MergeTree acceleration structures — Projections and Data-skipping indexes.
 *
 * Two read-only inventories surfaced as sub-views of the Parts tab. Both share
 * one small searchable + sortable table shell (ObjectExplorer); each just
 * supplies its hook, column config, and search keys.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Search,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Boxes,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/common/Skeletons";
import {
  useProjections,
  useDataSkippingIndices,
  type ProjectionRow,
  type SkipIndexRow,
} from "@/hooks/useMonitoringTimeline";
import { cn, formatBytes } from "@/lib/utils";

type Dir = "asc" | "desc";

interface ColumnDef<T> {
  key: keyof T & string;
  label: string;
  align?: "left" | "right";
  numeric?: boolean;
  /** Custom cell renderer; defaults to the raw value. */
  render?: (row: T) => ReactNode;
  /** Override the displayed cell className. */
  cellClass?: string;
}

interface ObjectExplorerProps<T extends object> {
  rows: T[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  columns: ColumnDef<T>[];
  searchKeys: (keyof T & string)[];
  searchPlaceholder: string;
  rowLabel: string;
  emptyLabel: string;
  emptyHint: string;
  defaultSort: { key: keyof T & string; dir: Dir };
  refreshKey?: number;
  onRefreshChange?: (isRefreshing: boolean) => void;
  rowKey: (row: T, i: number) => string;
}

function ObjectExplorer<T extends object>({
  rows,
  isLoading,
  isFetching,
  error,
  refetch,
  columns,
  searchKeys,
  searchPlaceholder,
  rowLabel,
  emptyLabel,
  emptyHint,
  defaultSort,
  refreshKey = 0,
  onRefreshChange,
  rowKey,
}: ObjectExplorerProps<T>) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState<{ key: keyof T & string; dir: Dir }>(defaultSort);

  useEffect(() => {
    onRefreshChange?.(isFetching);
  }, [isFetching, onRefreshChange]);

  useEffect(() => {
    if (refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(term))
    );
  }, [rows, searchTerm, searchKeys]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const mul = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
      return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
    });
    return arr;
  }, [filtered, sort]);

  const toggleSort = (key: keyof T & string, numeric?: boolean) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: numeric ? "desc" : "asc" }
    );

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2 rounded-md border border-ink-500 bg-ink-100 p-3">
        <Search className="h-4 w-4 text-paper-dim" />
        <Input
          placeholder={searchPlaceholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
        />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {sorted.length.toLocaleString()} {rowLabel}
        </span>
      </div>

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100">
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <table className="w-full">
              <tbody>
                <SkeletonRows count={8} cols={columns.length} />
              </tbody>
            </table>
          ) : error ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xs border border-red-900/60 bg-red-950/30 text-red-300">
                <AlertTriangle className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-[13px] text-paper">Couldn't load</span>
              <span className="text-[12px] text-paper-muted">{error.message}</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                <Boxes className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-[13px] text-paper">{emptyLabel}</span>
              <span className="max-w-md text-[12px] text-paper-muted">
                {searchTerm ? "Adjust the search filter." : emptyHint}
              </span>
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
                <tr className="border-b border-ink-500">
                  {columns.map((c) => {
                    const active = sort.key === c.key;
                    const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <th
                        key={c.key}
                        className={cn(
                          "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                          c.align === "right" ? "text-right" : "text-left"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key, c.numeric)}
                          className={cn(
                            "group inline-flex items-center gap-1 transition-colors hover:text-paper focus:outline-none focus-visible:text-paper",
                            c.align === "right" && "flex-row-reverse",
                            active ? "text-paper" : "text-paper-faint"
                          )}
                        >
                          <span>{c.label}</span>
                          <Icon
                            className={cn(
                              "h-3 w-3",
                              active ? "text-brand" : "text-paper-faint/50 group-hover:text-paper-muted"
                            )}
                            aria-hidden
                          />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr
                    key={rowKey(row, i)}
                    className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60"
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-3 py-1.5 font-mono",
                          c.align === "right" ? "text-right tabular-nums" : "text-left",
                          c.cellClass ?? "text-paper-muted"
                        )}
                      >
                        {c.render ? c.render(row) : String(row[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

interface ViewProps {
  refreshKey?: number;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

export function ProjectionsView({ refreshKey, onRefreshChange }: ViewProps) {
  const { data = [], isLoading, isFetching, error, refetch } = useProjections();
  const columns: ColumnDef<ProjectionRow>[] = [
    { key: "database", label: "Database", align: "left" },
    { key: "table", label: "Table", align: "left", cellClass: "text-paper" },
    { key: "name", label: "Projection", align: "left", cellClass: "text-paper" },
    { key: "type", label: "Type", align: "left" },
    { key: "sorting_key", label: "Sorting key", align: "left" },
    {
      key: "query",
      label: "Definition",
      align: "left",
      cellClass: "max-w-[420px] truncate text-paper-muted",
      render: (r) => <span title={r.query}>{r.query}</span>,
    },
  ];
  return (
    <ObjectExplorer
      rows={data}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      refetch={refetch}
      columns={columns}
      searchKeys={["database", "table", "name"]}
      searchPlaceholder="Search database, table, projection…"
      rowLabel="projections"
      emptyLabel="No projections"
      emptyHint="No MergeTree table here defines a projection. Projections precompute a reordering or aggregation to turn full scans into targeted reads."
      defaultSort={{ key: "table", dir: "asc" }}
      refreshKey={refreshKey}
      onRefreshChange={onRefreshChange}
      rowKey={(r, i) => `${r.database}.${r.table}.${r.name}-${i}`}
    />
  );
}

export function SkipIndexesView({ refreshKey, onRefreshChange }: ViewProps) {
  const { data = [], isLoading, isFetching, error, refetch } = useDataSkippingIndices();
  const columns: ColumnDef<SkipIndexRow>[] = [
    { key: "database", label: "Database", align: "left" },
    { key: "table", label: "Table", align: "left", cellClass: "text-paper" },
    { key: "name", label: "Index", align: "left", cellClass: "text-paper" },
    { key: "type_full", label: "Type", align: "left", cellClass: "text-paper-muted" },
    {
      key: "expr",
      label: "Expression",
      align: "left",
      cellClass: "max-w-[320px] truncate text-paper-muted",
      render: (r) => <span title={r.expr}>{r.expr}</span>,
    },
    { key: "granularity", label: "Granularity", align: "right", numeric: true },
    {
      key: "compressed_bytes",
      label: "On-disk",
      align: "right",
      numeric: true,
      cellClass: "text-paper",
      render: (r) => formatBytes(r.compressed_bytes),
    },
    {
      key: "uncompressed_bytes",
      label: "Raw",
      align: "right",
      numeric: true,
      render: (r) => formatBytes(r.uncompressed_bytes),
    },
  ];
  return (
    <ObjectExplorer
      rows={data}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      refetch={refetch}
      columns={columns}
      searchKeys={["database", "table", "name", "expr"]}
      searchPlaceholder="Search database, table, index, expression…"
      rowLabel="indexes"
      emptyLabel="No data-skipping indexes"
      emptyHint="No table here defines a secondary index. Skip indexes (minmax / set / bloom_filter / ngrambf) let ClickHouse skip granules that can't match a predicate."
      defaultSort={{ key: "compressed_bytes", dir: "desc" }}
      refreshKey={refreshKey}
      onRefreshChange={onRefreshChange}
      rowKey={(r, i) => `${r.database}.${r.table}.${r.name}-${i}`}
    />
  );
}
