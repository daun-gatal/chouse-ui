/**
 * Notes the assistant kept during a reply (ADR 0024 §Phase 3), shown under
 * the answer with an undo. A team note is only a proposal until an admin
 * approves it; withdrawing it deletes the proposal.
 */

import { useContext, useEffect, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Brain, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { deleteMemory } from '@/api/aiMemories';
import type { SavedMemoryNote } from '@/lib/aiMemories';
import { log } from '@/lib/log';

/** Memory lists cached elsewhere (AI Governance › Memories) refresh when a reply keeps or drops a note. */
const MEMORY_QUERY_KEY = ['ai-memories'];

export function MemoryNotes({ notes }: { notes: SavedMemoryNote[] }): React.JSX.Element | null {
  const [undone, setUndone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // Optional: the chat also renders where no query client is provided.
  const queryClient = useContext(QueryClientContext);
  const ids = notes.map((n) => n.memoryId).join();
  useEffect(() => {
    if (ids) void queryClient?.invalidateQueries({ queryKey: MEMORY_QUERY_KEY });
  }, [ids, queryClient]);
  if (notes.length === 0) return null;

  const undo = async (note: SavedMemoryNote): Promise<void> => {
    setBusy(note.memoryId);
    try {
      await deleteMemory(note.memoryId);
      setUndone((previous) => new Set(previous).add(note.memoryId));
      void queryClient?.invalidateQueries({ queryKey: MEMORY_QUERY_KEY });
    } catch (error) {
      log.error('[AiChat] Failed to undo a memory', error);
      toast.error(error instanceof Error ? error.message : 'Could not undo. Delete it in AI Governance › Memories.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="mt-2 space-y-1" aria-label="Saved to memory">
      {notes.map((note) => {
        const gone = undone.has(note.memoryId);
        const label = note.scope === 'connection' ? 'Proposed as team memory' : 'Saved to your memory';
        return (
          <li key={note.memoryId} className="flex items-start gap-2 rounded-xs border border-ink-500 bg-ink-50 px-2 py-1.5 text-[12px]">
            <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            <span className={`min-w-0 flex-1 break-words ${gone ? 'text-paper-faint line-through' : 'text-paper-muted'}`}>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{gone ? 'Removed' : label}</span>{' '}
              “{note.note}”{note.scope === 'connection' && !gone && <span className="text-paper-faint"> · an admin reviews it first</span>}
            </span>
            {!gone && (
              <button
                type="button"
                onClick={() => void undo(note)}
                disabled={busy === note.memoryId}
                className="flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper disabled:opacity-40"
                aria-label={note.scope === 'connection' ? `Withdraw “${note.note}”` : `Undo “${note.note}”`}
              >
                <Undo2 className="h-3 w-3" aria-hidden /> {note.scope === 'connection' ? 'Withdraw' : 'Undo'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
