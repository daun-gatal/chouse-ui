/**
 * One dashboard (ADR 0021 §12, ADR 0023 §1): the view bar, the canvas, and an
 * edit session — panels added, edited, removed, moved and resized locally, then
 * saved as a whole at the version that was loaded. A save that lost a race
 * says so and offers a reload; nothing is merged silently.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BarChart3, Copy, Database, CalendarClock, Camera, Download, Gauge, Heading, History, LayoutGrid, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings2, Share2, Sparkles, Trash2, Type } from "lucide-react";

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
  addNote,
  deleteDashboard,
  deleteNote,
  duplicateDashboard,
  exportDashboard,
  getAnnotations,
  getDashboard,
  panelInputOf,
  setPinned,
  tidyPanels,
  toInput,
  updateDashboard,
  type AnnotationEvent,
  type ChartPanelInput,
  type DashboardDetail,
  type DashboardInput,
  type HeadingPanelInput,
  type PanelInput,
  type TextPanelInput,
} from "@/api/dashboards";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { appendBelow, type Layout, type RefreshSeconds } from "@/lib/viz/spec";
import { RBAC_PERMISSIONS, genTabId, useAuthStore, useRbacStore, useWorkspaceStore } from "@/stores";
import { BTN_GHOST, BTN_ICON, BTN_OUTLINE, BTN_PRIMARY } from "@/components/charts/controlStyles";

import { dashboardKeys } from "../hooks";
import { bucketQueriesSql, linkAction } from "../links";
import { isAssignedTo, scopeLabel } from "../scope";
import { parseView, writeView, type ViewState } from "../urlState";
import { AskAiDialog } from "./AskAiDialog";
import { AnnotationDialog, ChartActionsDialog, NoteDialog, type ChartActionsTarget } from "./ChartActions";
import { ExplainSpikeDialog } from "./ExplainSpikeDialog";
import { PanelCostDialog } from "./PanelCostDialog";
import { ReportsDialog } from "./ReportsDialog";
import { SnapshotsDialog } from "./SnapshotsDialog";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { ConnectionsDialog } from "./ConnectionsDialog";
import { DashboardCanvas, type CanvasItem } from "./DashboardCanvas";
import { DashboardSettingsDialog } from "./DashboardSettingsDialog";
import { NotAssignedNotice } from "./NotAssignedNotice";
import { HeadingPanelCard, PanelCard, TextPanelCard, type TimeSpan } from "./PanelCard";
import { PanelAlertsButton, useDashboardAlerts } from "./PanelAlerts";
import { PanelEditor } from "./PanelEditor";
import { ShareDialog } from "./ShareDialog";
import { TextPanelDialog } from "./TextPanelDialog";
import { ViewControls } from "./ViewControls";

interface Draft {
  settings: Omit<DashboardInput, "panels">;
  panels: CanvasItem[];
}

let keySeq = 0;
const nextKey = (): string => `panel-${++keySeq}`;

function toDraft(detail: DashboardDetail): Draft {
  const { panels, ...settings } = toInput(detail);
  return { settings, panels: panels.map((panel) => ({ key: panel.id ?? nextKey(), panel })) };
}

/** Sizes new panels get, before the user resizes them. */
const NEW_SIZES = { chart: { w: 12, h: 9 }, text: { w: 8, h: 6 }, heading: { w: 24, h: 2 } } as const;

function newChart(layout: Layout): ChartPanelInput {
  return {
    id: null,
    kind: "chart",
    title: "New panel",
    sql: "SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t, count() AS queries\nFROM system.query_log\nWHERE event_time >= {{from}} AND event_time < {{to}}\nGROUP BY t ORDER BY t",
    viz: { version: 2, type: "line", x: "t", y: ["queries"], series: null, unit: "count", decimals: null, thresholds: [], colorScheme: "violet", reduce: null, links: [], baseline: null },
    fleet: false,
    layout,
  };
}

