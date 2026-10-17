/**
 * Dashboards › Ask AI (ADR 0021 §10): describe what to watch, review the
 * draft — every panel already checked and dry-run on the server — and accept
 * it as a new dashboard or as new panels on this one. Blocked panels cannot be
 * accepted; a lint fix is applied only when the user presses it. Nothing is
 * saved until Accept, and the save is checked again.
 */

import React, { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, CircleX, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getConnectionId } from "@/api/client";
import {
  createDashboard,
  draftDashboard,
  getDashboard,
  toInput,
  updateDashboard,
  type DashboardDetail,
  type DashboardDraft,
  type DraftPanel,
  type PanelInput,
} from "@/api/dashboards";
import { cn } from "@/lib/utils";
import { BTN_INLINE, BTN_OUTLINE, BTN_PRIMARY, TEXTAREA } from "@/components/charts/controlStyles";
import type { Variable } from "@/lib/viz/spec";

import { dashboardKeys } from "../hooks";

const STATUS = {
  ok: { icon: CircleCheck, label: "Checked", className: "text-emerald-300" },
  attention: { icon: CircleAlert, label: "Check this", className: "text-amber-300" },
  blocked: { icon: CircleX, label: "Blocked", className: "text-red-400" },
} as const;

interface ReviewPanel {
  draft: DraftPanel;
  include: boolean;
}

