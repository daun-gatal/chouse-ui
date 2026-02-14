import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  RefreshCw,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Pause,
  Download,
  BarChart3,
  Timer,
  Database,
  User,
  Zap,
  ChevronDown,
  ChevronUp,
  Copy,
  ArrowUpDown,
  Shield,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/components/common/theme-provider";
import { useQueryLogs, usePaginationPreference, useLogsPreferences } from "@/hooks";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DataControls } from "@/components/common/DataControls";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: any;
  color: string;
}

const StatCard = ({ title, value, icon: Icon, color }: StatCardProps) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn(
      "p-4 rounded-xl border backdrop-blur-sm",
      "bg-gradient-to-br from-gray-900/50 to-gray-800/50",
      `border-${color}-500/20`
    )}
  >
    <div className="flex items-center gap-3">
      <div className={cn(
        "p-2 rounded-lg",
        `bg-${color}-500/20`
      )}>
        <Icon className={cn("w-5 h-5", `text-${color}-400`)} />
      </div>
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider">{title}</p>
        <p className={cn("text-xl font-bold", `text-${color}-300`)}>{value}</p>
      </div>
    </div>
  </motion.div>
);

import { useQuery } from "@tanstack/react-query";
import { rbacUsersApi, rbacRolesApi } from "@/api/rbac";

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
  stats: {
    total: number;
    success: number;
    failed: number;
    avgDuration: number;
  };
  exceptionQueryIds: Set<string>; // Track query_ids that have ExceptionWhileProcessing entries
}

/**
 * Shared function to filter, deduplicate, and calculate stats for logs
 * This ensures consistency between display and stats calculation
 */
