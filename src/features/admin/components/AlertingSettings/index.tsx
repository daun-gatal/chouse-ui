/**
 * Admin › Alerting (ADR 0026 §7): Overview, Channels, Rules and Activity, with
 * the tab and every filter in the URL. Routes, permissions and delete guards
 * are those the page always used; this is where alerting is looked after.
 */

import React, { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { OverviewTab } from "./OverviewTab";
import { ChannelsTab } from "./ChannelsTab";
import { RulesTab } from "./RulesTab";
import { ActivityTab } from "./ActivityTab";

const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channels" },
  { key: "rules", label: "Rules" },
  { key: "activity", label: "Activity" },
] as const;
type View = (typeof VIEWS)[number]["key"];

function isView(value: string | null): value is View {
  return VIEWS.some((v) => v.key === value);
}

const AlertingSettings: React.FC = () => {
  const { hasPermission } = useRbacStore();
  const canEdit = useMemo(() => hasPermission(RBAC_PERMISSIONS.ALERTING_EDIT), [hasPermission]);
  const canDelete = useMemo(() => hasPermission(RBAC_PERMISSIONS.ALERTING_DELETE), [hasPermission]);
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: View = isView(raw) ? raw : "overview";

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
          <Bell className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[18px] font-semibold tracking-tight text-paper">Alerting</h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Channels, everything that sends alerts, and what was sent</p>
        </div>
      </div>

      <div role="tablist" aria-label="Alerting" className="flex gap-1 overflow-x-auto border-b border-ink-500">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setParams(new URLSearchParams(v.key === "overview" ? {} : { view: v.key }))}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em]",
              view === v.key ? "border-brand text-paper" : "border-transparent text-paper-faint hover:text-paper",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {view === "overview" && <OverviewTab />}
        {view === "channels" && <ChannelsTab canEdit={canEdit} canDelete={canDelete} />}
        {view === "rules" && <RulesTab canEdit={canEdit} canDelete={canDelete} />}
        {view === "activity" && <ActivityTab canDelete={canDelete} />}
      </div>
    </div>
  );
};

export default AlertingSettings;
