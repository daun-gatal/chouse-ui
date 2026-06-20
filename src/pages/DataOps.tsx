/**
 * DataOps — a top-level home for user-defined, scheduled data jobs and data
 * observability. Level 1: the page + a TabPill bar of feature tabs (phase 1 has a
 * single feature, Scheduled Queries; Data Health joins later). Level 3 (the
 * feature's own Overview/Jobs/Runs sub-tabs) lives in the feature. Reuses the
 * Monitoring page-with-sub-tabs pattern and house tokens (D10).
 */

import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { ScheduledQueries, SUB_TABS, type SubTab } from "@/features/scheduled-queries";

type FeatureKey = "scheduled-queries";

const FEATURE_META: Record<FeatureKey, { label: string; icon: React.ElementType; permission: string }> = {
  "scheduled-queries": { label: "Scheduled Queries", icon: CalendarClock, permission: RBAC_PERMISSIONS.SCHEDULED_QUERIES_VIEW },
};

function FeaturePill({ feature, isActive, onClick }: { feature: FeatureKey; isActive: boolean; onClick: () => void }) {
  const { label, icon: Icon } = FEATURE_META[feature];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative inline-flex h-9 items-center gap-2 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
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
  const activeSub: SubTab = sub && (SUB_TABS as string[]).includes(sub) ? (sub as SubTab) : "overview";

  // Normalize the URL so deep links / refreshes land on a valid feature+sub.
  useEffect(() => {
    if (availableFeatures.length === 0) return;
    if (!feature || !(availableFeatures as string[]).includes(feature) || !sub || !(SUB_TABS as string[]).includes(sub)) {
      navigate(`/dataops/${activeFeature}/${activeSub}`, { replace: true });
    }
  }, [feature, sub, activeFeature, activeSub, availableFeatures, navigate]);

  const setSub = (next: SubTab) => navigate(`/dataops/${activeFeature}/${next}`);

  if (availableFeatures.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-50">
        <p className="text-[13px] text-paper-muted">You don't have access to any DataOps features.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50">
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

          <nav aria-label="DataOps features" className="scrollbar-hide -mb-px flex items-center overflow-x-auto">
            {availableFeatures.map((f) => (
              <FeaturePill key={f} feature={f} isActive={activeFeature === f} onClick={() => navigate(`/dataops/${f}/overview`)} />
            ))}
          </nav>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeFeature === "scheduled-queries" && <ScheduledQueries sub={activeSub} onSubChange={setSub} />}
      </div>
    </div>
  );
}
