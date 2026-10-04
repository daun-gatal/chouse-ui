import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
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
  TrendingUp,
  HardDrive,
  ArrowUpCircle,
  type LucideIcon,
} from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import { Button } from "@/components/ui/button";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { DataControls } from "@/components/common/DataControls";
import { NavPill, PageHeader } from "@/components/common/PageShell";

import LogsPage from "./Logs";
import MetricsPage from "./Metrics";
import LiveQueriesTable from "./LiveQueries";
import PartsPage from "./Parts";
import SchemaDoctorPage from "./SchemaDoctor";
import NoPermission from "@/components/common/NoPermission";
import ClusterActivityPage from "./ClusterActivity";
import ErrorsPage from "./Errors";
import { PerformanceView } from "@/features/observe/PerformanceView";
import { CapacityView } from "@/features/observe/CapacityView";
import { UpgradesView } from "@/features/observe/UpgradesView";

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
  performance: {
    icon: TrendingUp,
    label: "Performance",
    description: "Regressions against each query's own baseline",
  },
  capacity: {
    icon: HardDrive,
    label: "Capacity",
    description: "Disk forecasts, growth, codecs & cost",
  },
  upgrades: {
    icon: ArrowUpCircle,
    label: "Upgrades",
    description: "Readiness, canary replay & rollout",
  },
};

type TabKey =
  | "live-queries"
  | "logs"
  | "metrics"
  | "parts"
  | "schema"
  | "cluster"
  | "errors"
  | "performance"
  | "capacity"
  | "upgrades";

export default function Monitoring() {
  const { hasPermission, hasAnyPermission } = useRbacStore();
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onboardingView = searchParams.get("guide") ?? undefined;
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
  const canViewPerformance = hasPermission(RBAC_PERMISSIONS.PERFORMANCE_VIEW);
  const canViewCapacity = hasPermission(RBAC_PERMISSIONS.CAPACITY_VIEW);
  const canViewUpgrades = hasPermission(RBAC_PERMISSIONS.UPGRADES_VIEW);

  const availableTabs: TabKey[] = [
    ...(canViewLogs ? (["logs"] as TabKey[]) : []),
    ...(canViewMetrics ? (["metrics"] as TabKey[]) : []),
    ...(canViewParts ? (["parts"] as TabKey[]) : []),
    ...(canViewSchema ? (["schema"] as TabKey[]) : []),
    ...(canViewCluster ? (["cluster"] as TabKey[]) : []),
    ...(canViewErrors ? (["errors"] as TabKey[]) : []),
    ...(canViewLiveQueries ? (["live-queries"] as TabKey[]) : []),
    ...(canViewPerformance ? (["performance"] as TabKey[]) : []),
    ...(canViewCapacity ? (["capacity"] as TabKey[]) : []),
    ...(canViewUpgrades ? (["upgrades"] as TabKey[]) : []),
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50" data-onboarding-id="monitoring-page">
      {/* ─── Header — compact: title + tabs + controls share one row ─── */}
      <PageHeader
        icon={Activity}
        eyebrow="Observability"
        title="Monitoring"
        navLabel="Monitoring sections"
        nav={availableTabs.map((tabKey) => (
          <NavPill
            key={tabKey}
            icon={TAB_CONFIG[tabKey].icon}
            label={TAB_CONFIG[tabKey].label}
            liveBadge={TAB_CONFIG[tabKey].liveBadge}
            onboardingId={`monitoring-section-${tabKey}`}
            isActive={activeTab === tabKey}
            onClick={() => navigate(`/monitoring/${tabKey}`)}
            noShrink
          />
        ))}
        actions={
          <>
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
          </>
        }
      />

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-hidden p-4" data-onboarding-id="monitoring-content">
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
              onboardingView={onboardingView}
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
              onboardingView={onboardingView}
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
              onboardingView={onboardingView}
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
              onboardingView={onboardingView}
              refreshKey={refreshKey}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "cluster" && canViewCluster && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <ClusterActivityPage
              embedded
              onboardingView={onboardingView}
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
              onboardingView={onboardingView}
              refreshKey={refreshKey}
              autoRefresh={autoRefresh}
              onRefreshChange={setIsRefreshing}
            />
          </div>
        )}

        {activeTab === "performance" && canViewPerformance && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <PerformanceView refreshKey={refreshKey} />
          </div>
        )}

        {activeTab === "capacity" && canViewCapacity && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <CapacityView refreshKey={refreshKey} />
          </div>
        )}

        {activeTab === "upgrades" && canViewUpgrades && (
          <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
            <UpgradesView refreshKey={refreshKey} />
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
                      {key === "performance" && "Each query shape against its own 14-day baseline, with the upgrades, DDL and setting changes around a regression."}
                      {key === "capacity" && "Disk forecasts per node, top growth, codec savings measured on samples, and cost by consumer."}
                      {key === "upgrades" && "Check a target version against your workload, replay it on a canary, and follow rollout gates."}
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
