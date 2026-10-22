/**
 * One dashboard (ADR 0021 §12): the view bar, the panel grid, and an edit
 * session — panels added, edited, removed and reordered locally, then saved
 * as a whole at the version that was loaded. A save that lost a race says so
 * and offers a reload; nothing is merged silently.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { ArrowLeft, Copy, Database, Download, GripVertical, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings2, Share2, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApiError } from "@/api/client";
import {
  deleteDashboard,
  duplicateDashboard,
  exportDashboard,
  getDashboard,
  setPinned,
  toInput,
  updateDashboard,
  type DashboardDetail,
  type DashboardInput,
  type PanelInput,
} from "@/api/dashboards";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import type { RefreshSeconds } from "@/lib/viz/spec";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { BTN_GHOST, BTN_ICON, BTN_OUTLINE, BTN_PRIMARY } from "@/components/charts/controlStyles";

import { dashboardKeys } from "../hooks";
import { isAssignedTo, scopeLabel } from "../scope";
import { parseView, writeView, type ViewState } from "../urlState";
import { AskAiDialog } from "./AskAiDialog";
import { ConnectionsDialog } from "./ConnectionsDialog";
import { DashboardSettingsDialog } from "./DashboardSettingsDialog";
import { NotAssignedNotice } from "./NotAssignedNotice";
import { PanelCard, WIDTH_CLASSES } from "./PanelCard";
import { PanelAlertsButton, useDashboardAlerts } from "./PanelAlerts";
import { PanelEditor } from "./PanelEditor";
import { ShareDialog } from "./ShareDialog";
import { ViewControls } from "./ViewControls";

interface DraftPanel {
  /** Stable key for drag and drop and React, independent of the stored id. */
  key: string;
  panel: PanelInput;
}

interface Draft {
  settings: Omit<DashboardInput, "panels">;
  panels: DraftPanel[];
}

let keySeq = 0;
const nextKey = (): string => `panel-${++keySeq}`;

function toDraft(detail: DashboardDetail): Draft {
  const { panels, ...settings } = toInput(detail);
  return { settings, panels: panels.map((panel) => ({ key: panel.id ?? nextKey(), panel })) };
}

const NEW_PANEL: PanelInput = {
  id: null,
  title: "New panel",
  sql: "SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t, count() AS queries\nFROM system.query_log\nWHERE event_time >= {{from}} AND event_time < {{to}}\nGROUP BY t ORDER BY t",
  viz: { version: 2, type: "line", x: "t", y: ["queries"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null },
  width: 6,
  height: "m",
  fleet: false,
};

function SortablePanel({ id, width, children }: { id: string; width: PanelInput["width"]; children: (handle: React.ReactNode) => React.ReactElement }): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button type="button" className="cursor-grab text-paper-faint hover:text-paper" aria-label="Drag to reorder" {...attributes} {...listeners}>
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }} className={cn("col-span-12 min-w-0", WIDTH_CLASSES[width])}>
      {children(handle)}
    </div>
  );
}

/** Alert threshold colors on charts: firing alerts stand out. */
const ALERT_LINE_COLORS = { firing: "#EF4444", other: "#A1A1AA" };

