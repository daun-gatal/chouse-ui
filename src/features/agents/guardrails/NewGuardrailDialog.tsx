/**
 * "New guardrail" (AI Governance › Guardrails): kind or AI draft → configure →
 * stages, action and scope → test and save in shadow or enforce mode.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Check, Loader2, Sparkles } from "lucide-react";

import { GUARDRAIL_KINDS, type GuardrailCatalog, type GuardrailInput, type GuardrailKind, type GuardrailMode } from "@/api/aiGuardrails";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { cn } from "@/lib/utils";
import { errorMessage, INPUT_CLASS, ProblemList } from "../assistant/shared";
import { BasicsSection, ConfigSection, ScopeSection, TestSection } from "./GuardrailForm";
import { useGuardrailDraft, useGuardrailMutations } from "./hooks";
import { blankGuardrail, uniqueSlug } from "./lib";

const STEPS = ["Kind", "Configure", "Scope and action", "Test and save"] as const;

function stepProblem(step: number, value: GuardrailInput | null): string | null {
  if (step === 0) return value ? null : "Choose a kind, or describe the guardrail and draft it";
  if (!value) return null;
  if (step === 1 && !value.name.trim()) return "Enter a name";
  if (step === 2 && value.stages.length === 0) return "Choose at least one stage";
  return null;
}

export function NewGuardrailDialog({ catalog, onClose }: { catalog: GuardrailCatalog; onClose: () => void }): ReactElement {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState<GuardrailInput | null>(null);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftProblems, setDraftProblems] = useState<string[]>([]);
  const draft = useGuardrailDraft();
  const { save } = useGuardrailMutations();
  const taken = catalog.guardrails.map((g) => g.slug);

  const pick = (kind: GuardrailKind): void => {
    setValue(blankGuardrail(kind, catalog.kinds[kind], catalog.guardrails));
    setDraftProblems([]);
    setError(null);
  };
  const runDraft = async (): Promise<void> => {
    if (goal.trim().length < 3) {
      setError("Describe the guardrail first");
      return;
    }
    try {
      const result = await draft.mutateAsync(goal.trim());
      setValue(result.input);
      setDraftProblems(result.problems);
      setError(null);
      setStep(1);
    } catch (e) {
      setError(errorMessage(e, "Could not draft the guardrail"));
    }
  };
  const next = (): void => {
    const problem = stepProblem(step, value);
    if (problem) {
      setError(problem);
      return;
    }
    if (step === 1 && value && !value.slug.trim()) setValue({ ...value, slug: uniqueSlug(value.name, taken) });
    setError(null);
    setStep(step + 1);
  };
  const finish = async (): Promise<void> => {
    if (!value) return;
    try {
      const saved = await save.mutateAsync({ id: null, input: value, version: null });
      toast.success(saved.mode === "shadow" ? `${saved.name} saved in shadow mode` : `${saved.name} saved and enforced`);
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Could not save the guardrail"));
    }
  };
  const setMode = (mode: GuardrailMode): void => { if (value) setValue({ ...value, mode }); };
  const change = (next: GuardrailInput): void => { setValue(next); setError(null); };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>New guardrail</DialogTitle>
          <DialogDescription>Guardrails are built from shipped kinds; you configure them, never write code.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-wrap gap-3 border-b border-ink-500 pb-3" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-1.5 text-[11px]", i === step ? "font-semibold text-paper" : i < step ? "text-emerald-500" : "text-paper-faint")}>
              <span className="grid h-4 w-4 place-items-center rounded-full border border-current text-[10px]">{i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}</span>{label}
            </li>
          ))}
        </ol>

        <div className="min-h-[260px] space-y-3">
          {step === 0 && (
            <>
              {catalog.drafting && (
                <div className="flex gap-2">
                  <Input value={goal} onChange={(e) => { setGoal(e.target.value); setError(null); }} placeholder="Mask employee IDs like EMP-123456 in query results" aria-label="Describe the guardrail" className={INPUT_CLASS} />
                  <Button variant="outline" className="h-8 shrink-0 rounded-xs text-[11px]" disabled={draft.isPending} onClick={() => void runDraft()}>
                    {draft.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} Draft
                  </Button>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {GUARDRAIL_KINDS.map((kind) => (
                  <button key={kind} type="button" aria-pressed={value?.kind === kind} onClick={() => pick(kind)}
                    className={cn("rounded-xs border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand", value?.kind === kind ? "border-brand bg-brand/10" : "border-ink-500 hover:border-ink-700")}>
                    <span className="block text-[12px] text-paper">{catalog.kinds[kind].label}</span>
                    <span className="block text-[11px] text-paper-faint">{catalog.kinds[kind].description}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-paper-faint">To start from a built-in guardrail, open it and change a copy of its settings in a new one.</p>
            </>
          )}
          {step === 1 && value && (
            <>
              <ProblemList problems={draftProblems} />
              <BasicsSection value={value} onChange={change} catalog={catalog} />
              <ConfigSection key={value.kind} value={value} onChange={change} catalog={catalog} />
            </>
          )}
          {step === 2 && value && <ScopeSection value={value} onChange={change} catalog={catalog} />}
          {step === 3 && value && (
            <>
              <TestSection value={value} />
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Turn on as">
                {([["shadow", "Shadow", "Record matches for a while, change nothing"], ["enforce", "Enforce", "Apply the action from the next run"]] as const).map(([mode, title, hint]) => (
                  <button key={mode} type="button" role="radio" aria-checked={value.mode === mode} onClick={() => setMode(mode)}
                    className={cn("rounded-xs border p-3 text-left", value.mode === mode ? "border-brand bg-brand/10" : "border-ink-500")}>
                    <span className="block text-[12px] text-paper">{title}</span><span className="block text-[11px] text-paper-faint">{hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <p role="alert" className="text-[12px] text-red-400">{error}</p>}
        <DialogFooter className="gap-2">
          {step > 0 && <Button variant="ghost" onClick={() => { setStep(step - 1); setError(null); }}>Back</Button>}
          {step < STEPS.length - 1
            ? <Button className={DH_PRIMARY} onClick={next}>Next</Button>
            : <Button className={DH_PRIMARY} disabled={save.isPending} onClick={() => void finish()}>{value?.mode === "enforce" ? "Save and enforce" : "Save in shadow mode"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
