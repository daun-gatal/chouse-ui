/**
 * Pin a query and its chart to a dashboard (ADR 0021 §12): add it as a panel
 * to a dashboard you can edit, or start a new one. The server validates the
 * panel; its message is shown as is when it refuses.
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getConnectionId } from "@/api/client";
import { createDashboard, getDashboard, listDashboards, toInput, updateDashboard, type PanelInput } from "@/api/dashboards";
import { log } from "@/lib/log";
import type { VizSpec } from "@/lib/viz/spec";

import { dashboardKeys } from "../hooks";

const NEW = "__new__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sql: string;
  viz: VizSpec;
}

export function PinToDashboardDialog({ open, onOpenChange, sql, viz }: Props): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboards = useQuery({ queryKey: dashboardKeys.list(), queryFn: listDashboards, enabled: open });
  const editable = (dashboards.data ?? []).filter((d) => d.access.edit);
  const [target, setTarget] = useState<string>(NEW);
  const [newTitle, setNewTitle] = useState("New dashboard");
  const [panelTitle, setPanelTitle] = useState("New panel");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const pin = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const panel: PanelInput = { id: null, title: panelTitle.trim(), sql, viz, width: 6, height: "m", fleet: false };
    try {
      let id: string;
      if (target === NEW) {
        const created = await createDashboard({
          title: newTitle.trim(), description: "", connectionId: getConnectionId(), timeRange: "6h", refreshSeconds: 0, variables: [], panels: [panel],
        });
        id = created.dashboard.id;
      } else {
        const detail = await getDashboard(target);
        const input = toInput(detail);
        await updateDashboard(target, detail.dashboard.version, { ...input, panels: [...input.panels, panel] });
        id = target;
      }
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      onOpenChange(false);
      toast.success("Pinned to the dashboard", { action: { label: "Open", onClick: () => navigate(`/dashboards/${id}`) } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("Pin to dashboard failed", e);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const invalid = panelTitle.trim() === "" || (target === NEW && newTitle.trim() === "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pin to dashboard</DialogTitle>
          <DialogDescription>Adds this query and chart as a panel. It runs with each viewer's own access.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-paper-dim">Dashboard</span>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger aria-label="Dashboard"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW}>New dashboard</SelectItem>
                {editable.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {dashboards.isError && <p className="text-xs text-red-300">Couldn't load your dashboards: {dashboards.error.message}</p>}
          {target === NEW && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-paper-dim">New dashboard title</span>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200} />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-paper-dim">Panel title</span>
            <Input value={panelTitle} onChange={(e) => setPanelTitle(e.target.value)} maxLength={200} />
          </label>
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void pin()} disabled={saving || invalid}>{saving ? "Pinning…" : "Pin"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
