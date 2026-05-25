/**
 * Live Queries Management Component
 * 
 * Displays running ClickHouse queries with the ability to kill them.
 * Restricted to super_admin and admin roles only.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Zap,
    RefreshCw,
    Loader2,
    Search,
    Skull,
    Clock,
    Database,
    MemoryStick,
    Hash,
    Copy,
    Check,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    User,
    Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    TooltipProvider,
} from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';
import { toast } from 'sonner';
import { useLiveQueries, useKillQuery, useLiveQueriesStats } from '@/hooks/useLiveQueries';
import { useBlockedTaskSummary } from '@/hooks/useMonitoringTimeline';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { cn } from '@/lib/utils';
import type { LiveQuery } from '@/api/live-queries';
import { SkeletonRows } from '@/components/common/Skeletons';

// ============================================
// Helper Functions
// ============================================

// Coerce ClickHouse JSON values (UInt64 often arrives as a string) into a
// finite number. Returns null when the value is unusable so callers can fall
// back to a placeholder instead of rendering "NaN" or "undefined".
function toFiniteNumber(input: unknown): number | null {
    const n = typeof input === 'number' ? input : Number(input);
    return Number.isFinite(n) ? n : null;
}

// Format a number to 2 decimals without ever switching to scientific notation
// for the typical UI range, but cleanly degrade to compact exponential when the
// upstream value is so large it'd otherwise overflow the layout.
function fixed2(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1e15) {
        // Numbers this large in the post-tiering result usually mean upstream
        // data is bogus (sums overflowing UInt64, etc). Keep the cell short.
        return n.toExponential(2);
    }
    return n.toFixed(2);
}

function formatBytes(bytes: unknown): string {
    const n = toFiniteNumber(bytes);
    if (n === null) return '—';
    if (n === 0) return '0 B';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(abs) / Math.log(k))));
    return `${sign}${fixed2(abs / Math.pow(k, i))} ${sizes[i]}`;
}

function formatNumber(num: unknown): string {
    const n = toFiniteNumber(num);
    if (n === null) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000_000_000) return `${sign}${fixed2(abs / 1_000_000_000_000_000)}Q`;
    if (abs >= 1_000_000_000_000) return `${sign}${fixed2(abs / 1_000_000_000_000)}T`;
    if (abs >= 1_000_000_000) return `${sign}${fixed2(abs / 1_000_000_000)}B`;
    if (abs >= 1_000_000) return `${sign}${fixed2(abs / 1_000_000)}M`;
    if (abs >= 1_000) return `${sign}${fixed2(abs / 1_000)}K`;
    return `${sign}${fixed2(abs)}`;
}

function formatDuration(seconds: unknown): string {
    const n = toFiniteNumber(seconds);
    if (n === null) return '—';
    if (n < 60) return `${fixed2(n)}s`;
    const mins = Math.floor(n / 60);
    const secs = fixed2(n % 60);
    return `${mins}m ${secs}s`;
}

// Convert microseconds of CPU time into something operators can scan quickly.
// 1.2s of CPU across 4 threads is more meaningful than "1,247,521" microseconds.
function formatCpuTime(microseconds: unknown): string {
    const n = toFiniteNumber(microseconds);
    if (n === null || n === 0) return '—';
    const ms = n / 1000;
    if (ms < 1) return `${n}µs`;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${(s % 60).toFixed(0)}s`;
}

function truncateQuery(query: string, maxLength: number = 100): string {
    if (query.length <= maxLength) return query;
    return query.substring(0, maxLength) + '...';
}

// ============================================
// Stats Card Component
// ============================================

interface StatsCardProps {
    icon: React.ElementType;
    label: string;
    value: string | number;
    color?: string; // accepted for API compatibility, not used in editorial layout
}

function StatsCard({ icon: Icon, label, value }: StatsCardProps) {
    return (
        <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
            <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                    {label}
                </span>
                <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
            </div>
            <span className="font-mono text-[20px] font-semibold leading-none text-paper">
                {value}
            </span>
        </div>
    );
}

// ============================================
// Server memory pressure strip — single-row "used / total · %" with a bar.
// Tile lights up amber/red as pressure climbs so it's spottable mid-scan.
// ============================================

function ServerMemoryStrip({
    used,
    total,
    pct,
}: {
    used: number;
    total: number;
    pct: number;
}) {
    const tone = pct >= 90 ? "danger" : pct >= 75 ? "warn" : "normal";
    const trackTone =
        tone === "danger"
            ? "bg-red-500/20"
            : tone === "warn"
                ? "bg-amber-500/15"
                : "bg-ink-300";
    const fillTone =
        tone === "danger"
            ? "bg-red-500"
            : tone === "warn"
                ? "bg-amber-500"
                : "bg-brand";
    const pctTone =
        tone === "danger"
            ? "text-red-700 dark:text-red-300"
            : tone === "warn"
                ? "text-amber-700 dark:text-amber-300"
                : "text-paper";

    return (
        <div className="flex items-center gap-4 rounded-xs border border-ink-500 bg-ink-100 px-4 py-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <MemoryStick className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col leading-tight">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                    Server memory · resident / total
                </span>
                <span className="font-mono text-[13px] text-paper">
                    {formatBytes(used)} <span className="text-paper-faint">/</span> {formatBytes(total)}
                </span>
            </div>
            <div className="ml-auto flex flex-1 items-center gap-3">
                <div className={cn("h-1.5 flex-1 overflow-hidden rounded-full", trackTone)}>
                    <div
                        className={cn("h-full rounded-full transition-all", fillTone)}
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <span className={cn("w-12 text-right font-mono text-[13px] tabular-nums", pctTone)}>
                    {pct}%
                </span>
            </div>
        </div>
    );
}

// ============================================
// Sortable column header — click to set the current sort key. Active key
// gets a chevron and brand-tinted label. No multi-direction toggle: every
// sort is "biggest at top" because that's what an operator chasing a hot
// query actually wants.
// ============================================

type SortKey = 'duration' | 'cpu' | 'memory' | 'rows';

function SortableTableHead({
    label,
    sortKey,
    current,
    onSort,
}: {
    label: string;
    sortKey: SortKey;
    current: SortKey;
    onSort: (k: SortKey) => void;
}) {
    const isActive = current === sortKey;
    return (
        <TableHead
            onClick={() => onSort(sortKey)}
            className={cn(
                "cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                isActive ? "text-brand" : "text-paper-faint hover:text-paper-muted"
            )}
        >
            <span className="inline-flex items-center gap-1">
                {label}
                {isActive && <ChevronDown className="h-3 w-3" aria-hidden />}
            </span>
        </TableHead>
    );
}

// ============================================
// Query Row Component
// ============================================

interface QueryRowProps {
    query: LiveQuery;
    onKill: (queryId: string) => void;
    canKill: boolean;
    isKilling: boolean;
}

function QueryRow({ query, onKill, canKill, isKilling }: QueryRowProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    const copyQueryId = useCallback(() => {
        navigator.clipboard.writeText(query.query_id);
        setCopied(true);
        toast.success('Query ID copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    }, [query.query_id]);

    const getDurationColor = (seconds: number) => {
        // Semantic latency tier — kept colored intentionally (performance signal)
        if (seconds < 5) return 'text-emerald-400';
        if (seconds < 30) return 'text-amber-400';
        return 'text-red-400';
    };

    return (
        <>
            <TableRow
                className={cn(
                    "hover:bg-white/5 transition-colors cursor-pointer",
                    isExpanded && "bg-white/5"
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            copyQueryId();
                                        }}
                                        className="p-1 hover:bg-ink-300 rounded transition-colors"
                                    >
                                        {copied ? (
                                            <Check className="w-3 h-3 text-emerald-500" />
                                        ) : (
                                            <Copy className="w-3 h-3 text-paper-faint" />
                                        )}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>Copy Query ID</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <span className="text-paper-muted">{query.query_id.slice(0, 8)}...</span>
                    </div>
                </TableCell>
                <TableCell>
                    <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-paper-faint" />
                        <span className="text-paper-muted">
                            {query.rbac_user_display_name || query.rbac_user || query.user}
                        </span>
                    </div>
                </TableCell>
                <TableCell className="max-w-[300px]">
                    <div className="flex items-center gap-2">
                        {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-paper-faint flex-shrink-0" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-paper-faint flex-shrink-0" />
                        )}
                        <code className="text-xs text-paper-muted truncate">
                            {truncateQuery(query.query)}
                        </code>
                    </div>
                </TableCell>
                <TableCell>
                    <Badge
                        variant="outline"
                        className={cn(
                            "font-mono border-none",
                            getDurationColor(query.elapsed_seconds)
                        )}
                    >
                        <Clock className="w-3 h-3 mr-1" />
                        {formatDuration(query.elapsed_seconds)}
                    </Badge>
                </TableCell>
                <TableCell>
                    <span className="text-paper-muted text-sm">
                        {formatBytes(query.memory_usage)}
                    </span>
                </TableCell>
                <TableCell>
                    <span className="text-paper-muted text-sm">
                        {formatNumber(query.read_rows)}
                    </span>
                </TableCell>
                <TableCell>
                    <div className="flex flex-col font-mono text-[12px] leading-tight">
                        <span className="text-paper">{formatCpuTime(query.cpu_time_microseconds)}</span>
                        {query.thread_count > 0 && (
                            <span className="text-[10px] text-paper-faint">{query.thread_count} thr</span>
                        )}
                    </div>
                </TableCell>
                <TableCell>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onKill(query.query_id);
                                    }}
                                    disabled={!canKill || isKilling}
                                    className={cn(
                                        "h-8 px-3",
                                        canKill
                                            ? "text-red-500 hover:text-red-600 hover:bg-red-500/15 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/20"
                                            : "text-paper-faint cursor-not-allowed"
                                    )}
                                >
                                    {isKilling ? (
                                        <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
                                    ) : (
                                        <Skull className="w-4 h-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {canKill ? 'Kill this query' : 'No permission to kill queries'}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </TableCell>
            </TableRow>

            {/* Expanded query details */}
            <AnimatePresence>
                {isExpanded && (
                    <TableRow>
                        <TableCell colSpan={8} className="p-0">
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                            >
                                <div className="p-4 bg-ink-200 border-t border-ink-500">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Terminal className="w-4 h-4 text-paper-muted" />
                                        <span className="text-sm font-medium text-paper-muted">Full Query</span>
                                    </div>
                                    <pre className="text-xs text-paper bg-ink-100 border border-ink-500 p-3 rounded-xs overflow-x-auto whitespace-pre-wrap">
                                        {query.query}
                                    </pre>
                                    <div className="mt-3 flex gap-4 text-xs text-paper-faint">
                                        <span>Query ID: <code className="text-paper-muted">{query.query_id}</code></span>
                                        <span>Client: <code className="text-paper-muted">{query.client_name || 'Unknown'}</code></span>
                                        <span>Read Bytes: <code className="text-paper-muted">{formatBytes(query.read_bytes)}</code></span>
                                    </div>
                                </div>
                            </motion.div>
                        </TableCell>
                    </TableRow>
                )}
            </AnimatePresence>
        </>
    );
}

