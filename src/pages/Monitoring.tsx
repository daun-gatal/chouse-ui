import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  InfoIcon,
  Activity,
  FileText,
  Zap,
  BarChart3,
  Layers,
  TableProperties,
  Network,
  ShieldAlert,
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
import NoPermission from "@/components/common/NoPermission";
import ClusterActivityPage from "./ClusterActivity";
import ErrorsPage from "./Errors";

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
    icon: TableProperties,
    label: "Schema advisor",
    description: "Nullable & oversized column lints",
  },
  cluster: {
    icon: Network,
    label: "Cluster",
    description: "Replication, mutations, topology, insert backlog & DDL",
  },
  errors: {
    icon: ShieldAlert,
    label: "Errors",
    description: "Error counters & crashes",
  },
};

type TabKey =
  | "live-queries"
  | "logs"
  | "metrics"
  | "parts"
  | "schema"
  | "cluster"
  | "errors";

interface TabPillProps {
  tabKey: TabKey;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Compact horizontal tab — icon + label + optional Live badge. Active row
 * grows a brand underline. Mirrors the in-page sub-tab style (Queries /
 * Patterns / By table / Histogram) so the navigation feels unified.
 */
function TabPill({ tabKey, isActive, onClick, disabled }: TabPillProps) {
  const config = TAB_CONFIG[tabKey];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative inline-flex h-9 items-center gap-2 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        isActive ? "text-paper" : "text-paper-muted hover:text-paper",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          isActive ? "text-brand" : "text-paper-dim group-hover:text-paper"
        )}
        aria-hidden
      />
      <span>{config.label}</span>
      {config.liveBadge && (
        <span className="inline-flex items-center gap-1 rounded-xs border border-red-300 bg-red-50 px-1 py-px font-mono text-[8px] uppercase tracking-[0.16em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span
            className="h-1 w-1 rounded-full bg-red-500 motion-safe:animate-pulse dark:bg-red-400"
            aria-hidden
          />
          Live
        </span>
      )}
      {isActive && (
        <span
          className="absolute -bottom-px left-0 right-0 h-px bg-brand"
          aria-hidden
        />
      )}
    </button>
  );
}

export default function Monitoring() {
  const { hasPermission, hasAnyPermission } = useRbacStore();
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const canViewLiveQueries = hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_VIEW);
  const canViewLogs = hasPermission(RBAC_PERMISSIONS.LOGS_VIEW);
  const canViewMetrics = hasAnyPermission([
    RBAC_PERMISSIONS.METRICS_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
  ]);
  const canViewParts = hasPermission(RBAC_PERMISSIONS.PARTS_VIEW);
  const canViewSchema = hasPermission(RBAC_PERMISSIONS.SCHEMA_ADVISOR_VIEW);
  const canViewCluster = hasPermission(RBAC_PERMISSIONS.CLUSTER_VIEW);
  const canViewErrors = hasPermission(RBAC_PERMISSIONS.ERRORS_VIEW);

  const availableTabs: TabKey[] = [
    ...(canViewLogs ? (["logs"] as TabKey[]) : []),
    ...(canViewMetrics ? (["metrics"] as TabKey[]) : []),
    ...(canViewParts ? (["parts"] as TabKey[]) : []),
    ...(canViewSchema ? (["schema"] as TabKey[]) : []),
    ...(canViewCluster ? (["cluster"] as TabKey[]) : []),
    ...(canViewErrors ? (["errors"] as TabKey[]) : []),
    ...(canViewLiveQueries ? (["live-queries"] as TabKey[]) : []),
  ];

  const allTabKeys = Object.keys(TAB_CONFIG) as TabKey[];
  // A real tab the user isn't allowed to see → show a "no permission" message
  // rather than silently bouncing them to another tab.
  const deniedTab =
    tab != null && allTabKeys.includes(tab as TabKey) && !availableTabs.includes(tab as TabKey);

  const getInitialTab = (): TabKey => {
    if (tab && availableTabs.includes(tab as TabKey)) {
      return tab as TabKey;
    }
    return availableTabs[0] || "live-queries";
  };

  const activeTab = getInitialTab();

  useEffect(() => {
    if (!deniedTab && (!tab || !availableTabs.includes(tab as TabKey))) {
      const firstAvailable = availableTabs[0];
      if (firstAvailable) {
        navigate(`/monitoring/${firstAvailable}`, { replace: true });
      }
    }
  }, [tab, deniedTab, availableTabs, navigate]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
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
      {/* ─── Header — compact: title + tabs + controls share one row ─── */}
      <header className="flex-none border-b border-ink-500 px-6 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-0">
          <div className="flex items-center gap-3 pb-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <Activity className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col gap-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                Observability
              </span>
              <h1 className="text-[18px] font-semibold leading-tight tracking-tight text-paper">
                Monitoring
              </h1>
            </div>
          </div>

          {/* Tab pills — horizontal, single line, underline active */}
          <nav
            aria-label="Monitoring sections"
            className="scrollbar-hide -mb-px flex items-center overflow-x-auto"
          >
            {availableTabs.map((tabKey) => (
              <TabPill
                key={tabKey}
                tabKey={tabKey}
                isActive={activeTab === tabKey}
                onClick={() => navigate(`/monitoring/${tabKey}`)}
              />
            ))}
          </nav>

          <div className="flex items-center gap-2 pb-2">
            <DataControls
              lastUpdated={lastUpdated}
              isRefreshing={isRefreshing}
              onRefresh={handleRefresh}
              autoRefresh={autoRefresh}
              onAutoRefreshChange={handleAutoRefreshChange}
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
      </header>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-hidden p-4">
        {deniedTab ? (
          <NoPermission inline feature={TAB_CONFIG[tab as TabKey].label} />
        ) : (
          <>
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

        {activeTab === "errors" && canViewErrors && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <ErrorsPage
              embedded
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}
          </>
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
                      {key === "cluster" && "Replication queue & mutations, plus cluster topology, Distributed insert backlog, and the ON CLUSTER DDL queue."}
                      {key === "errors" && "Server-wide error counters from system.errors and any crashes from system.crash_log."}
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
