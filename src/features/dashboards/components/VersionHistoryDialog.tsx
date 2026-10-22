/**
 * Version history (ADR 0023 §11): the last 50 saves, what restoring one would
 * change, and the restore itself. A restore is a new save, so it goes through
 * every save check again and is undone by restoring the version before it.
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getVersion, listVersions, restorePreview, restoreVersion, toInput, type DashboardDetail, type VersionSource } from "@/api/dashboards";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/charts/controlStyles";

import { diffVersions, isEmptyDiff, type VersionDiff } from "../versionDiff";

const SOURCE_LABELS: Record<VersionSource, string> = {
  ui: "Saved", token: "API token", import: "Imported", template: "From a template", duplicate: "Duplicated", restore: "Restored", migration: "Converted to v2",
};

interface Props {
  detail: DashboardDetail;
  canRestore: boolean;
  onRestored: (detail: DashboardDetail) => void;
  onClose: () => void;
}

function DiffList({ diff }: { diff: VersionDiff }): React.ReactElement {
  if (isEmptyDiff(diff)) return <p className="text-xs text-paper-dim">Same as the current dashboard.</p>;
  const rows: Array<{ label: string; items: string[] }> = [
    { label: "Settings", items: diff.settings },
    { label: "Brings back", items: diff.added.map((p) => p.title) },
    { label: "Removes", items: diff.removed.map((p) => p.title) },
    { label: "Changes", items: diff.changed.map((p) => `${p.title} (${p.parts.join(", ")})`) },
  ];
  return (
    <dl className="flex flex-col gap-1.5 text-xs" data-testid="version-diff">
      {rows.filter((r) => r.items.length > 0).map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">{r.label}</dt>
          <dd className="text-paper-muted">{r.items.join(" · ")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VersionHistoryDialog({ detail, canRestore, onRestored, onClose }: Props): React.ReactElement {
  const id = detail.dashboard.id;
  const current = detail.dashboard.version;
  const versions = useQuery({ queryKey: ["dashboards", "versions", id, current], queryFn: () => listVersions(id), retry: false });
  const [picked, setPicked] = useState<number | null>(null);
  const older = useMemo(() => (versions.data ?? []).filter((v) => v.version !== current), [versions.data, current]);
  const selected = picked ?? older[0]?.version ?? null;

  const record = useQuery({ queryKey: ["dashboards", "versions", id, "v", selected], queryFn: () => getVersion(id, selected ?? 0), enabled: selected !== null, retry: false });
  const preview = useQuery({ queryKey: ["dashboards", "versions", id, "preview", selected, current], queryFn: () => restorePreview(id, selected ?? 0), enabled: selected !== null && canRestore, retry: false });
  const diff = useMemo(() => (record.data ? diffVersions(toInput(detail), record.data.document) : null), [record.data, detail]);

  const restore = useMutation({
    mutationFn: (version: number) => restoreVersion(id, version, current),
    onSuccess: (next, version) => { toast.success(`Restored version ${version}`); onRestored(next); },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" aria-hidden /> Version history</DialogTitle>
          <DialogDescription>The last 50 saves of {detail.dashboard.title}. Restoring saves the old version as a new one; nothing is lost.</DialogDescription>
        </DialogHeader>
        {versions.isPending && <p className="flex items-center gap-2 text-sm text-paper-dim"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading versions…</p>}
        {versions.isError && <p role="alert" className="text-sm text-red-300">{versions.error.message}</p>}
        {versions.data && older.length === 0 && <p className="text-sm text-paper-dim">This is the only version so far.</p>}
        {older.length > 0 && (
          <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
            <ul className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto" aria-label="Versions">
              <li className="rounded-xs border border-ink-500 px-2 py-1.5 text-xs text-paper-dim">v{current} · current</li>
              {older.map((v) => (
                <li key={v.version}>
                  <button
                    type="button"
                    aria-pressed={v.version === selected}
                    onClick={() => { setPicked(v.version); restore.reset(); }}
                    className={cn("w-full rounded-xs border px-2 py-1.5 text-left text-xs", v.version === selected ? "border-yellow-500/60 bg-yellow-500/5 text-paper" : "border-ink-500 text-paper-muted hover:border-ink-400")}
                  >
                    <span className="font-mono">v{v.version}</span> · {SOURCE_LABELS[v.source]}
                    <span className="block text-[11px] text-paper-dim">{new Date(v.savedAt).toLocaleString()}{v.savedByName ? ` · ${v.savedByName}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 rounded-xs border border-ink-500 p-3">
              {record.isPending && <Loader2 className="h-4 w-4 animate-spin text-paper-dim" aria-label="Loading version" />}
              {record.isError && <p role="alert" className="text-sm text-red-300">{record.error.message}</p>}
              {diff && <DiffList diff={diff} />}
              {preview.data && preview.data.removedAlerts.length > 0 && (
                <p className="rounded-xs border border-amber-900/40 bg-amber-950/20 p-2 text-[11px] text-amber-200" role="status">
                  Restoring deletes these alerts with their panels: {preview.data.removedAlerts.map((a) => a.name).join(", ")}.
                </p>
              )}
              {preview.isError && <p role="alert" className="text-xs text-red-300">{preview.error.message}</p>}
              {restore.isError && <p role="alert" className="text-xs text-red-300">{restore.error.message}</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Close</Button>
          {canRestore && selected !== null && (
            <Button className={BTN_PRIMARY} disabled={restore.isPending || !diff || isEmptyDiff(diff) || preview.isPending} onClick={() => restore.mutate(selected)}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore v{selected}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