/** Variables for an existing dashboard plus the draft's new ones; a name it already has keeps its definition. */
export function mergeVariables(existing: Variable[], drafted: Variable[]): { variables: Variable[]; skipped: string[] } {
  const names = new Set(existing.map((v) => v.name));
  const added = drafted.filter((v) => !names.has(v.name));
  const skipped = drafted.filter((v) => names.has(v.name)).map((v) => v.name);
  return { variables: [...existing, ...added], skipped };
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
  const [goal, setGoal] = useState("");
  const [review, setReview] = useState<{ draft: DashboardDraft; panels: ReviewPanel[] } | null>(null);
  const connectionId = getConnectionId();

  const draft = useMutation({
    mutationFn: () => {
      if (connectionId === null) throw new Error("Pick a connection first: the drafter reads its schemas");
      return draftDashboard({
        goal: goal.trim(),
        connectionId,
        existing: existing ? { title: existing.dashboard.title, variables: existing.dashboard.variables, panels: existing.panels.map((p) => ({ title: p.title, sql: p.sql })) } : null,
      });
    },
    onSuccess: (result) => setReview({ draft: result, panels: result.panels.map((p) => ({ draft: p, include: p.status !== "blocked" && p.panel !== null })) }),
  });

  const accept = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!review) throw new Error("Nothing to accept");
      const panels: PanelInput[] = review.panels.flatMap((p) => (p.include && p.draft.panel ? [p.draft.panel] : []));
      if (!existing) {
        const created = await createDashboard({
          title: review.draft.title, description: review.draft.description, connectionId, timeRange: "6h", refreshSeconds: 60, variables: review.draft.variables, panels,
        });
        return created.dashboard.id;
      }
      // Re-read so the save is at the current version, with the panels as they are now.
      const fresh = await getDashboard(existing.dashboard.id);
      const input = toInput(fresh);
      const { variables } = mergeVariables(input.variables, review.draft.variables);
      await updateDashboard(existing.dashboard.id, fresh.dashboard.version, { ...input, variables, panels: [...input.panels, ...panels] });
      return existing.dashboard.id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      onOpenChange(false);
      toast.success(existing ? "Panels added" : "Dashboard created");
      navigate(`/dashboards/${id}`);
    },
  });

  const applyFix = (index: number, code: string, sql: string): void => {
    if (!review) return;
    setReview({
      ...review,
      panels: review.panels.map((p, i) => (i !== index || !p.draft.panel ? p : {
        ...p,
        draft: { ...p.draft, sql, panel: { ...p.draft.panel, sql }, lint: p.draft.lint.filter((f) => f.code !== code) },
      })),
    });
  };

  const included = review?.panels.filter((p) => p.include).length ?? 0;
  const skipped = review && existing ? mergeVariables(existing.dashboard.variables, review.draft.variables).skipped : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" aria-hidden /> {existing ? `Add panels to ${existing.dashboard.title} with AI` : "Draft a dashboard with AI"}</DialogTitle>
          <DialogDescription>
            Chouse AI reads the schemas on your active connection, drafts panels, and every panel is checked and dry-run with your access before you see it. Nothing is saved until you accept.
          </DialogDescription>
        </DialogHeader>

        {!review ? (
          <div className="flex flex-col gap-3">
            <Textarea
              className={TEXTAREA}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Watch the orders Kafka to MergeTree pipeline so I see problems before they hit users"
              aria-label="What should the dashboard show?"
            />
            {draft.isError && <p role="alert" className="text-xs text-red-300">{draft.error.message}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="draft-review">
            <div>
              <h3 className="text-sm font-medium text-paper">{review.draft.title}</h3>
              <p className="text-xs text-paper-dim">{review.draft.description}</p>
            </div>
            {review.draft.variables.length > 0 && (
              <p className="text-xs text-paper-dim">Variables: {review.draft.variables.map((v) => v.label).join(", ")}{skipped.length > 0 ? ` (this dashboard already has ${skipped.join(", ")}; its own definitions are kept)` : ""}</p>
            )}
            {review.draft.problems.map((p) => <p key={p} className="text-xs text-amber-300">{p}</p>)}
            {review.panels.map((p, i) => {
              const status = STATUS[p.draft.status];
              const Icon = status.icon;
              return (
                <div key={i} className={cn("flex flex-col gap-1.5 rounded-xs border p-3", p.draft.status === "blocked" ? "border-red-900/50 opacity-80" : "border-ink-500")} data-testid="draft-panel">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={p.include}
                      disabled={p.draft.status === "blocked" || p.draft.panel === null}
                      onCheckedChange={(c) => setReview({ ...review, panels: review.panels.map((x, j) => (j === i ? { ...x, include: c === true } : x)) })}
                      aria-label={`Include ${p.draft.title}`}
                    />
                    <Icon className={cn("h-4 w-4", status.className)} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm text-paper">{p.draft.title}</span>
                    <span className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", status.className)}>{status.label}</span>
                  </div>
                  <p className="text-xs text-paper-dim">{p.draft.rationale}</p>
                  <pre className="max-h-32 overflow-auto rounded-xs bg-ink-200 p-2 font-mono text-[11px] text-paper-muted">{p.draft.sql}</pre>
                  {p.draft.reasons.map((r) => <p key={r} role="alert" className="text-xs text-red-300">{r}</p>)}
                  {p.draft.lint.map((f) => (
                    <div key={f.code} className="flex items-start gap-2 text-xs text-amber-200">
                      <span className="flex-1">{f.message}</span>
                      {f.fixedSql !== undefined && <FixButton sql={f.fixedSql} onApply={(sql) => applyFix(i, f.code, sql)} />}
                    </div>
                  ))}
                </div>
              );
            })}
            {accept.isError && <p role="alert" className="text-xs text-red-300">{accept.error.message}</p>}
          </div>
        )}

        <DialogFooter>
          {!review ? (
            <>
              <Button variant="outline" className={BTN_OUTLINE} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className={BTN_PRIMARY} onClick={() => draft.mutate()} disabled={draft.isPending || goal.trim().length < 8}>
                {draft.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />} {draft.isPending ? "Drafting…" : "Draft"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className={BTN_OUTLINE} onClick={() => setReview(null)}>Discard</Button>
              <Button className={BTN_PRIMARY} onClick={() => accept.mutate()} disabled={accept.isPending || included === 0}>
                {existing ? `Add ${included} panel${included === 1 ? "" : "s"}` : `Create with ${included} panel${included === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FixButton({ sql, onApply }: { sql: string; onApply: (sql: string) => void }): React.ReactElement {
  return <Button variant="outline" className={BTN_INLINE} onClick={() => onApply(sql)}>Apply fix</Button>;
}
