/**
 * Assign a dashboard to connections from its header (ADR 0021 §3), without an
 * edit session: the change is saved at the version the page loaded, like any
 * save, so it never overwrites someone else's edit.
 */

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/api/client";
import { toInput, updateDashboard, type ConnectionScope, type DashboardDetail } from "@/api/dashboards";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/charts/controlStyles";

import { dashboardKeys } from "../hooks";
import { ConnectionsField, scopeProblem } from "./ConnectionsField";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: DashboardDetail;
}

export function ConnectionsDialog({ open, onOpenChange, detail }: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<ConnectionScope>(detail.dashboard.connectionScope);
  const problem = scopeProblem(scope);
  const save = useMutation({
    mutationFn: () => updateDashboard(detail.dashboard.id, detail.dashboard.version, { ...toInput(detail), connectionScope: scope }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      toast.success("Connections updated");
      onOpenChange(false);
    },
  });
  const error = save.error instanceof ApiError && save.error.statusCode === 409
    ? "This dashboard changed since you opened it. Reload it, then change its connections again."
    : save.error?.message ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription>The dashboard is listed, and its panels run, only on the connections it is assigned to.</DialogDescription>
        </DialogHeader>
        <ConnectionsField scope={scope} onChange={setScope} />
        {problem && <p className="text-[11px] text-amber-300">{problem}</p>}
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={BTN_PRIMARY} disabled={problem !== null || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
