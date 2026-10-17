/**
 * All dashboards the user may see (ADR 0021 §12): pinned, their own, shared
 * with them, and the curated templates to start from. New dashboards start
 * empty, from a template, or from an exported JSON file.
 */

import React, { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, LayoutTemplate, Pin, Plus, Sparkles, Users } from "lucide-react";

import PermissionGuard from "@/components/common/PermissionGuard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createDashboard,
  importDashboard,
  instantiateTemplate,
  listDashboards,
  listTemplates,
  type DashboardExport,
  type DashboardSummary,
  type DashboardTemplate,
} from "@/api/dashboards";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";

import { dashboardKeys } from "../hooks";
import { isAssignedTo, scopeForNew, scopeLabel } from "../scope";
import { AskAiDialog } from "./AskAiDialog";

function DashboardCard({ dashboard }: { dashboard: DashboardSummary }): React.ReactElement {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/dashboards/${dashboard.id}`)}
      className="flex flex-col items-start gap-1 rounded-md border border-ink-500 bg-ink-100 p-4 text-left transition-colors hover:border-ink-400 hover:bg-ink-200"
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-paper">{dashboard.title}</span>
        {dashboard.pinned && <Pin className="h-3.5 w-3.5 text-paper-dim" aria-label="Pinned" />}
        {dashboard.shares.length > 0 && <Users className="h-3.5 w-3.5 text-paper-dim" aria-label="Shared" />}
      </span>
      {dashboard.description && <span className="line-clamp-2 text-xs text-paper-dim">{dashboard.description}</span>}
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">
        {dashboard.panelCount} panel{dashboard.panelCount === 1 ? "" : "s"} · {dashboard.access.owner ? "yours" : `by ${dashboard.ownerName ?? "a removed user"}`}
      </span>
      <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint" data-testid="dashboard-card-scope">{scopeLabel(dashboard.scope)}</span>
    </button>
  );
}

function Section({ title, dashboards, empty }: { title: string; dashboards: DashboardSummary[]; empty: string }): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper-dim">{title}</h2>
      {dashboards.length === 0 ? (
        <p className="text-xs text-paper-faint">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => <DashboardCard key={d.id} dashboard={d} />)}
        </div>
      )}
    </section>
  );
}

function NewDashboardDialog({ open, onOpenChange, template }: { open: boolean; onOpenChange: (open: boolean) => void; template: DashboardTemplate | null }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(template?.title ?? "New dashboard");
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const activeConnectionName = useAuthStore((s) => s.activeConnectionName);
  const create = useMutation({
    mutationFn: () => template
      ? instantiateTemplate(template.id)
      : createDashboard({ title: title.trim(), description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: scopeForNew(activeConnectionId), variables: [], panels: [] }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      onOpenChange(false);
      navigate(template ? `/dashboards/${created.dashboard.id}` : `/dashboards/${created.dashboard.id}?edit=1`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{template ? `Use "${template.title}"` : "New dashboard"}</DialogTitle>
          <DialogDescription>{template ? template.description : "Start empty and add panels from the editor, or pin them from the SQL workspace's Chart tab."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {!template && (
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Title</span>
              <Input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </label>
          )}
          <p className="text-xs text-paper-dim">
            For {activeConnectionName ? <span className="font-mono">{activeConnectionName}</span> : "the connection you are on"}. Settings can assign it to more connections.
          </p>
          {create.isError && <p role="alert" className="text-xs text-red-300">{create.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={BTN_PRIMARY} onClick={() => create.mutate()} disabled={create.isPending || (!template && title.trim() === "")}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Read an exported dashboard file; a file that is not one says why. */
export async function readExport(file: File): Promise<DashboardExport> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} is not JSON`);
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { format?: unknown }).format !== "chouse.dashboard/v1") {
    throw new Error(`${file.name} is not a CHouse dashboard export (format chouse.dashboard/v1)`);
  }
  return parsed as DashboardExport;
}

