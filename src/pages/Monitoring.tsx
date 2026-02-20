import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    InfoIcon,
    Activity,
    FileText,
    Zap,
    BarChart3,
    Radio,
} from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { motion, AnimatePresence } from "framer-motion";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DataControls } from "@/components/common/DataControls";

// Import the actual page components
import LogsPage from "./Logs";
import MetricsPage from "./Metrics";
import LiveQueriesTable from "./LiveQueries";

// Tab configuration with metadata
const TAB_CONFIG = {
    "live-queries": {
        icon: Zap,
        label: "Live Queries",
        description: "Real-time running queries",
        color: "amber",
        gradient: "from-amber-500 to-orange-600",
        bgGlow: "bg-amber-500/10",
        borderColor: "border-amber-500/30",
        textColor: "text-amber-300",
        badge: "Live",
        badgeColor: "bg-red-500",
    },
    "logs": {
        icon: FileText,
        label: "Query Logs",
        description: "Historical query records",
        color: "purple",
        gradient: "from-purple-500 to-pink-600",
        bgGlow: "bg-purple-500/10",
        borderColor: "border-purple-500/30",
        textColor: "text-purple-300",
        badge: null,
        badgeColor: "",
    },
    "metrics": {
        icon: BarChart3,
        label: "Metrics",
        description: "Performance analytics",
        color: "cyan",
        gradient: "from-cyan-500 to-blue-600",
        bgGlow: "bg-cyan-500/10",
        borderColor: "border-cyan-500/30",
        textColor: "text-cyan-300",
        badge: null,
        badgeColor: "",
    },
} as const;

type TabKey = keyof typeof TAB_CONFIG;

// Custom Tab Card Component
function TabCard({
    tabKey,
    isActive,
    onClick,
    disabled = false,
}: {
    tabKey: TabKey;
    isActive: boolean;
    onClick: () => void;
    disabled?: boolean;
}) {
    const config = TAB_CONFIG[tabKey];
    const Icon = config.icon;

    return (
        <motion.button
            onClick={onClick}
            disabled={disabled}
            whileHover={{ scale: disabled ? 1 : 1.02 }}
            whileTap={{ scale: disabled ? 1 : 0.98 }}
            className={cn(
                "relative flex flex-col items-start p-4 rounded-xl border transition-all duration-300 text-left min-w-[180px]",
                isActive ? [
                    config.bgGlow,
                    config.borderColor,
                    "shadow-lg",
                ] : [
                    "bg-white/5",
                    "border-white/10",
                    "hover:bg-white/10",
                    "hover:border-white/20",
                ],
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            {/* Active indicator glow */}
            {isActive && (
                <motion.div
                    layoutId="activeTabGlow"
                    className={cn(
                        "absolute inset-0 rounded-xl",
                        config.bgGlow,
                        "opacity-50 blur-sm"
                    )}
                    transition={{ type: "spring", duration: 0.4 }}
                />
            )}

            <div className="relative z-10 flex items-center gap-3 w-full">
                <div className={cn(
                    "p-2 rounded-lg",
                    isActive ? `bg-gradient-to-br ${config.gradient}` : "bg-white/10"
                )}>
                    <Icon className={cn(
                        "w-5 h-5",
                        isActive ? "text-white" : "text-gray-400"
                    )} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "font-semibold text-sm",
                            isActive ? "text-white" : "text-gray-300"
                        )}>
                            {config.label}
                        </span>
                        {config.badge && (
                            <span className={cn(
                                "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase",
                                config.badgeColor,
                                "text-white animate-pulse"
                            )}>
                                <Radio className="w-2 h-2" />
                                {config.badge}
                            </span>
                        )}
                    </div>
                    <p className={cn(
                        "text-xs truncate",
                        isActive ? config.textColor : "text-gray-500"
                    )}>
                        {config.description}
                    </p>
                </div>
            </div>

            {/* Active indicator line */}
            {isActive && (
                <motion.div
                    layoutId="activeTabLine"
                    className={cn(
                        "absolute bottom-0 left-4 right-4 h-0.5 rounded-full",
                        `bg-gradient-to-r ${config.gradient}`
                    )}
                    transition={{ type: "spring", duration: 0.4 }}
                />
            )}
        </motion.button>
    );
}

