/**
 * Memory suggestions in Chobi chat (ADR 0026 §9). When a conversation goes
 * quiet, Chobi asks once for notes worth keeping and shows them as chips:
 * Save to me, Propose to team, or Dismiss. Nothing is saved without a click,
 * and "Anything worth remembering?" asks at once.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Lightbulb, Loader2, X } from "lucide-react";

import { createMemory, suggestMemories, type MemorySuggestion } from "@/api/aiMemories";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/log";

/** How long a finished conversation sits before Chobi asks. */
export const QUIET_MS = 45_000;

interface Props {
  threadId: string | null;
  /** Messages in the thread: a new turn makes it worth asking again. */
  messageCount: number;
  /** A reply is being written: not quiet. */
  generating: boolean;
  /** Turned off for the organization. */
  enabled: boolean;
}

export function MemorySuggestions({ threadId, messageCount, generating, enabled }: Props): ReactElement | null {
  const [shown, setShown] = useState<{ key: string; suggestions: MemorySuggestion[]; connectionId: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Thread lengths already asked about (or dismissed), so a quiet thread is asked once. */
  const asked = useRef(new Set<string>());
  const key = threadId ? `${threadId}:${messageCount}` : "";

  const ask = useCallback(async (manual: boolean): Promise<void> => {
    if (!threadId) return;
    asked.current.add(key);
    setLoading(true);
    try {
      const result = await suggestMemories(threadId);
      setShown({ key, suggestions: result.suggestions, connectionId: result.connectionId ?? null });
      if (manual && result.suggestions.length === 0) toast.info(result.off ? "Memory suggestions are turned off" : "Nothing to remember from this conversation");
    } catch (error) {
      log.error("[MemorySuggestions] Could not suggest memories", { message: error instanceof Error ? error.message : String(error) });
      if (manual) toast.error(error instanceof Error ? error.message : "Could not suggest memories");
    } finally {
      setLoading(false);
    }
  }, [threadId, key]);

  // Ask once a finished conversation has been quiet for a while.
  useEffect(() => {
    if (!enabled || !threadId || generating || messageCount < 2 || asked.current.has(key)) return;
    const timer = setTimeout(() => void ask(false), QUIET_MS);
    return () => clearTimeout(timer);
  }, [enabled, threadId, generating, messageCount, key, ask]);

  // Suggestions belong to the thread they came from.
  const visible = shown && shown.key.startsWith(`${threadId}:`) ? shown.suggestions : [];

  const save = async (suggestion: MemorySuggestion, scope: MemorySuggestion["scope"]): Promise<void> => {
    setBusy(suggestion.note);
    try {
      const saved = await createMemory({ scope, content: suggestion.note, ...(scope === "connection" && shown?.connectionId ? { connectionId: shown.connectionId } : {}) });
      toast.success(scope === "user" ? "Saved to your memory" : saved.status === "active" ? "Saved for the team" : "Proposed to the team for review");
      dismiss(suggestion);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the note");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = (suggestion: MemorySuggestion): void => {
    setShown((s) => (s ? { ...s, suggestions: s.suggestions.filter((x) => x.note !== suggestion.note) } : s));
  };

  if (!enabled || !threadId) return null;

  if (visible.length === 0) {
    if (generating || messageCount < 2) return null;
    return (
      <div className="mb-1.5 flex justify-end">
        <button type="button" onClick={() => void ask(true)} disabled={loading} className="inline-flex items-center gap-1 text-[11px] text-paper-faint hover:text-paper disabled:opacity-50">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Lightbulb className="h-3 w-3" aria-hidden />} Anything worth remembering?
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-ink-500 bg-ink-200/60 p-2" data-testid="memory-suggestions">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-paper">
        <Lightbulb className="h-3.5 w-3.5 text-brand" aria-hidden /> Worth remembering?
      </p>
      <ul className="space-y-1.5">
        {visible.map((s) => (
          <li key={s.note} className="rounded-md border border-ink-500 bg-ink-100 px-2 py-1.5">
            <p className="mb-1 text-[12px] text-paper">{s.note}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {s.scope === "connection" && shown?.connectionId && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy !== null} onClick={() => void save(s, "connection")}>Propose to team</Button>
              )}
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy !== null} onClick={() => void save(s, "user")}>Save to me</Button>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" disabled={busy !== null} onClick={() => dismiss(s)}>
                <X className="h-3 w-3" aria-hidden /> Dismiss
              </Button>
              {busy === s.note && <Loader2 className="h-3 w-3 animate-spin text-paper-dim" aria-hidden />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
