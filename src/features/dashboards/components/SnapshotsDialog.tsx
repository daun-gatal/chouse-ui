/**
 * Snapshots of a dashboard (ADR 0023 §12): take one of the current view's
 * range on the active connection, and open or delete the ones you may see.
 * The range is the view's, made absolute at the moment you take it.
 */

import React, { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createSnapshot, deleteSnapshot, listSnapshots, SNAPSHOT_EXPIRY_DAYS, type DashboardDetail } from "@/api/dashboards";
import { RELATIVE_RANGES, type TimeRange, type VariableValues } from "@/lib/viz/spec";
import { formatValue } from "@/lib/viz/units";
import { cn } from "@/lib/utils";
import { BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";

/** The view's range as unix seconds, fixed now. */
export function absoluteRange(range: TimeRange, nowMs: number): { from: number; to: number } {
  if (range.kind === "absolute") return { from: range.from, to: range.to };
  const to = Math.floor(nowMs / 1000);
  return { from: to - RELATIVE_RANGES[range.value], to };
}

interface Props {
  detail: DashboardDetail;
  range: TimeRange;
  values: VariableValues;
  canTake: boolean;
  userId: string | null;
  onClose: () => void;
}

export function SnapshotsDialog({ detail, range, values, canTake, userId, onClose }: Props): React.ReactElement {
  const id = detail.dashboard.id;
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["dashboards", "snapshots", id], queryFn: () => listSnapshots(id), retry: false });
  const [name, setName] = useState(`${detail.dashboard.title} · ${new Date().toLocaleString()}`.slice(0, 200));
  const [days, setDays] = useState<number>(30);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [incidentId, setIncidentId] = useState("");

  const take = useMutation({
    mutationFn: () => createSnapshot(id, { name: name.trim(), ...absoluteRange(range, Date.now()), values, roleIds, expiresInDays: days, incidentId: incidentId.trim() === "" ? null : incidentId.trim() }),
    onSuccess: async (created) => {
      toast.success(`Snapshot "${created.name}" saved`);
      setName(`${detail.dashboard.title} · ${new Date().toLocaleString()}`.slice(0, 200));
      await queryClient.invalidateQueries({ queryKey: ["dashboards", "snapshots", id] });
    },
  });
  const remove = useMutation({
    mutationFn: (snapshotId: string) => deleteSnapshot(id, snapshotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboards", "snapshots", id] }),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-4 w-4" aria-hidden /> Snapshots</DialogTitle>
          <DialogDescription>A snapshot freezes every chart's result for the current range, so it can be shared after the data has moved on. Whoever opens it still only sees what their own access allows.</DialogDescription>
        </DialogHeader>
        {canTake && (
          <div className="flex flex-col gap-3 rounded-xs border border-ink-500 p-3">
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Name</span>
              <Input className={FIELD} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Expires after</span>
                <select aria-label="Expires after" className={cn(FIELD, "h-8 rounded-xs px-2 text-xs")} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {SNAPSHOT_EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
                </select>
              </label>
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className={FIELD_LABEL}>Incident ID (optional)</span>
                <Input className={FIELD} value={incidentId} onChange={(e) => setIncidentId(e.target.value)} placeholder="Link it to an incident" />
              </label>
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className={FIELD_LABEL}>Who else may open it</legend>
              {detail.shares.length === 0 ? (
                <p className="text-xs text-paper-faint">Only you: the dashboard is not shared with any role.</p>
              ) : detail.shares.map((share) => (
                <label key={share.roleId} className="flex items-center gap-2 text-xs text-paper-muted">
                  <Checkbox
                    aria-label={`Let ${share.roleDisplayName} open it`}
                    checked={roleIds.includes(share.roleId)}
                    onCheckedChange={(checked) => setRoleIds((ids) => (checked === true ? [...ids, share.roleId] : ids.filter((r) => r !== share.roleId)))}
                  />
                  {share.roleDisplayName}
                </label>
              ))}
            </fieldset>
            {take.isError && <p role="alert" className="text-xs text-red-300">{take.error.message}</p>}
            <Button className={cn(BTN_PRIMARY, "self-start")} disabled={take.isPending || name.trim() === ""} onClick={() => take.mutate()}>
              {take.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Camera className="mr-1.5 h-3.5 w-3.5" />} Take snapshot
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Saved snapshots</span>
          {list.isPending && <Loader2 className="h-4 w-4 animate-spin text-paper-dim" aria-label="Loading snapshots" />}
          {list.isError && <p role="alert" className="text-xs text-red-300">{list.error.message}</p>}
          {list.data?.length === 0 && <p className="text-xs text-paper-faint">No snapshots you can open.</p>}
          <ul className="flex flex-col gap-1" aria-label="Snapshots">
            {list.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-xs border border-ink-500 px-2 py-1.5 text-xs">
                <Link to={`/dashboards/${id}/snapshots/${s.id}`} className="min-w-0 flex-1 truncate text-paper hover:underline">{s.name}</Link>
                <span className="hidden text-paper-dim sm:inline">{new Date(s.range.from * 1000).toLocaleString()} – {new Date(s.range.to * 1000).toLocaleTimeString()}</span>
                <span className="font-mono text-[10px] text-paper-faint">{formatValue(s.sizeBytes, "bytes")}</span>
                {(s.createdBy === userId || detail.access.edit) && (
                  <Button size="icon" variant="ghost" className={cn(BTN_ICON, "h-6 w-6")} aria-label={`Delete ${s.name}`} disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