export default function Monitoring() {
    const { hasPermission, hasAnyPermission } = useRbacStore();
    const { tab } = useParams<{ tab: string }>();
    const navigate = useNavigate();
    const [isInfoOpen, setIsInfoOpen] = useState(false);

    // Permission checks for tabs
    const canViewLiveQueries = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_VIEW);
    const canViewLogs = hasAnyPermission([
        RBAC_PERMISSIONS.QUERY_HISTORY_VIEW,
        RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
    ]);
    const canViewMetrics = hasAnyPermission([
        RBAC_PERMISSIONS.METRICS_VIEW,
        RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
    ]);

    // Tab keys in priority order: logs, metrics, then live-queries
    const availableTabs = [
        ...(canViewLogs ? ["logs" as const] : []),
        ...(canViewMetrics ? ["metrics" as const] : []),
        ...(canViewLiveQueries ? ["live-queries" as const] : []),
    ];

    // Get initial tab from URL or default based on permissions
    const getInitialTab = (): TabKey => {
        if (tab && availableTabs.includes(tab as TabKey)) {
            return tab as TabKey;
        }
        return availableTabs[0] || "live-queries";
    };

    const activeTab = getInitialTab();

    // Ensure user is redirected if permissions change, they land on a forbidden tab, or no tab is provided
    useEffect(() => {
        if (!tab || !availableTabs.includes(tab as TabKey)) {
            const firstAvailable = availableTabs[0];
            if (firstAvailable) {
                navigate(`/monitoring/${firstAvailable}`, { replace: true });
            }
        }
    }, [tab, availableTabs, navigate]);

    const [refreshKey, setRefreshKey] = useState(0);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [timeRange, setTimeRange] = useState("1h");
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString());

    const handleRefresh = () => {
        setRefreshKey(prev => prev + 1);
        setLastUpdated(new Date().toLocaleTimeString());
    };

    const handleAutoRefreshChange = (value: boolean) => {
        setAutoRefresh(value);
    };

    // Enable auto-refresh when switching to Live Queries
    useEffect(() => {
        if (activeTab === "live-queries") {
            setAutoRefresh(true);
        } else {
            setAutoRefresh(false);
        }
    }, [activeTab]);

    // (This useEffect block was removed since we use params exclusively now)

    const currentTabConfig = TAB_CONFIG[activeTab];

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="shrink-0 px-6 pt-6 pb-4"
            >
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <div className={cn(
                                "p-3 rounded-2xl shadow-lg",
                                `bg-gradient-to-br ${currentTabConfig.gradient}`,
                                `shadow-${currentTabConfig.color}-500/30`
                            )}>
                                <Activity className="w-7 h-7 text-white" />
                            </div>
                            {/* Animated glow ring */}
                            <div className={cn(
                                "absolute inset-0 rounded-2xl animate-ping opacity-20",
                                `bg-${currentTabConfig.color}-500`
                            )} style={{ animationDuration: "2s" }} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-white">
                                Monitoring
                            </h1>
                            <p className="text-gray-400 text-sm mt-0.5">
                                System monitoring and query performance insights
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <DataControls
                            lastUpdated={lastUpdated}
                            isRefreshing={isRefreshing}
                            onRefresh={handleRefresh}
                            autoRefresh={autoRefresh}
                            onAutoRefreshChange={handleAutoRefreshChange}
                            showTimeRange={activeTab === "metrics"} // Only show for Metrics tab
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                        />

                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsInfoOpen(true)}
                            className="text-gray-400 hover:text-white hover:bg-white/10"
                        >
                            <InfoIcon className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                {/* Tab Navigation Cards */}
                <div className="flex gap-3 overflow-x-auto px-1 pt-2 pb-2 scrollbar-hide">
                    {availableTabs.map((tabKey) => (
                        <TabCard
                            key={tabKey}
                            tabKey={tabKey}
                            isActive={activeTab === tabKey}
                            onClick={() => navigate(`/monitoring/${tabKey}`)}
                        />
                    ))}
                </div>
            </motion.div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden px-6 pb-6">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="h-full"
                    >
                        {activeTab === "live-queries" && canViewLiveQueries && (
                            <div className="h-full overflow-hidden rounded-xl bg-white/5 border border-white/10">
                                <LiveQueriesTable
                                    embedded
                                    refreshKey={refreshKey}
                                    autoRefresh={autoRefresh}
                                    onRefreshChange={setIsRefreshing}
                                />
                            </div>
                        )}

                        {activeTab === "logs" && canViewLogs && (
                            <div className="h-full overflow-hidden rounded-xl bg-white/5 border border-white/10">
                                <LogsPage
                                    embedded
                                    refreshKey={refreshKey}
                                    autoRefresh={autoRefresh}
                                    onRefreshChange={setIsRefreshing}
                                />
                            </div>
                        )}

                        {activeTab === "metrics" && canViewMetrics && (
                            <div className="h-full overflow-hidden rounded-xl bg-white/5 border border-white/10">
                                <MetricsPage
                                    embedded
                                    refreshKey={refreshKey}
                                    autoRefresh={autoRefresh}
                                    timeRange={timeRange}
                                    onRefreshChange={setIsRefreshing}
                                />
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Info Dialog */}
            <InfoDialog
                title="Monitoring Dashboard"
                isOpen={isInfoOpen}
                onClose={() => setIsInfoOpen(false)}
                variant="info"
            >
                <div className="flex flex-col gap-4">
                    <p className="text-gray-300">
                        Monitor your ClickHouse database in real-time with comprehensive insights.
                    </p>

                    <div className="space-y-3">
                        {Object.entries(TAB_CONFIG).map(([key, config]) => (
                            <div
                                key={key}
                                className={cn(
                                    "flex items-start gap-3 p-3 rounded-lg",
                                    config.bgGlow,
                                    "border",
                                    config.borderColor
                                )}
                            >
                                <div className={cn(
                                    "p-2 rounded-lg shrink-0",
                                    `bg-gradient-to-br ${config.gradient}`
                                )}>
                                    <config.icon className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-white text-sm">{config.label}</h4>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {key === "live-queries" && "View and terminate running queries in real-time"}
                                        {key === "logs" && "Browse historical query logs and execution history"}
                                        {key === "metrics" && "Analyze system performance and resource usage"}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="p-3 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
                        <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
                            <Zap className="w-4 h-4" />
                            Pro Tip
                        </div>
                        <p className="text-xs text-amber-200/80 mt-1">
                            Use the Live Queries tab to monitor long-running queries and terminate
                            problematic ones before they impact system performance.
                        </p>
                    </div>
                </div>
            </InfoDialog>
        </div>
    );
}
