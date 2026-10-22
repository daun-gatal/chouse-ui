/**
 * All dashboards the user may see (ADR 0021 §12, ADR 0023 §15): one table with
 * tabs for their own, shared with them, pinned and the curated templates,
 * searchable, sortable and paged so a long list stays usable. New dashboards
 * start empty, from a template, or from an exported JSON file.
 */

import React, { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, FileUp, LayoutTemplate, Pin, Plus, Search, Sparkles, Users } from "lucide-react";

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
  setPinned,
  type ConnectionScope,
  type DashboardSummary,
  type DashboardTemplate,
} from "@/api/dashboards";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { BTN_GHOST, BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";
import { DEFAULT_ANNOTATION_SOURCES } from "@/lib/viz/spec";

import { dashboardKeys } from "../hooks";
import { LIST_SORTS, LIST_TABS, PAGE_SIZE, listPage, parseListParams, tabCounts, writeListParams, type ListParams, type ListSort, type ListTab } from "../listView";
import { isAssignedTo, scopeLabel } from "../scope";
import { ConnectionsField, scopeProblem } from "./ConnectionsField";
import { AskAiDialog } from "./AskAiDialog";

const TAB_LABELS: Record<ListTab, string> = { all: "All", mine: "Mine", shared: "Shared with me", pinned: "Pinned", templates: "Templates" };
const SORT_LABELS: Record<ListSort, string> = { updated: "Recently updated", title: "Name", panels: "Most panels" };

function updatedLabel(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function DashboardTable({ rows, onPin, pinning }: { rows: DashboardSummary[]; onPin: (d: DashboardSummary) => void; pinning: string | null }): React.ReactElement {
  return (
    <table className="w-full table-fixed border-collapse text-left text-sm" data-testid="dashboard-table">
      <thead>
        <tr className="border-b border-ink-500 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
          <th scope="col" className="w-9 py-2"><span className="sr-only">Pinned</span></th>
          <th scope="col" className="py-2 font-normal">Dashboard</th>
          <th scope="col" className="hidden w-36 py-2 font-normal md:table-cell">Owner</th>
          <th scope="col" className="hidden w-40 py-2 font-normal lg:table-cell">Connections</th>
          <th scope="col" className="w-16 py-2 text-right font-normal">Panels</th>
          <th scope="col" className="hidden w-28 py-2 pr-2 text-right font-normal sm:table-cell">Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id} className="border-b border-ink-500/60 hover:bg-ink-100" data-testid="dashboard-row">
            <td className="py-2 align-top">
              <Button
                size="icon"
                variant="ghost"
                className={cn(BTN_GHOST, "h-7 w-7", d.pinned ? "text-yellow-300" : "text-paper-dim")}
                aria-label={d.pinned ? `Unpin ${d.title}` : `Pin ${d.title}`}
                aria-pressed={d.pinned}
                disabled={pinning === d.id}
                onClick={() => onPin(d)}
              >
                <Pin className={cn("h-3.5 w-3.5", d.pinned && "fill-current")} />
              </Button>
            </td>
            <td className="min-w-0 py-2 pr-3 align-top">
              <Link to={`/dashboards/${d.id}`} className="flex items-center gap-2 font-medium text-paper hover:underline">
                <span className="truncate">{d.title}</span>
                {d.shares.length > 0 && <Users className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-label="Shared" />}
              </Link>
              {d.description && <p className="truncate text-xs text-paper-dim">{d.description}</p>}
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint md:hidden">{d.access.owner ? "yours" : `by ${d.ownerName ?? "a removed user"}`} · {scopeLabel(d.scope)}</p>
            </td>
            <td className="hidden truncate py-2 pr-3 align-top text-xs text-paper-muted md:table-cell">{d.access.owner ? "You" : d.ownerName ?? "A removed user"}</td>
            <td className="hidden truncate py-2 pr-3 align-top text-xs text-paper-muted lg:table-cell" data-testid="dashboard-card-scope">{scopeLabel(d.scope)}</td>
            <td className="py-2 text-right align-top font-mono text-xs text-paper-muted">{d.panelCount}</td>
            <td className="hidden py-2 pr-2 text-right align-top text-xs text-paper-dim sm:table-cell" title={new Date(d.updatedAt).toLocaleString()}>{updatedLabel(d.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TemplateGrid({ templates, canEdit, onUse }: { templates: DashboardTemplate[]; canEdit: boolean; onUse: (t: DashboardTemplate) => void }): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((t) => (
        <div key={t.id} className="flex flex-col gap-2 rounded-md border border-dashed border-ink-500 p-4">
          <span className="flex items-center gap-2 font-medium text-paper"><LayoutTemplate className="h-4 w-4 text-paper-dim" aria-hidden /> {t.title}</span>
          <span className={FIELD_LABEL}>{t.description}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">{t.dashboard.panels.length} panels</span>
          {canEdit && <Button variant="outline" className={cn(BTN_OUTLINE, "self-start")} onClick={() => onUse(t)}>Use template</Button>}
        </div>
      ))}
    </div>
  );
}

function NewDashboardDialog({ open, onOpenChange, template }: { open: boolean; onOpenChange: (open: boolean) => void; template: DashboardTemplate | null }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(template?.title ?? "New dashboard");
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  // Starts with the connection you are on; tick more, or All connections.
  const [scope, setScope] = useState<ConnectionScope>(() => ({ kind: "only", connectionIds: activeConnectionId ? [activeConnectionId] : [] }));
  const problem = scopeProblem(scope);
  const create = useMutation({
    mutationFn: () => template
      ? instantiateTemplate(template.id, scope)
      : createDashboard({ title: title.trim(), description: "", timeRange: "6h", refreshSeconds: 0, connectionScope: scope, variables: [], annotations: [...DEFAULT_ANNOTATION_SOURCES], panels: [] }),
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
          <ConnectionsField scope={scope} onChange={setScope} />
          {problem && <p className="text-[11px] text-amber-300">{problem}</p>}
          {create.isError && <p role="alert" className="text-xs text-red-300">{create.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={BTN_PRIMARY} onClick={() => create.mutate()} disabled={create.isPending || problem !== null || (!template && title.trim() === "")}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Export formats import takes: format 2, and format 1 from before CHouse 3.16 (the server converts it). */
export const EXPORT_FORMATS = ["chouse.dashboard/v2", "chouse.dashboard/v1"] as const;

/**
 * Read an exported dashboard file; a file that is not one says why. The
 * server checks the rest and converts a format 1 export.
 */
export async function readExport(file: File): Promise<Record<string, unknown>> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} is not JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${file.name} is not a CHouse dashboard export`);
  const format = (parsed as { format?: unknown }).format;
  if (typeof format !== "string" || !(EXPORT_FORMATS as readonly string[]).includes(format)) {
    throw new Error(`${file.name} is not a CHouse dashboard export (format ${EXPORT_FORMATS.join(" or ")})`);
  }
  return parsed as Record<string, unknown>;
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
  const [params, setParams] = useSearchParams();
  const view = parseListParams(params);
  const update = (next: Partial<ListParams>): void => {
    // Changing anything but the page starts again at page 1.
    setParams(writeListParams({ ...view, page: 1, ...next }), { replace: true });
  };
  const pin = useMutation({
    mutationFn: (d: DashboardSummary) => setPinned(d.id, !d.pinned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardKeys.list() }),
    onError: (error) => toast.error(error.message),
  });

  // The list is the active connection's dashboards; the others are a dock switch away.
  const all = useMemo(() => (dashboards.data ?? []).filter((d) => isAssignedTo(d.scope, activeConnectionId)), [dashboards.data, activeConnectionId]);
  const elsewhere = (dashboards.data ?? []).length - all.length;
  const counts = tabCounts(all);
  const page = listPage(all, view);
  const query = view.q.trim();
  const templateRows = (templates.data ?? []).filter((t) => query === "" || `${t.title}\n${t.description}`.toLowerCase().includes(query.toLowerCase()));
  const emptyText = query !== ""
    ? `No dashboards match "${query}".`
    : view.tab === "mine" ? (canEdit ? "You have no dashboards yet. Start from a template." : "You have no dashboards.")
    : view.tab === "shared" ? "Nothing is shared with you yet."
    : view.tab === "pinned" ? "Pin a dashboard to keep it at the top and on Home."
    : canEdit ? "No dashboards yet. Start empty, from a template, or ask AI." : "No dashboards yet.";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-500 px-4 py-4 sm:px-6">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-paper">Dashboards</h1>
          <p className="text-xs text-paper-dim">Your own charts of ClickHouse, run with each viewer's own access.</p>
        </div>
        {toolbar}
        <PermissionGuard requiredPermission={RBAC_PERMISSIONS.DASHBOARDS_EDIT}>
          <div className="flex flex-wrap items-center gap-2" data-onboarding-id="dashboards-create">
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
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Which dashboards" className="flex flex-wrap gap-1" data-onboarding-id="dashboards-list">
            {LIST_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={view.tab === tab}
                data-onboarding-id={tab === "templates" ? "dashboards-templates" : undefined}
                onClick={() => update({ tab })}
                className={cn(
                  "rounded-xs border px-2.5 py-1 text-xs transition-colors",
                  view.tab === tab ? "border-yellow-500/60 bg-yellow-500/10 text-paper" : "border-ink-500 text-paper-muted hover:border-ink-400",
                )}
              >
                {TAB_LABELS[tab]}
                <span className="ml-1.5 font-mono text-[10px] text-paper-dim">{tab === "templates" ? (templates.data?.length ?? 0) : counts[tab]}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search dashboards</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-dim" aria-hidden />
              <Input className={cn(FIELD, "h-8 w-56 pl-7")} placeholder="Search title, description, owner" value={view.q} onChange={(e) => update({ q: e.target.value })} maxLength={200} />
            </label>
            {view.tab !== "templates" && (
              <label className="flex items-center gap-1.5 text-xs text-paper-dim">
                Sort
                <select aria-label="Sort dashboards" className={cn(FIELD, "h-8 rounded-xs px-2 text-xs")} value={view.sort} onChange={(e) => update({ sort: LIST_SORTS.find((s) => s === e.target.value) ?? "updated" })}>
                  {LIST_SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>

        {view.tab === "templates" ? (
          <section className="flex flex-col gap-2">
            {templates.isError && <p role="alert" className="text-xs text-red-300">{templates.error.message}</p>}
            {templates.isPending ? <p className="text-sm text-paper-faint">Loading templates…</p> : templateRows.length === 0 ? (
              <p className="text-xs text-paper-faint">{query !== "" ? `No templates match "${query}".` : "No templates."}</p>
            ) : (
              <TemplateGrid templates={templateRows} canEdit={canEdit} onUse={(t) => setCreating({ template: t })} />
            )}
          </section>
        ) : (
          <section className="flex flex-col gap-3">
            {dashboards.isError && <p role="alert" className="text-sm text-red-300">{dashboards.error.message}</p>}
            {dashboards.isPending ? (
              <p className="text-sm text-paper-faint">Loading dashboards…</p>
            ) : page.total === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-ink-500 p-6">
                <p className="text-sm text-paper-dim">{emptyText}</p>
                {query === "" && (view.tab === "all" || view.tab === "mine") && (templates.data?.length ?? 0) > 0 && (
                  <Button variant="outline" className={BTN_OUTLINE} onClick={() => update({ tab: "templates" })}><LayoutTemplate className="mr-1.5 h-3.5 w-3.5" /> Browse templates</Button>
                )}
              </div>
            ) : (
              <>
                <DashboardTable rows={page.rows} onPin={(d) => pin.mutate(d)} pinning={pin.isPending ? pin.variables.id : null} />
                {page.pages > 1 && (
                  <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-xs text-paper-dim">
                    <span>{(page.page - 1) * PAGE_SIZE + 1}–{(page.page - 1) * PAGE_SIZE + page.rows.length} of {page.total}</span>
                    <Button size="icon" variant="ghost" className={cn(BTN_GHOST, "h-7 w-7")} aria-label="Previous page" disabled={page.page <= 1} onClick={() => update({ page: page.page - 1 })}><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="font-mono">{page.page} / {page.pages}</span>
                    <Button size="icon" variant="ghost" className={cn(BTN_GHOST, "h-7 w-7")} aria-label="Next page" disabled={page.page >= page.pages} onClick={() => update({ page: page.page + 1 })}><ChevronRight className="h-4 w-4" /></Button>
                  </nav>
                )}
              </>
            )}
            {elsewhere > 0 && (
              <p className="text-xs text-paper-faint" data-testid="dashboards-elsewhere">
                {elsewhere} more dashboard{elsewhere === 1 ? " is" : "s are"} assigned to other connections. Switch connection in the dock to see {elsewhere === 1 ? "it" : "them"}.
              </p>
            )}
          </section>
        )}
      </div>
      {askAi && <AskAiDialog open onOpenChange={setAskAi} existing={null} />}
      {creating && <NewDashboardDialog open onOpenChange={(open) => { if (!open) setCreating(null); }} template={creating.template} />}
    </div>
  );
}