// ============================================
// Main Component
// ============================================

const REFRESH_INTERVALS = [
    { value: 2000, label: '2s' },
    { value: 3000, label: '3s' },
    { value: 5000, label: '5s' },
    { value: 10000, label: '10s' },
];

interface LiveQueriesTableProps {
    embedded?: boolean;
    refreshKey?: number;
    autoRefresh?: boolean;
    onRefreshChange?: (isRefreshing: boolean) => void;
}

export default function LiveQueriesTable({
    embedded = false,
    refreshKey = 0,
    autoRefresh = false,
    onRefreshChange
}: LiveQueriesTableProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [internalRefreshInterval, setInternalRefreshInterval] = useState(3000);
    const [queryToKill, setQueryToKill] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'duration' | 'cpu' | 'memory' | 'rows'>('duration');

    // If embedded, use external autoRefresh (fixed to 3s when on) or 0 (off)
    // If not embedded, use internal selector
    const refreshInterval = embedded
        ? (autoRefresh ? 3000 : 0)
        : internalRefreshInterval;

    const { hasPermission, isSuperAdmin, user } = useRbacStore();
    const canGlobalKill = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_KILL_ALL);
    const canKillOwn = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_KILL);

    const { data, isLoading, error, refetch, isFetching } = useLiveQueries(refreshInterval);
    const killQuery = useKillQuery();
    const stats = useLiveQueriesStats(data);
    const { data: blockedSummary } = useBlockedTaskSummary();
    const serverMemoryUsed = blockedSummary?.server_memory_used_bytes ?? 0;
    const serverMemoryTotal = blockedSummary?.server_memory_total_bytes ?? 0;
    const serverMemoryPct = serverMemoryTotal > 0
        ? Math.min(100, Math.round((serverMemoryUsed / serverMemoryTotal) * 100))
        : 0;

    // Manual refresh effect
    useEffect(() => {
        if (refreshKey) {
            refetch();
        }
    }, [refreshKey, refetch]);

    // Notify parent of refresh status change
    useEffect(() => {
        onRefreshChange?.(isLoading || isFetching);
    }, [isLoading, isFetching, onRefreshChange]);

    // Filter queries based on search
    const filteredQueries = useMemo(() => {
        if (!data?.queries) return [];
        const filtered = !searchQuery
            ? data.queries
            : (() => {
                const query = searchQuery.toLowerCase();
                return data.queries.filter(q =>
                    q.query_id.toLowerCase().includes(query) ||
                    q.user.toLowerCase().includes(query) ||
                    q.query.toLowerCase().includes(query)
                );
            })();

        const sorted = [...filtered].sort((a, b) => {
            switch (sortBy) {
                case 'cpu':    return (b.cpu_time_microseconds || 0) - (a.cpu_time_microseconds || 0);
                case 'memory': return (b.memory_usage || 0) - (a.memory_usage || 0);
                case 'rows':   return (b.read_rows || 0) - (a.read_rows || 0);
                default:       return (b.elapsed_seconds || 0) - (a.elapsed_seconds || 0);
            }
        });
        return sorted;
    }, [data?.queries, searchQuery, sortBy]);

    const handleKillQuery = useCallback((queryId: string) => {
        setQueryToKill(queryId);
    }, []);

    const confirmKillQuery = useCallback(async () => {
        if (!queryToKill) return;

        try {
            await killQuery.mutateAsync(queryToKill);
            setQueryToKill(null);
        } catch {
            // Error is handled by the mutation
        }
    }, [queryToKill, killQuery]);

    // Determine if a specific query can be killed by the current user
    const canKillQuery = useCallback((query: LiveQuery) => {
        if (canGlobalKill) return true;
        if (canKillOwn && user && query.rbac_user_id === user.id) return true;
        return false;
    }, [canGlobalKill, canKillOwn, user]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <div className="mb-4 grid h-12 w-12 place-items-center rounded-xs border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                    <AlertCircle className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mb-2 text-[15px] font-semibold text-paper">Failed to load live queries</h3>
                <p className="mb-4 text-[13px] text-paper-muted">{error.message}</p>
                <Button onClick={() => refetch()} variant="outline" className="rounded-xs border-ink-500 bg-transparent text-paper hover:border-ink-700 hover:bg-ink-200">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className={cn("h-full flex flex-col overflow-hidden", embedded ? "p-4" : "p-6")}>
            <div className="flex-1 flex flex-col gap-6 min-h-0">
                {/* Header - hidden when embedded */}
                {!embedded && (
                    <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                            <Zap className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                                Observability
                            </span>
                            <h2 className="text-[18px] font-semibold tracking-tight text-paper">Live queries</h2>
                        </div>
                    </div>
                )}

                {/* Server memory pressure — context for the per-query totals
                    below so you can tell whether 26 GB of queries is half the
                    box or eating all of it. Detailed breakdown lives on
                    Metrics → System (this page stays focused on per-query
                    state). */}
                {serverMemoryTotal > 0 && (
                    <ServerMemoryStrip
                        used={serverMemoryUsed}
                        total={serverMemoryTotal}
                        pct={serverMemoryPct}
                    />
                )}

                {/* Stats grid — editorial hairline */}
                <div className="grid grid-cols-2 border-l border-t border-ink-500 md:grid-cols-4">
                    <StatsCard
                        icon={Zap}
                        label="Active queries"
                        value={stats.totalQueries}
                    />
                    <StatsCard
                        icon={Clock}
                        label="Longest running"
                        value={stats.longestRunning > 0 ? formatDuration(stats.longestRunning) : '-'}
                    />
                    <StatsCard
                        icon={MemoryStick}
                        label="Total memory"
                        value={formatBytes(stats.totalMemory)}
                    />
                    <StatsCard
                        icon={Hash}
                        label="Rows read"
                        value={formatNumber(stats.totalReadRows)}
                    />
                </div>

                {/* Toolbar: Search + Controls */}
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-paper-faint" />
                        <Input
                            placeholder="Search by query ID, user, or query text…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-10 rounded-xs border-ink-500 bg-ink-100 pl-10 font-mono text-[13px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Refresh Interval Selector */}
                        {!embedded && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-paper-faint whitespace-nowrap hidden sm:inline">Auto-refresh:</span>
                                <Select
                                    value={internalRefreshInterval.toString()}
                                    onValueChange={(v) => setInternalRefreshInterval(parseInt(v))}
                                >
                                    <SelectTrigger className="w-24 h-10 rounded-xs border-ink-500 bg-ink-100 font-mono text-[12px] text-paper">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {REFRESH_INTERVALS.map((interval) => (
                                            <SelectItem key={interval.value} value={interval.value.toString()}>
                                                {interval.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Manual Refresh */}
                        {!embedded && (
                            <Button
                                variant="outline"
                                onClick={() => refetch()}
                                disabled={isFetching}
                                className="h-10 rounded-xs border-ink-500 bg-ink-100 px-4 text-paper hover:border-ink-700 hover:bg-ink-200"
                            >
                                <RefreshCw className={cn(
                                    "w-4 h-4 mr-2",
                                    isFetching && "motion-safe:animate-spin"
                                )} />
                                Refresh
                            </Button>
                        )}
                    </div>
                </div>

                {/* Table */}
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                    {isLoading ? (
                        <table className="w-full">
                            <tbody>
                                <SkeletonRows count={6} cols={5} />
                            </tbody>
                        </table>
                    ) : filteredQueries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-16 text-center">
                            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
                                <Database className="h-5 w-5" aria-hidden />
                            </div>
                            <h3 className="mb-2 text-[15px] font-semibold text-paper">
                                {searchQuery ? 'No matching queries' : 'No running queries'}
                            </h3>
                            <p className="text-[13px] text-paper-muted">
                                {searchQuery
                                    ? 'Try adjusting your search criteria.'
                                    : 'There are currently no queries running on the active connection.'}
                            </p>
                        </div>
                    ) : (
                        <ScrollArea className="h-full">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-b-ink-500 bg-ink-200 hover:bg-ink-200">
                                        <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Query ID</TableHead>
                                        <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">User</TableHead>
                                        <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Query</TableHead>
                                        <SortableTableHead label="Duration" sortKey="duration" current={sortBy} onSort={setSortBy} />
                                        <SortableTableHead label="Memory" sortKey="memory" current={sortBy} onSort={setSortBy} />
                                        <SortableTableHead label="Rows" sortKey="rows" current={sortBy} onSort={setSortBy} />
                                        <SortableTableHead label="CPU" sortKey="cpu" current={sortBy} onSort={setSortBy} />
                                        <TableHead className="w-[80px] font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredQueries.map((query) => (
                                        <QueryRow
                                            key={query.query_id}
                                            query={query}
                                            onKill={handleKillQuery}
                                            canKill={canKillQuery(query)}
                                            isKilling={killQuery.isPending && queryToKill === query.query_id}
                                        />
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    )}
                </div>
            </div>

            {/* Kill Confirmation Dialog */}
            <ConfirmationDialog
                isOpen={!!queryToKill}
                onClose={() => setQueryToKill(null)}
                onConfirm={confirmKillQuery}
                title="Kill Query"
                description={
                    <div className="space-y-3">
                        <p>Are you sure you want to kill this query?</p>
                        <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-3">
                            <p className="text-[13px] text-red-300">
                                This action will immediately terminate the query execution.
                                Any partial results will be lost.
                            </p>
                        </div>
                        {queryToKill && (
                            <div className="text-xs text-paper-faint">
                                Query ID: <code className="text-paper-muted">{queryToKill}</code>
                            </div>
                        )}
                    </div>
                }
                variant="danger"
                confirmText="Kill Query"
                isLoading={killQuery.isPending}
            />
        </div >
    );
}
