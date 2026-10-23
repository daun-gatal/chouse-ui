/**
 * Dashboards › Ask AI (ADR 0021 §10, ADR 0023 §4): describe what to watch,
 * review the draft — every panel already checked and dry-run on the server,
 * with the role, importance and section the model chose — and add it as a
 * new dashboard or as new panels under this one.
 *
 * The review fills the screen: the panels by section beside a live preview
 * laid out as it will be saved (tabs on narrower screens, the details sliding
 * in), with Refine and Regenerate to revise the draft instead of starting
 * over. The model never places panels: the server's layout engine does, by
 * role. Blocked panels cannot be added; a fix is applied only when the user
 * presses it. The draft is tied to the connection it was checked on, and
 * nothing is saved until the user adds it — the save is checked again.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  arrangePanels,
  createDashboard,
  draftDashboard,
  getDashboard,
  panelInputOf,
  toInput,
  updateDashboard,
  type DashboardDetail,
  type DraftRevision,
  type PanelInput,
} from "@/api/dashboards";
import { useAiModelId, useWindowSize } from "@/hooks";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE } from "@/components/charts/controlStyles";
import { DEFAULT_ANNOTATION_SOURCES, MAX_VARIABLES, shiftDown } from "@/lib/viz/spec";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";

import {
  defaultValues,
  fixCount,
  includedPanels,
  initialReview,
  mergeVariables,
  revisionOf,
  reviewReducer,
  roomProblem,
  sectionsOf,
  statusCounts,
  type ReviewAction,
  type ReviewState,
} from "../askAi";
import { dashboardKeys } from "../hooks";
import { isAssignedTo, scopeForNew } from "../scope";
import { AskAiHeader, PrimaryAction, type PrimaryProps, type ReviewLayout } from "./AskAiHeader";
import { AskAiPanelDetail } from "./AskAiPanelDetail";
import { AskAiPanelList, type StatusFilter } from "./AskAiPanelList";
import { AskAiPreview, type PreviewRun } from "./AskAiPreview";
import { AskAiPrompt } from "./AskAiPrompt";

/** Widths where the list sits beside the preview, and where tabs replace it on a tablet. */
export const WIDE_FROM_PX = 1100;
export const TABLET_FROM_PX = 768;

export function layoutFor(width: number): ReviewLayout {
  if (width >= WIDE_FROM_PX) return "wide";
  if (width >= TABLET_FROM_PX) return "tablet";
  return "phone";
}

type AiOp = { kind: "draft" } | { kind: "refine" } | { kind: "regenerate"; panelId: string };
type Confirm = "close" | "startOver" | "warnings";

/** Navigation state DashboardView reads to bring the panels just added into view. */
export interface AddedPanelsState {
  highlightPanels: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Add the panels to this dashboard; null drafts a new one. */
  existing: DashboardDetail | null;
}

