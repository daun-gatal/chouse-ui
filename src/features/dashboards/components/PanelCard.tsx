/**
 * One dashboard panel (ADR 0021 §4, §6): runs its query for the current view,
 * refreshes on the dashboard's interval while the tab is visible, and draws
 * the result. Errors are shown with the server's reason; a failed run is not
 * retried behind the user's back. A fleet panel draws one series per
 * connection and lists each connection that failed.
 */

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Pencil, RefreshCw, Trash2, Zap } from "lucide-react";

import { PanelMessage, PanelVisual } from "@/components/charts/PanelVisual";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { runPanel, type LintFinding, type PanelInput, type PanelRunResult } from "@/api/dashboards";
import { mergeFleet, type ResultData } from "@/lib/viz/resolve";
import type { VizSpec } from "@/lib/viz/spec";
import { formatValue } from "@/lib/viz/units";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores";
import { BTN_ICON } from "@/components/charts/controlStyles";

import type { ViewState } from "../urlState";

export const PANEL_HEIGHTS_PX: Record<PanelInput["height"], number> = { s: 140, m: 260, l: 420 };

export const WIDTH_CLASSES: Record<PanelInput["width"], string> = {
  3: "md:col-span-3",
  4: "md:col-span-4",
  6: "md:col-span-6",
  8: "md:col-span-8",
  12: "md:col-span-12",
};

interface Props {
  dashboardId: string;
  /** Null for a panel added in this edit session and not saved yet. */
  panelId: string | null;
  panel: PanelInput;
  view: ViewState;
  refreshSeconds: number;
  editing: boolean;
  lint: LintFinding[];
  onEdit: () => void;
  onRemove: () => void;
  dragHandle?: React.ReactNode;
  /** Extra controls in the header (alerts). */
  actions?: React.ReactNode;
  /** The card sits in a wrapper that owns its grid span (drag and drop). */
  wrapped?: boolean;
  /** Alert thresholds to draw on the chart. */
  alertLines?: Array<{ value: number; color: string }>;
}

/** A fleet result as one result to draw: a `connection` column, split by it for charts. */
function fleetVisual(spec: VizSpec, result: Extract<PanelRunResult, { kind: "fleet" }>): { spec: VizSpec; data: ResultData } {
  const ok = result.connections.filter((e): e is Extract<typeof e, { ok: true }> => e.ok);
  const data = mergeFleet(ok.map((e) => ({ connectionName: e.connectionName, data: e.data })));
  if (spec.type === "table") return { spec, data };
  return { spec: { ...spec, series: "connection" }, data };
}

function FleetStats({ spec, result }: { spec: VizSpec; result: Extract<PanelRunResult, { kind: "fleet" }> }): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {result.connections.filter((e) => e.ok).map((e) => (
        <div key={e.connectionId} className="rounded-xs border border-ink-500 p-2">
          <div className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{e.connectionName}</div>
          {e.ok && <PanelVisual spec={spec} data={e.data} height={56} />}
        </div>
      ))}
    </div>
  );
}

/**
 * The footer: how long the run took and what it read. The legend already names
 * a fleet panel's connections and the failure list names the rest, so a fleet
 * run reads like any other: its slowest connection and the total read.
 */
function runMeta(result: PanelRunResult): string | null {
  if (result.kind === "single") return `${result.cached ? "cached · " : ""}${result.data.elapsedMs} ms · ${formatValue(result.data.readBytes, "bytes")} read`;
  const ok = result.connections.filter((e): e is Extract<typeof e, { ok: true }> => e.ok);
  if (ok.length === 0) return null;
  const slowest = Math.max(...ok.map((e) => e.data.elapsedMs));
  const read = ok.reduce((sum, e) => sum + e.data.readBytes, 0);
  return `${ok.every((e) => e.cached) ? "cached · " : ""}${slowest} ms · ${formatValue(read, "bytes")} read`;
}

