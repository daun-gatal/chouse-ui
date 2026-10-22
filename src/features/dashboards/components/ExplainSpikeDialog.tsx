/**
 * Explain this spike (ADR 0023 §9): asks the Spike Explainer about a panel's
 * selected range. The evidence is gathered on the server as the viewer; what it
 * could not read is shown with the answer. Read-only — "Add as note" is the
 * only thing it can save, and only when the user presses it.
 */

import React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles, StickyNote } from "lucide-react";

import { AiModelButton } from "@/components/common/AiModelButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addNote, explainSpike, type ChartPanelInput } from "@/api/dashboards";
import { useAiModelId } from "@/hooks";
import type { VariableValues } from "@/lib/viz/spec";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/charts/controlStyles";

import type { TimeSpan } from "./PanelCard";

const CONFIDENCE: Record<"low" | "medium" | "high", string> = { low: "text-paper-dim", medium: "text-amber-300", high: "text-emerald-300" };

interface Props {
  dashboardId: string;
  panelId: string;
  panel: ChartPanelInput;
  span: TimeSpan;
  values: VariableValues;
  connectionId: string;
  canNote: boolean;
  onNoted: () => void;
  onClose: () => void;
}

export function ExplainSpikeDialog({ dashboardId, panelId, panel, span, values, connectionId, canNote, onNoted, onClose }: Props): React.ReactElement {
  const modelId = useAiModelId();
  // A query (not an effect + mutation) so a remount never asks twice; nothing is cached past the dialog.
  const explain = useQuery({
    queryKey: ["dashboards", "explain", dashboardId, panelId, span.fromMs, span.toMs, values, connectionId, modelId],
    queryFn: ({ signal }) => explainSpike({ dashboardId, panelId, fromMs: span.fromMs, toMs: span.toMs, values, connectionId }, { modelId, signal }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const note = useMutation({
    mutationFn: (text: string) => addNote(dashboardId, span.fromMs, text),
    onSuccess: () => { toast.success("Added as a note"); onNoted(); },
    onError: (error) => toast.error(error.message),
  });
  const result = explain.data;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" aria-hidden /> Explain this spike</DialogTitle>
            <AiModelButton />
          </div>
          <DialogDescription>{panel.title} · {new Date(span.fromMs).toLocaleString()} – {new Date(span.toMs).toLocaleTimeString()}. Read-only: the evidence is read with your access and nothing is changed.</DialogDescription>
        </DialogHeader>
        {explain.isPending && <p className="flex items-center gap-2 text-sm text-paper-dim"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the panel, what changed, slow queries, mutations and merges…</p>}
        {explain.isError && <p role="alert" className="text-sm text-red-300">{explain.error.message}</p>}
        {result && (
          <div className="flex flex-col gap-3" data-testid="spike-explanation">
            <div className="rounded-xs border border-yellow-500/40 bg-yellow-500/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-yellow-300">Likely cause · <span className={CONFIDENCE[result.confidence]}>{result.confidence} confidence</span></p>
              <p className="mt-1 text-sm text-paper">{result.likelyCause}</p>
            </div>
            <p className="text-sm text-paper-muted">{result.summary}</p>
            {result.evidence.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Evidence</span>
                {result.evidence.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xs border border-ink-500 px-2 py-1.5 text-xs">
                    <span className="rounded-full border border-ink-500 px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim">{e.kind}</span>
                    <span className="text-paper-muted">{e.text}</span>
                  </div>
                ))}
              </div>
            )}
            {result.nextSteps.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Next steps</span>
                <ol className="list-decimal pl-5 text-xs text-paper-muted">{result.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
            {result.unavailable.length > 0 && (
              <div className="rounded-xs border border-amber-900/40 bg-amber-950/20 p-2 text-[11px] text-amber-200" role="status">
                Not available to this answer:
                <ul className="list-disc pl-5">{result.unavailable.map((u) => <li key={u.part}>{u.part}: {u.reason}</li>)}</ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className={BTN_OUTLINE} onClick={onClose}>Close</Button>
          {result && canNote && (
            <Button className={cn(BTN_PRIMARY)} disabled={note.isPending} onClick={() => note.mutate(`Explain: ${result.likelyCause}`.slice(0, 500))}>
              <StickyNote className="mr-1.5 h-3.5 w-3.5" /> Add as note
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
