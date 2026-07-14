/**
 * Scheduled Queries feature (DataOps) — the inner Overview / Jobs sub-tab
 * bar and content. Sub-tab is driven by the `/dataops/scheduled-queries/:sub`
 * route segment for deep-linking. House tokens only (D10b).
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, ListChecks } from "lucide-react";

import { cn } from "@/lib/utils";
import { DataControls } from "@/components/common/DataControls";
import { OverviewTab } from "./OverviewTab";
import { JobsTab } from "./JobsTab";
import { sqKeys } from "./hooks";

const AUTO_REFRESH_MS = 30_000;

export type SubTab = "overview" | "jobs";
export const SUB_TABS: SubTab[] = ["overview", "jobs"];

const TAB_META: Record<SubTab, { label: string; icon: React.ElementType }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  jobs: { label: "Jobs", icon: ListChecks },
};

function SubTabPill({ tab, isActive, onClick }: { tab: SubTab; isActive: boolean; onClick: () => void }) {
  const { label, icon: Icon } = TAB_META[tab];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      data-onboarding-id={`dataops-scheduled-${tab}`}
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

interface ScheduledQueriesProps {
  sub: SubTab;
  onSubChange: (sub: SubTab) => void;
}

export function ScheduledQueries({ sub, onSubChange }: ScheduledQueriesProps) {
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const queryClient = useQueryClient();

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString());

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: sqKeys.all });
      setLastUpdated(new Date().toLocaleTimeString());
    } finally {
      setIsRefreshing(false);
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Auto-refresh: re-fetch every 30s while enabled (mirrors Monitoring).
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void refreshRef.current(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const selectJob = (id: string) => {
    setSelectedJobId(id);
    onSubChange("jobs");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-w-0 items-end justify-between gap-3 border-b border-ink-500 px-6 pt-2">
        <nav
          className="scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto"
          aria-label="Scheduled Query sections"
        >
          {SUB_TABS.map((t) => (
            <SubTabPill key={t} tab={t} isActive={sub === t} onClick={() => onSubChange(t)} />
          ))}
        </nav>
        <DataControls
          className="shrink-0 pb-2"
          lastUpdated={lastUpdated}
          isRefreshing={isRefreshing}
          onRefresh={() => void refresh()}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {sub === "overview" && <OverviewTab onSelectJob={selectJob} />}
        {sub === "jobs" && <JobsTab selectedJobId={selectedJobId} onSelectedJobChange={setSelectedJobId} />}
      </div>
    </div>
  );
}
