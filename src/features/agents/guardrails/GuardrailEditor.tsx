/**
 * Edit one guardrail (AI Governance › Guardrails): every section at once, the
 * live test, its revision history, and reset or delete.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { History, RotateCcw, Save, Trash2 } from "lucide-react";

import { guardrailInputOf, type Guardrail, type GuardrailCatalog, type GuardrailInput } from "@/api/aiGuardrails";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { formatAgo } from "@/features/observe/lib";
import { StatusPill } from "@/features/observe/ui";
import { errorMessage, OriginBadge } from "../assistant/shared";
import { BasicsSection, ConfigSection, ScopeSection, TestSection } from "./GuardrailForm";
import { useGuardrailMutations, useGuardrailRevisions } from "./hooks";

function Section({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <section className="space-y-3 border-t border-ink-500 pt-4">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-paper-dim">{title}</h3>
      {children}
    </section>
  );
}

export function GuardrailEditor({ guardrail, catalog, canManage, onClose }: { guardrail: Guardrail; catalog: GuardrailCatalog; canManage: boolean; onClose: () => void }): ReactElement {
  const [draft, setDraft] = useState<GuardrailInput>(() => guardrailInputOf(guardrail));
  const { save, remove, reset, rollback } = useGuardrailMutations();
  const revisions = useGuardrailRevisions(guardrail.id);
  const readOnly = !canManage;
  const kind = catalog.kinds[guardrail.kind];

  const onSave = async (): Promise<void> => {
    try {
      await save.mutateAsync({ id: guardrail.id, input: draft, version: guardrail.version });
      toast.success(`Saved ${draft.name}`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the guardrail"));
    }
  };
  const run = async (action: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    try {
      await action();
      toast.success(done);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, failed));
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">{guardrail.name}<OriginBadge row={guardrail} /><StatusPill tone="muted" dot={false}>{kind.label}</StatusPill></SheetTitle>
          <SheetDescription>{kind.description}. Changes apply from the next AI run, on every replica.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 pb-6">
          <BasicsSection value={draft} onChange={setDraft} catalog={catalog} readOnly={readOnly} />
          <Section title="Settings"><ConfigSection key={guardrail.kind} value={draft} onChange={setDraft} catalog={catalog} readOnly={readOnly} /></Section>
          <Section title="Stages, action and scope"><ScopeSection value={draft} onChange={setDraft} catalog={catalog} readOnly={readOnly} /></Section>
          <Section title="Try it"><TestSection value={draft} /></Section>
          <Section title="History">
            {(revisions.data ?? []).length === 0 ? <p className="text-[12px] text-paper-faint">No revisions yet.</p> : (
              <ul className="space-y-1">
                {(revisions.data ?? []).slice(0, 10).map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-[12px] text-paper-muted">
                    <span><History className="mr-1 inline h-3 w-3" aria-hidden />v{r.version} · {r.action} · {formatAgo(r.createdAt)}</span>
                    {canManage && i > 0 && r.action !== "delete" && (
                      <Button variant="ghost" className="h-6 rounded-xs px-2 text-[11px]" disabled={rollback.isPending}
                        onClick={() => void run(() => rollback.mutateAsync(r.id), `Restored version ${r.version}`, "Could not restore that version")}>Restore</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {canManage && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-500 pt-4">
              <div className="flex gap-2">
                {guardrail.isSystem ? (
                  <Button variant="outline" className="h-9 rounded-xs text-[11px]" disabled={reset.isPending || !guardrail.customized}
                    onClick={() => void run(() => reset.mutateAsync(guardrail.id), `Reset ${guardrail.name} to built-in`, "Could not reset the guardrail")}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to built-in
                  </Button>
                ) : (
                  <Button variant="outline" className="h-9 rounded-xs border-red-500/40 text-[11px] text-red-400 hover:bg-red-500/10" disabled={remove.isPending}
                    onClick={() => void run(() => remove.mutateAsync({ id: guardrail.id, version: guardrail.version }), `Deleted ${guardrail.name}`, "Could not delete the guardrail")}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                )}
              </div>
              <Button className={DH_PRIMARY} disabled={save.isPending} onClick={() => void onSave()}><Save className="mr-1 h-3.5 w-3.5" /> Save</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
