/**
 * SchemaInventory — per-database object inventory, tables vs views kept
 * separate (never summed into one "objects" number).
 *
 * Top: three count tiles (Databases / Tables / Views).
 * Body: one row per database with its table & view counts, rows, on-disk
 * size, and a mix bar showing the table:view ratio. Click a row to expand a
 * drill-down panel that lists the actual objects, again split into a TABLES
 * section and a VIEWS section.
 *
 * Read-only over system.tables via the shared query path — no new backend.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Layers,
  Table2,
  Eye,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  AlertTriangle,
  Code2,
  Copy,
  Check,
  Database as DatabaseIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/common/Skeletons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useSchemaInventory,
  useDatabaseObjects,
  useTableDDL,
  type SchemaInventoryRow,
} from "@/hooks/useMonitoringTimeline";
import { formatClickHouseSQL } from "@/lib/formatSql";
import { cn, formatBytes, formatCompactNumber } from "@/lib/utils";

/** A database-qualified object whose DDL the user opened. */
interface DDLTarget {
  database: string;
  name: string;
  isView: boolean;
}

interface SchemaInventoryProps {
  refreshKey?: number;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

type SortKey = "database" | "tables" | "views" | "rows" | "bytes";
type SortDir = "asc" | "desc";

export default function SchemaInventory({
  refreshKey = 0,
  onRefreshChange,
}: SchemaInventoryProps) {
  const { data = [], isLoading, isFetching, error, refetch } = useSchemaInventory();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [ddlTarget, setDdlTarget] = useState<DDLTarget | null>(null);
  // Default: biggest databases first — the most common scan an operator does.
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "bytes",
    dir: "desc",
  });

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
    return data.filter((r) => r.database.toLowerCase().includes(term));
  }, [data, searchTerm]);

  const rows = useMemo(() => {
    const arr = [...filtered];
    const mul = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) =>
      sort.key === "database"
        ? a.database.localeCompare(b.database) * mul
        : (a[sort.key] - b[sort.key]) * mul
    );
    return arr;
  }, [filtered, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "database" ? "asc" : "desc" }
    );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.tables += r.tables;
          acc.views += r.views;
          return acc;
        },
        { tables: 0, views: 0 }
      ),
    [rows]
  );

  const maxObjects = useMemo(
    () => Math.max(1, ...rows.map((r) => r.tables + r.views)),
    [rows]
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      {/* Count tiles */}
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <CountTile icon={DatabaseIcon} label="Databases" value={rows.length} />
        <CountTile icon={Table2} label="Tables" value={totals.tables} accent="brand" />
        <CountTile icon={Eye} label="Views" value={totals.views} accent="muted" />
      </div>

      {/* Search */}
      <div className="flex shrink-0 items-center gap-2 rounded-md border border-ink-500 bg-ink-100 p-3">
        <Search className="h-4 w-4 text-paper-dim" />
        <Input
          placeholder="Filter databases…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-9 rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
        />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {rows.length} {rows.length === 1 ? "database" : "databases"}
        </span>
      </div>

      {/* Inventory table */}
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
              <span className="text-[13px] text-paper">Couldn't read the schema inventory</span>
              <span className="text-[12px] text-paper-muted">{error.message}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                <Layers className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-[13px] text-paper">No user databases</span>
              <span className="text-[12px] text-paper-muted">
                {searchTerm ? "Adjust the filter." : "This connection has no non-system databases yet."}
              </span>
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
                <tr className="border-b border-ink-500">
                  <th className="w-8 px-2 py-2" aria-label="expand" />
                  <SortTh label="Database" sortKey="database" align="left" sort={sort} onSort={toggleSort} />
                  <SortTh label="Tables" sortKey="tables" align="right" sort={sort} onSort={toggleSort} />
                  <SortTh label="Views" sortKey="views" align="right" sort={sort} onSort={toggleSort} />
                  <SortTh label="Rows" sortKey="rows" align="right" sort={sort} onSort={toggleSort} />
                  <SortTh label="On-disk" sortKey="bytes" align="right" sort={sort} onSort={toggleSort} />
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                    Mix
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <InventoryRow
                    key={r.database}
                    row={r}
                    maxObjects={maxObjects}
                    expanded={expandedDb === r.database}
                    onToggle={() =>
                      setExpandedDb((cur) => (cur === r.database ? null : r.database))
                    }
                    onShowDDL={setDdlTarget}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <DDLDialog target={ddlTarget} onClose={() => setDdlTarget(null)} />
    </div>
  );
}

