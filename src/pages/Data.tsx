/**
 * Data — the data observability home (ADR 0016 §14): Overview, Incidents,
 * Lineage, Pipelines, Datasets, Coverage, Context and Scheduled queries.
 * Replaces DataOps; old `/dataops/*` URLs redirect here. Each tab is gated by
 * its own permission, so a user who could open DataOps still reaches the same
 * features (Scheduled Queries, Data Health promises and incidents).
 */

import { useEffect, type ElementType, type ReactElement } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { BookOpen, CalendarClock, Gauge, GitBranch, LayoutDashboard, ShieldCheck, Siren, Table2, Workflow } from "lucide-react";

import { NavPill, PageHeader } from "@/components/common/PageShell";
import NoPermission from "@/components/common/NoPermission";
import { DataOpsModelButton } from "@/features/dataops-ai";
import { CollectorStatusChip } from "@/features/observe/CollectorStatusChip";
import { ContextTab } from "@/features/observe/ContextTab";
import { CoverageTab } from "@/features/observe/CoverageTab";
import { DatasetsTab } from "@/features/observe/DatasetsTab";
import { useIncidents } from "@/features/observe/hooks";
import { IncidentsTab } from "@/features/observe/IncidentsTab";
import { LineageTab } from "@/features/observe/LineageTab";
import { OverviewTab } from "@/features/observe/OverviewTab";
import { DATA_TABS, isDataTab, legacyDataOpsPath, type DataTab } from "@/features/observe/paths";
import { PipelinesTab } from "@/features/observe/PipelinesTab";
import { ScheduledQueries, SUB_TABS, type SubTab } from "@/features/scheduled-queries";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

const TAB_META: Record<DataTab, { label: string; icon: ElementType; permissions: string[] }> = {
  overview: { label: "Overview", icon: LayoutDashboard, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW] },
  incidents: { label: "Incidents", icon: Siren, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW, RBAC_PERMISSIONS.DATA_HEALTH_VIEW] },
  lineage: { label: "Lineage", icon: GitBranch, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW] },
  pipelines: { label: "Pipelines", icon: Workflow, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW] },
  datasets: { label: "Datasets", icon: Table2, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW, RBAC_PERMISSIONS.DATA_HEALTH_VIEW] },
  coverage: { label: "Coverage", icon: ShieldCheck, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW] },
  context: { label: "Context", icon: BookOpen, permissions: [RBAC_PERMISSIONS.OBSERVE_VIEW] },
  "scheduled-queries": { label: "Scheduled queries", icon: CalendarClock, permissions: [RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW] },
};

function isSubTab(value: string | undefined): value is SubTab {
  return SUB_TABS.some((s) => s === value);
}

function useIncidentCount(enabled: boolean): number | undefined {
  const { data } = useIncidents("active", enabled);
  return data?.length;
}

function Pills({ tabs, active }: { tabs: DataTab[]; active: DataTab }): ReactElement {
  const navigate = useNavigate();
  const incidents = useIncidentCount(tabs.includes("incidents"));
  return (
    <>
      {tabs.map((tab) => (
        <NavPill
          key={tab}
          icon={TAB_META[tab].icon}
          label={TAB_META[tab].label}
          count={tab === "incidents" ? incidents : undefined}
          isActive={tab === active}
          onboardingId={`data-tab-${tab}`}
          onClick={() => navigate(`/data/${tab}`)}
          noShrink
        />
      ))}
    </>
  );
}

export default function Data(): ReactElement {
  const { hasAnyPermission, hasPermission } = useRbacStore();
  const { tab, a, b } = useParams<{ tab?: string; a?: string; b?: string }>();
  const navigate = useNavigate();

  const available = DATA_TABS.filter((t) => hasAnyPermission(TAB_META[t].permissions));
  const requested = isDataTab(tab) ? tab : undefined;
  const denied = requested !== undefined && !available.includes(requested);
  const active: DataTab = requested && !denied ? requested : available[0] ?? "overview";
  const canObserve = hasPermission(RBAC_PERMISSIONS.OBSERVE_VIEW);

  useEffect(() => {
    if (available.length > 0 && !denied && (!requested || (requested === "scheduled-queries" && !isSubTab(a)))) {
      navigate(active === "scheduled-queries" ? `/data/scheduled-queries/${isSubTab(a) ? a : "overview"}` : `/data/${active}`, { replace: true });
    }
  }, [available.length, denied, requested, active, a, navigate]);

  if (available.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-50">
        <p className="text-[13px] text-paper-muted">You don't have access to any Data features.</p>
      </div>
    );
  }

  const decoded = (v: string | undefined): string | undefined => (v === undefined ? undefined : decodeURIComponent(v));

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50" data-onboarding-id="data-page">
      <PageHeader
        icon={Gauge}
        eyebrow="Data observability"
        title="Data"
        navLabel="Data sections"
        layout="start"
        nav={<Pills tabs={available} active={active} />}
        actions={
          <>
            {canObserve && <CollectorStatusChip />}
            <DataOpsModelButton />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden" data-onboarding-id="data-content">
        {denied ? (
          <div className="p-6"><NoPermission inline feature={TAB_META[requested].label} /></div>
        ) : active === "scheduled-queries" ? (
          <ScheduledQueries sub={isSubTab(a) ? a : "overview"} onSubChange={(sub) => navigate(`/data/scheduled-queries/${sub}`)} />
        ) : (
          <div className={active === "lineage" ? "flex h-full flex-col p-6" : "h-full overflow-y-auto p-6"}>
            {active === "overview" && <OverviewTab />}
            {active === "incidents" && <IncidentsTab source={a} id={decoded(b)} />}
            {active === "lineage" && <LineageTab />}
            {active === "pipelines" && <PipelinesTab />}
            {active === "datasets" && <DatasetsTab database={decoded(a)} table={decoded(b)} />}
            {active === "coverage" && <CoverageTab />}
            {active === "context" && <ContextTab />}
          </div>
        )}
      </div>
    </div>
  );
}

/** `/dataops/:feature?/:sub?` → the matching `/data/*` page (bookmarks only; DataOps is gone). */
export function LegacyDataOpsRedirect(): ReactElement {
  const { feature, sub } = useParams<{ feature?: string; sub?: string }>();
  return <Navigate to={legacyDataOpsPath(feature, sub)} replace />;
}
