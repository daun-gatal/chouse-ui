/**
 * Draft with AI for agents, harnesses and skills (issue #381): the dialog that
 * starts a draft, the review banner and per-section status shown in the
 * editors, "Redraft this section", "Refine with AI", and the save warning for
 * sections that still need attention. Nothing here saves — the editor's own
 * Create / Save does, after the admin reviews the draft.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";

import type {
  AgentHints,
  AgentInput,
  AiRegistry,
  DraftKind,
  DraftRequest,
  DraftResult,
  HarnessInput,
  SectionStatus,
  SkillInput,
} from "@/api/aiAgents";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useDraft } from "./hooks";
import { draftableFeatures, draftWarnings, SECTION_LABELS, STATE_LABEL, STATE_MARK } from "./lib";
import { errorMessage, Field, TEXTAREA_CLASS } from "./shared";

const GOAL_MAX = 4_000;
const REFERENCE_MAX = 60_000;
const INSTRUCTION_MAX = 2_000;
const NO_FEATURE = "__none__";

const NOUN: Record<DraftKind, string> = { agent: "agent", harness: "harness", skill: "skill" };

const GOAL_LABEL: Record<DraftKind, string> = {
  agent: "What should this agent do?",
  harness: "How should agents using this harness behave?",
  skill: "What should the agent know or do when this skill applies?",
};

const GOAL_PLACEHOLDER: Record<DraftKind, string> = {
  agent: "Answer questions about table sizes and growth, and point out tables that grow unusually fast.",
  harness: "No filesystem writes, terse answers, delegate long scans to subagents.",
  skill: "Triage TOO_MANY_PARTS errors: find the partitions with the most parts, check merges and suggest fixes.",
};

/** What a draft was started from, so redrafts and refinements keep the same intent. */
export interface DraftOrigin {
  goal?: string;
  reference?: string;
  agentHints?: AgentHints;
}

type AnyInput = AgentInput | HarnessInput | SkillInput;

interface DraftRunner<T> {
  run: (request: DraftRequest<T>) => Promise<DraftResult<T>>;
  pending: boolean;
}

function useDraftRunner<T extends AnyInput>(kind: DraftKind): DraftRunner<T> {
  const mutation = useDraft<T>(kind);
  return { run: mutation.mutateAsync, pending: mutation.isPending };
}