function CountTile({
  icon: Icon,
  label,
  value,
  accent = "paper",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent?: "paper" | "brand" | "muted";
}) {
  const valueColor =
    accent === "brand" ? "text-brand" : accent === "muted" ? "text-paper-muted" : "text-paper";
  return (
    <div className="flex items-center justify-between rounded-md border border-ink-500 bg-ink-100 px-4 py-3">
      <div className="flex flex-col leading-tight">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {label}
        </span>
        <span className={cn("mt-0.5 font-mono text-[22px] tabular-nums", valueColor)}>
          {value.toLocaleString()}
        </span>
      </div>
      <Icon className="h-4 w-4 text-paper-dim" />
    </div>
  );
}

function SortTh({
  label,
  sortKey,
  align,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align: "left" | "right";
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]",
        align === "right" ? "text-right" : "text-left"
      )}
    >
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
          className={cn(
            "h-3 w-3",
            active ? "text-brand" : "text-paper-faint/60 group-hover:text-paper-muted"
          )}
          aria-hidden
        />
      </button>
    </th>
  );
}

function InventoryRow({
  row,
  maxObjects,
  expanded,
  onToggle,
  onShowDDL,
}: {
  row: SchemaInventoryRow;
  maxObjects: number;
  expanded: boolean;
  onToggle: () => void;
  onShowDDL: (target: DDLTarget) => void;
}) {
  const total = row.tables + row.views;
  const tablePct = total > 0 ? (row.tables / total) * 100 : 0;
  const widthPct = (total / maxObjects) * 100;

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-ink-500/60 transition-colors hover:bg-ink-200/60",
          expanded && "bg-ink-200/40"
        )}
      >
        <td className="px-2 py-1.5 text-center">
          <ChevronRight
            className={cn(
              "inline h-3.5 w-3.5 text-paper-dim transition-transform",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        </td>
        <td className="px-3 py-1.5 font-mono text-paper">{row.database}</td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper">
          {row.tables.toLocaleString()}
        </td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper-muted">
          {row.views.toLocaleString()}
        </td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper-muted">
          {row.rows > 0 ? formatCompactNumber(row.rows) : "—"}
        </td>
        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper-muted">
          {row.bytes > 0 ? formatBytes(row.bytes) : "—"}
        </td>
        <td className="px-3 py-1.5">
          <MixBar tablePct={tablePct} widthPct={widthPct} hasViews={row.views > 0} hasTables={row.tables > 0} />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-ink-500/60 bg-ink-50/40">
          <td colSpan={7} className="px-3 py-3">
            <DatabaseObjectsPanel database={row.database} onShowDDL={onShowDDL} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Stacked table:view ratio bar, scaled by the database's share of objects. */
function MixBar({
  tablePct,
  widthPct,
  hasTables,
  hasViews,
}: {
  tablePct: number;
  widthPct: number;
  hasTables: boolean;
  hasViews: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-[140px] overflow-hidden rounded-xs bg-ink-300">
        <div
          className="absolute inset-y-0 left-0 flex"
          style={{ width: `${Math.max(2, Math.min(100, widthPct))}%` }}
          aria-hidden
        >
          {hasTables && (
            <div className="h-full bg-brand" style={{ width: `${tablePct}%` }} />
          )}
          {hasViews && (
            <div className="h-full bg-brand/40" style={{ width: `${100 - tablePct}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}

function DatabaseObjectsPanel({
  database,
  onShowDDL,
}: {
  database: string;
  onShowDDL: (target: DDLTarget) => void;
}) {
  const { data = [], isLoading, error } = useDatabaseObjects(database);

  const { tables, views } = useMemo(() => {
    const tables = data.filter((o) => !o.isView);
    const views = data.filter((o) => o.isView);
    return { tables, views };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-4 text-[12px] text-paper-muted">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-400 border-t-brand" />
        Loading objects…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-1 py-2 text-[12px] text-red-300">
        Couldn't list objects: {error.message}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ObjectSection
        title="Tables"
        icon={Table2}
        accent="brand"
        objects={tables}
        onSelect={(name) => onShowDDL({ database, name, isView: false })}
      />
      <ObjectSection
        title="Views"
        icon={Eye}
        accent="muted"
        objects={views}
        onSelect={(name) => onShowDDL({ database, name, isView: true })}
      />
    </div>
  );
}

function ObjectSection({
  title,
  icon: Icon,
  accent,
  objects,
  onSelect,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "brand" | "muted";
  objects: { name: string; engine: string; rows: number; bytes: number }[];
  onSelect: (name: string) => void;
}) {
  const accentText = accent === "brand" ? "text-brand" : "text-paper-muted";
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
      <div className="flex items-center gap-2 border-b border-ink-500 bg-ink-200/60 px-3 py-2">
        <Icon className={cn("h-3.5 w-3.5", accentText)} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
          {title}
        </span>
        <span className={cn("ml-auto font-mono text-[11px] tabular-nums", accentText)}>
          {objects.length.toLocaleString()}
        </span>
      </div>
      {objects.length === 0 ? (
        <div className="px-3 py-4 text-center font-mono text-[11px] text-paper-faint">
          None
        </div>
      ) : (
        <div className="max-h-72 divide-y divide-ink-500/40 overflow-auto">
          {objects.map((o) => (
            <button
              key={o.name}
              type="button"
              onClick={() => onSelect(o.name)}
              title={`${o.name} — view DDL`}
              className="group flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-ink-200/60 focus:outline-none focus-visible:bg-ink-200/60"
            >
              {/* Name gets all remaining width and only truncates when it must;
                  engine sits small underneath so the name is never crushed. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-paper" title={o.name}>
                  {o.name}
                </span>
                <span className="block truncate font-mono text-[9px] uppercase tracking-[0.1em] text-paper-faint">
                  {o.engine}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-[10px] tabular-nums text-paper-muted">
                {o.rows > 0 ? formatCompactNumber(o.rows) : "—"}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums text-paper-muted">
                {o.bytes > 0 ? formatBytes(o.bytes) : "—"}
              </span>
              <Code2
                className="h-3.5 w-3.5 shrink-0 text-paper-faint opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * DDL viewer — lazy-loads create_table_query for the selected object and shows
 * it formatted, with a copy button. Works for tables and views alike.
 */
function DDLDialog({
  target,
  onClose,
}: {
  target: DDLTarget | null;
  onClose: () => void;
}) {
  const { data: ddl = "", isLoading, error } = useTableDDL(
    target?.database ?? null,
    target?.name ?? null,
  );
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(() => (ddl ? formatClickHouseSQL(ddl) : ""), [ddl]);

  // Label the statement by what it actually is (MATERIALIZED VIEW, DICTIONARY,
  // …) read from the DDL itself — not the coarse table/view split — so a
  // materialized view isn't mislabelled "CREATE VIEW". Falls back to the split
  // while the DDL is still loading.
  const kindLabel = useMemo(() => {
    const m = ddl.match(
      /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+)?(MATERIALIZED\s+VIEW|LIVE\s+VIEW|WINDOW\s+VIEW|VIEW|DICTIONARY|TABLE)/i
    );
    if (m) return m[1].toUpperCase().replace(/\s+/g, " ");
    return target?.isView ? "VIEW" : "TABLE";
  }, [ddl, target?.isView]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatted || ddl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-ink-500 bg-ink-100 p-0">
        <DialogHeader className="border-b border-ink-500 px-5 py-4">
          {/* pr-10 keeps the long name clear of the dialog's close button */}
          <DialogTitle className="flex items-center gap-2 pr-10 font-mono text-[13px] text-paper">
            {target?.isView ? (
              <Eye className="h-4 w-4 shrink-0 text-paper-muted" aria-hidden />
            ) : (
              <Table2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            )}
            <span className="truncate" title={target ? `${target.database}.${target.name}` : ""}>
              {target ? `${target.database}.${target.name}` : ""}
            </span>
          </DialogTitle>
          <div className="flex items-center justify-between gap-3">
            <DialogDescription className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              CREATE {kindLabel} statement
            </DialogDescription>
            {!isLoading && !error && formatted && (
              <button
                type="button"
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:bg-ink-300 hover:text-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden /> Copy
                  </>
                )}
              </button>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-[12px] text-paper-muted">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-400 border-t-brand" />
            Loading DDL…
          </div>
        ) : error ? (
          <div className="px-5 py-8 text-[12px] text-red-300">
            Couldn't read the DDL: {error.message}
          </div>
        ) : !formatted ? (
          <div className="px-5 py-8 text-center text-[12px] text-paper-faint">
            No DDL available for this object.
          </div>
        ) : (
          <pre className="max-h-[60vh] overflow-auto px-5 py-4 font-mono text-[12px] leading-[1.6] text-paper">
            {formatted}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
