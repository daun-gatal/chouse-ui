import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  FileText,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  Zap,
  User,
  Shield,
  X,
  Copy,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CalendarRange,
  GitCompare,
  Sparkles,
  Loader2,
} from "lucide-react";
import { format as formatDate } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RangePickerDrilldown } from "@/components/monitoring/RangePickerDrilldown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQueryLogs, usePaginationPreference, useLogsPreferences } from "@/hooks";
import {
  useClusterMemoryTotal,
  useQueryByTable,
  useQueryByRedashId,
  useQueryPatterns,
  useQueryProfileEvents,
  useQueryViewsLog,
  type ByRedashRow,
  type ByRedashSort,
  type ByTableRow,
  type ByTableSort,
  type HistogramMetric,
  type ProfileEventEntry,
  type QueryPattern,
  type QueryPatternSort,
  type ViewLogRow,
} from "@/hooks/useMonitoringTimeline";
import { QueryHistogramChart } from "@/components/monitoring/QueryHistogramChart";
import { useRbacStore, RBAC_PERMISSIONS, useWorkspaceStore, genTabId } from "@/stores";
import { useNavigate } from "react-router-dom";
import { cn, formatCompactNumber } from "@/lib/utils";
import { DataControls } from "@/components/common/DataControls";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery, useMutation } from "@tanstack/react-query";
import { rbacUsersApi, rbacRolesApi } from "@/api/rbac";
import { OptimizeQueryDialog } from "@/components/common/OptimizeQueryDialog";
import { SkeletonRows } from "@/components/common/Skeletons";
import { QueryTimelineChart } from "@/components/monitoring/QueryTimelineChart";
import { PaginationBar } from "@/components/monitoring/PaginationBar";
import type { TimelineBucket } from "@/hooks/useMonitoringTimeline";

interface LogEntry {
  type: string;
  event_date: string;
  event_time: string;
  query_id: string;
  query: string;
  query_duration_ms: number;
  read_rows: number;
  read_bytes: number;
  memory_usage: number;
  user: string;
  rbacUser?: string | null;
  rbacUserId?: string | null;
  connectionId?: string | null;
  connectionName?: string;
  exception?: string;
}

interface LogFilterParams {
  searchTerm: string;
  logType: string;
  selectedRoleId: string;
  usersByRoleData?: { users: Array<{ id: string }> } | null;
}

interface ProcessedLogsResult {
  logs: LogEntry[];
  exceptionQueryIds: Set<string>;
}

/**
 * Filter + dedup logs by query_id. ExceptionWhileProcessing > QueryStart-with-exception
 * > QueryFinish > QueryStart. Returns the full sorted list (paging happens in
 * the render layer) plus the set of query_ids that ever carried an exception.
 */
function processLogs(
  logs: LogEntry[],
  filters: LogFilterParams
): ProcessedLogsResult {
  const { searchTerm, logType, selectedRoleId, usersByRoleData } = filters;

  const hasRoleFilter = selectedRoleId !== "all";
  const roleUserIds =
    hasRoleFilter && usersByRoleData?.users && usersByRoleData.users.length > 0
      ? new Set(usersByRoleData.users.map((u) => u.id))
      : null;

  const finalStateQueryIds = new Set<string>();
  const exceptionQueryIds = new Set<string>();
  logs.forEach((log) => {
    const hasException = log.exception && log.exception.trim().length > 0;
    if (
      log.type === "QueryFinish" ||
      log.type === "ExceptionWhileProcessing" ||
      log.type === "ExceptionBeforeStart" ||
      (log.type === "QueryStart" && hasException)
    ) {
      finalStateQueryIds.add(log.query_id);
    }
    if (log.type === "ExceptionWhileProcessing" || log.type === "ExceptionBeforeStart") {
      exceptionQueryIds.add(log.query_id);
    }
  });

  const searchByQueryId = searchTerm && searchTerm.trim().length > 0;
  const matchingQueryIds = new Set<string>();
  if (searchByQueryId) {
    const searchLower = searchTerm.toLowerCase().trim();
    logs.forEach((log) => {
      if (log.query_id) {
        const idLower = log.query_id.toLowerCase();
        if (idLower === searchLower || idLower.includes(searchLower)) {
          matchingQueryIds.add(log.query_id);
        }
      }
    });
  }

  const filtered = logs.filter((log) => {
    const matchesIdSearch = searchByQueryId && matchingQueryIds.has(log.query_id);
    const matchesSearch =
      matchesIdSearch ||
      !searchTerm ||
      log.query?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.query_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.rbacUser?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = logType === "all" || log.type === logType;

    let matchesRole = true;
    if (hasRoleFilter) {
      if (roleUserIds && roleUserIds.size > 0) {
        matchesRole = log.rbacUserId ? roleUserIds.has(log.rbacUserId) : false;
      } else {
        matchesRole = false;
      }
    }

    return matchesSearch && matchesType && matchesRole;
  });

  const queryMap = new Map<string, LogEntry>();
  for (const log of filtered) {
    if (logType === "QueryStart" && finalStateQueryIds.has(log.query_id)) continue;

    const existing = queryMap.get(log.query_id);
    if (!existing) {
      queryMap.set(log.query_id, log);
      continue;
    }

    const priority = (e: LogEntry): number => {
      if (e.type === "ExceptionWhileProcessing" || e.type === "ExceptionBeforeStart") return 4;
      const hasEx = e.exception && e.exception.trim().length > 0;
      const hasExEntry = exceptionQueryIds.has(e.query_id);
      if (e.type === "QueryStart" && (hasEx || hasExEntry)) return 3;
      if (e.type === "QueryFinish") return 2;
      if (e.type === "QueryStart") return 1;
      return 0;
    };

    const ep = priority(existing);
    const cp = priority(log);
    if (cp > ep) {
      queryMap.set(log.query_id, log);
    } else if (cp === ep && cp > 0) {
      if (log.event_date > existing.event_date) {
        queryMap.set(log.query_id, log);
      } else if (log.event_date === existing.event_date && log.event_time > existing.event_time) {
        queryMap.set(log.query_id, log);
      }
    }
  }

  const deduplicated = Array.from(queryMap.values()).sort((a, b) => {
    if (b.event_date !== a.event_date) return b.event_date.localeCompare(a.event_date);
    return b.event_time.localeCompare(a.event_time);
  });

  return { logs: deduplicated, exceptionQueryIds };
}

const RANGE_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "15m", hours: 0.25 },
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
];

function bucketFor(hours: number): TimelineBucket {
  if (hours > 48) return "day";   // multi-day ranges → one point per day
  if (hours > 12) return "hour";
  return "minute";
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

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Restrained SQL keyword set — the common control/predicate words. Highlight is
// intentionally limited so the preview stays editorial rather than rainbow.
const SQL_KEYWORDS =
  "SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|GROUP\\s+BY|ORDER\\s+BY|HAVING|LIMIT|OFFSET|INSERT|UPDATE|DELETE|INTO|VALUES|SET|WITH|AS|ON|AND|OR|NOT|IN|IS|NULL|BETWEEN|LIKE|ILIKE|DISTINCT|UNION|ALL|EXISTS|CASE|WHEN|THEN|ELSE|END|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|MATERIALIZED|ASC|DESC|FORMAT|SETTINGS|FINAL|PREWHERE|ARRAY\\s+JOIN|GLOBAL|SAMPLE";

const SQL_TOKEN = new RegExp(`(/\\*[\\s\\S]*?\\*/|--[^\\n]*|\\b(?:${SQL_KEYWORDS})\\b)`, "gi");

/**
 * Light-touch SQL highlight for the query-preview tooltip. Comments dim out
 * (paper-faint, italic) and keywords pop in brand. Everything else stays paper.
 * Order matters: comments first to avoid keyword matches inside commented SQL.
 */
function highlightSql(sql: string): React.ReactNode[] {
  const parts = sql.split(SQL_TOKEN);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <React.Fragment key={i}>{part}</React.Fragment>;
    if (part.startsWith("/*") || part.startsWith("--")) {
      return (
        <span key={i} className="italic text-paper-faint">
          {part}
        </span>
      );
    }
    return (
      <span key={i} className="text-brand">
        {part}
      </span>
    );
  });
}

/**
 * Compact label for the time-range trigger. Drops the 00:00 suffix when both
 * ends sit at midnight (the common "pick days" case) so the chip stays short.
 */
function formatRangeLabel(from: Date, to: Date): string {
  const isMidnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0;
  const fmt = isMidnight(from) && isMidnight(to) ? "MMM d" : "MMM d HH:mm";
  return `${formatDate(from, fmt)} → ${formatDate(to, fmt)}`;
}

/**
 * Compact event time for the table — drops the date when it matches today, so
 * recent rows stay short (e.g. "16:58:00") and older rows reveal context
 * ("May 18 16:58:00").
 */