export function DashboardList({ toolbar }: { toolbar?: React.ReactNode }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.DASHBOARDS_EDIT));
  const dashboards = useQuery({ queryKey: dashboardKeys.list(), queryFn: listDashboards });
  const templates = useQuery({ queryKey: dashboardKeys.templates(), queryFn: listTemplates });
  const [creating, setCreating] = useState<{ template: DashboardTemplate | null } | null>(null);
  const [askAi, setAskAi] = useState(false);
  const canAskAi = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File): Promise<void> => {
    try {
      const body = await readExport(file);
      const created = await importDashboard(body);
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      toast.success(`Imported ${created.dashboard.title}`);
      navigate(`/dashboards/${created.dashboard.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  // The list is the active connection's dashboards; the others are a dock switch away.
  const all = (dashboards.data ?? []).filter((d) => isAssignedTo(d.scope, activeConnectionId));
  const elsewhere = (dashboards.data ?? []).length - all.length;
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-500 px-6 py-4">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-paper">Dashboards</h1>
          <p className="text-xs text-paper-dim">Your own charts of ClickHouse, run with each viewer's own access.</p>
        </div>
        {toolbar}
        <PermissionGuard requiredPermission={RBAC_PERMISSIONS.DASHBOARDS_EDIT}>
          <div className="flex items-center gap-2" data-onboarding-id="dashboards-create">
            {canAskAi && <Button variant="outline" className={BTN_OUTLINE} onClick={() => setAskAi(true)}><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ask AI</Button>}
            <Button variant="outline" className={BTN_OUTLINE} onClick={() => fileRef.current?.click()}><FileUp className="mr-1.5 h-3.5 w-3.5" /> Import</Button>
            <Button className={BTN_PRIMARY} onClick={() => setCreating({ template: null })}><Plus className="mr-1.5 h-3.5 w-3.5" /> New dashboard</Button>
          </div>
        </PermissionGuard>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Import a dashboard file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImport(file);
          }}
        />
      </header>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-6" data-onboarding-id="dashboards-list">
          {dashboards.isError && <p role="alert" className="text-sm text-red-300">{dashboards.error.message}</p>}
          {dashboards.isPending ? (
            <p className="text-sm text-paper-faint">Loading dashboards…</p>
          ) : (
            <>
              {all.some((d) => d.pinned) && <Section title="Pinned" dashboards={all.filter((d) => d.pinned)} empty="" />}
              <Section title="Yours" dashboards={all.filter((d) => d.access.owner)} empty={canEdit ? "You have no dashboards yet. Start from a template below." : "You have no dashboards."} />
              <Section title="Shared with you" dashboards={all.filter((d) => !d.access.owner)} empty="Nothing is shared with you yet." />
              {elsewhere > 0 && (
                <p className="text-xs text-paper-faint" data-testid="dashboards-elsewhere">
                  {elsewhere} more dashboard{elsewhere === 1 ? " is" : "s are"} assigned to other connections. Switch connection in the dock to see {elsewhere === 1 ? "it" : "them"}.
                </p>
              )}
            </>
          )}
        </div>
        <section className="flex flex-col gap-2" data-onboarding-id="dashboards-templates">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper-dim">Templates</h2>
          {templates.isError && <p role="alert" className="text-xs text-red-300">{templates.error.message}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(templates.data ?? []).map((t) => (
              <div key={t.id} className="flex flex-col gap-2 rounded-md border border-dashed border-ink-500 p-4">
                <span className="flex items-center gap-2 font-medium text-paper"><LayoutTemplate className="h-4 w-4 text-paper-dim" aria-hidden /> {t.title}</span>
                <span className={FIELD_LABEL}>{t.description}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">{t.dashboard.panels.length} panels</span>
                {canEdit && <Button variant="outline" className={cn(BTN_OUTLINE, "self-start")} onClick={() => setCreating({ template: t })}>Use template</Button>}
              </div>
            ))}
          </div>
        </section>
      </div>
      {askAi && <AskAiDialog open onOpenChange={setAskAi} existing={null} />}
      {creating && <NewDashboardDialog open onOpenChange={(open) => { if (!open) setCreating(null); }} template={creating.template} />}
    </div>
  );
}
