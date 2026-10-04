/**
 * Shown when a DDL statement would break dependents (ADR 0016 §11): what
 * breaks, what is affected, a safer plan when one exists, and — for users
 * with schema:override — an explicit "run anyway" that is audited.
 */

import type { ReactElement } from "react";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSchemaPreflightStore } from "@/stores/schemaPreflight";

const SEVERITY_CLASS: Record<string, string> = {
  breaks: "border-red-400/40 bg-red-500/10 text-red-500",
  affects: "border-amber-400/40 bg-amber-500/10 text-amber-500",
  info: "border-sky-400/40 bg-sky-500/10 text-sky-500",
};

export function SchemaPreflightDialog(): ReactElement {
  const prompt = useSchemaPreflightStore((s) => s.prompt);
  const answer = useSchemaPreflightStore((s) => s.answer);
  const items = prompt?.impact.items ?? [];
  const breaks = items.filter((i) => i.severity === "breaks").length;
  return (
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0 text-paper">
        <DialogHeader className="border-b border-ink-500 px-6 py-5">
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-red-500" aria-hidden /> This change breaks {breaks} dependent{breaks === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>{prompt?.message}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {prompt && <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{prompt.statement}</pre>}
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={`${item.kind}:${item.ref}:${item.reason}`} className="flex items-start gap-3 rounded-xs border border-ink-500 p-2.5">
                <span className={`shrink-0 rounded-xs border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em] ${SEVERITY_CLASS[item.severity] ?? SEVERITY_CLASS.info}`}>{item.severity}</span>
                <div className="min-w-0">
                  <p className="text-[12px] text-paper">{item.label}</p>
                  <p className="text-[11px] text-paper-muted">{item.reason}</p>
                </div>
              </li>
            ))}
          </ul>
          {(prompt?.impact.hiddenDependents ?? 0) > 0 && <p className="text-[11px] text-paper-muted">{prompt?.impact.hiddenDependents} more dependents are in tables you cannot read.</p>}
          {(prompt?.impact.notes ?? []).map((n) => <p key={n} className="text-[11px] text-paper-muted">{n}</p>)}
          {prompt?.impact.saferPlan && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Safer plan</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{prompt.impact.saferPlan}</pre>
            </div>
          )}
          {!prompt?.canOverride && <p className="text-[11px] text-amber-500">Running it anyway needs the schema:override permission.</p>}
        </div>
        <DialogFooter className="border-t border-ink-500 px-6 py-4">
          <Button variant="ghost" onClick={() => answer(false)}>Cancel</Button>
          {prompt?.canOverride && <Button variant="destructive" className="rounded-xs" onClick={() => answer(true)}>Run anyway (audited)</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