export function DashboardView({ id }: { id: string }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canCreate = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.DASHBOARDS_EDIT));
  const canAskAi = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const activeConnectionName = useAuthStore((s) => s.activeConnectionName);
  const [askAi, setAskAi] = useState(false);
  const detail = useQuery({ queryKey: dashboardKeys.detail(id), queryFn: () => getDashboard(id) });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState(false);
  const [editingPanel, setEditingPanel] = useState<{ key: string | null; panel: PanelInput } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refresh, setRefresh] = useState<RefreshSeconds | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ key: string; title: string; alerts: number } | null>(null);
  const alerts = useDashboardAlerts(id);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const data = detail.data;
  const parsed = useMemo(() => (data ? parseView(params, data.dashboard) : null), [params, data]);
  const editing = draft !== null;

  // `?edit=1` (a new dashboard) opens straight into editing, once.
  useEffect(() => {
    if (!data || !params.has("edit")) return;
    if (data.access.edit) setDraft((current) => current ?? toDraft(data));
    const next = new URLSearchParams(params);
    next.delete("edit");
    setParams(next, { replace: true });
  }, [data, params, setParams]);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      if (!data) throw new Error("The dashboard is not loaded");
      return updateDashboard(id, data.dashboard.version, { ...d.settings, panels: d.panels.map((p) => p.panel) });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(dashboardKeys.detail(id), saved);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      setDraft(null);
      setConflict(false);
      toast.success("Dashboard saved");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.statusCode === 409) setConflict(true);
      log.error("Saving the dashboard failed", error);
    },
  });

  const pin = useMutation({
    mutationFn: (pinned: boolean) => setPinned(id, pinned),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
    onError: (error) => toast.error(error.message),
  });

  if (detail.isPending) return <div className="p-6 text-sm text-paper-faint">Loading dashboard…</div>;
  if (detail.isError || !data || !parsed) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p role="alert" className="text-sm text-red-300">{detail.error?.message ?? "The dashboard could not be loaded"}</p>
        <Button variant="outline" className={BTN_OUTLINE} onClick={() => navigate("/dashboards")}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> All dashboards</Button>
      </div>
    );
  }

  const view = parsed.view;
  const settings = draft ? draft.settings : toInput(data);
  const panels: DraftPanel[] = draft ? draft.panels : data.panels.map((p) => ({ key: p.id, panel: { id: p.id, title: p.title, sql: p.sql, viz: p.viz, width: p.width, height: p.height, fleet: p.fleet } }));
  const refreshSeconds = refresh ?? data.dashboard.refreshSeconds;
  const stored = new Map(data.panels.map((p) => [p.id, p]));

  /** The stored panel id to run, or null when this edit session changed what the server would run. */
  const runnableId = (panel: PanelInput): string | null => {
    if (panel.id === null) return null;
    const s = stored.get(panel.id);
    return s && s.sql === panel.sql && s.fleet === panel.fleet && JSON.stringify(settings.variables) === JSON.stringify(data.dashboard.variables) ? s.id : null;
  };

  const setView = (next: ViewState): void => setParams(writeView(params, next), { replace: true });

  const onDragEnd = (event: DragEndEvent): void => {
    if (!draft || !event.over || event.active.id === event.over.id) return;
    const from = draft.panels.findIndex((p) => p.key === event.active.id);
    const to = draft.panels.findIndex((p) => p.key === event.over?.id);
    if (from < 0 || to < 0) return;
    setDraft({ ...draft, panels: arrayMove(draft.panels, from, to) });
  };

  const download = async (): Promise<void> => {
    try {
      const body = await exportDashboard(id);
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.dashboard.title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "dashboard"}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicate = async (): Promise<void> => {
    try {
      const copy = await duplicateDashboard(id);
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      navigate(`/dashboards/${copy.dashboard.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await deleteDashboard(id);
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
      toast.success("Dashboard deleted");
      navigate("/dashboards");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const savePanel = (panel: PanelInput): void => {
    if (!draft || !editingPanel) return;
    const panelsNext = editingPanel.key === null
      ? [...draft.panels, { key: nextKey(), panel }]
      : draft.panels.map((p) => (p.key === editingPanel.key ? { ...p, panel } : p));
    setDraft({ ...draft, panels: panelsNext });
    setEditingPanel(null);
  };

  const grid = (
    <div className="grid grid-cols-12 gap-3 p-4" data-testid="panel-grid">
      {panels.map(({ key, panel }) => {
        const card = (handle?: React.ReactNode): React.ReactElement => (
          <PanelCard
            key={key}
            dashboardId={id}
            panelId={runnableId(panel)}
            panel={panel}
            view={view}
            refreshSeconds={editing ? 0 : refreshSeconds}
            editing={editing}
            lint={panel.id ? data.lint[panel.id] ?? [] : []}
            onEdit={() => setEditingPanel({ key, panel })}
            onRemove={() => {
              const count = panel.id ? data.alertCounts[panel.id] ?? 0 : 0;
              if (count > 0) setPendingRemoval({ key, title: panel.title, alerts: count });
              else if (draft) setDraft({ ...draft, panels: draft.panels.filter((p) => p.key !== key) });
            }}
            dragHandle={handle}
            wrapped={editing}
            actions={!editing && panel.id ? <PanelAlertsButton detail={data} panelId={panel.id} panel={panel} view={view} /> : undefined}
            alertLines={(alerts.data ?? [])
              .filter((a) => a.enabled && a.panelId === panel.id && panel.viz.y.includes(a.config.column))
              .map((a) => ({ value: a.config.value, color: a.status?.state === "firing" ? ALERT_LINE_COLORS.firing : ALERT_LINE_COLORS.other }))}
          />
        );
        return editing ? <SortablePanel key={key} id={key} width={panel.width}>{(handle) => card(handle)}</SortablePanel> : card();
      })}
      {panels.length === 0 && (
        <div className="col-span-12 rounded-md border border-dashed border-ink-500 p-10 text-center text-sm text-paper-faint">
          {editing ? "Add a panel to start." : data.access.edit ? "This dashboard has no panels yet. Edit it to add one." : "This dashboard has no panels yet."}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-500 px-4 py-3">
        <Button variant="ghost" size="icon" className={cn(BTN_ICON, "h-8 w-8")} aria-label="All dashboards" onClick={() => navigate("/dashboards")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-paper">{settings.title}</h1>
          {settings.description && <p className="truncate text-xs text-paper-dim">{settings.description}</p>}
        </div>
        {data.access.edit && !editing ? (
          <button
            type="button"
            onClick={() => setConnectionsOpen(true)}
            className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim transition-colors hover:border-ink-400 hover:text-paper"
            aria-label={`Connections: ${scopeLabel(data.scope)}. Change`}
            data-testid="dashboard-scope"
          >
            <Database className="h-3 w-3" aria-hidden /> {scopeLabel(data.scope)}
          </button>
        ) : (
          <span className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim" data-testid="dashboard-scope">
            <Database className="h-3 w-3" aria-hidden /> {scopeLabel(data.scope)}
          </span>
        )}
        {data.shares.length > 0 && <span className="rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">Shared · {data.shares.map((s) => s.roleDisplayName).join(", ")}</span>}
        {editing ? (
          <>
            <Button variant="outline" className={BTN_OUTLINE} onClick={() => setEditingPanel({ key: null, panel: { ...NEW_PANEL } })}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add panel</Button>
            <Button variant="outline" className={BTN_OUTLINE} onClick={() => setSettingsOpen(true)}><Settings2 className="mr-1.5 h-3.5 w-3.5" /> Settings</Button>
            <Button variant="ghost" className={BTN_GHOST} onClick={() => { setDraft(null); setConflict(false); }}>Cancel</Button>
            <Button className={BTN_PRIMARY} onClick={() => save.mutate(draft)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className={BTN_GHOST} aria-label={data.pinned ? "Unpin from Home" : "Pin to Home"} onClick={() => pin.mutate(!data.pinned)}>
              {data.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
            {data.access.share && <Button variant="outline" className={BTN_OUTLINE} onClick={() => setShareOpen(true)}><Share2 className="mr-1.5 h-3.5 w-3.5" /> Share</Button>}
            {data.access.edit && canAskAi && <Button variant="outline" className={BTN_OUTLINE} onClick={() => setAskAi(true)}><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ask AI</Button>}
            {data.access.edit && <Button className={BTN_PRIMARY} onClick={() => setDraft(toDraft(data))}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className={cn(BTN_ICON, "h-8 w-8")} aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canCreate && <DropdownMenuItem onClick={() => void duplicate()}><Copy className="mr-2 h-3.5 w-3.5" /> Duplicate</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => void download()}><Download className="mr-2 h-3.5 w-3.5" /> Export JSON</DropdownMenuItem>
                {data.access.delete && <DropdownMenuItem className="text-red-300" onClick={() => setDeleteOpen(true)}><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </header>

      {conflict && (
        <div role="alert" className="flex items-center gap-3 border-b border-amber-900/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          <span className="flex-1">Someone saved this dashboard after you opened it. Reload to see their version; your unsaved changes will be lost.</span>
          <Button variant="outline" className={BTN_OUTLINE} onClick={() => { setDraft(null); setConflict(false); void detail.refetch(); }}>Reload</Button>
        </div>
      )}
      {save.isError && !conflict && <div role="alert" className="border-b border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-200">{save.error.message}</div>}
      {parsed.problems.length > 0 && (
        <div role="status" className="border-b border-amber-900/40 bg-amber-950/20 px-4 py-2 text-xs text-amber-200">
          {parsed.problems.map((p) => <p key={p}>{p}. The dashboard's own setting is used instead.</p>)}
        </div>
      )}
      {editing && settings.variables.length > 0 && JSON.stringify(settings.variables) !== JSON.stringify(data.dashboard.variables) && (
        <div role="status" className="border-b border-ink-500 px-4 py-2 text-xs text-paper-dim">Variables changed: panels run again after you save.</div>
      )}

      {data.scope.kind === "only" && !editing && !isAssignedTo(data.scope, activeConnectionId) ? (
        <NotAssignedNotice scope={data.scope} activeConnectionName={activeConnectionName} />
      ) : (
        <>
          <ViewControls
            dashboardId={id}
            variables={data.dashboard.variables}
            view={view}
            refreshSeconds={refreshSeconds}
            onViewChange={setView}
            onRefreshChange={setRefresh}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {editing ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={panels.map((p) => p.key)} strategy={rectSortingStrategy}>{grid}</SortableContext>
              </DndContext>
            ) : grid}
          </div>
        </>
      )}

      {editingPanel && (
        <PanelEditor
          open
          onOpenChange={(open) => { if (!open) setEditingPanel(null); }}
          initial={editingPanel.panel}
          variables={settings.variables}
          connectionScope={settings.connectionScope}
          view={view}
          onSave={savePanel}
        />
      )}
      {settingsOpen && draft && (
        <DashboardSettingsDialog
          open
          onOpenChange={setSettingsOpen}
          settings={draft.settings}
          onApply={(next) => setDraft({ ...draft, settings: next })}
        />
      )}
      <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingRemoval?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This panel has {pendingRemoval?.alerts} alert{pendingRemoval?.alerts === 1 ? "" : "s"}. When you save, the panel and its alerts are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (draft && pendingRemoval) setDraft({ ...draft, panels: draft.panels.filter((p) => p.key !== pendingRemoval.key) });
              setPendingRemoval(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {askAi && <AskAiDialog open onOpenChange={setAskAi} existing={data} />}
      {shareOpen && <ShareDialog open onOpenChange={setShareOpen} dashboardId={id} shares={data.shares} />}
      {connectionsOpen && <ConnectionsDialog open onOpenChange={setConnectionsOpen} detail={data} />}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {data.dashboard.title}?</AlertDialogTitle>
            <AlertDialogDescription>The dashboard, its panels and their alerts are deleted for everyone it is shared with. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
