/**
 * Dashboards › Ask AI › the question, and the wait while the draft is made.
 * The server answers once, with every panel already checked, so the wait
 * shows elapsed time rather than made-up steps.
 */

import React, { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { AiModelButton } from "@/components/common/AiModelButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BTN_OUTLINE, BTN_PRIMARY, TEXTAREA } from "@/components/charts/controlStyles";

import { PICKER_LAYER } from "./askAiLayer";

export const MIN_GOAL_LENGTH = 8;
export const MAX_GOAL_LENGTH = 4_000;

const EXAMPLES = [
  "Watch the orders Kafka to MergeTree pipeline so I see problems before they hit users",
  "Which queries are slow, who runs them and what they read",
  "Disk usage, part counts and merge pressure per table",
];

interface Props {
  goal: string;
  onGoal: (goal: string) => void;
  onDraft: () => void;
  drafting: boolean;
  onCancel: () => void;
  error: string | null;
  /** Why drafting cannot start (null when it can). */
  blocked: string | null;
  connectionName: string | null;
  /** Adding to this dashboard; null drafts a new one. */
  existingTitle: string | null;
}

export function AskAiPrompt({ goal, onGoal, onDraft, drafting, onCancel, error, blocked, connectionName, existingTitle }: Props): React.ReactElement {
  const ready = goal.trim().length >= MIN_GOAL_LENGTH && blocked === null && !drafting;

  if (drafting) return <DraftingState onCancel={onCancel} />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:py-10" data-testid="ask-step">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold text-paper">{existingTitle ? `What should ${existingTitle} also show?` : "What should the dashboard show?"}</h2>
        <p className="text-xs text-paper-dim">
          Chouse AI reads the schemas on {connectionName ? <span className="text-paper-muted">{connectionName}</span> : "your active connection"} and drafts panels. Each one is checked and dry-run with your access before you see it. Nothing is saved until you add it.
        </p>
      </div>
      <Textarea
        className={TEXTAREA}
        value={goal}
        onChange={(e) => onGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            onDraft();
          }
        }}
        rows={5}
        maxLength={MAX_GOAL_LENGTH}
        placeholder={EXAMPLES[0]}
        aria-label="What should the dashboard show?"
        autoFocus
      />
      <div className="flex flex-wrap gap-1.5" aria-label="Examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" onClick={() => onGoal(example)} className="min-h-8 rounded-full border border-ink-500 px-3 py-1 text-left text-[11px] text-paper-dim hover:border-paper-dim hover:text-paper">
            {example}
          </button>
        ))}
      </div>
      {blocked && <p className="text-xs text-amber-300" data-testid="draft-blocked">{blocked}</p>}
      {error && <p role="alert" className="break-words text-xs text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AiModelButton layer={PICKER_LAYER} />
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-paper-faint sm:inline">Ctrl/⌘ + Enter</span>
          <Button className={`${BTN_PRIMARY} min-h-9`} onClick={onDraft} disabled={!ready}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Draft
          </Button>
        </div>
      </div>
      {goal.trim().length > 0 && goal.trim().length < MIN_GOAL_LENGTH && <p className="text-[11px] text-paper-faint">Say a little more: at least {MIN_GOAL_LENGTH} characters.</p>}
    </div>
  );
}

function DraftingState({ onCancel }: { onCancel: () => void }): React.ReactElement {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:py-10" data-testid="drafting">
      <div className="flex flex-wrap items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-paper-dim" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-paper" role="status">Reading schemas, drafting and checking each panel… <span className="font-mono text-paper-faint">{seconds}s</span></p>
        <Button variant="outline" className={`${BTN_OUTLINE} min-h-9`} onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-paper-dim">This usually takes under a minute. Every panel is dry-run before you see it.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-md border border-ink-500 bg-ink-100" />)}
      </div>
    </div>
  );
}
