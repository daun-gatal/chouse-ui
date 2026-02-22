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
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores';
import { cn } from '@/lib/utils';
import type { LiveQuery } from '@/api/live-queries';

// ============================================
// Helper Functions
// ============================================

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(2)}B`;
    }
    if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2)}M`;
    }
    if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2)}K`;
    }
    return num.toString();
}

function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(0);
    return `${mins}m ${secs}s`;
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
    color: string;
}

function StatsCard({ icon: Icon, label, value, color }: StatsCardProps) {
    return (
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
                    <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
                    <p className={cn("text-xl font-bold", `text-${color}-300`)}>{value}</p>
                </div>
            </div>
        </motion.div>
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
        if (seconds < 5) return 'text-green-400';
        if (seconds < 30) return 'text-yellow-400';
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
                                        className="p-1 hover:bg-white/10 rounded transition-colors"
                                    >
                                        {copied ? (
                                            <Check className="w-3 h-3 text-green-400" />
                                        ) : (
                                            <Copy className="w-3 h-3 text-gray-500" />
                                        )}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>Copy Query ID</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <span className="text-gray-300">{query.query_id.slice(0, 8)}...</span>
                    </div>
                </TableCell>
                <TableCell>
                    <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-gray-300">
                            {query.rbac_user_display_name || query.rbac_user || query.user}
                        </span>
                    </div>
                </TableCell>
                <TableCell className="max-w-[300px]">
                    <div className="flex items-center gap-2">
                        {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        ) : (
                            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        )}
                        <code className="text-xs text-gray-300 truncate">
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
                    <span className="text-gray-300 text-sm">
                        {formatBytes(query.memory_usage)}
                    </span>
                </TableCell>
                <TableCell>
                    <span className="text-gray-300 text-sm">
                        {formatNumber(query.read_rows)}
                    </span>
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
                                            ? "text-red-400 hover:text-red-300 hover:bg-red-500/20"
                                            : "text-gray-600 cursor-not-allowed"
                                    )}
                                >
                                    {isKilling ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
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
                        <TableCell colSpan={7} className="p-0">
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                            >
                                <div className="p-4 bg-gray-800/50 border-t border-gray-700/50">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Terminal className="w-4 h-4 text-purple-400" />
                                        <span className="text-sm font-medium text-gray-300">Full Query</span>
                                    </div>
                                    <pre className="text-xs text-gray-300 bg-gray-900/50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                                        {query.query}
                                    </pre>
                                    <div className="mt-3 flex gap-4 text-xs text-gray-500">
                                        <span>Query ID: <code className="text-gray-400">{query.query_id}</code></span>
                                        <span>Client: <code className="text-gray-400">{query.client_name || 'Unknown'}</code></span>
                                        <span>Read Bytes: <code className="text-gray-400">{formatBytes(query.read_bytes)}</code></span>
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
        if (!searchQuery) return data.queries;

        const query = searchQuery.toLowerCase();
        return data.queries.filter(q =>
            q.query_id.toLowerCase().includes(query) ||
            q.user.toLowerCase().includes(query) ||
            q.query.toLowerCase().includes(query)
        );
    }, [data?.queries, searchQuery]);

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
            <div className="p-8 text-center">
                <div className="inline-flex items-center justify-center p-4 rounded-full bg-red-500/20 mb-4">
                    <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Failed to load live queries</h3>
                <p className="text-gray-400 mb-4">{error.message}</p>
                <Button onClick={() => refetch()} variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
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
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-amber-500/20">
                                <Zap className="w-5 h-5 text-amber-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-semibold text-white">Live Queries</h2>
                                <p className="text-sm text-gray-400">
                                    Real-time view of running ClickHouse queries
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatsCard
                        icon={Zap}
                        label="Active Queries"
                        value={stats.totalQueries}
                        color="amber"
                    />
                    <StatsCard
                        icon={Clock}
                        label="Longest Running"
                        value={stats.longestRunning > 0 ? formatDuration(stats.longestRunning) : '-'}
                        color="purple"
                    />
                    <StatsCard
                        icon={MemoryStick}
                        label="Total Memory"
                        value={formatBytes(stats.totalMemory)}
                        color="cyan"
                    />
                    <StatsCard
                        icon={Hash}
                        label="Rows Read"
                        value={formatNumber(stats.totalReadRows)}
                        color="green"
                    />
                </div>

                {/* Toolbar: Search + Controls */}
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <Input
                            placeholder="Search by query ID, user, or query text..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 bg-white/5 border-white/10 focus:border-amber-500/50 transition-colors"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Refresh Interval Selector */}
                        {!embedded && (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 whitespace-nowrap hidden sm:inline">Auto-refresh:</span>
                                <Select
                                    value={internalRefreshInterval.toString()}
                                    onValueChange={(v) => setInternalRefreshInterval(parseInt(v))}
                                >
                                    <SelectTrigger className="w-24 h-10 bg-white/5 border-white/10">
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
                                className="h-10 px-4 bg-white/5 border-white/10 hover:bg-white/10"
                            >
                                <RefreshCw className={cn(
                                    "w-4 h-4 mr-2",
                                    isFetching && "animate-spin"
                                )} />
                                Refresh
                            </Button>
                        )}
                    </div>
                </div>

                {/* Table */}
                <div className="flex-1 min-h-0 border border-gray-700/50 rounded-lg overflow-hidden">
                    {isLoading ? (
                        <div className="p-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-4" />
                            <p className="text-gray-400">Loading live queries...</p>
                        </div>
                    ) : filteredQueries.length === 0 ? (
                        <div className="p-12 text-center">
                            <div className="inline-flex items-center justify-center p-4 rounded-full bg-gray-800/50 mb-4">
                                <Database className="w-8 h-8 text-gray-500" />
                            </div>
                            <h3 className="text-lg font-semibold text-white mb-2">
                                {searchQuery ? 'No matching queries' : 'No running queries'}
                            </h3>
                            <p className="text-gray-400">
                                {searchQuery
                                    ? 'Try adjusting your search criteria'
                                    : 'There are currently no queries running on the active connection'}
                            </p>
                        </div>
                    ) : (
                        <ScrollArea className="h-full">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-800/50 hover:bg-gray-800/50">
                                        <TableHead className="text-gray-400 font-medium">Query ID</TableHead>
                                        <TableHead className="text-gray-400 font-medium">User</TableHead>
                                        <TableHead className="text-gray-400 font-medium">Query</TableHead>
                                        <TableHead className="text-gray-400 font-medium">Duration</TableHead>
                                        <TableHead className="text-gray-400 font-medium">Memory</TableHead>
                                        <TableHead className="text-gray-400 font-medium">Rows</TableHead>
                                        <TableHead className="text-gray-400 font-medium w-[80px]">Action</TableHead>
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
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                            <p className="text-sm text-red-300">
                                This action will immediately terminate the query execution.
                                Any partial results will be lost.
                            </p>
                        </div>
                        {queryToKill && (
                            <div className="text-xs text-gray-400">
                                Query ID: <code className="text-gray-300">{queryToKill}</code>
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
