/**
 * What a reply changed (ADR 0025), under the answer: each action the
 * assistant ran with its Undo, filed for a second approver, or proposed. It
 * reads the actions' current state, so an undo made in Activity shows here too.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { getAiActivity, undoAiAction, type AiAction } from '@/api/aiActions';
import { log } from '@/lib/log';

function line(action: AiAction): { icon: React.ReactNode; label: string; tone: string } {
  if (action.undoneAt) return { icon: <Undo2 className="h-3.5 w-3.5" aria-hidden />, label: 'Undone', tone: 'text-paper-faint line-through' };
  switch (action.status) {
    case 'executed':
      return { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />, label: 'Done', tone: 'text-paper-muted' };
    case 'pending':
    case 'approved':
    case 'running':
      return {
        icon: <Clock className="h-3.5 w-3.5 text-amber-400" aria-hidden />,
        label: action.source === 'background' && action.tier === 't3' ? 'Waiting for a second approver' : 'Waiting',
        tone: 'text-paper-muted',
      };
    case 'failed':
      return { icon: <XCircle className="h-3.5 w-3.5 text-red-400" aria-hidden />, label: 'Failed', tone: 'text-red-300' };
    case 'rejected':
      return { icon: <XCircle className="h-3.5 w-3.5 text-paper-faint" aria-hidden />, label: action.decidedByName ? `Rejected by ${action.decidedByName}` : 'Rejected', tone: 'text-paper-faint' };
    default:
      return { icon: <Clock className="h-3.5 w-3.5 text-paper-faint" aria-hidden />, label: 'Expired', tone: 'text-paper-faint' };
  }
}

export function ActionReceipts({ ids }: { ids: string[] }): React.JSX.Element | null {
  const [actions, setActions] = useState<AiAction[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const key = ids.join(',');

  const load = useCallback(async (): Promise<AiAction[]> => (key ? getAiActivity({ ids: key.split(',') }) : []), [key]);

  useEffect(() => {
    let live = true;
    load()
      .then((found) => { if (live) setActions(found); })
      .catch((error: unknown) => log.error('[AiChat] Failed to load what the reply changed', error));
    return () => { live = false; };
  }, [load]);

  if (!actions || actions.length === 0) return null;
  const ordered = ids.map((id) => actions.find((a) => a.id === id)).filter((a): a is AiAction => Boolean(a));

  const undo = async (action: AiAction): Promise<void> => {
    setBusy(action.id);
    try {
      const updated = await undoAiAction(action.id);
      setActions((previous) => (previous ?? []).map((a) => (a.id === updated.id ? updated : a)));
      toast.success(`Undone: ${action.title}`);
    } catch (error) {
      log.error('[AiChat] Failed to undo an action', error);
      toast.error(error instanceof Error ? error.message : 'Could not undo it. Change it by hand.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="mt-2 space-y-1" aria-label="What this reply changed">
      {ordered.map((action) => {
        const { icon, label, tone } = line(action);
        return (
          <li key={action.id} className="flex items-start gap-2 rounded-xs border border-ink-500 bg-ink-50 px-2 py-1.5 text-[12px]">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className={`min-w-0 flex-1 break-words ${tone}`}>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{label}</span>{' '}
              {action.description}
              {action.status === 'failed' && action.error && <span className="block text-[11px] text-red-300">{action.error}</span>}
            </span>
            {action.undoAvailable && (
              <button
                type="button"
                onClick={() => void undo(action)}
                disabled={busy === action.id}
                className="flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper disabled:opacity-40"
                aria-label={`Undo ${action.title}`}
              >
                <Undo2 className="h-3 w-3" aria-hidden /> Undo
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
