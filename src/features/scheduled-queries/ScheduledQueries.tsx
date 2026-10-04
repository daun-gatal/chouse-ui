/**
 * Scheduled Queries feature (DataOps) — the inner Overview / Jobs sub-tab
 * bar and content. Sub-tab is driven by the `/data/scheduled-queries/:sub`
 * route segment for deep-linking. House tokens only (D10b).
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, ListChecks } from "lucide-react";

import { DataControls } from "@/components/common/DataControls";
import { SubTabs } from "@/components/common/PageShell";
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
      <SubTabs
        tabs={SUB_TABS.map((t) => ({ key: t, ...TAB_META[t] }))}
        active={sub}
        onChange={onSubChange}
        label="Scheduled Query sections"
        onboardingPrefix="data-scheduled"
        trailing={
          <DataControls
            className="shrink-0 pb-2"
            lastUpdated={lastUpdated}
            isRefreshing={isRefreshing}
            onRefresh={() => void refresh()}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {sub === "overview" && <OverviewTab onSelectJob={selectJob} />}
        {sub === "jobs" && <JobsTab selectedJobId={selectedJobId} onSelectedJobChange={setSelectedJobId} />}
      </div>
    </div>
  );
}
