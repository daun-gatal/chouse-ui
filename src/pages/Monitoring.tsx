import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  InfoIcon,
  Activity,
  FileText,
  Zap,
  BarChart3,
  Layers,
  Stethoscope,
  Network,
  type LucideIcon,
} from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import { Button } from "@/components/ui/button";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { cn } from "@/lib/utils";
import { DataControls } from "@/components/common/DataControls";

import LogsPage from "./Logs";
import MetricsPage from "./Metrics";
import LiveQueriesTable from "./LiveQueries";
import PartsPage from "./Parts";
import SchemaDoctorPage from "./SchemaDoctor";
import ClusterActivityPage from "./ClusterActivity";

interface TabConfig {
  icon: LucideIcon;
  label: string;
  description: string;
  liveBadge?: boolean;
}

const TAB_CONFIG: Record<TabKey, TabConfig> = {
  "live-queries": {
    icon: Zap,
    label: "Live queries",
    description: "Real-time running queries",
    liveBadge: true,
  },
  logs: {
    icon: FileText,
    label: "Query logs",
    description: "Historical query records",
  },
  metrics: {
    icon: BarChart3,
    label: "Metrics",
    description: "Performance analytics",
  },
  parts: {
    icon: Layers,
    label: "Parts",
    description: "Merges, mutations & part movements",
  },
  schema: {
    icon: Stethoscope,
    label: "Schema doctor",
    description: "Nullable & oversized column lints",
  },
  cluster: {
    icon: Network,
    label: "Cluster activity",
    description: "Mutations & replication queue",
  },
};

type TabKey =
  | "live-queries"
  | "logs"
  | "metrics"
  | "parts"
  | "schema"
  | "cluster";

interface TabCardProps {
  tabKey: TabKey;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function TabCard({ tabKey, isActive, onClick, disabled }: TabCardProps) {
  const config = TAB_CONFIG[tabKey];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      className={cn(
        "group relative flex min-w-[200px] items-start gap-3 border border-ink-500 px-4 py-3 text-left transition-colors",
        "rounded-xs",
        isActive
          ? "border-ink-700 bg-ink-200 text-paper"
          : "bg-ink-100 text-paper-muted hover:border-ink-700 hover:bg-ink-200 hover:text-paper",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-xs border transition-colors",
          isActive
            ? "border-brand bg-ink-100 text-brand"
            : "border-ink-500 bg-ink-200 text-paper-muted group-hover:border-ink-700"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[13px] font-semibold",
              isActive ? "text-paper" : "text-paper-muted group-hover:text-paper"
            )}
          >
            {config.label}
          </span>
          {config.liveBadge && (
            <span className="inline-flex items-center gap-1.5 rounded-xs border border-red-900/60 bg-red-950/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.16em] text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" aria-hidden />
              Live
            </span>
          )}
        </div>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {config.description}
        </span>
      </div>
    </button>
  );
}

export default function Monitoring() {
  const { hasPermission, hasAnyPermission } = useRbacStore();
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const canViewLiveQueries = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_VIEW);
  const canViewLogs = hasAnyPermission([
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW,
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
  ]);
  const canViewMetrics = hasAnyPermission([
    RBAC_PERMISSIONS.METRICS_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
  ]);
  const canViewParts = canViewMetrics;
  const canViewSchema = canViewMetrics;
  const canViewCluster = canViewMetrics;

  const availableTabs: TabKey[] = [
    ...(canViewLogs ? (["logs"] as TabKey[]) : []),
    ...(canViewMetrics ? (["metrics"] as TabKey[]) : []),
    ...(canViewParts ? (["parts"] as TabKey[]) : []),
    ...(canViewSchema ? (["schema"] as TabKey[]) : []),
    ...(canViewCluster ? (["cluster"] as TabKey[]) : []),
    ...(canViewLiveQueries ? (["live-queries"] as TabKey[]) : []),
  ];

  const getInitialTab = (): TabKey => {
    if (tab && availableTabs.includes(tab as TabKey)) {
      return tab as TabKey;
    }
    return availableTabs[0] || "live-queries";
  };

  const activeTab = getInitialTab();

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
    setRefreshKey((prev) => prev + 1);
    setLastUpdated(new Date().toLocaleTimeString());
  };

  const handleAutoRefreshChange = (value: boolean) => {
    setAutoRefresh(value);
  };

  useEffect(() => {
    if (activeTab === "live-queries") {
      setAutoRefresh(true);
    } else {
      setAutoRefresh(false);
    }
  }, [activeTab]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50">
      {/* ─── Header ─── */}
      <header className="flex-none border-b border-ink-500 px-6 pb-4 pt-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <Activity className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span>Observability</span>
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-paper">Monitoring</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DataControls
              lastUpdated={lastUpdated}
              isRefreshing={isRefreshing}
              onRefresh={handleRefresh}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={handleAutoRefreshChange}
              showTimeRange={activeTab === "metrics"}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsInfoOpen(true)}
              className="h-9 w-9 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
              aria-label="About monitoring"
            >
              <InfoIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tab cards */}
        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-0.5">
          {availableTabs.map((tabKey) => (
            <TabCard
              key={tabKey}
              tabKey={tabKey}
              isActive={activeTab === tabKey}
              onClick={() => navigate(`/monitoring/${tabKey}`)}
            />
          ))}
        </div>
      </header>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-hidden p-6">
        {activeTab === "live-queries" && canViewLiveQueries && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <LiveQueriesTable
              embedded
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "logs" && canViewLogs && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <LogsPage
              embedded
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "metrics" && canViewMetrics && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <MetricsPage
              embedded
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              timeRange={timeRange}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "parts" && canViewParts && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <PartsPage
              embedded
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "schema" && canViewSchema && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <SchemaDoctorPage
              embedded
              refreshKey={refreshKey}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "cluster" && canViewCluster && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <ClusterActivityPage
              embedded
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}
      </div>

      {/* Info dialog */}
      <InfoDialog
        title="Monitoring dashboard"
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        variant="info"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-paper-muted">
            Monitor your ClickHouse database in real-time with comprehensive insights.
          </p>

          <div className="flex flex-col gap-2">
            {(Object.entries(TAB_CONFIG) as [TabKey, TabConfig][]).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <div
                  key={key}
                  className="flex items-start gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium text-paper">{config.label}</span>
                    <span className="text-[12px] text-paper-muted">
                      {key === "live-queries" && "View and terminate running queries in real-time."}
                      {key === "logs" && "Browse historical query logs and execution history."}
                      {key === "metrics" && "Analyze system performance and resource usage."}
                      {key === "parts" && "Track MergeTree merges, mutations, downloads, and removals."}
                      {key === "schema" && "Lint columns for needless Nullable wrappers and oversized integers."}
                      {key === "cluster" && "Track in-flight ALTER mutations and the per-replica replication queue."}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-3 rounded-xs border border-brand/30 bg-brand/[0.04] p-3">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand">
                Pro tip
              </span>
              <p className="text-[12px] text-paper-muted">
                Use the Live queries tab to monitor long-running queries and terminate problematic
                ones before they impact system performance.
              </p>
            </div>
          </div>
        </div>
      </InfoDialog>
    </div>
  );
}
