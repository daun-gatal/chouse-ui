/**
 * Scheduled Queries feature (DataOps) — the inner Overview / Jobs / Runs sub-tab
 * bar and content. Sub-tab is driven by the `/dataops/scheduled-queries/:sub`
 * route segment for deep-linking. House tokens only (D10b).
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, ListChecks, History, Network } from "lucide-react";

import { cn } from "@/lib/utils";
import { DataControls } from "@/components/common/DataControls";
import { OverviewTab } from "./OverviewTab";
import { JobsTab } from "./JobsTab";
import { RunsTab } from "./RunsTab";
import { LineageTab } from "./LineageTab";
import { sqKeys } from "./hooks";

const AUTO_REFRESH_MS = 30_000;

export type SubTab = "overview" | "jobs" | "runs" | "lineage";
export const SUB_TABS: SubTab[] = ["overview", "jobs", "runs", "lineage"];

const TAB_META: Record<SubTab, { label: string; icon: React.ElementType }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  jobs: { label: "Jobs", icon: ListChecks },
  runs: { label: "Runs", icon: History },
  lineage: { label: "Runtime Lineage", icon: Network },
};

function SubTabPill({ tab, isActive, onClick }: { tab: SubTab; isActive: boolean; onClick: () => void }) {
  const { label, icon: Icon } = TAB_META[tab];
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

interface ScheduledQueriesProps {
  sub: SubTab;
  onSubChange: (sub: SubTab) => void;
}

export function ScheduledQueries({ sub, onSubChange }: ScheduledQueriesProps) {
  const [drillJobId, setDrillJobId] = useState<string | undefined>();
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

  const drillToRuns = (id: string) => {
    setDrillJobId(id);
    onSubChange("runs");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between gap-3 border-b border-ink-500 px-6 pt-2">
        <div className="flex items-center gap-1">
          {SUB_TABS.map((t) => (
            <SubTabPill key={t} tab={t} isActive={sub === t} onClick={() => onSubChange(t)} />
          ))}
        </div>
        <DataControls
          className="pb-2"
          lastUpdated={lastUpdated}
          isRefreshing={isRefreshing}
          onRefresh={() => void refresh()}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {sub === "overview" && <OverviewTab onSelectJob={drillToRuns} />}
        {sub === "jobs" && <JobsTab onSelectJob={drillToRuns} />}
        {sub === "runs" && <RunsTab selectedJobId={drillJobId} />}
        {sub === "lineage" && <LineageTab />}
      </div>
    </div>
  );
}
