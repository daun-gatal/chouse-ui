/**
 * The dashboards the user pinned, for Home (ADR 0021 §12). Shows nothing to
 * users without dashboards:view or with no pins.
 */

import React from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";

import { listDashboards } from "@/api/dashboards";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

import { dashboardKeys } from "../hooks";

export function PinnedDashboards({ header }: { header: React.ReactNode }): React.ReactElement | null {
  const navigate = useNavigate();
  const canView = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.DASHBOARDS_VIEW));
  const dashboards = useQuery({ queryKey: dashboardKeys.list(), queryFn: listDashboards, enabled: canView });
  const pinned = (dashboards.data ?? []).filter((d) => d.pinned);
  if (!canView || pinned.length === 0) return null;
  return (
    <section className="mt-12 flex flex-col gap-5" aria-label="Pinned dashboards">
      {header}
      <div className="grid grid-cols-1 border-l border-t border-ink-500 sm:grid-cols-2 lg:grid-cols-4">
        {pinned.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => navigate(`/dashboards/${d.id}`)}
            className="flex items-start gap-3 border-b border-r border-ink-500 p-4 text-left transition-colors hover:bg-ink-100"
          >
            <ChartColumn className="mt-0.5 h-4 w-4 shrink-0 text-paper-dim" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-paper">{d.title}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">{d.panelCount} panel{d.panelCount === 1 ? "" : "s"}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
