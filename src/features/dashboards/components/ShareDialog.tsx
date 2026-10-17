/**
 * Share a dashboard with roles (ADR 0021 §5). A share shows the dashboard to
 * the role's members; every panel still runs with each viewer's own access.
 */

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listShareTargets, setShares, type ShareRecord } from "@/api/dashboards";

import { dashboardKeys } from "../hooks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
  shares: ShareRecord[];
}

type Level = "none" | "view" | "edit";

export function ShareDialog({ open, onOpenChange, dashboardId, shares }: Props): React.ReactElement {
  const queryClient = useQueryClient();
  const targets = useQuery({ queryKey: ["dashboards", "share-targets"], queryFn: listShareTargets, enabled: open });
  const [levels, setLevels] = useState<Record<string, Level>>(() => Object.fromEntries(shares.map((s) => [s.roleId, s.canEdit ? "edit" : "view"])));
  const save = useMutation({
    mutationFn: () => setShares(dashboardId, Object.entries(levels).filter(([, l]) => l !== "none").map(([roleId, l]) => ({ roleId, canEdit: l === "edit" }))),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      toast.success("Sharing updated");
      onOpenChange(false);
    },
  });

  const level = (roleId: string): Level => levels[roleId] ?? "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share dashboard</DialogTitle>
          <DialogDescription>Members of a role see the dashboard; panels still run with each viewer's own data access.</DialogDescription>
        </DialogHeader>
        {targets.isError && <p role="alert" className="text-xs text-red-300">{targets.error.message}</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-paper-dim"><th className="py-1">Role</th><th className="py-1 text-center">View</th><th className="py-1 text-center">Edit</th></tr>
          </thead>
          <tbody>
            {(targets.data ?? []).map((role) => (
              <tr key={role.id} className="border-t border-ink-500">
                <td className="py-1.5">{role.displayName}</td>
                <td className="py-1.5 text-center">
                  <Checkbox aria-label={`${role.displayName} can view`} checked={level(role.id) !== "none"} onCheckedChange={(c) => setLevels({ ...levels, [role.id]: c === true ? "view" : "none" })} />
                </td>
                <td className="py-1.5 text-center">
                  <Checkbox aria-label={`${role.displayName} can edit`} checked={level(role.id) === "edit"} onCheckedChange={(c) => setLevels({ ...levels, [role.id]: c === true ? "edit" : level(role.id) === "none" ? "none" : "view" })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {save.isError && <p role="alert" className="text-xs text-red-300">{save.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !targets.isSuccess}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