/** Alert threshold colors on charts: firing alerts stand out. */
const ALERT_LINE_COLORS = { firing: "#EF4444", other: "#A1A1AA" };

type Editing =
  | { kind: "chart"; key: string | null; panel: ChartPanelInput }
  | { kind: "text"; key: string | null; panel: TextPanelInput }
  | { kind: "heading"; key: string | null; panel: HeadingPanelInput };

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
  const [editingPanel, setEditingPanel] = useState<Editing | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [costFor, setCostFor] = useState<{ panelId: string; panel: ChartPanelInput } | null>(null);
  const canViewAlerting = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.ALERTING_VIEW));
  const canEditAlerting = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.ALERTING_EDIT));
  const canRun = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.QUERY_EXECUTE));
  const [tidying, setTidying] = useState(false);
  const [refresh, setRefresh] = useState<RefreshSeconds | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ key: string; title: string; alerts: number } | null>(null);
  const alerts = useDashboardAlerts(id);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const userId = useRbacStore((s) => s.user?.id ?? null);
  const [actions, setActions] = useState<ChartActionsTarget | null>(null);
  const [selected, setSelected] = useState<{ key: string; span: TimeSpan } | null>(null);
  const [marker, setMarker] = useState<AnnotationEvent | null>(null);
  const [noteAt, setNoteAt] = useState<number | null>(null);
  const [explaining, setExplaining] = useState<{ panelId: string; panel: ChartPanelInput; span: TimeSpan } | null>(null);

  const data = detail.data;
  const parsed = useMemo(() => (data ? parseView(params, data.dashboard) : null), [params, data]);
  const editing = draft !== null;

  // Every source the dashboard shows is read (so the toggles can show counts and failures); hidden ones are not drawn.
  const annotationSources = data?.dashboard.annotations ?? [];
  const viewRange = parsed?.view.range ?? null;
  const annotationsQuery = useQuery({
    queryKey: ["dashboards", "annotations", id, viewRange, annotationSources, activeConnectionId],
    queryFn: ({ signal }) => {
      if (viewRange === null) throw new Error("The dashboard is not loaded");
      return getAnnotations(id, viewRange, annotationSources, signal);
    },
    enabled: viewRange !== null && annotationSources.length > 0 && activeConnectionId !== null && !editing,
    refetchInterval: (refresh ?? data?.dashboard.refreshSeconds ?? 0) > 0 ? (refresh ?? data?.dashboard.refreshSeconds ?? 0) * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const hidden = parsed?.view.hidden ?? [];
  const annotationEvents = useMemo(
    () => (annotationsQuery.data?.sources ?? []).flatMap((r) => (r.ok && !hidden.includes(r.source) ? r.events : [])),
    [annotationsQuery.data, hidden],
  );

  const note = useMutation({
    mutationFn: ({ at, text }: { at: number; text: string }) => addNote(id, at, text),
    onSuccess: async () => {
      setNoteAt(null);
      await queryClient.invalidateQueries({ queryKey: ["dashboards", "annotations", id] });
      toast.success("Note added");
    },
  });
  const removeNote = useMutation({
    mutationFn: (noteId: string) => deleteNote(id, noteId),
    onSuccess: async () => {
      setMarker(null);
      await queryClient.invalidateQueries({ queryKey: ["dashboards", "annotations", id] });
      toast.success("Note deleted");
    },
    onError: (error) => toast.error(error.message),
  });

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

  const view: ViewState = parsed.view;
  const settings = draft ? draft.settings : toInput(data);
  const panels: CanvasItem[] = draft ? draft.panels : data.panels.map((p) => ({ key: p.id, panel: panelInputOf(p) }));
  const refreshSeconds = refresh ?? data.dashboard.refreshSeconds;
  const stored = new Map(data.panels.map((p) => [p.id, p]));

  /** The stored panel id to run, or null when this edit session changed what the server would run. */
  const runnableId = (panel: ChartPanelInput): string | null => {
    if (panel.id === null) return null;
    const s = stored.get(panel.id);
    return s && s.kind === "chart" && s.sql === panel.sql && s.fleet === panel.fleet && JSON.stringify(settings.variables) === JSON.stringify(data.dashboard.variables) ? s.id : null;
  };

  const setView = (next: ViewState): void => setParams(writeView(params, next), { replace: true });

  const followLink = (target: Extract<ChartActionsTarget, { kind: "datum" }>, index: number): void => {
    const link = target.panel.viz.links[index];
    if (!link) return;
    const action = linkAction(link, target.row, view.range, data.dashboard.variables);
    setActions(null);
    if (action.kind === "error") toast.error(action.message);
    else if (action.kind === "navigate") navigate(action.to);
    else setView({ ...view, values: { ...view.values, [action.variable]: action.value } });
  };

  const openQueries = (span: TimeSpan): void => {
    addTab({ id: genTabId(), title: `Queries · ${new Date(span.fromMs).toLocaleTimeString()}`, type: "sql", content: bucketQueriesSql(span.fromMs, span.toMs), isSaved: false });
    setActions(null);
    navigate("/explorer");
  };

  const zoomTo = (span: TimeSpan): void => {
    setActions(null);
    setSelected(null);
    setView({ ...view, range: { kind: "absolute", from: Math.floor(span.fromMs / 1000), to: Math.ceil(span.toMs / 1000) } });
  };

  const onLayoutChange = (places: Map<string, Layout>): void => {
    setDraft((current) => current && {
      ...current,
      panels: current.panels.map((item) => {
        const place = places.get(item.key);
        return place ? { ...item, panel: { ...item.panel, layout: place } } : item;
      }),
    });
  };

  const tidyUp = async (): Promise<void> => {
    if (!draft) return;
    setTidying(true);
    try {
      const { placed } = await tidyPanels(draft.panels.map((p) => ({
        key: p.key,
        kind: p.panel.kind,
        chartType: p.panel.kind === "chart" ? p.panel.viz.type : null,
        size: { w: p.panel.layout.w, h: p.panel.layout.h },
      })));
      const places = new Map(placed.flatMap((p) => (p.key === null ? [] : [[p.key, p.layout] as const])));
      setDraft({ ...draft, panels: draft.panels.map((item) => ({ ...item, panel: { ...item.panel, layout: places.get(item.key) ?? item.panel.layout } })) });
      toast.success("Laid out again: KPIs first, then trends, breakdowns and tables. Save to keep it, or cancel to undo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTidying(false);
    }
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

  const startAdding = (kind: keyof typeof NEW_SIZES): void => {
    if (!draft) return;
    const layout = appendBelow(draft.panels.map((p) => p.panel.layout), NEW_SIZES[kind]);
    if (kind === "chart") setEditingPanel({ kind, key: null, panel: newChart(layout) });
    else if (kind === "text") setEditingPanel({ kind, key: null, panel: { id: null, kind: "text", title: "", markdown: "", layout } });
    else setEditingPanel({ kind, key: null, panel: { id: null, kind: "heading", title: "", description: "", layout } });
  };

  const savePanel = (panel: PanelInput): void => {
    if (!draft || !editingPanel) return;
    const key = editingPanel.key;
    const panelsNext = key === null
      ? [...draft.panels, { key: nextKey(), panel }]
      : draft.panels.map((p) => (p.key === key ? { ...p, panel } : p));
    setDraft({ ...draft, panels: panelsNext });
    setEditingPanel(null);
  };

  const removePanel = (item: CanvasItem): void => {
    const count = item.panel.id ? data.alertCounts[item.panel.id] ?? 0 : 0;
    if (count > 0) setPendingRemoval({ key: item.key, title: item.panel.title || "this panel", alerts: count });
    else if (draft) setDraft({ ...draft, panels: draft.panels.filter((p) => p.key !== item.key) });
  };

  const renderItem = (item: CanvasItem, heightPx: number): React.ReactNode => {
    const { key, panel } = item;
    if (panel.kind === "heading") {
      return <HeadingPanelCard panel={panel} editing={editing} onEdit={() => setEditingPanel({ kind: "heading", key, panel })} onRemove={() => removePanel(item)} />;
    }
    if (panel.kind === "text") {
      return <TextPanelCard panel={panel} editing={editing} onEdit={() => setEditingPanel({ kind: "text", key, panel })} onRemove={() => removePanel(item)} />;
    }
    return (
      <PanelCard
        dashboardId={id}
        panelId={runnableId(panel)}
        panel={panel}
        view={view}
        height={heightPx}
        refreshSeconds={editing ? 0 : refreshSeconds}
        editing={editing}
        lint={panel.id ? data.lint[panel.id] ?? [] : []}
        onEdit={() => setEditingPanel({ kind: "chart", key, panel })}
        onRemove={() => removePanel(item)}
        actions={!editing && panel.id ? (
          <>
            <Button variant="ghost" size="icon" className={BTN_ICON} aria-label={`Cost of ${panel.title}`} onClick={() => { if (panel.id) setCostFor({ panelId: panel.id, panel }); }}><Gauge className="h-3.5 w-3.5" /></Button>
            <PanelAlertsButton detail={data} panelId={panel.id} panel={panel} view={view} />
          </>
        ) : undefined}
        alertLines={(alerts.data ?? []).flatMap((a) => (a.enabled && a.panelId === panel.id && a.config.kind === "threshold" && panel.viz.y.includes(a.config.column)
          ? [{ value: a.config.value, color: a.status?.state === "firing" ? ALERT_LINE_COLORS.firing : ALERT_LINE_COLORS.other }]
          : []))}
        annotations={editing ? [] : annotationEvents}
        selection={selected?.key === key ? selected.span : null}
        onDatum={editing ? undefined : (row, bucket) => setActions({ kind: "datum", panel, row, bucket })}
        onSelectRange={editing ? undefined : (span) => { setSelected({ key, span }); setActions({ kind: "range", panel, span }); }}
        onMarker={editing ? undefined : setMarker}
      />
    );
  };

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" className={BTN_OUTLINE}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => startAdding("chart")}><BarChart3 className="mr-2 h-3.5 w-3.5" /> Chart</DropdownMenuItem>
                <DropdownMenuItem onClick={() => startAdding("text")}><Type className="mr-2 h-3.5 w-3.5" /> Text</DropdownMenuItem>
                <DropdownMenuItem onClick={() => startAdding("heading")}><Heading className="mr-2 h-3.5 w-3.5" /> Heading</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" className={BTN_OUTLINE} onClick={() => void tidyUp()} disabled={tidying || panels.length === 0}><LayoutGrid className="mr-1.5 h-3.5 w-3.5" /> {tidying ? "Tidying…" : "Tidy up"}</Button>
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
                <DropdownMenuItem onClick={() => setHistoryOpen(true)}><History className="mr-2 h-3.5 w-3.5" /> Version history</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSnapshotsOpen(true)}><Camera className="mr-2 h-3.5 w-3.5" /> Snapshots</DropdownMenuItem>
                {canViewAlerting && <DropdownMenuItem onClick={() => setReportsOpen(true)}><CalendarClock className="mr-2 h-3.5 w-3.5" /> Scheduled reports</DropdownMenuItem>}
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
            annotations={data.dashboard.annotations}
            annotationResults={annotationsQuery.data?.sources ?? []}
            view={view}
            refreshSeconds={refreshSeconds}
            onViewChange={setView}
            onRefreshChange={setRefresh}
          />

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {panels.length === 0 ? (
              <div className="rounded-md border border-dashed border-ink-500 p-10 text-center text-sm text-paper-faint" data-testid="panel-grid">
                {editing ? "Add a chart, a text panel or a heading to start." : data.access.edit ? "This dashboard has no panels yet. Edit it to add one." : "This dashboard has no panels yet."}
              </div>
            ) : (
              <DashboardCanvas items={panels} editing={editing} onLayoutChange={onLayoutChange} renderItem={renderItem} />
            )}
          </div>
        </>
      )}

      {editingPanel?.kind === "chart" && (
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
      {editingPanel?.kind === "text" && (
        <TextPanelDialog open onOpenChange={(open) => { if (!open) setEditingPanel(null); }} initial={editingPanel.panel} onSave={savePanel} />
      )}
      {editingPanel?.kind === "heading" && (
        <TextPanelDialog open onOpenChange={(open) => { if (!open) setEditingPanel(null); }} initial={editingPanel.panel} onSave={savePanel} />
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
      {actions && (
        <ChartActionsDialog
          target={actions}
          canNote={data.access.edit}
          canExplain={canAskAi && actions.panel.id !== null && activeConnectionId !== null}
          onClose={() => { setActions(null); setSelected(null); }}
          onLink={(index) => { if (actions.kind === "datum") followLink(actions, index); }}
          onQueries={openQueries}
          onNote={(at) => { setActions(null); setSelected(null); setNoteAt(at); }}
          onZoom={zoomTo}
          onExplain={(span) => {
            const panelId = actions.panel.id;
            setActions(null);
            setSelected(null);
            if (panelId !== null) setExplaining({ panelId, panel: actions.panel, span });
          }}
        />
      )}
      {explaining && activeConnectionId !== null && parsed && (
        <ExplainSpikeDialog
          dashboardId={id}
          panelId={explaining.panelId}
          panel={explaining.panel}
          span={explaining.span}
          values={parsed.view.values}
          connectionId={activeConnectionId}
          canNote={data.access.edit}
          onNoted={() => void queryClient.invalidateQueries({ queryKey: ["dashboards", "annotations", id] })}
          onClose={() => setExplaining(null)}
        />
      )}
      {marker && (
        <AnnotationDialog
          event={marker}
          canDelete={marker.source === "notes" && (data.access.edit || marker.authorId === userId)}
          deleting={removeNote.isPending}
          onDelete={() => removeNote.mutate(marker.id)}
          onClose={() => setMarker(null)}
        />
      )}
      {noteAt !== null && (
        <NoteDialog atMs={noteAt} saving={note.isPending} error={note.isError ? note.error.message : null} onSave={(text) => note.mutate({ at: noteAt, text })} onClose={() => setNoteAt(null)} />
      )}
      {costFor && <PanelCostDialog detail={data} panelId={costFor.panelId} panel={costFor.panel} view={view} onClose={() => setCostFor(null)} />}
      {reportsOpen && (
        <ReportsDialog detail={data} connectionId={activeConnectionId} canManage={canEditAlerting && data.access.edit} onClose={() => setReportsOpen(false)} />
      )}
      {snapshotsOpen && (
        <SnapshotsDialog
          detail={data}
          range={view.range}
          values={view.values}
          canTake={canRun && activeConnectionId !== null && (data.scope.kind === "any" || isAssignedTo(data.scope, activeConnectionId))}
          userId={userId}
          onClose={() => setSnapshotsOpen(false)}
        />
      )}
      {historyOpen && (
        <VersionHistoryDialog
          detail={data}
          canRestore={data.access.edit}
          onRestored={(next) => {
            queryClient.setQueryData(dashboardKeys.detail(id), next);
            void queryClient.invalidateQueries({ queryKey: dashboardKeys.list() });
            void queryClient.invalidateQueries({ queryKey: dashboardKeys.alerts(id) });
            setHistoryOpen(false);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
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
