/**
 * DataOps — a top-level home for user-defined, scheduled data jobs and data
 * observability. Level 1: the page + a TabPill bar of feature tabs. Level 3 (each
 * feature's own sub-tabs) lives in the feature. Reuses the
 * Monitoring page-with-sub-tabs pattern and house tokens (D10).
 */

import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, HeartPulse, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { DataOpsModelButton } from "@/features/dataops-ai";
import { ScheduledQueries, SUB_TABS, type SubTab } from "@/features/scheduled-queries";
import { DataHealth, DATA_HEALTH_SUB_TABS, type DataHealthSubTab } from "@/features/data-health";

type FeatureKey = "scheduled-queries" | "data-health";

const FEATURE_META: Record<FeatureKey, { label: string; icon: React.ElementType; permission: string }> = {
  "scheduled-queries": { label: "Scheduled Queries", icon: CalendarClock, permission: RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW },
  "data-health": { label: "Data Health", icon: HeartPulse, permission: RBAC_PERMISSIONS.DATA_HEALTH_VIEW },
};

function FeaturePill({ feature, isActive, onClick }: { feature: FeatureKey; isActive: boolean; onClick: () => void }) {
  const { label, icon: Icon } = FEATURE_META[feature];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      data-onboarding-id={`dataops-feature-${feature}`}
      className={cn(
        "group relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        isActive ? "text-paper" : "text-paper-muted hover:text-paper",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", isActive ? "text-brand" : "text-paper-dim group-hover:text-paper")} aria-hidden />
      <span>{label}</span>
      {isActive && <span className="absolute -bottom-px left-0 right-0 h-px bg-brand" aria-hidden />}
    </button>
  );
}

export default function DataOps() {
  const { hasPermission } = useRbacStore();
  const { feature, sub } = useParams<{ feature?: string; sub?: string }>();
  const navigate = useNavigate();

  const availableFeatures: FeatureKey[] = (Object.keys(FEATURE_META) as FeatureKey[]).filter((f) =>
    hasPermission(FEATURE_META[f].permission),
  );

  const activeFeature: FeatureKey =
    feature && (availableFeatures as string[]).includes(feature) ? (feature as FeatureKey) : availableFeatures[0] ?? "scheduled-queries";
  const validSubs: string[] = activeFeature === "data-health" ? DATA_HEALTH_SUB_TABS : SUB_TABS;
  const legacyScheduledDetail = activeFeature === "scheduled-queries" && (sub === "runs" || sub === "lineage");
  const activeSub = sub && validSubs.includes(sub) ? sub : legacyScheduledDetail ? "jobs" : "overview";

  // Normalize the URL so deep links / refreshes land on a valid feature+sub.
  useEffect(() => {
    if (availableFeatures.length === 0) return;
    if (!feature || !(availableFeatures as string[]).includes(feature) || !sub || !validSubs.includes(sub)) {
      navigate(`/dataops/${activeFeature}/${activeSub}`, { replace: true });
    }
  }, [feature, sub, activeFeature, activeSub, availableFeatures, validSubs, navigate]);

  const setSub = (next: string) => navigate(`/dataops/${activeFeature}/${next}`);

  if (availableFeatures.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-50">
        <p className="text-[13px] text-paper-muted">You don't have access to any DataOps features.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50" data-onboarding-id="dataops-page">
      {/* Header — icon + title + feature tabs share one row (mirrors Monitoring) */}
      <header className="flex-none border-b border-ink-500 px-6 pt-4">
        <div className="flex flex-wrap items-end justify-start gap-6 pb-0">
          <div className="flex items-center gap-3 pb-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <Workflow className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col gap-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                Data operations
              </span>
              <h1 className="text-[18px] font-semibold leading-tight tracking-tight text-paper">
                DataOps
              </h1>
            </div>
          </div>

          <nav
            aria-label="DataOps features"
            className="scrollbar-hide -mb-px flex min-w-0 max-w-full items-center overflow-x-auto"
          >
            {availableFeatures.map((f) => (
              <FeaturePill key={f} feature={f} isActive={activeFeature === f} onClick={() => navigate(`/dataops/${f}/overview`)} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 pb-2">
            <DataOpsModelButton />
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden" data-onboarding-id="dataops-content">
        {activeFeature === "scheduled-queries" && <ScheduledQueries sub={activeSub as SubTab} onSubChange={setSub} />}
        {activeFeature === "data-health" && <DataHealth sub={activeSub as DataHealthSubTab} onSubChange={setSub} />}
      </div>
    </div>
  );
}
