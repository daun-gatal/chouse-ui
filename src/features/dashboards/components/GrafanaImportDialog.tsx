/**
 * Grafana import (ADR 0023 §14): the server converts the file and says what
 * happened to every panel and variable; the user reviews it and imports the
 * convertible part through the normal import.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importDashboard, previewGrafana, type ConnectionScope, type GrafanaStatus } from "@/api/dashboards";
import { useAuthStore } from "@/stores";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD_LABEL } from "@/components/charts/controlStyles";

import { dashboardKeys } from "../hooks";
import { ConnectionsField, scopeProblem } from "./ConnectionsField";

/** A Grafana dashboard JSON, as exported from the UI or wrapped by the HTTP API. */
export function isGrafanaDashboard(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = "dashboard" in value && value.dashboard && typeof value.dashboard === "object" ? value.dashboard : value;
  return "panels" in doc && Array.isArray(doc.panels) && "schemaVersion" in doc;
}

const TONE: Record<GrafanaStatus, string> = { ready: "border-emerald-700/50 text-emerald-300", changed: "border-amber-700/50 text-amber-300", skipped: "border-ink-500 text-paper-dim" };

function Status({ status }: { status: GrafanaStatus }): React.ReactElement {
  return <span className={cn("shrink-0 rounded-full border px-1.5 font-mono text-[9px] uppercase tracking-[0.12em]", TONE[status])}>{status}</span>;
}

export function GrafanaImportDialog({ file, json, onClose }: { file: string; json: unknown; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const [scope, setScope] = useState<ConnectionScope>(() => ({ kind: "only", connectionIds: activeConnectionId ? [activeConnectionId] : [] }));
  const problem = scopeProblem(scope);
  const preview = useMutation({ mutationFn: () => previewGrafana(json, scope) });
  const save = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("Preview the conversion first");
      return importDashboard({ format: "chouse.dashboard/v2", id: null, dashboard: preview.data.dashboard });
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      toast.success(`Imported ${created.dashboard.title}`);
      onClose();
      navigate(`/dashboards/${created.dashboard.id}`);
    },
  });
  const data = preview.data;
  const kept = data ? data.panels.filter((p) => p.status !== "skipped").length : 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Grafana</DialogTitle>
          <DialogDescription>{file}: ClickHouse panels are converted; anything else is listed with the reason. Nothing is saved until you import.</DialogDescription>
        </DialogHeader>
        <ConnectionsField scope={scope} onChange={(next) => { setScope(next); preview.reset(); }} />
        {problem && <p className="text-[11px] text-amber-300">{problem}</p>}
        {!data && (
          <Button className={cn(BTN_PRIMARY, "self-start")} disabled={preview.isPending || problem !== null} onClick={() => preview.mutate()}>
            {preview.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Preview the conversion
          </Button>
        )}
        {preview.isError && <p role="alert" className="text-xs text-red-300">{preview.error.message}</p>}
        {data && (
          <div className="flex flex-col gap-3" data-testid="grafana-preview">
            <p className="text-sm text-paper">{data.dashboard.title} · {kept} of {data.panels.length} panels convert</p>
            {data.notes.length > 0 && (
              <ul className="list-disc pl-5 text-[11px] text-amber-200">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            )}
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Panels</span>
              {data.panels.map((p, i) => (
                <div key={`${p.title}-${i}`} className="flex items-start gap-2 rounded-xs border border-ink-500 px-2 py-1.5 text-xs" data-testid="grafana-panel">
                  <Status status={p.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-paper">{p.title} <span className="font-mono text-[10px] text-paper-faint">{p.grafanaType}</span></p>
                    {p.reason && <p className="text-[11px] text-paper-dim">{p.reason}</p>}
                    {p.changes.map((ch) => <p key={ch} className="text-[11px] text-amber-200">{ch}</p>)}
                  </div>
                </div>
              ))}
            </div>
            {data.variables.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className={FIELD_LABEL}>Variables</span>
                {data.variables.map((v) => (
                  <div key={v.name} className="flex items-start gap-2 text-xs">
                    <Status status={v.status} />
                    <span className="font-mono text-paper">{v.name}</span>
                    <span className="text-[11px] text-paper-dim">{[v.reason, ...v.changes].filter(Boolean).join(" · ")}</span>
                  </div>
                ))}
              </div>
            )}
            {save.isError && <p role="alert" className="text-xs text-red-300">{save.error.message}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Cancel</Button>
          {data && (
            <Button className={BTN_PRIMARY} disabled={save.isPending || data.dashboard.panels.length === 0} onClick={() => save.mutate()}>
              {save.isPending ? "Importing…" : `Import ${data.dashboard.panels.length} panel${data.dashboard.panels.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
