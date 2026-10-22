/**
 * Panel cost (ADR 0023 §10): what one run reads, what that comes to per hour
 * at the dashboard's refresh, and — for a heavy, time-bucketed panel — a
 * rollup proposed as a remediation action. Nothing runs until it is approved;
 * once the rollup returns exactly what the panel returns, the panel switches
 * to it.
 */

import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gauge, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getPanelCost, proposeRollup, type ChartPanelInput, type DashboardDetail } from "@/api/dashboards";
import { ActionList } from "@/features/observe/RemediationPanel";
import { useRemediationActions } from "@/features/observe/hooks";
import { formatValue } from "@/lib/viz/units";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";

import type { ViewState } from "../urlState";

interface Props {
  detail: DashboardDetail;
  panelId: string;
  panel: ChartPanelInput;
  view: ViewState;
  onClose: () => void;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warn" }): React.ReactElement {
  return (
    <div className="rounded-xs border border-ink-500 p-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{label}</p>
      <p className={cn("text-sm", tone === "warn" ? "text-amber-300" : "text-paper")}>{value}</p>
    </div>
  );
}

export function PanelCostDialog({ detail, panelId, panel, view, onClose }: Props): React.ReactElement {
  const id = detail.dashboard.id;
  const { hasPermission, hasAnyPermission } = useRbacStore();
  const canPropose = hasPermission(RBAC_PERMISSIONS.REMEDIATION_PROPOSE) && detail.access.edit;
  const canSeeFixes = hasAnyPermission([RBAC_PERMISSIONS.REMEDIATION_PROPOSE, RBAC_PERMISSIONS.REMEDIATION_APPROVE, RBAC_PERMISSIONS.REMEDIATION_APPROVE_HIGH]);
  const cost = useQuery({ queryKey: ["dashboards", "cost", id, panelId, panel.sql, view.range, view.values], queryFn: () => getPanelCost(id, panelId, { range: view.range, values: view.values }), retry: false });
  const actions = useRemediationActions({}, canSeeFixes);
  const rollups = (actions.data ?? []).filter((a) => a.params.type === "create_panel_rollup" && a.params.panelId === panelId);
  const [days, setDays] = useState(7);
  const [cluster, setCluster] = useState("");
  const propose = useMutation({
    mutationFn: () => proposeRollup(id, panelId, { backfillDays: days, cluster: cluster.trim() === "" ? null : cluster.trim() }),
    onSuccess: async () => {
      toast.success("Rollup proposed: it runs once two approvers agree");
      await actions.refetch();
    },
  });
  const c = cost.data;
  const pending = rollups.some((a) => !["rejected", "failed", "failed_verification", "rolled_back"].includes(a.status));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" aria-hidden /> Cost of {panel.title}</DialogTitle>
          <DialogDescription>One run for the current range, from the shared cache when it is fresh.</DialogDescription>
        </DialogHeader>
        {cost.isPending && <p className="flex items-center gap-2 text-sm text-paper-dim"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Running the panel…</p>}
        {cost.isError && <p role="alert" className="text-sm text-red-300">{cost.error.message}</p>}
        {c && (
          <div className="flex flex-col gap-3" data-testid="panel-cost">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Figure label="Read per run" value={formatValue(c.readBytes, "bytes")} tone={c.readBytes > 1024 ** 3 ? "warn" : undefined} />
              <Figure label="Rows per run" value={formatValue(c.readRows, "count")} />
              <Figure label="Time per run" value={`${c.elapsedMs} ms`} />
              <Figure label="Refresh" value={c.refreshSeconds > 0 ? `every ${c.refreshSeconds} s` : "off"} />
              <Figure label="Runs per hour" value={c.readsPerHour > 0 ? `${c.readsPerHour} per viewer` : "on open only"} />
              <Figure label="Read per hour" value={c.readsPerHour > 0 ? `${formatValue(c.bytesPerHour, "bytes")} per viewer` : "—"} tone={c.bytesPerHour > 100 * 1024 ** 3 ? "warn" : undefined} />
            </div>
            {c.heavy && <p role="status" className="rounded-xs border border-amber-900/40 bg-amber-950/20 p-2 text-xs text-amber-200">This panel is heavy: over 1 GiB a run or 100 GiB an hour.</p>}
            <div className="flex flex-col gap-2 rounded-xs border border-ink-500 p-3">
              <span className={FIELD_LABEL}>Rollup</span>
              {c.rollup.eligible ? (
                <>
                  <p className="text-xs text-paper-muted">
                    {c.rollup.source} can be pre-aggregated per minute into {c.rollup.target} (an AggregatingMergeTree table and a materialized view).
                    After a backfill, the panel switches to it only if both return exactly the same results. The panel then has 1-minute resolution.
                  </p>
                  {canPropose && !pending && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1">
                        <span className={FIELD_LABEL}>Backfill days</span>
                        <Input type="number" min={1} max={30} aria-label="Backfill days" className={cn(FIELD, "h-8 w-24")} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Math.round(e.target.valueAsNumber || 1))))} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={FIELD_LABEL}>Cluster (optional)</span>
                        <Input aria-label="Cluster" className={cn(FIELD, "h-8 w-40")} value={cluster} placeholder="one shard, replicas" onChange={(e) => setCluster(e.target.value)} />
                      </label>
                      <Button className={BTN_PRIMARY} disabled={propose.isPending} onClick={() => propose.mutate()}>{propose.isPending ? "Proposing…" : "Propose rollup"}</Button>
                    </div>
                  )}
                  {!canPropose && <p className="text-[11px] text-paper-faint">Proposing a rollup needs remediation:propose and edit access to this dashboard.</p>}
                  {propose.isError && <p role="alert" className="text-xs text-red-300">{propose.error.message}</p>}
                </>
              ) : (
                <p className="text-xs text-paper-dim">Not available: {c.rollup.reason}.</p>
              )}
              {rollups.length > 0 && <ActionList actions={rollups} />}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
