import { Check, MessageSquare, RotateCcw, X } from "lucide-react";

import { AI_ORIGIN_LABELS, type AiAction } from "@/api/aiActions";
import { Button } from "@/components/ui/button";
import { useAiActivity, useAiInbox, useDecide, type Decide } from "@/features/agents/approvals/hooks";
import { effectiveStatus, sourceLabel, STATUS_LABEL, STATUS_TONE, tierLabel, TIER_TONE } from "@/features/agents/approvals/lib";
import { openChatThread } from "@/features/agents/usage/lib";
import { formatAgo } from "@/features/observe/lib";
import { StatusPill } from "@/features/observe/ui";
import { expiresIn } from "@/lib/aiApprovals";

const RECENT_LIMIT = 30;

interface ActivityTabProps {
  /** Fetch only while the tab is showing. */
  active: boolean;
}

/**
 * What waits for you and what AI changed (ADR 0025 §6): confirm or decline a
 * held MCP call, approve a second-approver request, undo a recent change.
 */
export function ActivityTab({ active }: ActivityTabProps): React.JSX.Element {
  const inbox = useAiInbox(active);
  const recent = useAiActivity(RECENT_LIMIT, active);
  const decide = useDecide();
  const now = Date.now();
  const waiting = inbox.data ?? [];
  const waitingIds = new Set(waiting.map((a) => a.id));
  const done = (recent.data ?? []).filter((a) => !waitingIds.has(a.id));

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="chobi-activity">
      <Section title="Needs you" count={waiting.length}>
        {inbox.isLoading ? (
          <Hint>Checking…</Hint>
        ) : inbox.isError ? (
          <Hint>Approvals could not be loaded.</Hint>
        ) : waiting.length === 0 ? (
          <Hint>Nothing waits for you. Changes that need a yes show up here.</Hint>
        ) : (
          waiting.map((action) => <WaitingItem key={action.id} action={action} decide={decide} now={now} />)
        )}
      </Section>
      <Section title="Recent">
        {recent.isLoading ? (
          <Hint>Loading…</Hint>
        ) : recent.isError ? (
          <Hint>Activity could not be loaded.</Hint>
        ) : done.length === 0 ? (
          <Hint>No AI changes yet. What an agent changes for you — in chat, MCP or the CLI — is listed here, with undo.</Hint>
        ) : (
          done.map((action) => <RecentItem key={action.id} action={action} decide={decide} now={now} />)
        )}
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-b border-ink-500 px-3 py-3 last:border-b-0" aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-ink-50">{count}</span>}
      </h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <li className="px-1 py-2 text-[12px] text-paper-faint">{children}</li>;
}

function WaitingItem({ action, decide, now }: { action: AiAction; decide: Decide; now: number }): React.JSX.Element {
  const busy = decide.busyId === action.id;
  const held = action.source === "held";
  return (
    <li className="rounded-sm border border-ink-500 bg-ink-200/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-paper">{action.title}</p>
          <p className="mt-0.5 break-words font-mono text-[10px] text-paper-muted">{action.description}</p>
        </div>
        {action.tier && <StatusPill tone={TIER_TONE[action.tier]} dot={false}>{tierLabel(action.tier)}</StatusPill>}
      </div>
      <p className="mt-1.5 text-[11px] text-paper-faint">
        {held ? `${AI_ORIGIN_LABELS[action.origin]} agent waits for your answer` : sourceLabel(action)} · expires {expiresIn(action.expiresAt, now)}
      </p>
      {action.canDecide ? (
        <div className="mt-2 flex justify-end gap-1">
          <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px] text-red-400 hover:text-red-300" disabled={busy} onClick={() => void decide.reject(action)} aria-label={`${held ? "Decline" : "Reject"} ${action.title}`}>
            <X className="mr-1 h-3 w-3" /> {held ? "Decline" : "Reject"}
          </Button>
          <Button className="h-7 gap-1 rounded-xs bg-brand px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft" disabled={busy} onClick={() => void decide.approve(action)} aria-label={`${held ? "Confirm" : "Approve"} ${action.title}`}>
            <Check className="h-3 w-3" /> {held ? "Confirm" : "Approve"}
          </Button>
        </div>
      ) : action.threadId ? (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" onClick={() => openChatThread(action.threadId ?? "")}>
            <MessageSquare className="mr-1 h-3 w-3" /> Answer in chat
          </Button>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-paper-faint">Waiting for a second person to approve.</p>
      )}
    </li>
  );
}

function RecentItem({ action, decide, now }: { action: AiAction; decide: Decide; now: number }): React.JSX.Element {
  const status = effectiveStatus(action, now);
  const busy = decide.busyId === action.id;
  return (
    <li className="group rounded-sm px-1.5 py-1.5 hover:bg-ink-200/50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] text-paper" title={action.description}>{action.title}</p>
          <p className="truncate font-mono text-[10px] text-paper-faint" title={action.description}>{action.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action.undoneAt ? (
            <StatusPill tone="muted" dot={false}>Undone</StatusPill>
          ) : (
            <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[10px] text-paper-faint">
          {AI_ORIGIN_LABELS[action.origin]} · {formatAgo(action.decidedAt ?? action.createdAt, now)}
        </span>
        <span className="flex gap-1">
          {action.threadId && (
            <button type="button" className="text-[10px] text-paper-muted hover:text-brand" onClick={() => openChatThread(action.threadId ?? "")}>
              Open chat
            </button>
          )}
          {action.undoAvailable && (
            <button type="button" disabled={busy} className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand hover:text-brand-soft disabled:opacity-50" onClick={() => void decide.undo(action)} aria-label={`Undo ${action.title}`}>
              <RotateCcw className="h-2.5 w-2.5" /> Undo
            </button>
          )}
        </span>
      </div>
      {action.error && <p className="mt-1 truncate text-[10px] text-red-400" title={action.error}>{action.error}</p>}
    </li>
  );
}
