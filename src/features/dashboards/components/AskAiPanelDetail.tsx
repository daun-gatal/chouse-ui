/**
 * Dashboards › Ask AI › one panel: whether it is in, why it is blocked or
 * needs a look (each mechanical fix a button), what the model meant by it,
 * Regenerate with an optional note, and its SQL — collapsed, and wrapped so
 * it never scrolls sideways.
 */

import React, { useState } from "react";
import { ChevronDown, ChevronLeft, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FEEDBACK_LENGTH } from "@/api/dashboards";
import { BTN_GHOST, BTN_INLINE, BTN_OUTLINE, FIELD_LABEL, TEXTAREA } from "@/components/charts/controlStyles";
import { cn } from "@/lib/utils";

import { canInclude, type ReviewPanel } from "../askAi";
import { STATUS, chartIcon } from "./AskAiPanelList";

interface Props {
  panel: ReviewPanel;
  /** Shown where the detail replaces the list (wide screens). */
  onBack: (() => void) | null;
  onInclude: (include: boolean) => void;
  onApplyFix: (code: string) => void;
  onRegenerate: (feedback: string) => void;
  regenerating: boolean;
  /** An AI request or a save is running: nothing can change. */
  locked: boolean;
  /** Why the AI cannot be asked now (null when it can). */
  aiBlocked: string | null;
}

export function AskAiPanelDetail({ panel, onBack, onInclude, onApplyFix, onRegenerate, regenerating, locked, aiBlocked }: Props): React.ReactElement {
  const [note, setNote] = useState("");
  const [sqlOpen, setSqlOpen] = useState(false);
  const { draft } = panel;
  const status = STATUS[draft.status];
  const StatusIcon = status.icon;
  const ChartIcon = chartIcon(draft.panel?.viz.type ?? null);
  const sql = draft.panel?.sql ?? draft.sql;

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="draft-panel-detail">
      {onBack && (
        <Button variant="ghost" className={cn(BTN_GHOST, "-ml-2 min-h-8 self-start")} onClick={onBack}><ChevronLeft className="h-3.5 w-3.5" aria-hidden /> All panels</Button>
      )}
      <div className="flex flex-col gap-1.5">
        <h3 className="break-words text-base font-semibold text-paper">{draft.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em]", status.className)}><StatusIcon className="h-3.5 w-3.5" aria-hidden /> {status.label}</span>
          {draft.panel && <span className="flex items-center gap-1 rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim"><ChartIcon className="h-3 w-3" aria-hidden /> {draft.panel.viz.type.replace(/_/g, " ")}</span>}
          {draft.role && <span className="rounded-full border border-ink-500 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim" data-testid="draft-role">{draft.role}{draft.importance === "primary" ? " · primary" : ""}</span>}
          {draft.section && <span className="truncate text-[11px] text-paper-faint">in {draft.section}</span>}
        </div>
      </div>

      <label className="flex min-h-11 items-center justify-between gap-3 rounded-xs border border-ink-500 px-3">
        <span className="text-[13px] text-paper">{canInclude(draft) ? (panel.include ? "Included" : "Left out") : "Cannot be added"}</span>
        <Switch checked={panel.include} disabled={locked || !canInclude(draft)} onCheckedChange={onInclude} aria-label={`Include ${draft.title}`} />
      </label>

      {draft.reasons.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Why it is blocked">
          {draft.reasons.map((r) => <li key={r} className="break-words text-xs text-red-300">{r}</li>)}
        </ul>
      )}
      {draft.lint.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Things to check">
          {draft.lint.map((f) => (
            <li key={f.code} className="flex flex-wrap items-start gap-2 text-xs text-amber-200">
              <span className="min-w-0 flex-1 break-words">{f.message}</span>
              {(f.fixedSql !== undefined || f.fixedViz !== undefined) && draft.panel && (
                <Button variant="outline" className={cn(BTN_INLINE, "min-h-8")} disabled={locked} onClick={() => onApplyFix(f.code)}>Apply fix</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {draft.rationale && <p className="break-words text-xs text-paper-dim">{draft.rationale}</p>}

      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL}>Regenerate this panel</span>
        <Textarea
          className={TEXTAREA}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={MAX_FEEDBACK_LENGTH}
          placeholder="What should change? (optional)"
          aria-label={`What should change in ${draft.title}`}
          disabled={locked}
        />
        <Button variant="outline" className={cn(BTN_OUTLINE, "min-h-9 self-start")} disabled={locked || aiBlocked !== null} onClick={() => onRegenerate(note)}>
          {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />} {regenerating ? "Regenerating…" : "Regenerate"}
        </Button>
        {aiBlocked && <p className="text-[11px] text-paper-faint">{aiBlocked}</p>}
      </div>

      <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className={cn(BTN_GHOST, "-ml-2 min-h-8")} aria-expanded={sqlOpen}>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", sqlOpen && "rotate-180")} aria-hidden /> {sqlOpen ? "Hide SQL" : "Show SQL"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-xs bg-ink-200 p-2 font-mono text-[11px] text-paper-muted" data-testid="draft-sql">{sql}</pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