export function DraftWithAiDialog<T extends AnyInput>({ kind, registry, onDrafted, onClose }: {
  kind: DraftKind;
  registry: AiRegistry;
  onDrafted: (result: DraftResult<T>, origin: DraftOrigin) => void;
  onClose: () => void;
}): ReactElement {
  const [goal, setGoal] = useState("");
  const [reference, setReference] = useState("");
  const [featureId, setFeatureId] = useState(NO_FEATURE);
  const [delegate, setDelegate] = useState<AgentHints["delegate"]>("auto");
  const { run, pending } = useDraftRunner<T>(kind);
  const features = draftableFeatures(registry);

  const submit = async (): Promise<void> => {
    const origin: DraftOrigin = {
      goal: goal.trim(),
      ...(kind === "skill" && reference.trim() ? { reference } : {}),
      ...(kind === "agent" ? { agentHints: { featureId: featureId === NO_FEATURE ? null : featureId, delegate } } : {}),
    };
    try {
      const result = await run(origin);
      onDrafted(result, origin);
    } catch (error) {
      toast.error(errorMessage(error, `Could not draft the ${NOUN[kind]}`));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-xl rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Draft a {NOUN[kind]} with AI</DialogTitle>
          <DialogDescription>
            The draft opens in the editor for review. Nothing is saved until you create it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={GOAL_LABEL[kind]} hint={`${goal.length} / ${GOAL_MAX}`}>
            <Textarea className={`${TEXTAREA_CLASS} min-h-[110px] font-sans`} value={goal} maxLength={GOAL_MAX} placeholder={GOAL_PLACEHOLDER[kind]}
              onChange={(e) => setGoal(e.target.value)} aria-label={GOAL_LABEL[kind]} autoFocus />
          </Field>
          {kind === "agent" && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Serves a feature" hint="Leave on none for a chat agent or a subagent.">
                <Select value={featureId} onValueChange={setFeatureId}>
                  <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Serves a feature"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FEATURE}>None — chat agent or subagent</SelectItem>
                    {features.map((f) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Delegate to subagents">
                <Select value={delegate} onValueChange={(v) => setDelegate(v === "yes" || v === "no" ? v : "auto")}>
                  <SelectTrigger className="h-8 rounded-xs text-[12px]" aria-label="Delegate to subagents"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Let the drafter decide</SelectItem>
                    <SelectItem value="yes">Yes, delegate</SelectItem>
                    <SelectItem value="no">No, answer itself</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <p className="text-[11px] text-paper-faint md:col-span-2">Every CHouse tool is read-only, so a drafted agent can look things up but never change data.</p>
            </div>
          )}
          {kind === "skill" && (
            <Field label="Reference material (optional)" hint={`Paste a runbook or doc to turn into the skill. Long material is split into reference files. ${reference.length} / ${REFERENCE_MAX}`}>
              <Textarea className={`${TEXTAREA_CLASS} min-h-[140px]`} value={reference} maxLength={REFERENCE_MAX} onChange={(e) => setReference(e.target.value)} aria-label="Reference material" />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button className={DH_PRIMARY} onClick={() => void submit()} disabled={pending || goal.trim().length < 8}>
            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {pending ? "Drafting… this can take a minute" : "Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A draft being reviewed in an editor: redraft one section or refine the whole thing. */
export interface AiDraftSession<T> {
  result: DraftResult<T> | null;
  pending: boolean;
  /** Redraft one section of `current`; resolves with the new input, or null on failure. */
  redraft: (section: string, current: T) => Promise<T | null>;
  /** Refine `current` with an instruction; resolves with the new input, or null on failure. */
  refine: (instruction: string, current: T) => Promise<T | null>;
}

export function useAiDraftSession<T extends AnyInput>(kind: DraftKind, initial: DraftResult<T> | null, origin: DraftOrigin, entityId: string | null): AiDraftSession<T> {
  const [result, setResult] = useState<DraftResult<T> | null>(initial);
  const { run, pending } = useDraftRunner<T>(kind);

  const apply = async (request: DraftRequest<T>, failed: string): Promise<T | null> => {
    try {
      const next = await run({ ...origin, entityId, ...request });
      setResult(next);
      return next.input;
    } catch (error) {
      toast.error(errorMessage(error, failed));
      return null;
    }
  };

  return {
    result,
    pending,
    redraft: (section, current) => apply({
      current,
      currentMeta: result?.meta,
      sections: [section],
      feedback: { [section]: result?.sections[section]?.problems ?? [] },
    }, `Could not redraft ${SECTION_LABELS[kind][section] ?? section}`),
    refine: (instruction, current) => apply({ current, currentMeta: result?.meta, instruction }, `Could not refine the ${NOUN[kind]}`),
  };
}

export function SectionMark({ status }: { status: SectionStatus | undefined }): ReactElement | null {
  if (!status) return null;
  const tone = status.state === "attention" ? "text-amber-500" : status.state === "empty" ? "text-paper-faint" : "text-emerald-500";
  return <span className={`ml-1 ${tone}`} aria-label={STATE_LABEL[status.state]} title={STATE_LABEL[status.state]}>{STATE_MARK[status.state]}</span>;
}

/** Status, reasons and the redraft action at the top of one editor section. */
export function SectionReview({ kind, section, status, pending, onRedraft }: {
  kind: DraftKind;
  section: string;
  status: SectionStatus | undefined;
  pending: boolean;
  onRedraft?: () => void;
}): ReactElement | null {
  if (!status) return null;
  const border = status.state === "attention" ? "border-amber-500/40 bg-amber-500/5" : "border-ink-500 bg-ink-200/30";
  return (
    <div className={`space-y-1.5 rounded-xs border p-2 text-[12px] ${border}`} aria-label={`${SECTION_LABELS[kind][section]} review`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-paper">
          <SectionMark status={status} /> {STATE_LABEL[status.state]}
          {status.state === "empty" && status.reason && <span className="text-paper-muted"> — {status.reason}</span>}
        </span>
        {onRedraft && (
          <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" disabled={pending} onClick={onRedraft}>
            {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Redraft this section
          </Button>
        )}
      </div>
      {status.problems.length > 0 && (
        <ul className="space-y-0.5 text-amber-500">{status.problems.map((p, i) => <li key={i}>• {p}</li>)}</ul>
      )}
      {status.rationale.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-paper-faint">
          {status.rationale.map((r, i) => <li key={i}><span className="font-mono text-paper-muted">{r.subject}</span>{r.why ? ` — ${r.why}` : ""}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The banner at the top of an editor holding an AI draft. */
export function AiDraftBanner<T>({ result }: { result: DraftResult<T> }): ReactElement {
  const labels = SECTION_LABELS[result.kind];
  return (
    <div role="status" className="space-y-2 rounded-xs border border-brand/30 bg-brand/5 p-3 text-[12px]">
      <div className="flex items-center gap-2 font-medium text-paper">
        <Sparkles className="h-3.5 w-3.5 text-brand" />
        {result.mode === "refine" ? "Refined by AI" : "Drafted by AI"} — review before saving
      </div>
      {result.summary && <p className="text-paper-muted">{result.summary}</p>}
      <div className="flex flex-wrap gap-1.5" aria-label="Section status">
        {Object.keys(labels).map((section) => {
          const status = result.sections[section];
          if (!status) return null;
          return (
            <span key={section} className="rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted" title={status.problems.join("\n") || status.reason || STATE_LABEL[status.state]}>
              {labels[section]}<SectionMark status={status} />
            </span>
          );
        })}
      </div>
      {result.fixes.length > 0 && (
        <details className="text-[11px] text-paper-faint">
          <summary className="cursor-pointer">Adjusted to fit the registry ({result.fixes.length})</summary>
          <ul className="mt-1 space-y-0.5">{result.fixes.map((f, i) => <li key={i}>• {f}</li>)}</ul>
        </details>
      )}
      {result.suggestedSkills.length > 0 && (
        <div className="text-[11px] text-paper-faint">
          Skills worth drafting next: {result.suggestedSkills.join("; ")}
        </div>
      )}
    </div>
  );
}

/** Refine with AI: an instruction for the whole open draft or stored custom entity. */
export function RefineWithAi({ kind, pending, onRefine }: { kind: DraftKind; pending: boolean; onRefine: (instruction: string) => Promise<boolean> }): ReactElement {
  const [instruction, setInstruction] = useState("");
  const submit = async (): Promise<void> => {
    if (await onRefine(instruction.trim())) setInstruction("");
  };
  return (
    <div className="space-y-1.5 rounded-xs border border-ink-500 p-2">
      <Field label="Refine with AI" hint={`Describe a change to the whole ${NOUN[kind]}; you review the result before saving.`}>
        <div className="flex flex-col gap-2 md:flex-row">
          <Textarea className={`${TEXTAREA_CLASS} min-h-[60px] flex-1 font-sans`} value={instruction} maxLength={INSTRUCTION_MAX}
            placeholder={kind === "agent" ? "Make it stricter about DDL; add the clickhouse-playbook skill" : kind === "harness" ? "Also hide grep and glob" : "Add a section on TTL"}
            onChange={(e) => setInstruction(e.target.value)} aria-label="Refine instruction" />
          <Button variant="outline" className="h-8 shrink-0 rounded-xs text-[11px]" disabled={pending || instruction.trim().length < 3} onClick={() => void submit()}>
            {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />} Refine
          </Button>
        </div>
      </Field>
    </div>
  );
}

/**
 * Save guard: a draft with sections that need attention can still be saved,
 * but the open problems are shown first. Returns whether to save now.
 */
export function useSaveGuard<T>(result: DraftResult<T> | null): { warnings: string[]; confirming: boolean; check: () => boolean; cancel: () => void } {
  const [confirming, setConfirming] = useState(false);
  const warnings = result ? draftWarnings(result) : [];
  return {
    warnings,
    confirming,
    check: () => {
      if (warnings.length === 0 || confirming) {
        setConfirming(false);
        return true;
      }
      setConfirming(true);
      return false;
    },
    cancel: () => setConfirming(false),
  };
}

export function SaveWarning({ warnings, onCancel }: { warnings: string[]; onCancel: () => void }): ReactElement {
  return (
    <div role="alert" className="space-y-1 rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">
      <p className="font-medium">These sections still need attention. Save anyway?</p>
      <ul className="space-y-0.5">{warnings.map((w, i) => <li key={i}>• {w}</li>)}</ul>
      <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" onClick={onCancel}>Keep editing</Button>
    </div>
  );
}

/** The "Draft with AI" button next to a "New …" button. */
export function DraftWithAiButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={onClick}>
      <Sparkles className="mr-1 h-3 w-3 text-brand" /> Draft with AI
    </Button>
  );
}