function processLogs(
  logs: LogEntry[],
  filters: LogFilterParams,
  limit: number
): ProcessedLogsResult {
  const { searchTerm, logType, selectedRoleId, usersByRoleData } = filters;

  // Get user IDs for role filter
  const hasRoleFilter = selectedRoleId !== "all";
  const roleUserIds = hasRoleFilter && usersByRoleData?.users && usersByRoleData.users.length > 0
    ? new Set(usersByRoleData.users.map(u => u.id))
    : null;

  // First, identify all query_ids that have reached final states
  // This helps us exclude them when filtering by "Running" and for stats calculation
  // Note: QueryStart with exception should also be considered a final (failed) state
  const finalStateQueryIds = new Set<string>();
  // Also track which query_ids have ExceptionWhileProcessing entries (even if filtered out)
  const exceptionQueryIds = new Set<string>();
  logs.forEach((log) => {
    const hasException = log.exception && log.exception.trim().length > 0;
    if (log.type === 'QueryFinish' || log.type === 'ExceptionWhileProcessing' || log.type === 'ExceptionBeforeStart' || (log.type === 'QueryStart' && hasException)) {
      finalStateQueryIds.add(log.query_id);
    }
    // Track queries that have ExceptionWhileProcessing or ExceptionBeforeStart entries
    if (log.type === 'ExceptionWhileProcessing' || log.type === 'ExceptionBeforeStart') {
      exceptionQueryIds.add(log.query_id);
    }
  });

  // Also track final states in the filtered set (for accurate stats)
  const filteredFinalStateQueryIds = new Set<string>();

  // If searching by query_id, find all logs with that query_id first
  // This ensures we include the query even if it's in a different state
  const searchByQueryId = searchTerm && searchTerm.trim().length > 0;
  const matchingQueryIds = new Set<string>();
  if (searchByQueryId) {
    const searchLower = searchTerm.toLowerCase().trim();
    logs.forEach((log) => {
      if (log.query_id) {
        const logQueryIdLower = log.query_id.toLowerCase();
        // Exact match or contains match
        if (logQueryIdLower === searchLower || logQueryIdLower.includes(searchLower)) {
          matchingQueryIds.add(log.query_id);
        }
      }
    });
  }

  // Apply all filters
  const filtered = logs.filter((log) => {
    // If searching by query_id and this log's query_id matches, include it
    // This takes priority to ensure we find the query even if other filters would exclude it
    const matchesQueryIdSearch = searchByQueryId && matchingQueryIds.has(log.query_id);

    // If we have a query_id match, bypass other search filters
    const matchesSearch = matchesQueryIdSearch || (
      !searchTerm ||
      log.query?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.query_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.rbacUser?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    const matchesType = logType === "all" || log.type === logType;

    // Filter by role if role is selected
    let matchesRole = true;
    if (hasRoleFilter) {
      if (roleUserIds && roleUserIds.size > 0) {
        // When filtering by role, only include logs that have a rbacUserId
        // and that rbacUserId is in the set of users with the selected role
        if (log.rbacUserId) {
          matchesRole = roleUserIds.has(log.rbacUserId);
        } else {
          // If log doesn't have rbacUserId, exclude it when filtering by role
          // (we can't determine which user ran it, so we can't filter by role)
          matchesRole = false;
        }
      } else {
        // If role is selected but no users found with that role, show no logs
        matchesRole = false;
      }
    }

    const matches = matchesSearch && matchesType && matchesRole;

    // Track final states in filtered set
    // QueryStart with exception should also be considered a final (failed) state
    const hasException = log.exception && log.exception.trim().length > 0;
    if (matches && (log.type === 'QueryFinish' || log.type === 'ExceptionWhileProcessing' || log.type === 'ExceptionBeforeStart' || (log.type === 'QueryStart' && hasException))) {
      filteredFinalStateQueryIds.add(log.query_id);
    }

    return matches;
  });

  // Deduplicate by query_id - keep only one entry per query_id
  // Priority: ExceptionWhileProcessing > QueryStart with exception > QueryFinish > QueryStart (or most recent if same type)
  const queryMap = new Map<string, LogEntry>();

  for (const log of filtered) {
    // If filtering by "Running" and this query_id has a final state, skip it
    if (logType === "QueryStart" && finalStateQueryIds.has(log.query_id)) {
      continue;
    }

    const existing = queryMap.get(log.query_id);

    if (!existing) {
      // First occurrence of this query_id
      queryMap.set(log.query_id, log);
    } else {
      // Determine which log to keep based on status priority and timestamp
      // QueryStart with exception should be treated as failed (high priority)
      // Also check if there's an ExceptionWhileProcessing or ExceptionBeforeStart entry for this query_id
      const getPriority = (logEntry: LogEntry): number => {
        if (logEntry.type === 'ExceptionWhileProcessing' || logEntry.type === 'ExceptionBeforeStart') return 4; // Highest priority (failed states)
        const hasException = logEntry.exception && logEntry.exception.trim().length > 0;
        const hasExceptionEntry = exceptionQueryIds.has(logEntry.query_id);
        if (logEntry.type === 'QueryStart' && (hasException || hasExceptionEntry)) return 3; // QueryStart with exception or exception entry = failed
        if (logEntry.type === 'QueryFinish') return 2; // Success
        if (logEntry.type === 'QueryStart') return 1; // Running
        return 0;
      };

      const existingPriority = getPriority(existing);
      const currentPriority = getPriority(log);

      if (currentPriority > existingPriority) {
        // Current log has higher priority status
        queryMap.set(log.query_id, log);
      } else if (currentPriority === existingPriority && currentPriority > 0) {
        // Same priority status, keep the most recent one
        // Compare by event_date first, then event_time
        const existingDate = existing.event_date;
        const currentDate = log.event_date;
        if (currentDate > existingDate) {
          queryMap.set(log.query_id, log);
        } else if (currentDate === existingDate) {
          // Same date, compare by time
          if (log.event_time > existing.event_time) {
            queryMap.set(log.query_id, log);
          }
        }
      }
      // Otherwise keep the existing one
    }
  }

  // Convert map back to array and sort by timestamp (most recent first)
  const deduplicated = Array.from(queryMap.values()).sort((a, b) => {
    // Compare by date first, then time
    if (b.event_date !== a.event_date) {
      return b.event_date.localeCompare(a.event_date);
    }
    return b.event_time.localeCompare(a.event_time);
  });

  // Apply the requested limit AFTER deduplication
  const limitedLogs = deduplicated.slice(0, limit);

  // Calculate stats from the limited, deduplicated logs
  let success = 0;
  let failed = 0;
  let running = 0;
  const durations: number[] = [];

  limitedLogs.forEach((log) => {
    // Check if QueryStart has exception - treat as failed
    // Check for truthy and non-empty exception string
    // Also check if there's an ExceptionWhileProcessing entry for this query_id (even if filtered out)
    const hasException = log.exception && log.exception.trim().length > 0;
    const hasExceptionEntry = exceptionQueryIds.has(log.query_id);
    const isFailedQueryStart = log.type === "QueryStart" && (hasException || hasExceptionEntry);

    if (log.type === "QueryFinish") {
      success++;
      if (log.query_duration_ms) {
        durations.push(log.query_duration_ms);
      }
    } else if (log.type === "ExceptionWhileProcessing" || log.type === "ExceptionBeforeStart" || isFailedQueryStart) {
      failed++;
      if (log.query_duration_ms) {
        durations.push(log.query_duration_ms);
      }
    } else if (log.type === "QueryStart") {
      // Running queries are now filtered out
    }
  });

  const total = limitedLogs.length;
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
    : 0;

  return {
    logs: limitedLogs,
    stats: {
      total,
      success,
      failed,
      avgDuration,
    },
    exceptionQueryIds,
  };
}

// Summary stat component
interface LogStatProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

const LogStat: React.FC<LogStatProps> = ({ title, value, icon: Icon, color, bgColor }) => (
  <div className={cn("flex items-center gap-3 p-3 rounded-xl", bgColor)}>
    <Icon className={cn("h-4 w-4", color)} />
    <div>
      <p className="text-xs text-gray-400">{title}</p>
      <p className="text-lg font-bold text-white">{value}</p>
    </div>
  </div>
);

// Query detail modal/expanded view
interface QueryDetailProps {
  log: LogEntry;
  onClose: () => void;
}

const QueryDetail: React.FC<QueryDetailProps & { isFailed?: boolean; exceptionQueryIds?: Set<string> }> = ({ log, onClose, isFailed, exceptionQueryIds }) => {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Determine if this log is failed (use provided isFailed or calculate)
  const logIsFailed = isFailed !== undefined ? isFailed : (
    log.type === "ExceptionWhileProcessing" || log.type === "ExceptionBeforeStart" ||
    (log.type === "QueryStart" && (
      (log.exception && log.exception.trim().length > 0) ||
      (exceptionQueryIds?.has(log.query_id) || false)
    ))
  );

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="col-span-full bg-white/5 rounded-xl p-4 border border-white/10"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          {log.type === "QueryFinish" ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : logIsFailed ? (
            <XCircle className="h-5 w-5 text-red-500" />
          ) : (
            <Play className="h-5 w-5 text-blue-500" />
          )}
          <span className="font-medium text-white">{log.type}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronUp className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Query ID */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Query ID</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => copyToClipboard(log.query_id)}
            >
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
          <div className="bg-black/30 rounded-lg p-3">
            <p className="text-sm text-gray-300 font-mono break-all">{log.query_id}</p>
          </div>
        </div>

        {/* Query */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Query</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => copyToClipboard(log.query)}
            >
              <Copy className="h-3 w-3" />
              Copy
            </Button>
          </div>
          <pre className="bg-black/30 rounded-lg p-3 text-sm text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
            {log.query}
          </pre>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Duration</p>
            <p className="font-mono text-white">{log.query_duration_ms}ms</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Rows Read</p>
            <p className="font-mono text-white">{log.read_rows.toLocaleString()}</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Data Read</p>
            <p className="font-mono text-white">{(log.read_bytes / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-xs text-gray-400">Memory</p>
            <p className="font-mono text-white">{(log.memory_usage / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        </div>

        {/* Exception if exists */}
        {log.exception && (
          <div>
            <span className="text-xs text-red-400 uppercase tracking-wider">Exception</span>
            <pre className="mt-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-300 font-mono overflow-x-auto whitespace-pre-wrap">
              {log.exception}
            </pre>
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {log.rbacUser ? (
              <span title={`RBAC User: ${log.rbacUser}${log.rbacUserId ? ` (${log.rbacUserId.substring(0, 8)}...)` : ''}\nClickHouse User: ${log.user}`}>
                {log.rbacUser}
                {(log.connectionName || log.connectionId) && (
                  <span className="text-gray-500 ml-1">
                    ({log.connectionName || `ID: ${log.connectionId?.substring(0, 8)}...`})
                  </span>
                )}
              </span>
            ) : (
              <span title={`ClickHouse User: ${log.user}`}>
                {log.user}
                {(log.connectionName || log.connectionId) && (
                  <span className="text-gray-500 ml-1">
                    ({log.connectionName || `ID: ${log.connectionId?.substring(0, 8)}...`})
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {log.event_date} {log.event_time}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

interface LogsPageProps {
  embedded?: boolean;
  refreshKey?: number;
  autoRefresh?: boolean;
  onRefreshChange?: (isRefreshing: boolean) => void;
}

export default function LogsPage({ embedded = false, refreshKey = 0, autoRefresh: externalAutoRefresh = false, onRefreshChange }: LogsPageProps) {
  const { theme } = useTheme();
  const { isSuperAdmin, user, hasPermission } = useRbacStore();
  const canViewAllLogs = isSuperAdmin() || hasPermission(RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL);
  const { pageSize: defaultLimit, setPageSize: setLimitPreference } = usePaginationPreference('logs');
  const { preferences: logsPrefs, updatePreferences: updateLogsPrefs } = useLogsPreferences();

  const [limit, setLimit] = useState(defaultLimit);

  // Sync limit state when preference changes
  useEffect(() => {
    setLimit(defaultLimit);
  }, [defaultLimit]);

  // Initialize state from preferences
  const [searchTerm, setSearchTerm] = useState(logsPrefs.defaultSearchQuery || "");
  const [logType, setLogType] = useState<string>(logsPrefs.defaultLogType || "all");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [internalAutoRefresh, setInternalAutoRefresh] = useState(logsPrefs.autoRefresh || false);

  // Use external autoRefresh if embedded, otherwise internal state
  const autoRefresh = embedded ? externalAutoRefresh : internalAutoRefresh;
  const setAutoRefresh = embedded ? () => { } : setInternalAutoRefresh;
  const [selectedUserId, setSelectedUserId] = useState<string>(logsPrefs.defaultSelectedUserId || "all");
  const [selectedRoleId, setSelectedRoleId] = useState<string>(logsPrefs.defaultSelectedRoleId || "all");
  const previousLogStatesRef = useRef<Map<string, string>>(new Map());
  const [statusChangedIds, setStatusChangedIds] = useState<Set<string>>(new Set());

  // Update preferences when state changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateLogsPrefs({
        defaultLogType: logType,
        autoRefresh: autoRefresh,
        defaultSelectedUserId: selectedUserId,
        defaultSelectedRoleId: selectedRoleId,
      });
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [logType, autoRefresh, selectedUserId, selectedRoleId, updateLogsPrefs]);

  // Update limit preference when limit changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setLimitPreference(limit);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [limit, setLimitPreference]);

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm("");
    setLogType("all");
    setSelectedUserId("all");
    setSelectedRoleId("all");
  };

  // Check if any filters are active
  const hasActiveFilters = searchTerm.trim().length > 0 || logType !== "all" || selectedUserId !== "all" || selectedRoleId !== "all";

  // Fetch users list for users who can view all logs
  const { data: usersData } = useQuery({
    queryKey: ['rbac-users-list'],
    queryFn: () => rbacUsersApi.list({ limit: 1000, isActive: true }),
    enabled: canViewAllLogs, // Only fetch for users who can see all logs
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch roles list for users who can view all logs
  const { data: rolesData } = useQuery({
    queryKey: ['rbac-roles-list'],
    queryFn: () => rbacRolesApi.list(),
    enabled: canViewAllLogs, // Only fetch for users who can see all logs
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch users with selected role when role filter is applied
  const { data: usersByRoleData } = useQuery({
    queryKey: ['rbac-users-by-role', selectedRoleId],
    queryFn: () => rbacUsersApi.list({ limit: 1000, isActive: true, roleId: selectedRoleId }),
    enabled: canViewAllLogs && selectedRoleId !== "all",
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Users with QUERY_HISTORY_VIEW_ALL or super_admin can see all logs
  // All other users only see their own logs
  // If user can view all logs and selects a specific user, filter by that user
  // If user can view all logs and selects a role, filter by users with that role
  const rbacUserIdFilter = canViewAllLogs
    ? (selectedUserId !== "all"
      ? selectedUserId
      : (selectedRoleId !== "all" && usersByRoleData?.users.length
        ? undefined // Will filter client-side by role user IDs
        : undefined))
    : user?.id;
  // Fetch more logs than requested to account for:
  // 1. Deduplication (multiple entries per query_id: QueryStart, QueryFinish, Exception)
  // 2. Filtering (search, logType, role filters may exclude many logs)
  // Use a higher multiplier to ensure we get enough unique queries after all filtering
  // Reuse hasActiveFilters variable defined above
  // If filters are active, use a much higher multiplier (20x) to account for filtering reducing the pool significantly
  // If no filters, 5x should be sufficient for deduplication only
  // This ensures we fetch enough logs to get the requested number of unique queries after filtering + deduplication
  const multiplier = hasActiveFilters ? 20 : 5;
  const fetchLimit = Math.max(limit * multiplier, 1000); // Higher multiplier when filters active, minimum 1000 to ensure enough data
  const { data: logs = [], isLoading, isFetching, refetch, error, dataUpdatedAt } = useQueryLogs(fetchLimit, undefined, rbacUserIdFilter);

  // Combined loading state
  const isAnyLoading = isLoading || isFetching;

  // Notify parent of refresh status change
  useEffect(() => {
    onRefreshChange?.(isAnyLoading);
  }, [isAnyLoading, onRefreshChange]);

  // Manual refresh effect
  useEffect(() => {
    if (refreshKey) {
      refetch();
    }
  }, [refreshKey, refetch]);

  // Auto refresh
  React.useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => refetch(), 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, refetch]);



  // Use shared function to process logs - ensures consistency between display and stats
  const processedLogs = useMemo(() => {
    return processLogs(
      logs,
      {
        searchTerm,
        logType,
        selectedRoleId,
        usersByRoleData: usersByRoleData || null,
      },
      limit
    );
  }, [logs, searchTerm, logType, selectedRoleId, usersByRoleData, limit]);

  const filteredLogs = processedLogs.logs;
  const exceptionQueryIds = processedLogs.exceptionQueryIds;

  // Helper function to check if a log entry represents a failed query
  const isFailedLog = useCallback((log: LogEntry): boolean => {
    if (log.type === "ExceptionWhileProcessing" || log.type === "ExceptionBeforeStart") return true;
    if (log.type === "QueryStart") {
      const hasException = log.exception && log.exception.trim().length > 0;
      const hasExceptionEntry = exceptionQueryIds.has(log.query_id);
      return hasException || hasExceptionEntry;
    }
    return false;
  }, [exceptionQueryIds]);

  // Track status changes for animation
  useEffect(() => {
    const changedIds = new Set<string>();
    const newStates = new Map<string, string>();
    const previousLogStates = previousLogStatesRef.current;

    filteredLogs.forEach((log) => {
      const previousState = previousLogStates.get(log.query_id);
      newStates.set(log.query_id, log.type);

      // Check if status changed from QueryStart to a final state
      // Also handle QueryStart with exception (should be treated as failed)
      const hasException = log.exception && log.exception.trim().length > 0;
      const isFinalState = log.type === 'QueryFinish' || log.type === 'ExceptionWhileProcessing' || log.type === 'ExceptionBeforeStart' || (log.type === 'QueryStart' && hasException);
      if (previousState === 'QueryStart' && isFinalState) {
        changedIds.add(log.query_id);
      }
    });

    if (changedIds.size > 0) {
      setStatusChangedIds(changedIds);
      // Clear the animation after 2 seconds
      const timeoutId = setTimeout(() => {
        setStatusChangedIds(new Set());
      }, 2000);

      // Cleanup timeout on unmount or when filteredLogs change
      return () => {
        clearTimeout(timeoutId);
      };
    }

    // Update the ref with new states
    previousLogStatesRef.current = newStates;
  }, [filteredLogs]);

  // Stats are calculated by the shared processLogs function - guaranteed consistency
  const stats = processedLogs.stats;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "--:--:--";

  return (
    <div className="h-full overflow-hidden">
      <div className={cn(
        "mx-auto space-y-6 flex flex-col h-full",
        embedded ? "p-4" : "p-6"
      )}>
        {/* Header - separate title and controls */}
        {!embedded ? (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6"
          >
            {/* Title Section */}
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-lg shadow-blue-500/20">
                <FileText className="h-7 w-7 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight text-white">Query Logs</h1>
                  {!canViewAllLogs && user && (
                    <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      <User className="h-3 w-3 mr-1" />
                      Your queries only
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Data Controls - Top Right */}
            <DataControls
              lastUpdated={lastUpdated}
              isRefreshing={isFetching}
              onRefresh={() => refetch()}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={setAutoRefresh}
            />
          </motion.div>
        ) : null}




        {/* Summary Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <StatCard
            title="Total Queries"
            value={stats.total}
            icon={Database}
            color="blue"
          />
          <StatCard
            title="Successful"
            value={stats.success}
            icon={CheckCircle2}
            color="green"
          />
          <StatCard
            title="Failed"
            value={stats.failed}
            icon={XCircle}
            color="red"
          />

          <StatCard
            title="Avg Duration"
            value={`${Math.round(stats.avgDuration)}ms`}
            icon={Timer}
            color="purple"
          />
        </motion.div>



        {/* Filters */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <div className={cn(
            "relative overflow-hidden rounded-2xl border border-white/10 p-4 flex flex-wrap gap-3 items-center",
            "bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl"
          )}>
            <div className="flex items-center gap-2 w-full md:w-[320px]">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search queries, users, IDs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-white/5 border-white/10"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <Select value={logType} onValueChange={setLogType}>
                <SelectTrigger className="w-[140px] bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="QueryFinish">Success</SelectItem>

                  <SelectItem value="ExceptionWhileProcessing">Failed</SelectItem>
                  <SelectItem value="ExceptionBeforeStart">Failed (Before Start)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {canViewAllLogs && (
              <>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <Select
                    value={selectedUserId}
                    onValueChange={(value) => {
                      setSelectedUserId(value);
                      // Clear role filter when user is selected
                      if (value !== "all") {
                        setSelectedRoleId("all");
                      }
                    }}
                  >
                    <SelectTrigger className="w-[180px] bg-white/5 border-white/10 [&>span]:text-left [&>span]:truncate">
                      <SelectValue placeholder="All Users" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      {usersData?.users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.displayName || u.username || u.email || u.id.substring(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-gray-400" />
                  <Select
                    value={selectedRoleId}
                    onValueChange={(value) => {
                      setSelectedRoleId(value);
                      // Clear user filter when role is selected
                      if (value !== "all") {
                        setSelectedUserId("all");
                      }
                    }}
                  >
                    <SelectTrigger className="w-[180px] bg-white/5 border-white/10 [&>span]:text-left [&>span]:truncate">
                      <SelectValue placeholder="All Roles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      {rolesData?.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.displayName || role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <Select
              value={String(limit)}
              onValueChange={(v) => {
                const newLimit = Number(v);
                if (!isNaN(newLimit) && newLimit > 0) {
                  setLimit(newLimit);
                  setLimitPreference(newLimit);
                }
              }}
            >
              <SelectTrigger className="w-[120px] bg-white/5 border-white/10">
                <SelectValue placeholder="Select rows" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 rows</SelectItem>
                <SelectItem value="100">100 rows</SelectItem>
                <SelectItem value="500">500 rows</SelectItem>
                <SelectItem value="1000">1000 rows</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearFilters}
                      className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 text-gray-400 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                      Clear Filters
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear all filters</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>







        </motion.div>



        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3"
            >
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <p className="text-red-400">{error.message}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Logs Content */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex-1 min-h-0"
        >
          <div className={cn(
            "relative overflow-hidden rounded-2xl border border-white/10 flex flex-col h-full",
            "bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl"
          )}>
            <div className="h-full overflow-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <RefreshCw className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Loading logs...</span>
                  </div>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                  <FileText className="h-16 w-16 opacity-20 mb-4" />
                  <p className="text-lg font-medium">No logs found</p>
                  <p className="text-sm">Try adjusting your filters</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLogs.map((log, i) => {
                    const hasStatusChanged = statusChangedIds.has(log.query_id);
                    return (
                      <React.Fragment key={log.query_id + i}>
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{
                            opacity: 1,
                            y: 0,
                            scale: hasStatusChanged ? [1, 1.02, 1] : 1,
                            backgroundColor: hasStatusChanged
                              ? (log.type === "QueryFinish" ? "rgba(34, 197, 94, 0.1)" : (isFailedLog(log) ? "rgba(239, 68, 68, 0.1)" : "rgba(255, 255, 255, 0.05)"))
                              : "rgba(255, 255, 255, 0.05)"
                          }}
                          transition={{
                            delay: Math.min(i * 0.02, 0.5),
                            scale: hasStatusChanged ? { duration: 0.5, ease: "easeOut" } : undefined,
                            backgroundColor: hasStatusChanged ? { duration: 0.5 } : undefined
                          }}
                          onClick={() => setExpandedLog(expandedLog === log.query_id ? null : log.query_id)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl cursor-pointer",
                            "hover:bg-white/10 transition-all",
                            "border border-transparent hover:border-white/10",
                            expandedLog === log.query_id && "border-white/20 bg-white/10",
                            hasStatusChanged && "ring-2 ring-offset-2 ring-offset-[#0a0a0a]",
                            hasStatusChanged && log.type === "QueryFinish" && "ring-green-500/50",
                            hasStatusChanged && isFailedLog(log) && "ring-red-500/50"
                          )}
                        >
                          {/* Status Icon */}
                          <motion.div
                            className="flex-shrink-0"
                            animate={{
                              scale: hasStatusChanged ? [1, 1.2, 1] : 1,
                            }}
                            transition={{
                              duration: 0.5,
                              ease: "easeOut"
                            }}
                          >
                            {log.type === "QueryFinish" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : isFailedLog(log) ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : (
                              <Zap className="h-4 w-4 text-amber-500 animate-pulse" />
                            )}
                          </motion.div>

                          {/* Query Preview */}
                          <div className="flex-1 overflow-hidden">
                            <p className="text-sm text-gray-300 font-mono truncate">{log.query}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span className="flex items-center gap-1" title={log.rbacUser ? `RBAC User: ${log.rbacUser}${log.rbacUserId ? ` (${log.rbacUserId.substring(0, 8)}...)` : ''}\nClickHouse User: ${log.user}` : `ClickHouse User: ${log.user}`}>
                                <User className="h-3 w-3" />
                                {log.rbacUser ? (
                                  <span>{log.rbacUser}</span>
                                ) : (
                                  <span>{log.user}</span>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <Timer className="h-3 w-3" />
                                {log.query_duration_ms}ms
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {log.event_time}
                              </span>
                            </div>
                          </div>

                          {/* Expand Icon */}
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-gray-500 transition-transform",
                              expandedLog === log.query_id && "rotate-180"
                            )}
                          />
                        </motion.div>

                        <AnimatePresence>
                          {expandedLog === log.query_id && (
                            <QueryDetail log={log} onClose={() => setExpandedLog(null)} isFailed={isFailedLog(log)} exceptionQueryIds={exceptionQueryIds} />
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div >
    </div >
  );
}
