/**
 * The chat's approval card (ADR 0024 §Phase 2): the reply paused before a
 * write action, and the user approves, edits or rejects each call. Nothing
 * runs until they answer; the run continues in the same reply.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Lock, Pencil, ShieldAlert, X } from 'lucide-react';

import type { ApprovalDecision, PendingApproval } from '@/api/ai-chat';
import { argRows, argsToText, formatCountdown, parseArgsText } from '@/lib/aiApprovals';

const PRIMARY = 'inline-flex h-8 items-center gap-1.5 rounded-xs bg-brand px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-50 transition-colors hover:bg-brand-soft disabled:bg-ink-300 disabled:text-paper-faint';
const SECONDARY = 'inline-flex h-8 items-center gap-1.5 rounded-xs border border-ink-500 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:bg-ink-300 hover:text-paper disabled:opacity-40 disabled:hover:bg-transparent';
const DANGER = 'inline-flex h-8 items-center gap-1.5 rounded-xs px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300 transition-colors hover:bg-red-950/40 hover:text-red-200 disabled:opacity-40 disabled:hover:bg-transparent';

type Mode = 'view' | 'edit' | 'reject';

const DECIDED_LABEL: Record<ApprovalDecision['type'], string> = { approve: 'Approved', edit: 'Approved with changes', reject: 'Rejected' };

interface ApprovalCardProps {
  pending: PendingApproval[];
  /** Whether the user holds ai:act; without it they can only reject. */
  canAct: boolean;
  /** True while the answer is being sent. */
  busy: boolean;
  onSubmit: (decisions: ApprovalDecision[]) => void;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ApprovalCard({ pending, canAct, busy, onSubmit }: ApprovalCardProps): React.JSX.Element {
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const expiresAt = useMemo(() => Math.min(...pending.map((p) => p.expiresAt)), [pending]);
  const now = useNow(!busy);
  const left = expiresAt - now;
  const expired = left <= 0;
  const single = pending.length === 1;
  const disabled = busy || expired;

  const setMode = (id: string, mode: Mode): void => {
    setModes((m) => ({ ...m, [id]: mode }));
    setErrors((e) => ({ ...e, [id]: '' }));
  };

  const decide = (decision: ApprovalDecision): void => {
    setMode(decision.actionId, 'view');
    if (single) {
      onSubmit([decision]);
      return;
    }
    setDecisions((d) => ({ ...d, [decision.actionId]: decision }));
  };

  const approveEdited = (item: PendingApproval): void => {
    const parsed = parseArgsText(drafts[item.actionId] ?? argsToText(item.args));
    if (!parsed.ok) {
      setErrors((e) => ({ ...e, [item.actionId]: parsed.error }));
      return;
    }
    decide({ actionId: item.actionId, type: 'edit', args: parsed.args });
  };

  const undecide = (id: string): void => setDecisions((d) => {
    const rest = { ...d };
    delete rest[id];
    return rest;
  });

  const allDecided = pending.every((p) => decisions[p.actionId]);

  return (
    <div className="mt-2 rounded-xs border border-brand/40 bg-brand/5 p-3" role="group" aria-label="Approval needed">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          {single ? 'Approval needed' : `${pending.length} approvals needed`}
        </span>
        <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${expired ? 'text-red-300' : 'text-paper-faint'}`} aria-live="off">
          {expired ? 'Expired' : `Expires in ${formatCountdown(left)}`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {pending.map((item) => {
          const mode = modes[item.actionId] ?? 'view';
          const decided = decisions[item.actionId];
          const rows = argRows(item.args);
          return (
            <div key={item.actionId} className={pending.length > 1 ? 'border-t border-ink-500 pt-3 first:border-t-0 first:pt-0' : ''}>
              <p className="text-[13px] font-medium text-paper">{item.title}</p>
              <p className="mt-1 break-words rounded-xs border border-ink-500 bg-ink-50 px-2 py-1.5 font-mono text-[11px] text-paper-muted">{item.description}</p>

              {mode === 'edit' ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  <label htmlFor={`approval-args-${item.actionId}`} className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Arguments (JSON)</label>
                  <textarea
                    id={`approval-args-${item.actionId}`}
                    value={drafts[item.actionId] ?? argsToText(item.args)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.actionId]: e.target.value }))}
                    rows={Math.min(12, Math.max(3, argsToText(item.args).split('\n').length))}
                    spellCheck={false}
                    className="w-full resize-y rounded-xs border border-ink-500 bg-ink-50 px-2 py-1.5 font-mono text-[11px] text-paper focus:border-brand/60 focus:outline-none"
                  />
                  {errors[item.actionId] && <p className="text-[12px] text-red-300" role="alert">{errors[item.actionId]}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={PRIMARY} disabled={disabled} onClick={() => approveEdited(item)}>
                      <Check className="h-3 w-3" aria-hidden /> Approve with changes
                    </button>
                    <button type="button" className={SECONDARY} disabled={busy} onClick={() => setMode(item.actionId, 'view')}>Cancel</button>
                  </div>
                </div>
              ) : rows.length > 0 && (
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                  {rows.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="font-mono text-[11px] text-paper-faint">{key}</dt>
                      <dd className="min-w-0 break-words text-paper-muted">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {mode === 'reject' && (
                <form
                  className="mt-2 flex flex-col gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const message = (drafts[`reject-${item.actionId}`] ?? '').trim();
                    decide({ actionId: item.actionId, type: 'reject', ...(message ? { message } : {}) });
                  }}
                >
                  <label htmlFor={`approval-reason-${item.actionId}`} className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Why not? (optional, the assistant reads it)</label>
                  <input
                    id={`approval-reason-${item.actionId}`}
                    autoFocus
                    value={drafts[`reject-${item.actionId}`] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [`reject-${item.actionId}`]: e.target.value }))}
                    maxLength={1000}
                    placeholder="e.g. Not during the backfill"
                    className="h-8 w-full rounded-xs border border-ink-500 bg-ink-50 px-2 text-[12px] text-paper placeholder:text-paper-faint focus:border-brand/60 focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button type="submit" className={`${DANGER} border border-red-900/60`} disabled={busy}>
                      <X className="h-3 w-3" aria-hidden /> Reject
                    </button>
                    <button type="button" className={SECONDARY} disabled={busy} onClick={() => setMode(item.actionId, 'view')}>Cancel</button>
                  </div>
                </form>
              )}

              {mode === 'view' && (decided ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${decided.type === 'reject' ? 'text-red-300' : 'text-brand'}`}>{DECIDED_LABEL[decided.type]}</span>
                  <button type="button" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim underline-offset-2 hover:text-paper hover:underline disabled:opacity-40" disabled={busy} onClick={() => undecide(item.actionId)}>Change</button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" className={PRIMARY} disabled={disabled || !canAct} onClick={() => decide({ actionId: item.actionId, type: 'approve' })}>
                    <Check className="h-3 w-3" aria-hidden /> Approve
                  </button>
                  <button type="button" className={SECONDARY} disabled={disabled || !canAct} onClick={() => setMode(item.actionId, 'edit')}>
                    <Pencil className="h-3 w-3" aria-hidden /> Edit
                  </button>
                  <button type="button" className={DANGER} disabled={disabled} onClick={() => setMode(item.actionId, 'reject')}>
                    <X className="h-3 w-3" aria-hidden /> Reject
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {!single && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-500 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">{Object.keys(decisions).length} of {pending.length} answered</span>
          <button type="button" className={PRIMARY} disabled={disabled || !allDecided} onClick={() => onSubmit(pending.map((p) => decisions[p.actionId]))}>
            Continue
          </button>
        </div>
      )}

      {!canAct && !expired && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-paper-dim">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          You need the ai:act permission to approve AI actions. You can still reject them.
        </p>
      )}
      {expired && (
        <p className="mt-2 text-[12px] text-paper-dim">This approval expired, so the reply stopped. Ask again to continue.</p>
      )}
    </div>
  );
}