export function PanelCard({ dashboardId, panelId, panel, view, refreshSeconds, editing, lint, onEdit, onRemove, dragHandle, actions, wrapped = false, alertLines }: Props): React.ReactElement {
  const height = PANEL_HEIGHTS_PX[panel.height];
  // Runs on the dock's active connection (sent with every request); a fleet panel on all of them.
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const run = useQuery({
    queryKey: ["dashboards", "run", dashboardId, panelId, panel.sql, panel.fleet, view, panel.fleet ? null : activeConnectionId],
    queryFn: ({ signal }) => {
      // Disabled below while there is no stored panel to run.
      if (panelId === null) throw new Error("Save the dashboard to run this panel");
      if (!panel.fleet && activeConnectionId === null) throw new Error("Pick a connection in the dock to run this panel");
      return runPanel(dashboardId, panelId, { range: view.range, values: view.values }, signal);
    },
    enabled: panelId !== null,
    refetchInterval: refreshSeconds > 0 ? refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const visual = useMemo(() => {
    if (!run.data) return null;
    if (run.data.kind === "single") return { spec: panel.viz, data: run.data.data };
    return fleetVisual(panel.viz, run.data);
  }, [run.data, panel.viz]);

  const failures = run.data?.kind === "fleet" ? run.data.connections.filter((e): e is Extract<typeof e, { ok: false }> => !e.ok) : [];
  const meta = run.data ? runMeta(run.data) : null;

  return (
    <section className={cn("flex min-w-0 flex-col rounded-md border border-ink-500 bg-ink-100", wrapped ? "h-full" : ["col-span-12", WIDTH_CLASSES[panel.width]])} aria-label={panel.title}>
      <header className="flex items-center gap-2 border-b border-ink-500 px-3 py-2">
        {editing && dragHandle}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-paper" title={panel.title}>{panel.title}</h3>
        {panel.fleet && <span className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim"><Zap className="h-3 w-3" aria-hidden /> Fleet</span>}
        {lint.length > 0 && editing && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 rounded-full bg-amber-950/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-300" data-testid="lint-badge">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {lint.length} to check
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{lint.map((f) => <p key={f.code} className="text-xs">{f.message}</p>)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {actions}
        <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Refresh ${panel.title}`} onClick={() => void run.refetch()} disabled={run.isFetching || panelId === null}>
          <RefreshCw className={cn("h-3.5 w-3.5", run.isFetching && "animate-spin")} />
        </Button>
        {editing && (
          <>
            <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Edit ${panel.title}`} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Remove ${panel.title}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
          </>
        )}
      </header>
      <div className="min-w-0 p-3" style={{ minHeight: height }}>
        {panelId === null ? (
          <PanelMessage tone="muted">Save the dashboard to run this panel</PanelMessage>
        ) : run.isError ? (
          <PanelMessage tone="error">{run.error.message}</PanelMessage>
        ) : run.isPending ? (
          <PanelMessage tone="muted">Running…</PanelMessage>
        ) : visual && run.data?.kind === "fleet" && panel.viz.type === "stat" ? (
          <FleetStats spec={panel.viz} result={run.data} />
        ) : visual && (run.data?.kind === "single" || visual.data.rows.length > 0) ? (
          <PanelVisual spec={visual.spec} data={visual.data} height={height} title={panel.title} extraLines={alertLines} />
        ) : (
          <PanelMessage tone="error">No connection returned a result</PanelMessage>
        )}
        {failures.length > 0 && run.data?.kind === "fleet" && (
          <ul className="mt-2 space-y-0.5 border-t border-ink-500 pt-2" aria-label="Connections that failed">
            <li className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">{failures.length} of {run.data.connections.length} connections failed</li>
            {failures.map((f) => (
              <li key={f.connectionId} className="text-[11px] text-red-300"><span className="font-mono">{f.connectionName}</span>: {f.error}</li>
            ))}
          </ul>
        )}
        {meta && <p className="mt-1 text-right font-mono text-[10px] text-paper-faint" data-testid="panel-meta">{meta}</p>}
        {run.data?.kind === "fleet" && run.data.omitted > 0 && (
          <p className="mt-1 text-[11px] text-amber-300">Showing the first {run.data.connections.length} connections by name; {run.data.omitted} more are not run.</p>
        )}
      </div>
    </section>
  );
}