function formatRowTime(eventDate: string, eventTime: string): string {
  const today = formatDate(new Date(), "yyyy-MM-dd");
  if (eventDate === today) return eventTime;
  const parsed = new Date(`${eventDate}T${eventTime}`);
  if (isNaN(parsed.getTime())) return `${eventDate} ${eventTime}`;
  return formatDate(parsed, "MMM d HH:mm:ss");
}

interface LogsPageProps {
  embedded?: boolean;
  refreshKey?: number;
  autoRefresh?: boolean;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

export default function LogsPage({
  embedded = false,
  refreshKey = 0,
  autoRefresh: externalAutoRefresh = false,
  onRefreshChange,
}: LogsPageProps) {
  const { isSuperAdmin, user, hasPermission } = useRbacStore();
  const canViewAllLogs = isSuperAdmin() || hasPermission(RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL);
  const { pageSize: defaultLimit, setPageSize: setLimitPreference } =
    usePaginationPreference("logs");
  const { preferences: logsPrefs, updatePreferences: updateLogsPrefs } = useLogsPreferences();

  const [pageSize, setPageSize] = useState(defaultLimit);
  useEffect(() => setPageSize(defaultLimit), [defaultLimit]);

  const [searchTerm, setSearchTerm] = useState(logsPrefs.defaultSearchQuery || "");
  const [logType, setLogType] = useState<string>(logsPrefs.defaultLogType || "all");
  const [internalAutoRefresh, setInternalAutoRefresh] = useState(logsPrefs.autoRefresh || false);

  const autoRefresh = embedded ? externalAutoRefresh : internalAutoRefresh;
  const setAutoRefresh = embedded ? () => {} : setInternalAutoRefresh;
  const [selectedUserId, setSelectedUserId] = useState<string>(
    logsPrefs.defaultSelectedUserId || "all"
  );
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    logsPrefs.defaultSelectedRoleId || "all"
  );
  const [timeRangeHours, setTimeRangeHours] = useState<number>(6);
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date } | null>(null);
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("event_time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 2) return [cur[1], id]; // keep last 2
      return [...cur, id];
    });
  };

  // Cluster RAM, used downstream to flag queries that ate > 40% of it.
  const { data: clusterMemoryBytes = 0 } = useClusterMemoryTotal();

  const customRangeActive = !!(customRange?.from && customRange?.to);
  const customRangeSql = customRangeActive
    ? {
        start: formatDate(customRange!.from!, "yyyy-MM-dd HH:mm:ss"),
        end: formatDate(customRange!.to!, "yyyy-MM-dd HH:mm:ss"),
      }
    : undefined;
  const effectiveHours = customRangeActive
    ? Math.max(
        0.25,
        (customRange!.to!.getTime() - customRange!.from!.getTime()) / 3_600_000
      )
    : timeRangeHours;

  // Sub-view inside Logs — flat query list, aggregated patterns, by-table, by-redash, or histogram.
  const [view, setView] = useState<"queries" | "patterns" | "tables" | "redash" | "histogram">("queries");
  const [histogramMetric, setHistogramMetric] = useState<HistogramMetric>("duration");
  const [patternSort, setPatternSort] = useState<QueryPatternSort>("total_duration_ms");
  const [patternPage, setPatternPage] = useState(0);
  const [byTableSort, setByTableSort] = useState<ByTableSort>("total_duration_ms");
  const [byTablePage, setByTablePage] = useState(0);
  const [redashSort, setRedashSort] = useState<ByRedashSort>("total_duration_ms");
  const [redashPage, setRedashPage] = useState(0);

  const {
    data: patterns = [],
    isLoading: patternsLoading,
    isFetching: patternsFetching,
    error: patternsError,
  } = useQueryPatterns(
    effectiveHours,
    patternSort,
    1000,
    customRangeSql,
    { enabled: view === "patterns" }
  );

  useEffect(() => {
    setPatternPage(0);
  }, [
    patternSort,
    timeRangeHours,
    customRangeSql?.start,
    customRangeSql?.end,
    view,
  ]);

  const patternTotalRows = patterns.length;
  const patternTotalPages = Math.max(1, Math.ceil(patternTotalRows / pageSize));
  const patternSafePage = Math.min(patternPage, patternTotalPages - 1);
  const patternStart = patternSafePage * pageSize;
  const patternEnd = Math.min(patternStart + pageSize, patternTotalRows);
  const paginatedPatterns = useMemo(
    () => patterns.slice(patternStart, patternEnd),
    [patterns, patternStart, patternEnd]
  );

  const {
    data: byTable = [],
    isLoading: byTableLoading,
    isFetching: byTableFetching,
    error: byTableError,
  } = useQueryByTable(
    effectiveHours,
    byTableSort,
    500,
    customRangeSql,
    { enabled: view === "tables" }
  );

  useEffect(() => {
    setByTablePage(0);
  }, [
    byTableSort,
    timeRangeHours,
    customRangeSql?.start,
    customRangeSql?.end,
    view,
  ]);

  const byTableTotalRows = byTable.length;
  const byTableTotalPages = Math.max(1, Math.ceil(byTableTotalRows / pageSize));
  const byTableSafePage = Math.min(byTablePage, byTableTotalPages - 1);
  const byTableStart = byTableSafePage * pageSize;
  const byTableEnd = Math.min(byTableStart + pageSize, byTableTotalRows);
  const paginatedByTable = useMemo(
    () => byTable.slice(byTableStart, byTableEnd),
    [byTable, byTableStart, byTableEnd]
  );

  const {
    data: byRedash = [],
    isLoading: byRedashLoading,
    isFetching: byRedashFetching,
    error: byRedashError,
  } = useQueryByRedashId(
    effectiveHours,
    redashSort,
    500,
    customRangeSql,
    { enabled: view === "redash" }
  );

  useEffect(() => {
    setRedashPage(0);
  }, [
    redashSort,
    timeRangeHours,
    customRangeSql?.start,
    customRangeSql?.end,
    view,
  ]);

  const byRedashTotalRows = byRedash.length;
  const byRedashTotalPages = Math.max(1, Math.ceil(byRedashTotalRows / pageSize));
  const byRedashSafePage = Math.min(redashPage, byRedashTotalPages - 1);
  const byRedashStart = byRedashSafePage * pageSize;
  const byRedashEnd = Math.min(byRedashStart + pageSize, byRedashTotalRows);
  const paginatedByRedash = useMemo(
    () => byRedash.slice(byRedashStart, byRedashEnd),
    [byRedash, byRedashStart, byRedashEnd]
  );

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "query" || key === "user" || key === "query_id" ? "asc" : "desc");
    }
  };

  const bucket = bucketFor(effectiveHours);

  useEffect(() => {
    const id = setTimeout(() => {
      updateLogsPrefs({
        defaultLogType: logType,
        autoRefresh,
        defaultSelectedUserId: selectedUserId,
        defaultSelectedRoleId: selectedRoleId,
      });
    }, 500);
    return () => clearTimeout(id);
  }, [logType, autoRefresh, selectedUserId, selectedRoleId, updateLogsPrefs]);

  useEffect(() => {
    const id = setTimeout(() => setLimitPreference(pageSize), 500);
    return () => clearTimeout(id);
  }, [pageSize, setLimitPreference]);

  const clearFilters = () => {
    setSearchTerm("");
    setLogType("all");
    setSelectedUserId("all");
    setSelectedRoleId("all");
  };

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    logType !== "all" ||
    selectedUserId !== "all" ||
    selectedRoleId !== "all";

  const { data: usersData } = useQuery({
    queryKey: ["rbac-users-list"],
    queryFn: () => rbacUsersApi.list({ limit: 1000, isActive: true }),
    enabled: canViewAllLogs,
    staleTime: 5 * 60 * 1000,
  });

  const { data: rolesData } = useQuery({
    queryKey: ["rbac-roles-list"],
    queryFn: () => rbacRolesApi.list(),
    enabled: canViewAllLogs,
    staleTime: 5 * 60 * 1000,
  });

  const { data: usersByRoleData } = useQuery({
    queryKey: ["rbac-users-by-role", selectedRoleId],
    queryFn: () =>
      rbacUsersApi.list({ limit: 1000, isActive: true, roleId: selectedRoleId }),
    enabled: canViewAllLogs && selectedRoleId !== "all",
    staleTime: 5 * 60 * 1000,
  });

  const rbacUserIdFilter = canViewAllLogs
    ? selectedUserId !== "all"
      ? selectedUserId
      : undefined
    : user?.id;

  // Over-fetch so that client-side dedup + pagination has enough material per page.
  // The cap (5k unfiltered / 20k filtered) is the upper bound a single fetch will
  // pull; beyond that the user needs to narrow the time range or filters.
  const fetchLimit = hasActiveFilters ? Math.max(pageSize * 20, 5000) : Math.max(pageSize * 5, 1000);
  const {
    data: logs = [],
    isLoading,
    isFetching,
    refetch,
    error,
    dataUpdatedAt,
  } = useQueryLogs(
    fetchLimit,
    undefined,
    rbacUserIdFilter,
    timeRangeHours,
    sortKey,
    sortDir,
    customRangeSql
  );

  const isAnyLoading = isLoading || isFetching;

  useEffect(() => {
    onRefreshChange?.(isAnyLoading);
  }, [isAnyLoading, onRefreshChange]);

  useEffect(() => {
    if (refreshKey) refetch();
  }, [refreshKey, refetch]);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refetch(), 5000);
    return () => clearInterval(id);
  }, [autoRefresh, refetch]);

  const processed = useMemo(
    () =>
      processLogs(logs, {
        searchTerm,
        logType,
        selectedRoleId,
        usersByRoleData: usersByRoleData || null,
      }),
    [logs, searchTerm, logType, selectedRoleId, usersByRoleData]
  );

  const filteredLogs = processed.logs;
  const exceptionQueryIds = processed.exceptionQueryIds;

  const sortedLogs = useMemo(
    () => sortLogs(filteredLogs, sortKey, sortDir),
    [filteredLogs, sortKey, sortDir]
  );

  const totalRows = sortedLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const paginatedRows = useMemo(
    () => sortedLogs.slice(startIndex, endIndex),
    [sortedLogs, startIndex, endIndex]
  );

  // Reset to the first page when the filter set, time range, or page size changes.
  useEffect(() => {
    setCurrentPage(0);
  }, [
    searchTerm,
    logType,
    selectedUserId,
    selectedRoleId,
    timeRangeHours,
    pageSize,
    customRangeSql?.start,
    customRangeSql?.end,
  ]);

  const isFailedLog = useCallback(
    (log: LogEntry): boolean => {
      if (log.type === "ExceptionWhileProcessing" || log.type === "ExceptionBeforeStart")
        return true;
      if (log.type === "QueryStart") {
        const hasEx = log.exception && log.exception.trim().length > 0;
        return Boolean(hasEx) || exceptionQueryIds.has(log.query_id);
      }
      return false;
    },
    [exceptionQueryIds]
  );

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : "--:--:--";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Standalone page header */}
      {!embedded && (
        <div className="flex flex-col gap-4 border-b border-ink-500 px-6 pb-4 pt-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                Observability
              </span>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight text-paper">Query logs</h1>
                {!canViewAllLogs && user && (
                  <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                    <User className="h-3 w-3" />
                    Your queries only
                  </span>
                )}
              </div>
            </div>
          </div>

          <DataControls
            lastUpdated={lastUpdated}
            isRefreshing={isFetching}
            onRefresh={() => refetch()}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
          />
        </div>
      )}

      {/* Top strip — filters + time range + counter */}
      <div className={cn("border-b border-ink-500 bg-ink-100", embedded ? "px-4" : "px-6")}>
        <div className="flex flex-wrap items-center gap-3 py-2.5">
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-paper-dim" />
            <Input
              placeholder="Search query, user, ID…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 w-[260px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-paper-dim" />
            <Select value={logType} onValueChange={setLogType}>
              <SelectTrigger className="h-8 w-[120px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="QueryFinish">Success</SelectItem>
                <SelectItem value="ExceptionWhileProcessing">Failed</SelectItem>
                <SelectItem value="ExceptionBeforeStart">Failed (before start)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {canViewAllLogs && (
            <>
              <Select
                value={selectedUserId}
                onValueChange={(v) => {
                  setSelectedUserId(v);
                  if (v !== "all") setSelectedRoleId("all");
                }}
              >
                <SelectTrigger className="h-8 w-[160px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper [&>span]:truncate">
                  <User className="h-3.5 w-3.5 text-paper-dim" />
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {usersData?.users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName || u.username || u.email || u.id.substring(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedRoleId}
                onValueChange={(v) => {
                  setSelectedRoleId(v);
                  if (v !== "all") setSelectedUserId("all");
                }}
              >
                <SelectTrigger className="h-8 w-[140px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper [&>span]:truncate">
                  <Shield className="h-3.5 w-3.5 text-paper-dim" />
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {rolesData?.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.displayName || role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              const n = Number(v);
              if (!isNaN(n) && n > 0) setPageSize(n);
            }}
          >
            <SelectTrigger className="h-8 w-[110px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 / page</SelectItem>
              <SelectItem value="100">100 / page</SelectItem>
              <SelectItem value="500">500 / page</SelectItem>
              <SelectItem value="1000">1000 / page</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="h-8 gap-1.5 rounded-xs border-ink-500 bg-ink-200 px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted hover:border-ink-700 hover:bg-ink-300 hover:text-paper"
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}

          {view === "queries" && selectedIds.length > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xs border border-brand/40 bg-brand/[0.08] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
              <span>{selectedIds.length} selected</span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                aria-label="Clear selection"
                className="rounded-xs px-0.5 hover:bg-brand/10"
              >
                <X className="h-3 w-3" />
              </button>
              <span className="mx-1 text-paper-faint">·</span>
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                disabled={selectedIds.length < 2}
                className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-brand transition-colors hover:bg-brand hover:text-ink-50 disabled:opacity-40"
              >
                <GitCompare className="h-3 w-3" />
                Compare
              </button>
            </div>
          )}

          {/* Spacer */}
          <div className="ml-auto flex items-center gap-3">
            {/* Time range — single unified popover (presets + custom calendar) */}
            <Popover open={rangePopoverOpen} onOpenChange={setRangePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Time range"
                  className={cn(
                    "inline-flex h-8 items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors hover:border-ink-700 hover:bg-ink-300",
                    customRangeActive ? "text-brand" : "text-paper"
                  )}
                >
                  <CalendarRange className="h-3.5 w-3.5" aria-hidden />
                  <span>
                    {customRangeActive && customRange?.from && customRange?.to
                      ? formatRangeLabel(customRange.from, customRange.to)
                      : `Last ${timeRangeHours < 1 ? Math.round(timeRangeHours * 60) + "m" : timeRangeHours + "h"}`}
                  </span>
                  <ChevronDown className="h-3 w-3 text-paper-dim" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-auto rounded-xs border-ink-500 bg-ink-100 p-0"
              >
                {/* Presets column */}
                <div className="flex">
                  <div className="flex w-[150px] flex-col gap-0.5 border-r border-ink-500 p-2">
                    <span className="px-2 pb-1 pt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                      Quick
                    </span>
                    {RANGE_OPTIONS.map((opt) => {
                      const active = !customRangeActive && timeRangeHours === opt.hours;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => {
                            setCustomRange(null);
                            setTimeRangeHours(opt.hours);
                            setRangePopoverOpen(false);
                          }}
                          className={cn(
                            "flex items-center justify-between rounded-xs px-2 py-1.5 text-left font-mono text-[11px] transition-colors",
                            active
                              ? "bg-brand text-ink-50"
                              : "text-paper-muted hover:bg-ink-200 hover:text-paper"
                          )}
                        >
                          <span className="uppercase tracking-[0.14em]">{opt.label}</span>
                          <span className={cn("text-[10px]", active ? "text-ink-50/70" : "text-paper-faint")}>
                            {opt.hours < 1
                              ? `${Math.round(opt.hours * 60)} min`
                              : `${opt.hours} hour${opt.hours > 1 ? "s" : ""}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Calendar column */}
                  <div className="flex w-[300px] flex-col">
                    <RangePickerDrilldown
                      range={customRange}
                      onChange={(r) =>
                        setCustomRange(r ? { from: r.from, to: r.to } : null)
                      }
                    />

                    <div className="flex items-center justify-between gap-3 border-t border-ink-500 px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomRange(null);
                          setRangePopoverOpen(false);
                        }}
                        className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted hover:text-paper"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        disabled={!customRange?.from}
                        onClick={() => {
                          if (!customRange?.from) return;
                          // Normalise: pick one day → span the full day
                          // (00:00:00 → 23:59:59.999). Pick a range → from
                          // snaps to start of its day, to to end of its day.
                          const from = new Date(customRange.from);
                          from.setHours(0, 0, 0, 0);
                          const toBase = customRange.to ?? customRange.from;
                          const to = new Date(toBase);
                          to.setHours(23, 59, 59, 999);
                          setCustomRange({ from, to });
                          setRangePopoverOpen(false);
                        }}
                        className="rounded-xs bg-brand px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-40"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              Bucket · {bucket}
            </span>

            {view !== "histogram" && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                Total ·{" "}
                {(view === "patterns"
                  ? patternTotalRows
                  : view === "tables"
                    ? byTableTotalRows
                    : totalRows
                ).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body — chart on top, table below */}
      <div className={cn("flex flex-1 min-h-0 flex-col gap-4 overflow-hidden", embedded ? "p-4" : "p-6")}>
        {/* Chart card — query-kind counts + resource metrics in one chart
            (metric toggle), so the table below stays in view. */}
        <QueryTimelineChart
          hoursBack={effectiveHours}
          bucket={bucket}
          refreshKey={refreshKey}
          customRange={customRangeSql}
        />

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 rounded-xs border border-red-900/60 bg-red-950/40 p-3">
            <AlertTriangle className="h-4 w-4 text-red-300" />
            <p className="text-[13px] text-red-200">{error.message}</p>
          </div>
        )}

        {/* View tabs — queries / patterns / by-table / histogram */}
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-500">
          {[
            { id: "queries", label: "Queries", hint: "Every execution" },
            { id: "patterns", label: "Patterns", hint: "Grouped by query shape" },
            { id: "tables", label: "By table", hint: "Hot tables" },
            { id: "redash", label: "By Redash", hint: "Grouped by Redash query_id" },
            { id: "histogram", label: "Histogram", hint: "Metric distribution" },
          ].map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id as typeof view)}
                className={cn(
                  "group relative flex items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  active
                    ? "text-paper"
                    : "text-paper-muted hover:text-paper"
                )}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[9px] tracking-[0.14em] text-paper-faint">
                  · {tab.hint}
                </span>
                {active && (
                  <span
                    className="absolute -bottom-px left-0 right-0 h-px bg-brand"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Histogram view sits on its own — own card, no pagination */}
        {view === "histogram" ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <QueryHistogramChart
              hoursBack={effectiveHours}
              customRange={customRangeSql}
              metric={histogramMetric}
              onMetricChange={setHistogramMetric}
            />
          </div>
        ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100">
          <div className="flex-1 overflow-auto">
            {view === "queries" ? (
              isLoading ? (
                <table className="w-full">
                  <tbody>
                    <SkeletonRows count={10} cols={10} />
                  </tbody>
                </table>
              ) : totalRows === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                    <FileText className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[13px] text-paper">No queries match</span>
                  <span className="text-[12px] text-paper-muted">
                    {hasActiveFilters
                      ? "Adjust filters or widen the time range."
                      : `Nothing logged in the last ${timeRangeHours < 1 ? `${Math.round(timeRangeHours * 60)}m` : `${timeRangeHours}h`}.`}
                  </span>
                </div>
              ) : (
                <LogsTable
                  rows={paginatedRows}
                  expanded={expandedLog}
                  onToggle={(id) => setExpandedLog((cur) => (cur === id ? null : id))}
                  isFailed={isFailedLog}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  clusterMemoryBytes={clusterMemoryBytes}
                  selectedIds={selectedIds}
                  onSelect={toggleSelect}
                />
              )
            ) : view === "patterns" ? (
              patternsLoading ? (
                <table className="w-full">
                  <tbody>
                    <SkeletonRows count={10} cols={7} />
                  </tbody>
                </table>
              ) : patternsError ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                  <span className="text-[13px] text-paper">Couldn't load patterns</span>
                  <span className="text-[12px] text-paper-muted">{patternsError.message}</span>
                </div>
              ) : patternTotalRows === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                    <FileText className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[13px] text-paper">No patterns yet</span>
                  <span className="text-[12px] text-paper-muted">
                    Widen the time range — needs a handful of queries to group.
                  </span>
                </div>
              ) : (
                <PatternsTable
                  rows={paginatedPatterns}
                  sortKey={patternSort}
                  onSort={setPatternSort}
                  clusterMemoryBytes={clusterMemoryBytes}
                />
              )
            ) : view === "tables" ? (
              byTableLoading ? (
                <table className="w-full">
                  <tbody>
                    <SkeletonRows count={10} cols={7} />
                  </tbody>
                </table>
              ) : byTableError ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                  <span className="text-[13px] text-paper">Couldn't load by-table rollup</span>
                  <span className="text-[12px] text-paper-muted">{byTableError.message}</span>
                </div>
              ) : byTableTotalRows === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                    <FileText className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[13px] text-paper">No table activity</span>
                  <span className="text-[12px] text-paper-muted">
                    Widen the time range — needs queries that touched user tables.
                  </span>
                </div>
              ) : (
                <ByTableTable
                  rows={paginatedByTable}
                  sortKey={byTableSort}
                  onSort={setByTableSort}
                  clusterMemoryBytes={clusterMemoryBytes}
                />
              )
            ) : byRedashLoading ? (
              <table className="w-full">
                <tbody>
                  <SkeletonRows count={10} cols={7} />
                </tbody>
              </table>
            ) : byRedashError ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="text-[13px] text-paper">Couldn't load Redash rollup</span>
                <span className="text-[12px] text-paper-muted">{byRedashError.message}</span>
              </div>
            ) : byRedashTotalRows === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                  <FileText className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-[13px] text-paper">No Redash queries</span>
                <span className="text-[12px] text-paper-muted">
                  Nothing with a Redash <code>query_id</code> comment in the window.
                </span>
              </div>
            ) : (
              <ByRedashTable
                rows={paginatedByRedash}
                sortKey={redashSort}
                onSort={setRedashSort}
                clusterMemoryBytes={clusterMemoryBytes}
              />
            )}
          </div>

          {view === "queries" && totalRows > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalRows}
              rowLabel="queries"
              onPrev={() => setCurrentPage((p) => Math.max(0, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              onFirst={() => setCurrentPage(0)}
              onLast={() => setCurrentPage(totalPages - 1)}
            />
          )}

          {view === "patterns" && patternTotalRows > 0 && (
            <PaginationBar
              page={patternSafePage}
              totalPages={patternTotalPages}
              startIndex={patternStart}
              endIndex={patternEnd}
              totalRows={patternTotalRows}
              rowLabel="patterns"
              onPrev={() => setPatternPage((p) => Math.max(0, p - 1))}
              onNext={() => setPatternPage((p) => Math.min(patternTotalPages - 1, p + 1))}
              onFirst={() => setPatternPage(0)}
              onLast={() => setPatternPage(patternTotalPages - 1)}
            />
          )}

          {view === "tables" && byTableTotalRows > 0 && (
            <PaginationBar
              page={byTableSafePage}
              totalPages={byTableTotalPages}
              startIndex={byTableStart}
              endIndex={byTableEnd}
              totalRows={byTableTotalRows}
              rowLabel="tables"
              onPrev={() => setByTablePage((p) => Math.max(0, p - 1))}
              onNext={() => setByTablePage((p) => Math.min(byTableTotalPages - 1, p + 1))}
              onFirst={() => setByTablePage(0)}
              onLast={() => setByTablePage(byTableTotalPages - 1)}
            />
          )}

          {view === "redash" && byRedashTotalRows > 0 && (
            <PaginationBar
              page={byRedashSafePage}
              totalPages={byRedashTotalPages}
              startIndex={byRedashStart}
              endIndex={byRedashEnd}
              totalRows={byRedashTotalRows}
              rowLabel="redash queries"
              onPrev={() => setRedashPage((p) => Math.max(0, p - 1))}
              onNext={() => setRedashPage((p) => Math.min(byRedashTotalPages - 1, p + 1))}
              onFirst={() => setRedashPage(0)}
              onLast={() => setRedashPage(byRedashTotalPages - 1)}
            />
          )}

          {(patternsFetching || byTableFetching || byRedashFetching) && (
            <span className="sr-only" aria-live="polite">Refreshing…</span>
          )}
        </div>
        )}
      </div>

      <CompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        entries={selectedIds
          .map((id) => filteredLogs.find((l) => l.query_id === id))
          .filter((l): l is LogEntry => !!l)}
        clusterMemoryBytes={clusterMemoryBytes}
      />
    </div>
  );
}

/* ============================================================
   Compare dialog — side-by-side metric diff
   ============================================================ */

interface CompareDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entries: LogEntry[];
  clusterMemoryBytes: number;
}

interface CompareMetric {
  label: string;
  format: (e: LogEntry) => string;
  value: (e: LogEntry) => number;
  /** Lower is better — used to colour the delta tone. */
  lowerBetter?: boolean;
}

const COMPARE_METRICS: CompareMetric[] = [
  {
    label: "Duration",
    format: (e) => formatDuration(e.query_duration_ms),
    value: (e) => e.query_duration_ms,
    lowerBetter: true,
  },
  {
    label: "Memory",
    format: (e) => formatBytes(e.memory_usage),
    value: (e) => e.memory_usage,
    lowerBetter: true,
  },
  {
    label: "Read rows",
    format: (e) => e.read_rows.toLocaleString(),
    value: (e) => e.read_rows,
    lowerBetter: true,
  },
  {
    label: "Read bytes",
    format: (e) => formatBytes(e.read_bytes),
    value: (e) => e.read_bytes,
    lowerBetter: true,
  },
];

function CompareDialog({
  open,
  onOpenChange,
  entries,
  clusterMemoryBytes,
}: CompareDialogProps) {
  if (entries.length < 2) return null;
  const [a, b] = entries;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] rounded-xs border-ink-700 bg-ink-100 p-0">
        <DialogHeader className="border-b border-ink-500 px-5 py-4">
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <GitCompare className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                Side by side
              </span>
              <span className="text-[15px] font-semibold tracking-tight">
                Compare two queries
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-[12px] text-paper-muted">
            Metric diff with delta tints. Memory cells inherit the cluster-RAM
            warn / danger flag.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[55vh] grid-cols-2 divide-x divide-ink-500 overflow-auto">
          <CompareColumn label="Query A" entry={a} clusterMemoryBytes={clusterMemoryBytes} />
          <CompareColumn label="Query B" entry={b} clusterMemoryBytes={clusterMemoryBytes} />
        </div>

        <div className="border-t border-ink-500 px-5 py-4">
          <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Diff
          </h3>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-ink-500 bg-ink-500">
            {COMPARE_METRICS.map((m) => {
              const va = m.value(a);
              const vb = m.value(b);
              const delta = vb - va;
              const pct = va > 0 ? (delta / va) * 100 : 0;
              const better = m.lowerBetter ? delta < 0 : delta > 0;
              const tone =
                delta === 0
                  ? "text-paper-muted"
                  : better
                    ? "text-emerald-300"
                    : "text-red-300";
              const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
              const absDelta = Math.abs(delta);
              const formattedDelta =
                m.label === "Duration"
                  ? formatDuration(absDelta)
                  : m.label.includes("bytes") || m.label === "Memory"
                    ? formatBytes(absDelta)
                    : absDelta.toLocaleString();
              return (
                <div
                  key={m.label}
                  className="grid grid-cols-[160px_1fr_1fr_180px] items-center gap-3 bg-ink-100 px-4 py-2 text-[12px]"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                    {m.label}
                  </span>
                  <span className="font-mono text-paper">{m.format(a)}</span>
                  <span className="font-mono text-paper">{m.format(b)}</span>
                  <span className={cn("text-right font-mono tabular-nums", tone)}>
                    {sign}
                    {formattedDelta}
                    {Number.isFinite(pct) && va > 0 && (
                      <span className="ml-2 text-[10px] opacity-70">
                        ({sign}
                        {Math.abs(pct).toFixed(0)}%)
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompareColumn({
  label,
  entry,
  clusterMemoryBytes,
}: {
  label: string;
  entry: LogEntry;
  clusterMemoryBytes: number;
}) {
  const memTier = memoryTier(entry.memory_usage, clusterMemoryBytes);
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {label}
        </span>
        <span className="font-mono text-[10px] text-paper-dim">
          {entry.query_id.substring(0, 12)}…
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
          Query
        </span>
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-xs border border-ink-500 bg-ink-200 p-3 font-mono text-[11px] leading-[1.55] text-paper">
          {highlightSql(entry.query)}
        </pre>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <CompareCell label="Duration" value={formatDuration(entry.query_duration_ms)} />
        <CompareCell
          label="Memory"
          value={formatBytes(entry.memory_usage)}
          tone={
            memTier === "danger"
              ? "text-red-300"
              : memTier === "warn"
                ? "text-amber-300"
                : undefined
          }
        />
        <CompareCell label="Read rows" value={entry.read_rows.toLocaleString()} />
        <CompareCell label="Read bytes" value={formatBytes(entry.read_bytes)} />
      </div>

      {entry.exception && (
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-red-300">
            Exception
          </span>
          <pre className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap rounded-xs border border-red-900/60 bg-red-950/40 p-3 font-mono text-[11px] text-red-200">
            {entry.exception}
          </pre>
        </div>
      )}
    </div>
  );
}

function CompareCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-l border-ink-500 pl-3">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </span>
      <span className={cn("font-mono text-[12px] text-paper", tone)}>{value}</span>
    </div>
  );
}

/* ============================================================
   Compact logs table — QueryDog-style dense layout
   ============================================================ */

type SortKey =
  | "event_time"
  | "type"
  | "query"
  | "user"
  | "query_duration_ms"
  | "read_rows"
  | "read_bytes"
  | "memory_usage"
  | "query_id";

interface ColumnSpec {
  key: SortKey | null;
  label: string;
  align: "left" | "right";
  w?: string;
}

const COLUMNS: ColumnSpec[] = [
  { key: null, label: "", align: "left", w: "w-[36px]" },
  { key: "event_time", label: "Time", align: "left", w: "w-[140px]" },
  { key: "type", label: "", align: "left", w: "w-[28px]" },
  { key: "query", label: "Query", align: "left" },
  { key: "user", label: "User", align: "left", w: "w-[140px]" },
  { key: "query_duration_ms", label: "Duration", align: "right", w: "w-[88px]" },
  { key: "read_rows", label: "Read rows", align: "right", w: "w-[96px]" },
  { key: "read_bytes", label: "Read bytes", align: "right", w: "w-[96px]" },
  { key: "memory_usage", label: "Memory", align: "right", w: "w-[96px]" },
  { key: "query_id", label: "Query ID", align: "left", w: "w-[110px]" },
];

function sortLogs(rows: LogEntry[], key: SortKey, dir: "asc" | "desc"): LogEntry[] {
  const mult = dir === "asc" ? 1 : -1;
  const cmp = (a: LogEntry, b: LogEntry): number => {
    switch (key) {
      case "event_time": {
        const dateCmp = a.event_date.localeCompare(b.event_date);
        if (dateCmp !== 0) return mult * dateCmp;
        return mult * a.event_time.localeCompare(b.event_time);
      }
      case "query_duration_ms":
        return mult * (a.query_duration_ms - b.query_duration_ms);
      case "read_rows":
        return mult * (a.read_rows - b.read_rows);
      case "read_bytes":
        return mult * (a.read_bytes - b.read_bytes);
      case "memory_usage":
        return mult * (a.memory_usage - b.memory_usage);
      case "query":
        return mult * (a.query || "").localeCompare(b.query || "");
      case "user": {
        const au = a.rbacUser || a.user || "";
        const bu = b.rbacUser || b.user || "";
        return mult * au.localeCompare(bu);
      }
      case "type":
        return mult * (a.type || "").localeCompare(b.type || "");
      case "query_id":
        return mult * (a.query_id || "").localeCompare(b.query_id || "");
      default:
        return 0;
    }
  };
  return [...rows].sort(cmp);
}

interface LogsTableProps {
  rows: LogEntry[];
  expanded: string | null;
  onToggle: (id: string) => void;
  isFailed: (log: LogEntry) => boolean;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  /** Total cluster RAM in bytes; used to flag memory-heavy queries. 0 disables. */
  clusterMemoryBytes: number;
  selectedIds: string[];
  onSelect: (queryId: string) => void;
}

/**
 * Memory pressure tiers as fraction of total cluster RAM. ClickHouse's
 * max_server_memory_usage defaults to 0.9 * OS RAM, and concurrent query
 * allocations are additive, so the headroom shrinks fast: 4 queries at 25%
 * each = OOM territory. Background merges + page cache take another slice
 * off the top, so effective room is closer to 60-70%. The 10% warn / 25%
 * danger split flags heavy queries preventively, before they coincide with
 * other heavy queries and force MEMORY_LIMIT_EXCEEDED kills.
 */
const MEM_TIER_WARN = 0.1;
const MEM_TIER_DANGER = 0.25;

function memoryTier(usage: number, total: number): "ok" | "warn" | "danger" {
  if (total <= 0 || usage <= 0) return "ok";
  const ratio = usage / total;
  if (ratio >= MEM_TIER_DANGER) return "danger";
  if (ratio >= MEM_TIER_WARN) return "warn";
  return "ok";
}

function LogsTable({
  rows,
  expanded,
  onToggle,
  isFailed,
  sortKey,
  sortDir,
  onSort,
  clusterMemoryBytes,
  selectedIds,
  onSelect,
}: LogsTableProps) {
  return (
    <TooltipProvider delayDuration={300}>
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {COLUMNS.map((c, i) => {
            const isActive = c.key !== null && c.key === sortKey;
            const sortable = c.key !== null && c.label.length > 0;
            return (
              <th
                key={`${c.label}-${i}`}
                className={cn(
                  "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                  c.align === "right" ? "text-right" : "text-left",
                  c.w
                )}
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.key as SortKey)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-xs transition-colors hover:text-paper",
                      c.align === "right" && "flex-row-reverse",
                      isActive && "text-brand"
                    )}
                    aria-label={`Sort by ${c.label}`}
                  >
                    <span>{c.label}</span>
                    {isActive ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ArrowDown className="h-3 w-3" aria-hidden />
                      )
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 opacity-40" aria-hidden />
                    )}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((log, i) => (
          <LogRow
            key={log.query_id}
            log={log}
            isExpanded={expanded === log.query_id}
            onToggle={() => onToggle(log.query_id)}
            failed={isFailed(log)}
            clusterMemoryBytes={clusterMemoryBytes}
            selected={selectedIds.includes(log.query_id)}
            onSelect={() => onSelect(log.query_id)}
          />
        ))}
      </tbody>
    </table>
    </TooltipProvider>
  );
}

/* ============================================================
   Patterns table — normalizeQuery() rollup
   ============================================================ */

interface PatternColumn {
  key: QueryPatternSort | null;
  label: string;
  align: "left" | "right";
  w?: string;
}

const PATTERN_COLUMNS: PatternColumn[] = [
  { key: null, label: "Pattern", align: "left" },
  { key: "executions", label: "Runs", align: "right", w: "w-[80px]" },
  { key: "avg_duration_ms", label: "Avg dur", align: "right", w: "w-[88px]" },
  { key: "total_duration_ms", label: "Total dur", align: "right", w: "w-[100px]" },
  { key: "max_memory", label: "Max mem", align: "right", w: "w-[92px]" },
  { key: "total_read_rows", label: "Read rows", align: "right", w: "w-[112px]" },
  { key: "total_read_bytes", label: "Read bytes", align: "right", w: "w-[108px]" },
];

interface PatternsTableProps {
  rows: QueryPattern[];
  sortKey: QueryPatternSort;
  onSort: (key: QueryPatternSort) => void;
  clusterMemoryBytes: number;
}

function PatternsTable({ rows, sortKey, onSort, clusterMemoryBytes }: PatternsTableProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
          <tr className="border-b border-ink-500">
            {PATTERN_COLUMNS.map((c, i) => {
              const isActive = c.key !== null && c.key === sortKey;
              const sortable = c.key !== null;
              return (
                <th
                  key={`${c.label}-${i}`}
                  className={cn(
                    "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                    c.align === "right" ? "text-right" : "text-left",
                    c.w
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key as QueryPatternSort)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-xs transition-colors hover:text-paper",
                        c.align === "right" && "flex-row-reverse",
                        isActive && "text-brand"
                      )}
                      aria-label={`Sort by ${c.label}`}
                    >
                      <span>{c.label}</span>
                      {isActive ? (
                        <ArrowDown className="h-3 w-3" aria-hidden />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <PatternRow key={`${p.sample_query_id}-${i}`} pattern={p} clusterMemoryBytes={clusterMemoryBytes} />
          ))}
        </tbody>
      </table>
    </TooltipProvider>
  );
}

interface PatternRowProps {
  pattern: QueryPattern;
  clusterMemoryBytes: number;
}

function PatternRow({ pattern, clusterMemoryBytes }: PatternRowProps) {
  const memTier = memoryTier(pattern.max_memory, clusterMemoryBytes);
  const memRatioPct =
    clusterMemoryBytes > 0 ? (pattern.max_memory / clusterMemoryBytes) * 100 : 0;

  return (
    <tr className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
      <td className="px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help font-mono text-paper line-clamp-1">
              {pattern.pattern}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            sideOffset={6}
            className="max-w-[640px] rounded-xs border border-ink-700 bg-ink-200 p-0 text-paper shadow-2xl ring-1 ring-black/30"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink-500 bg-ink-300 px-3 py-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-muted">
                Pattern
              </span>
              <span className="font-mono text-[10px] text-paper-dim">
                {pattern.pattern.length.toLocaleString()} chars
              </span>
            </div>
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-[1.55] text-paper">
              {highlightSql(pattern.pattern)}
            </pre>
          </TooltipContent>
        </Tooltip>
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper">
        {pattern.executions.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatDuration(pattern.avg_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper">
        {formatDuration(pattern.total_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        <MemoryCell
          bytes={pattern.max_memory}
          tier={memTier}
          ratioPct={memRatioPct}
        />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {pattern.total_read_rows.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatBytes(pattern.total_read_bytes)}
      </td>
    </tr>
  );
}

/* ============================================================
   By-table table — arrayJoin(tables) rollup
   ============================================================ */

interface ByTableColumn {
  key: ByTableSort | null;
  label: string;
  align: "left" | "right";
  w?: string;
}

const BY_TABLE_COLUMNS: ByTableColumn[] = [
  { key: null, label: "Table", align: "left" },
  { key: "queries", label: "Queries", align: "right", w: "w-[80px]" },
  { key: null, label: "Select / Insert", align: "right", w: "w-[120px]" },
  { key: "total_duration_ms", label: "Total dur", align: "right", w: "w-[100px]" },
  { key: "total_read_rows", label: "Read rows", align: "right", w: "w-[112px]" },
  { key: "total_read_bytes", label: "Read bytes", align: "right", w: "w-[108px]" },
  { key: "max_memory", label: "Max mem", align: "right", w: "w-[92px]" },
];

interface ByTableTableProps {
  rows: ByTableRow[];
  sortKey: ByTableSort;
  onSort: (key: ByTableSort) => void;
  clusterMemoryBytes: number;
}

function ByTableTable({ rows, sortKey, onSort, clusterMemoryBytes }: ByTableTableProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
          <tr className="border-b border-ink-500">
            {BY_TABLE_COLUMNS.map((c, i) => {
              const isActive = c.key !== null && c.key === sortKey;
              const sortable = c.key !== null;
              return (
                <th
                  key={`${c.label}-${i}`}
                  className={cn(
                    "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                    c.align === "right" ? "text-right" : "text-left",
                    c.w
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key as ByTableSort)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-xs transition-colors hover:text-paper",
                        c.align === "right" && "flex-row-reverse",
                        isActive && "text-brand"
                      )}
                      aria-label={`Sort by ${c.label}`}
                    >
                      <span>{c.label}</span>
                      {isActive ? (
                        <ArrowDown className="h-3 w-3" aria-hidden />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <ByTableTableRow
              key={`${r.table_qualified}-${i}`}
              row={r}
              clusterMemoryBytes={clusterMemoryBytes}
            />
          ))}
        </tbody>
      </table>
    </TooltipProvider>
  );
}

function ByTableTableRow({
  row,
  clusterMemoryBytes,
}: {
  row: ByTableRow;
  clusterMemoryBytes: number;
}) {
  const memTier = memoryTier(row.max_memory, clusterMemoryBytes);
  const memRatioPct =
    clusterMemoryBytes > 0 ? (row.max_memory / clusterMemoryBytes) * 100 : 0;
  const [database, ...tableParts] = row.table_qualified.split(".");
  const table = tableParts.join(".");

  return (
    <tr className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
      <td className="px-3 py-1.5 font-mono">
        <span className="text-paper-muted">{database}</span>
        <span className="text-paper-faint">.</span>
        <span className="text-paper">{table || row.table_qualified}</span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper">
        {row.queries.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums">
        <span className="text-brand">{row.selects.toLocaleString()}</span>
        <span className="text-paper-faint"> / </span>
        <span className="text-emerald-400">{row.inserts.toLocaleString()}</span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper">
        {formatDuration(row.total_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {row.total_read_rows.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatBytes(row.total_read_bytes)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        <MemoryCell
          bytes={row.max_memory}
          tier={memTier}
          ratioPct={memRatioPct}
        />
      </td>
    </tr>
  );
}

/* ============================================================
   By Redash table — group by query_id extracted from Redash's
   leading SQL comment /* …, query_id: NNN, … *\/. Mirrors the
   Patterns columns so DE/Data Platform can spot which saved
   Redash query is dominating the cluster.
   ============================================================ */

interface ByRedashColumn {
  key: ByRedashSort | null;
  label: string;
  align: "left" | "right";
  w?: string;
}

const BY_REDASH_COLUMNS: ByRedashColumn[] = [
  { key: null, label: "Redash ID · user", align: "left" },
  { key: "executions", label: "Runs", align: "right", w: "w-[80px]" },
  // Combined "min / avg / max" duration cell — sorts by avg by default,
  // header is hint-text only. Two extra sort buttons for min and max sit
  // in the next two narrow columns.
  { key: "avg_duration_ms", label: "Avg dur", align: "right", w: "w-[88px]" },
  { key: "min_duration_ms", label: "Min dur", align: "right", w: "w-[80px]" },
  { key: "max_duration_ms", label: "Max dur", align: "right", w: "w-[88px]" },
  { key: "total_duration_ms", label: "Total dur", align: "right", w: "w-[100px]" },
  { key: "min_memory", label: "Min mem", align: "right", w: "w-[80px]" },
  { key: "max_memory", label: "Max mem", align: "right", w: "w-[92px]" },
  { key: "total_read_rows", label: "Read rows", align: "right", w: "w-[112px]" },
  { key: "total_read_bytes", label: "Read bytes", align: "right", w: "w-[108px]" },
];

interface ByRedashTableProps {
  rows: ByRedashRow[];
  sortKey: ByRedashSort;
  onSort: (key: ByRedashSort) => void;
  clusterMemoryBytes: number;
}

function ByRedashTable({ rows, sortKey, onSort, clusterMemoryBytes }: ByRedashTableProps) {
  return (
    <TooltipProvider delayDuration={300}>
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 z-10 bg-ink-200/90 backdrop-blur">
        <tr className="border-b border-ink-500">
          {BY_REDASH_COLUMNS.map((c, i) => {
            const isActive = c.key !== null && c.key === sortKey;
            const sortable = c.key !== null;
            return (
              <th
                key={`${c.label}-${i}`}
                className={cn(
                  "px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint",
                  c.align === "right" ? "text-right" : "text-left",
                  c.w
                )}
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.key as ByRedashSort)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-xs transition-colors hover:text-paper",
                      c.align === "right" && "flex-row-reverse",
                      isActive && "text-brand"
                    )}
                    aria-label={`Sort by ${c.label}`}
                  >
                    <span>{c.label}</span>
                    {isActive ? (
                      <ArrowDown className="h-3 w-3" aria-hidden />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 opacity-40" aria-hidden />
                    )}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <ByRedashTableRow
            key={`${r.redash_query_id}-${i}`}
            row={r}
            clusterMemoryBytes={clusterMemoryBytes}
          />
        ))}
      </tbody>
    </table>
    </TooltipProvider>
  );
}

function ByRedashTableRow({
  row,
  clusterMemoryBytes,
}: {
  row: ByRedashRow;
  clusterMemoryBytes: number;
}) {
  const memTier = memoryTier(row.max_memory, clusterMemoryBytes);
  const memRatioPct =
    clusterMemoryBytes > 0 ? (row.max_memory / clusterMemoryBytes) * 100 : 0;

  const minMemTier = memoryTier(row.min_memory, clusterMemoryBytes);
  const minMemRatioPct =
    clusterMemoryBytes > 0 ? (row.min_memory / clusterMemoryBytes) * 100 : 0;

  return (
    <tr className="border-b border-ink-500/60 transition-colors hover:bg-ink-200/60">
      <td className="px-3 py-1.5 font-mono">
        <span className="text-paper">#{row.redash_query_id}</span>
        {row.redash_username && (
          <>
            <span className="text-paper-faint"> · </span>
            <span className="text-paper-muted">{row.redash_username}</span>
          </>
        )}
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-paper">
        {row.executions.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper">
        {formatDuration(row.avg_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatDuration(row.min_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatDuration(row.max_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper">
        {formatDuration(row.total_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        <MemoryCell
          bytes={row.min_memory}
          tier={minMemTier}
          ratioPct={minMemRatioPct}
        />
      </td>
      <td className="px-3 py-1.5 text-right font-mono">
        <MemoryCell
          bytes={row.max_memory}
          tier={memTier}
          ratioPct={memRatioPct}
        />
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {row.total_read_rows.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatBytes(row.total_read_bytes)}
      </td>
    </tr>
  );
}

interface LogRowProps {
  log: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  failed: boolean;
  clusterMemoryBytes: number;
  selected: boolean;
  onSelect: () => void;
}

function LogRow({
  log,
  isExpanded,
  onToggle,
  failed,
  clusterMemoryBytes,
  selected,
  onSelect,
}: LogRowProps) {
  const memTier = memoryTier(log.memory_usage, clusterMemoryBytes);
  const memRatioPct =
    clusterMemoryBytes > 0 ? (log.memory_usage / clusterMemoryBytes) * 100 : 0;
  const isFinish = log.type === "QueryFinish";
  const StatusIcon = isFinish ? CheckCircle2 : failed ? XCircle : Zap;
  const statusColor = isFinish
    ? "text-emerald-400"
    : failed
      ? "text-red-400"
      : "text-amber-400";

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "group cursor-pointer border-b border-ink-500/60 transition-colors",
          isExpanded
            ? "bg-ink-200"
            : selected
              ? "bg-brand/[0.04] hover:bg-brand/[0.06]"
              : "hover:bg-ink-200/60"
        )}
      >
        <td
          className="px-3 py-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          <span
            role="checkbox"
            aria-checked={selected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onSelect();
              }
            }}
            className={cn(
              "grid h-3.5 w-3.5 cursor-pointer place-items-center rounded-xs border transition-colors",
              selected
                ? "border-brand bg-brand text-ink-50"
                : "border-ink-500 bg-ink-200 hover:border-ink-700"
            )}
          >
            {selected && (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="h-2.5 w-2.5"
                aria-hidden
              >
                <polyline points="3 8 7 12 13 4" />
              </svg>
            )}
          </span>
        </td>
        <td className="px-3 py-1.5 font-mono text-paper-muted whitespace-nowrap">
          <span title={`${log.event_date} ${log.event_time}`}>
            {formatRowTime(log.event_date, log.event_time)}
          </span>
        </td>
        <td className="px-3 py-1.5">
          <StatusIcon className={cn("h-3.5 w-3.5", statusColor)} aria-hidden />
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 flex-1 cursor-help font-mono text-paper line-clamp-1">
                {log.query}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              sideOffset={6}
              className="max-w-[640px] rounded-xs border border-ink-700 bg-ink-200 p-0 text-paper shadow-2xl ring-1 ring-black/30"
            >
              <div className="flex items-center justify-between gap-3 border-b border-ink-500 bg-ink-300 px-3 py-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-muted">
                  Query preview
                </span>
                <span className="font-mono text-[10px] text-paper-dim">
                  {log.query.length.toLocaleString()} chars
                </span>
              </div>
              {/* Resource summary — saves a click into the expanded row for the
                  at-a-glance "how heavy was this query" read. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-ink-500 px-3 py-1.5 font-mono text-[10px] tabular-nums text-paper-muted">
                <span className="text-paper">{formatDuration(log.query_duration_ms)}</span>
                <span className="text-ink-700" aria-hidden>·</span>
                <span>{formatBytes(log.memory_usage)} peak</span>
                <span className="text-ink-700" aria-hidden>·</span>
                <span>{formatCompactNumber(log.read_rows)} rows</span>
                <span className="text-ink-700" aria-hidden>·</span>
                <span>{formatBytes(log.read_bytes)} read</span>
              </div>
              <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-[1.55] text-paper">
                {highlightSql(log.query)}
              </pre>
            </TooltipContent>
          </Tooltip>
          <OptimizeWithChouseAI
            compact
            queryId={log.query_id}
            query={log.query}
            heavy={memTier !== "ok"}
          />
          </div>
        </td>
        <td className="px-3 py-1.5 text-paper truncate">
          {log.rbacUser ? (
            <span title={`RBAC: ${log.rbacUser}\nClickHouse: ${log.user}`}>
              {log.rbacUser}
            </span>
          ) : (
            <span title={`ClickHouse user: ${log.user}`}>{log.user}</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-paper">
          {formatDuration(log.query_duration_ms)}
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
          {log.read_rows.toLocaleString()}
        </td>
        <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
          {formatBytes(log.read_bytes)}
        </td>
        <td className="px-3 py-1.5 text-right font-mono">
          <MemoryCell
            bytes={log.memory_usage}
            tier={memTier}
            ratioPct={memRatioPct}
          />
        </td>
        <td
          className="px-3 py-1.5 font-mono text-paper-faint truncate"
          title={log.query_id}
        >
          {log.query_id.substring(0, 8)}…
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-ink-200/40">
          <td colSpan={COLUMNS.length} className="p-4">
            <LogDetail log={log} failed={failed} onClose={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * "Optimize Query With Chouse AI" — opens the shared OptimizeQueryDialog (the
 * same window the SQL editor's Optimize button uses) in log mode: it passes the
 * query_id so the backend works from the FULL query (never the truncated
 * preview) and the dialog renders the richer cause / tables / suggestions /
 * before → after EXPLAIN analysis. Accept opens the result in a new Explorer tab.
 */
function OptimizeWithChouseAI({
  queryId,
  query,
  compact = false,
  heavy = false,
}: {
  queryId: string;
  query: string;
  /** Icon-only trigger for dense table rows (vs. the full text button). */
  compact?: boolean;
  /** Heavy query → keep the compact trigger always visible + brand-tinted. */
  heavy?: boolean;
}) {
  const { hasPermission } = useRbacStore();
  const navigate = useNavigate();
  const addTab = useWorkspaceStore((s) => s.addTab);
  const canOptimize = hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);
  // Only SELECT / WITH queries can be optimized (read-only). Strip BOTH block
  // /* … */ and line -- comments first — Redash prefixes a /* … */--DP-1234
  // banner, so stripping only block comments leaves a leading -- and the check
  // would wrongly fail.
  const isReadOnly = /^(select|with)\b/i.test(
    query
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .trim(),
  );
  const [open, setOpen] = useState(false);

  if (!canOptimize || !isReadOnly) return null;

  const start = (e?: React.MouseEvent) => {
    e?.stopPropagation(); // don't toggle the row's expand when launching
    setOpen(true);
  };

  // Drop the optimized query into a fresh SQL tab in the Explorer workspace and
  // jump there so the operator can run it immediately.
  const openInExplorer = (sql: string) => {
    if (!sql) return;
    addTab({ id: genTabId(), title: "Optimized · Chouse AI", type: "sql", content: sql, isSaved: false });
    setOpen(false);
    navigate("/explorer");
  };

  const trigger = compact ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={start}
          aria-label="Optimize with Chouse AI"
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-xs border transition-all",
            heavy
              ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/20"
              : "border-transparent text-paper-faint opacity-0 hover:bg-ink-300 hover:text-brand group-hover:opacity-100",
          )}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Optimize with Chouse AI</TooltipContent>
    </Tooltip>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      onClick={start}
      className="h-6 gap-1.5 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-brand hover:bg-brand/10"
    >
      <Sparkles className="h-3 w-3" />
      Optimize with Chouse AI
    </Button>
  );

  return (
    <>
      {trigger}

      {open && (
        <OptimizeQueryDialog
          isOpen={open}
          onClose={() => setOpen(false)}
          query={query}
          queryId={queryId}
          acceptLabel="Open in Explorer"
          onAccept={openInExplorer}
        />
      )}
    </>
  );
}

interface LogDetailProps {
  log: LogEntry;
  failed: boolean;
  onClose: () => void;
}

function LogDetail({ log, failed, onClose }: LogDetailProps) {
  const copy = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="flex flex-col gap-4 rounded-xs border border-ink-500 bg-ink-100 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
              log.type === "QueryFinish"
                ? "border-emerald-500/40 text-emerald-300"
                : failed
                  ? "border-red-500/40 text-red-300"
                  : "border-amber-500/40 text-amber-300"
            )}
          >
            {log.type}
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-7 w-7 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            Query
          </span>
          <div className="flex items-center gap-1">
            <OptimizeWithChouseAI queryId={log.query_id} query={log.query} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(log.query)}
              className="h-6 gap-1.5 rounded-xs px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
            >
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xs border border-ink-500 bg-ink-200 p-3 font-mono text-[12px] text-paper">
          {log.query}
        </pre>
      </div>

      {log.exception && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
            Exception
          </span>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xs border border-red-900/60 bg-red-950/40 p-3 font-mono text-[12px] text-red-200">
            {log.exception}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetaCell label="Query ID" value={log.query_id} mono onCopy={() => copy(log.query_id)} />
        <MetaCell
          label="Connection"
          value={log.connectionName || log.connectionId?.substring(0, 8) || "—"}
        />
        <MetaCell label="ClickHouse user" value={log.user} />
        <MetaCell label="Event time" value={`${log.event_date} ${log.event_time}`} />
      </div>

      <ViewsTriggeredBlock queryId={log.query_id} />

      <ProfileEventsBlock queryId={log.query_id} />
    </div>
  );
}

interface ViewsTriggeredBlockProps {
  queryId: string;
}

/**
 * Lazy-loaded panel showing the materialized / normal views that fired as
 * part of this query — sourced from system.query_views_log. Useful when a
 * query is slower than expected and the cost is hiding in a downstream MV.
 */
function ViewsTriggeredBlock({ queryId }: ViewsTriggeredBlockProps) {
  const { data: views = [], isLoading, error } = useQueryViewsLog(queryId);

  // Hide the section entirely when no views fired — keeps the expanded
  // panel quiet for single-table SELECTs where it would never apply.
  if (!isLoading && !error && views.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          Views triggered
        </span>
        {!isLoading && views.length > 0 && (
          <span className="font-mono text-[10px] text-paper-dim">
            {views.length.toLocaleString()} {views.length === 1 ? "view" : "views"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xs border border-ink-500 bg-ink-200 p-3 font-mono text-[11px] text-paper-faint">
          Loading triggered views…
        </div>
      ) : error ? (
        <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-3 font-mono text-[11px] text-red-200">
          Couldn't load views log — {error.message}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xs border border-ink-500">
          <table className="w-full text-[11px]">
            <thead className="bg-ink-200">
              <tr className="border-b border-ink-500">
                {[
                  { label: "View", align: "left" },
                  { label: "Type", align: "left" },
                  { label: "Status", align: "left" },
                  { label: "Duration", align: "right" },
                  { label: "Read rows", align: "right" },
                  { label: "Written", align: "right" },
                  { label: "Peak mem", align: "right" },
                ].map((h) => (
                  <th
                    key={h.label}
                    className={cn(
                      "px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint",
                      h.align === "right" ? "text-right" : "text-left"
                    )}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {views.map((v, i) => (
                <ViewLogTableRow key={`${v.view_name}-${i}`} row={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ViewLogTableRow({ row }: { row: ViewLogRow }) {
  const failed =
    row.status === "ExceptionWhileProcessing" ||
    row.status === "ExceptionBeforeStart" ||
    !!row.exception;
  return (
    <tr className="border-b border-ink-500/60 last:border-b-0">
      <td className="px-3 py-1.5 font-mono text-paper">{row.view_name}</td>
      <td className="px-3 py-1.5 font-mono text-paper-muted">{row.view_type}</td>
      <td className="px-3 py-1.5">
        <span
          className={cn(
            "rounded-xs border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.14em]",
            failed
              ? "border-red-500/40 text-red-300"
              : "border-emerald-500/40 text-emerald-300"
          )}
          title={row.exception || undefined}
        >
          {failed ? "Failed" : row.status === "QueryFinish" ? "OK" : row.status}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper">
        {formatDuration(row.view_duration_ms)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {row.read_rows.toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {row.written_rows > 0
          ? `${row.written_rows.toLocaleString()} / ${formatBytes(row.written_bytes)}`
          : "—"}
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-paper-muted">
        {formatBytes(row.peak_memory_usage)}
      </td>
    </tr>
  );
}

interface ProfileEventsBlockProps {
  queryId: string;
}

/**
 * Lazy-loaded panel showing the top ProfileEvents emitted by this query —
 * surfaces things like OSCPUVirtualTimeMicroseconds, NetworkSendBytes,
 * MarkCacheMisses, etc. Sits below the meta grid in the expanded row.
 */
function ProfileEventsBlock({ queryId }: ProfileEventsBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const { data: events = [], isLoading, error } = useQueryProfileEvents(queryId);

  const visible = showAll ? events : events.slice(0, 20);
  const maxValue = events[0]?.value ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          Profile events
        </span>
        {!isLoading && events.length > 20 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted hover:text-paper"
          >
            {showAll ? `Show top 20` : `Show all (${events.length})`}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xs border border-ink-500 bg-ink-200 p-3 font-mono text-[11px] text-paper-faint">
          Loading profile events…
        </div>
      ) : error ? (
        <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-3 font-mono text-[11px] text-red-200">
          Couldn't load profile events — {error.message}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xs border border-ink-500 bg-ink-200 p-3 font-mono text-[11px] text-paper-faint">
          No profile events recorded for this query.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-ink-500 bg-ink-500 md:grid-cols-2">
          {visible.map((evt) => (
            <ProfileEventRow key={evt.name} event={evt} maxValue={maxValue} />
          ))}
        </div>
      )}
    </div>
  );
}

interface ProfileEventRowProps {
  event: ProfileEventEntry;
  maxValue: number;
}

function ProfileEventRow({ event, maxValue }: ProfileEventRowProps) {
  const ratio = maxValue > 0 ? event.value / maxValue : 0;
  const formatted = formatProfileEvent(event.name, event.value);
  return (
    <div className="relative bg-ink-100 px-3 py-1.5">
      <div
        className="absolute inset-y-0 left-0 bg-brand/[0.07]"
        style={{ width: `${Math.max(2, ratio * 100)}%` }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[11px] text-paper" title={event.name}>
          {event.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-paper-muted">
          {formatted}
        </span>
      </div>
    </div>
  );
}

/**
 * Auto-format ProfileEvent values based on the name convention used in
 * ClickHouse: *Microseconds → time, *Bytes → bytes, *Hits/*Misses → counts.
 */
function formatProfileEvent(name: string, value: number): string {
  if (/Microseconds$/.test(name)) {
    if (value < 1000) return `${value.toLocaleString()} µs`;
    if (value < 1_000_000) return `${(value / 1000).toFixed(1)} ms`;
    return `${(value / 1_000_000).toFixed(2)} s`;
  }
  if (/Bytes$/.test(name) || /Size$/.test(name)) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return value.toLocaleString();
}

interface MemoryCellProps {
  bytes: number;
  tier: "ok" | "warn" | "danger";
  ratioPct: number;
}

/**
 * Memory cell with a pressure flag. > 40% cluster RAM goes amber + warning
 * icon (worth a look); > 60% goes red + flame (likely needs tuning). Below
 * threshold it renders exactly like the other byte cells so the editorial
 * baseline doesn't get noisy.
 */
function MemoryCell({ bytes, tier, ratioPct }: MemoryCellProps) {
  if (tier === "ok") {
    return <span className="text-paper-muted">{formatBytes(bytes)}</span>;
  }
  const Icon = tier === "danger" ? Flame : AlertTriangle;
  const tone =
    tier === "danger"
      ? "text-red-300"
      : "text-amber-300";
  const label =
    tier === "danger"
      ? `Used ${ratioPct.toFixed(0)}% of cluster RAM — likely needs optimization.`
      : `Used ${ratioPct.toFixed(0)}% of cluster RAM — worth reviewing.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center justify-end gap-1.5", tone)}>
          <Icon className="h-3 w-3" aria-hidden />
          <span>{formatBytes(bytes)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        sideOffset={6}
        className="rounded-xs border border-ink-700 bg-ink-200 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted shadow-xl ring-1 ring-black/30"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface MetaCellProps {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
}

function MetaCell({ label, value, mono, onCopy }: MetaCellProps) {
  return (
    <div className="flex flex-col gap-1 border-l border-ink-500 pl-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper-faint">
          {label}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-paper-faint hover:text-paper"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
      <span
        className={cn(
          "truncate text-[12px] text-paper",
          mono && "font-mono text-[11px]"
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