export function AskAiDialog({ open, onOpenChange, existing }: Props): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modelId = useAiModelId();
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const activeConnectionName = useAuthStore((s) => s.activeConnectionName);
  const canRunQueries = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.QUERY_EXECUTE));
  const layout = layoutFor(useWindowSize().width);

  const [goal, setGoal] = useState("");
  const [review, setReview] = useState<ReviewState | null>(null);
  /** The connection the draft was checked on: previews, Refine and the save use only it. */
  const [pinned, setPinned] = useState<{ id: string; name: string | null } | null>(null);
  const [op, setOp] = useState<AiOp | null>(null);
  const opRef = useRef<{ token: number; controller: AbortController } | null>(null);
  const tokens = useRef(0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "panels">("preview");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [refineText, setRefineText] = useState("");

  const dispatch = useCallback((action: ReviewAction): void => setReview((r) => (r ? reviewReducer(r, action) : r)), []);

  // A request still running when the window goes away is dropped.
  useEffect(() => () => opRef.current?.controller.abort(), []);

  // Leaving the page with a draft open loses it: let the browser ask first.
  useEffect(() => {
    if (!review) return undefined;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [review]);

  const existingContext = useMemo(
    () => (existing ? { title: existing.dashboard.title, variables: existing.dashboard.variables, panels: existing.panels.flatMap((p) => (p.kind === "chart" ? [{ title: p.title, sql: p.sql }] : [])) } : null),
    [existing],
  );
  const existingPanels = useMemo<PanelInput[]>(() => (existing ? existing.panels.map(panelInputOf) : []), [existing]);

  const panels = useMemo(() => review?.draft.panels ?? [], [review]);
  const sections = useMemo(() => sectionsOf(panels), [panels]);
  const selected = panels.find((p) => p.id === selectedId) ?? null;
  const connectionChanged = pinned !== null && activeConnectionId !== pinned.id;
  const pinnedName = pinned?.name ?? "the connection you drafted on";
  const locked = op !== null;

  const ask = async (kind: AiOp, revision?: DraftRevision): Promise<void> => {
    const connectionId = kind.kind === "draft" ? activeConnectionId : pinned?.id ?? null;
    if (connectionId === null) return;
    opRef.current?.controller.abort();
    const controller = new AbortController();
    const token = ++tokens.current;
    opRef.current = { token, controller };
    setOp(kind);
    setAiError(null);
    if (kind.kind === "draft") setDraftError(null);
    try {
      const result = await draftDashboard({ goal: goal.trim(), connectionId, existing: existingContext, ...(revision ? { revision } : {}) }, { modelId, signal: controller.signal });
      if (opRef.current?.token !== token) return;
      if (kind.kind === "draft") {
        setReview(initialReview(result));
        setPinned({ id: connectionId, name: activeConnectionName });
        setSelectedId(null);
        setFilter("all");
        setTab("preview");
      } else if (kind.kind === "refine") {
        dispatch({ type: "refined", draft: result });
        setRefineText("");
        setSelectedId(null);
        setFilter("all");
      } else {
        dispatch({ type: "regenerated", id: kind.panelId, draft: result });
      }
    } catch (error) {
      // Cancelled, or replaced by a newer request: its outcome no longer matters.
      if (opRef.current?.token !== token || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (kind.kind === "draft") setDraftError(message);
      else setAiError(message);
    } finally {
      if (opRef.current?.token === token) {
        opRef.current = null;
        setOp(null);
      }
    }
  };

  const cancelAi = (): void => {
    opRef.current?.controller.abort();
    opRef.current = null;
    setOp(null);
  };

  const accept = useMutation({
    mutationFn: async (): Promise<{ id: string; added: string[] }> => {
      if (!review || !pinned) throw new Error("Nothing to add");
      // Read at the moment of saving: the panels were checked on the pinned connection only.
      if (useAuthStore.getState().activeConnectionId !== pinned.id) throw new Error(`Switch back to ${pinnedName} to add these panels`);
      const chosen = sectionsOf(review.draft.panels);
      const byId = new Map(review.draft.panels.map((p) => [p.id, p]));
      const { placed } = await arrangePanels(chosen);
      const added: PanelInput[] = placed.map((p): PanelInput => {
        if (p.key === null) return { id: null, kind: "heading", title: p.heading.title, description: p.heading.description, layout: p.layout };
        const drafted = byId.get(p.key)?.draft.panel;
        if (!drafted) throw new Error("A placed panel has no chart");
        return { ...drafted, layout: p.layout };
      });
      if (!existing) {
        const created = await createDashboard({
          title: review.draft.title.trim(), description: review.draft.description.trim(), timeRange: "6h", refreshSeconds: 60, connectionScope: scopeForNew(pinned.id),
          variables: review.draft.variables, annotations: [...DEFAULT_ANNOTATION_SOURCES], panels: added,
        });
        return { id: created.dashboard.id, added: [] };
      }
      // Re-read so the save is at the current version, with the panels as they are now; the new ones go below them.
      const fresh = await getDashboard(existing.dashboard.id);
      const input = toInput(fresh);
      const room = roomProblem({ panels: input.panels, variables: input.variables }, chosen, review.draft.variables);
      if (room) throw new Error(room);
      const bottom = input.panels.reduce((max, p) => Math.max(max, p.layout.y + p.layout.h), 0);
      const { variables } = mergeVariables(input.variables, review.draft.variables);
      const saved = await updateDashboard(existing.dashboard.id, fresh.dashboard.version, { ...input, variables, panels: [...input.panels, ...shiftDown(added, bottom)] });
      const before = new Set(fresh.panels.map((p) => p.id));
      return { id: existing.dashboard.id, added: saved.panels.filter((p) => !before.has(p.id)).map((p) => p.id) };
    },
    onSuccess: async ({ id, added }) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      toast.success(existing ? `Added ${added.length} panel${added.length === 1 ? "" : "s"}` : "Dashboard created");
      onOpenChange(false);
      const state: AddedPanelsState | undefined = added.length > 0 ? { highlightPanels: added } : undefined;
      navigate(`/dashboards/${id}`, state ? { state } : undefined);
    },
  });
  const busy = locked || accept.isPending;

  const requestClose = (): void => {
    if (accept.isPending) return;
    if (review) {
      setConfirm("close");
      return;
    }
    cancelAi();
    onOpenChange(false);
  };

  const startOver = (): void => {
    setReview(null);
    setPinned(null);
    setSelectedId(null);
    setAiError(null);
    setRefineText("");
    accept.reset();
  };

  const selectPanel = (id: string): void => setSelectedId(id);
  const showStatus = (status: StatusFilter): void => {
    setFilter(status);
    setSelectedId(null);
    if (layout !== "wide") setTab("panels");
  };

  // ------------------------------------------------------------------ derived
  const counts = statusCounts(panels);
  const chosenCount = sections.reduce((n, s) => n + s.panels.length, 0);
  const warnings = includedPanels(panels).filter((p) => p.draft.status === "attention").length;
  const room = review ? roomProblem({ panels: existingPanels, variables: existing?.dashboard.variables ?? [] }, sections, review.draft.variables) : null;
  const connectionNote = connectionChanged
    ? `You switched to ${activeConnectionName ?? "another connection"}. These panels were checked on ${pinnedName}: switch back to preview, refine or add them.`
    : null;
  const aiBlocked = connectionChanged ? `Switch back to ${pinnedName} to ask the AI about this draft` : null;

  const disabledReason = connectionChanged
    ? `Switch back to ${pinnedName} to add these panels`
    : chosenCount === 0
      ? "Select at least one panel"
      : !existing && (review?.draft.title.trim() ?? "") === ""
        ? "Give the dashboard a title"
        : room;
  const primary: PrimaryProps = {
    label: existing ? `Add ${chosenCount} panel${chosenCount === 1 ? "" : "s"}` : `Create dashboard · ${chosenCount}`,
    onClick: () => (warnings > 0 ? setConfirm("warnings") : accept.mutate()),
    disabledReason,
    pending: accept.isPending,
    locked,
    warn: warnings > 0,
  };

  const draftBlocked = activeConnectionId === null
    ? "Pick a connection in the dock first: the drafter reads its schemas"
    : existing && existing.scope.kind === "only" && !isAssignedTo(existing.scope, activeConnectionId)
      ? `This dashboard is not assigned to ${activeConnectionName ?? "the connection you are on"}. Switch to one of its connections: panels are checked on the connection you are on.`
      : null;

  const previewVariables = useMemo(
    () => (review ? (existing ? mergeVariables(existing.dashboard.variables, review.draft.variables).variables : review.draft.variables).slice(0, MAX_VARIABLES) : []),
    [review, existing],
  );
  const run = useMemo<PreviewRun>(() => ({
    blocked: !canRunQueries
      ? "The preview needs permission to run queries (query:execute). You can still review and add the panels."
      : connectionChanged ? connectionNote : null,
    connectionId: pinned?.id ?? null,
    connectionScope: existing ? existing.dashboard.connectionScope : { kind: "only", connectionIds: pinned ? [pinned.id] : [] },
    range: { kind: "relative", value: existing?.dashboard.timeRange ?? "6h" },
    variables: previewVariables,
    values: defaultValues(previewVariables),
  }), [canRunQueries, connectionChanged, connectionNote, pinned, existing, previewVariables]);

  const skipped = review && existing ? mergeVariables(existing.dashboard.variables, review.draft.variables).skipped : [];
  const notes = review
    ? [
      ...(review.draft.variables.length > 0 ? [`Variables: ${review.draft.variables.map((v) => v.label).join(", ")}${skipped.length > 0 ? ` (this dashboard already has ${skipped.join(", ")}; its own definitions are kept)` : ""}`] : []),
      ...review.draft.problems,
    ]
    : [];

  // ------------------------------------------------------------------ pieces
  const list = (
    <AskAiPanelList
      panels={panels}
      filter={filter}
      onFilter={setFilter}
      selectedId={selectedId}
      onSelect={selectPanel}
      onInclude={(ids, include) => dispatch({ type: "include", ids, include })}
      onOnlyChecked={() => dispatch({ type: "onlyChecked" })}
      locked={busy}
    />
  );
  const detail = (onBack: (() => void) | null): React.ReactNode => selected && review && (
    <AskAiPanelDetail
      key={`${selected.id}:${review.history.length}`}
      panel={selected}
      onBack={onBack}
      onInclude={(include) => dispatch({ type: "include", ids: [selected.id], include })}
      onApplyFix={(code) => dispatch({ type: "applyFix", id: selected.id, code })}
      onRegenerate={(feedback) => void ask({ kind: "regenerate", panelId: selected.id }, revisionOf(review.draft, feedback, selected.id))}
      regenerating={op?.kind === "regenerate" && op.panelId === selected.id}
      locked={busy}
      aiBlocked={aiBlocked}
    />
  );
  const preview = review && (
    <AskAiPreview panels={panels} sections={sections} run={run} existingPanels={existingPanels.length} selectedId={selectedId} onSelect={selectPanel} />
  );

  const opLabel = op?.kind === "refine"
    ? "Refining the draft…"
    : op?.kind === "regenerate"
      ? `Regenerating ${panels.find((p) => p.id === op.panelId)?.draft.title ?? "the panel"}…`
      : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent
        className="left-0 top-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0"
        onboardingSurfaceDismissible={false}
        data-testid="ask-ai"
      >
        <DialogTitle className="sr-only">{existing ? `Add panels to ${existing.dashboard.title} with AI` : "Draft a dashboard with AI"}</DialogTitle>
        <DialogDescription className="sr-only">Describe what to watch; review the drafted panels and add them. Nothing is saved until you add it.</DialogDescription>

        {!review ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AskAiPrompt
              goal={goal}
              onGoal={setGoal}
              onDraft={() => void ask({ kind: "draft" })}
              drafting={op?.kind === "draft"}
              onCancel={cancelAi}
              error={draftError}
              blocked={draftBlocked}
              connectionName={activeConnectionName}
              existingTitle={existing?.dashboard.title ?? null}
            />
          </div>
        ) : (
          <>
            <AskAiHeader
              layout={layout}
              existingTitle={existing?.dashboard.title ?? null}
              title={review.draft.title}
              onTitle={(title) => dispatch({ type: "setTitle", title })}
              counts={counts}
              onFilter={showStatus}
              fixes={fixCount(panels)}
              onApplyFixes={() => dispatch({ type: "applyAllFixes" })}
              canUndo={review.history.length > 0}
              onUndo={() => {
                dispatch({ type: "undo" });
                setSelectedId(null);
              }}
              onStartOver={() => (review.dirty ? setConfirm("startOver") : startOver())}
              refine={{ text: refineText, onText: setRefineText, onSubmit: () => void ask({ kind: "refine" }, revisionOf(review.draft, refineText, null)), blocked: aiBlocked }}
              primary={primary}
              locked={busy}
            />

            <div className="flex shrink-0 flex-col gap-1 empty:hidden" data-testid="review-notices">
              {opLabel && (
                <div className="flex items-center gap-2 border-b border-ink-500 bg-ink-100 px-4 py-2 text-xs text-paper" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> <span className="min-w-0 flex-1 truncate">{opLabel}</span>
                  <Button variant="outline" className={cn(BTN_OUTLINE, "min-h-8")} onClick={cancelAi}>Cancel</Button>
                </div>
              )}
              {connectionNote && <p className="border-b border-amber-900/40 bg-amber-950/20 px-4 py-2 text-xs text-amber-200" data-testid="connection-changed">{connectionNote}</p>}
              {aiError && (
                <div role="alert" className="flex items-start gap-2 border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300">
                  <span className="min-w-0 flex-1 break-words">{aiError} The draft is unchanged.</span>
                  <button type="button" onClick={() => setAiError(null)} aria-label="Dismiss" className="shrink-0 p-1"><X className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {accept.isError && <p role="alert" className="break-words border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300">{accept.error.message}</p>}
              {notes.length > 0 && (
                <details className="border-b border-ink-500 px-4 py-1.5 text-xs text-paper-dim">
                  <summary className="cursor-pointer select-none py-1">Notes on this draft ({notes.length})</summary>
                  <ul className="flex flex-col gap-1 pb-1">
                    {notes.map((n) => <li key={n} className="break-words">{n}</li>)}
                  </ul>
                </details>
              )}
            </div>

            <div className="flex min-h-0 flex-1">
              {layout === "wide" && (
                <aside className="w-[320px] shrink-0 overflow-y-auto border-r border-ink-500" aria-label={selected ? "Panel details" : "Panels"}>
                  {selected ? detail(() => setSelectedId(null)) : list}
                </aside>
              )}
              <main className="flex min-w-0 flex-1 flex-col">
                {layout !== "wide" && (
                  <div className="flex shrink-0 border-b border-ink-500" role="tablist" aria-label="Review">
                    {(["preview", "panels"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className={cn("min-h-11 flex-1 border-b-2 text-xs font-medium", tab === t ? "border-brand text-paper" : "border-transparent text-paper-dim")}
                      >
                        {t === "preview" ? "Preview" : `Panels ${chosenCount}/${panels.length}`}
                      </button>
                    ))}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  {layout === "wide" || tab === "preview" ? preview : list}
                </div>
              </main>
            </div>

            {layout === "phone" && (
              <div className="flex shrink-0 flex-col gap-1 border-t border-ink-500 bg-ink-50 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2" data-testid="bottom-bar">
                {primary.disabledReason && <p id="ask-ai-primary-reason" className="text-center text-[11px] text-amber-300">{primary.disabledReason}</p>}
                <PrimaryAction primary={primary} className="h-11 w-full justify-center" />
              </div>
            )}

            {layout !== "wide" && (
              <Sheet open={selected !== null} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
                <SheetContent
                  side={layout === "phone" ? "bottom" : "right"}
                  className={cn("overflow-y-auto p-0", layout === "phone" ? "max-h-[85dvh] rounded-t-md" : "w-full sm:max-w-md")}
                >
                  <SheetTitle className="sr-only">{selected?.draft.title ?? "Panel"}</SheetTitle>
                  <SheetDescription className="sr-only">Details of the drafted panel</SheetDescription>
                  {detail(null)}
                </SheetContent>
              </Sheet>
            )}
          </>
        )}

        <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
          <AlertDialogContent>
            {confirm === "warnings" ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{warnings} included panel{warnings === 1 ? " has" : "s have"} warnings</AlertDialogTitle>
                  <AlertDialogDescription>They passed their checks, but something about them needs a look — a missing limit, a unit, a chart that does not fit its data.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => showStatus("attention")}>Review them</AlertDialogCancel>
                  <AlertDialogAction onClick={() => accept.mutate()}>{existing ? "Add anyway" : "Create anyway"}</AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{confirm === "close" ? "Discard this draft?" : "Start over?"}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {confirm === "close" ? "The drafted panels and your changes to them are lost." : "Your changes to this draft are lost. Your question is kept."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      cancelAi();
                      if (confirm === "close") onOpenChange(false);
                      else startOver();
                    }}
                  >
                    {confirm === "close" ? "Discard" : "Start over"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
