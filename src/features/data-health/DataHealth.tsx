import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Database, Siren } from "lucide-react";

import { DataControls } from "@/components/common/DataControls";
import { cn } from "@/lib/utils";
import { DatasetsTab } from "./DatasetsTab";
import { IncidentsTab } from "./IncidentsTab";
import { OverviewTab } from "./OverviewTab";
import { dhKeys } from "./hooks";

export type DataHealthSubTab = "overview" | "datasets" | "incidents";
export const DATA_HEALTH_SUB_TABS: DataHealthSubTab[] = ["overview", "datasets", "incidents"];

const META: Record<DataHealthSubTab, { label: string; icon: React.ElementType }> = {
  overview: { label: "Overview", icon: Activity },
  datasets: { label: "Datasets", icon: Database },
  incidents: { label: "Incidents", icon: Siren },
};

interface DataHealthProps {
  sub: DataHealthSubTab;
  onSubChange: (sub: DataHealthSubTab) => void;
}

export function DataHealth({ sub, onSubChange }: DataHealthProps) {
  const queryClient = useQueryClient();
  const [selectedPromiseId, setSelectedPromiseId] = useState<string>();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString());

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: dhKeys.all });
      setLastUpdated(new Date().toLocaleTimeString());
    } finally {
      setIsRefreshing(false);
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void refreshRef.current(), 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const selectPromise = (id: string) => {
    setSelectedPromiseId(id);
    onSubChange("datasets");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-w-0 items-end justify-between gap-3 border-b border-ink-500 px-6 pt-2">
        <nav
          className="scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto"
          aria-label="Data Health sections"
        >
          {DATA_HEALTH_SUB_TABS.map((tab) => {
            const Icon = META[tab].icon;
            const active = tab === sub;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onSubChange(tab)}
                aria-current={active ? "page" : undefined}
                data-onboarding-id={`dataops-health-${tab}`}
                className={cn(
                  "group relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  active ? "text-paper" : "text-paper-muted hover:text-paper",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", active ? "text-brand" : "text-paper-dim")} />
                {META[tab].label}
                {active && <span className="absolute -bottom-px left-0 right-0 h-px bg-brand" />}
              </button>
            );
          })}
        </nav>
        <DataControls className="shrink-0 pb-2" lastUpdated={lastUpdated} isRefreshing={isRefreshing} onRefresh={() => void refresh()} autoRefresh={autoRefresh} onAutoRefreshChange={setAutoRefresh} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {sub === "overview" && <OverviewTab onSelectPromise={selectPromise} />}
        {sub === "datasets" && <DatasetsTab selectedPromiseId={selectedPromiseId} onSelectedPromiseChange={setSelectedPromiseId} />}
        {sub === "incidents" && <IncidentsTab onSelectPromise={selectPromise} />}
      </div>
    </div>
  );
}
