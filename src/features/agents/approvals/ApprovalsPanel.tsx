/**
 * AI Governance › Approvals (ADR 0024 §Phase 2, ADR 0025): every write action
 * an AI agent asked for or made. Chat requests are answered in their chat;
 * queued requests (runs with nobody there, and high-risk T3 calls) wait here
 * for someone with ai:act — for T3, a second person who holds the tool's
 * permission — and run as that person once approved. MCP calls held for
 * their own user's confirmation are confirmed here or in Chobi.
 */

import { useMemo, useState, type ReactElement } from "react";
import { Check, ClipboardCheck, MessageSquare, X } from "lucide-react";

import type { AiAction, AiActionStatus } from "@/api/aiActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { formatAgo } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, LoadingGrid, Panel, StatusPill } from "@/features/observe/ui";
import { Field, INPUT_CLASS, TEXTAREA_CLASS } from "@/features/agents/assistant/shared";
import { openChatThread } from "@/features/agents/usage/lib";
import { argsToText, expiresIn, parseArgsText } from "@/lib/aiApprovals";
import { useAiActions, useDecide, type Decide } from "./hooks";
import { chatHint, effectiveStatus, sourceLabel, STATUS_FILTERS, STATUS_LABEL, STATUS_TONE, tierLabel, TIER_TONE } from "./lib";

type Filter = AiActionStatus | "all";

/** Keyed by the action, so a list refetch never wipes an edit in progress. */
function ReviewSheet({ action, onClose, decide }: { action: AiAction; onClose: () => void; decide: Decide }): ReactElement {
  const [draft, setDraft] = useState(() => argsToText(action.args));
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const edited = draft.trim() !== argsToText(action.args).trim();
  const busy = decide.busyId === action.id;
  const status = effectiveStatus(action, Date.now());

  const approve = async (): Promise<void> => {
    let args: Record<string, unknown> | undefined;
    if (edited) {
      const parsed = parseArgsText(draft);
      if (!parsed.ok) {
        setProblem(parsed.error);
        return;
      }
      args = parsed.args;
    }
    if (await decide.approve(action, args)) onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{action.title}</SheetTitle>
          <SheetDescription>{sourceLabel(action)} · {formatAgo(action.createdAt)}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
            {action.tier && <StatusPill tone={TIER_TONE[action.tier]} dot={false}>{tierLabel(action.tier)}</StatusPill>}
            {action.decidedByName && <span className="text-[11px] text-paper-muted">by {action.decidedByName}</span>}
          </div>
          <p className="break-words rounded-xs border border-ink-500 bg-ink-200/40 p-2 font-mono text-[12px] text-paper">{action.description}</p>
          {action.canDecide ? (
            <Field label="Arguments" hint="Edit to change what runs; CHouse checks them before running" htmlFor="approval-args">
              <Textarea id="approval-args" className={TEXTAREA_CLASS} value={draft} onChange={(e) => { setDraft(e.target.value); setProblem(null); }} spellCheck={false} />
            </Field>
          ) : (
            <Field label="Arguments">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[11px] text-paper">{argsToText(action.args)}</pre>
            </Field>
          )}
          {problem && <p role="alert" className="text-[12px] text-red-400">{problem}</p>}
          {action.error && (
            <Field label="Error">
              <p className="rounded-xs border border-red-500/30 bg-red-500/5 p-2 text-[12px] text-red-400">{action.error}</p>
            </Field>
          )}
          {action.result !== null && action.result !== undefined && (
            <Field label="Result">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[11px] text-paper">{JSON.stringify(action.result, null, 2)}</pre>
            </Field>
          )}
          {action.canDecide && (
            <>
              <Field label="Reason, if you reject it" htmlFor="approval-reason">
                <Input id="approval-reason" className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Optional" />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-500 pt-4">
                <Button type="button" variant="ghost" className="h-9 rounded-xs text-[11px] text-red-400 hover:text-red-300" disabled={busy} onClick={() => void decide.reject(action, reason.trim() || undefined).then((ok) => ok && onClose())}>
                  <X className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-9 rounded-xs text-[11px]" onClick={onClose}>Cancel</Button>
                  <Button type="button" className={DH_PRIMARY} disabled={busy} onClick={() => void approve()}>
                    <Check className="h-3.5 w-3.5" /> {edited ? "Approve with changes" : "Approve and run"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ApprovalsPanel(): ReactElement {
  const [filter, setFilter] = useState<Filter>("pending");
  const actions = useAiActions(filter === "all" ? null : filter);
  const decide = useDecide();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const rows = useMemo(() => actions.data?.actions ?? [], [actions.data]);
  const reviewing = rows.find((a) => a.id === reviewId) ?? null;
  const canAct = actions.data?.canAct ?? false;
  const now = Date.now();

  return (
    <Panel
      title="Approvals"
      meta={canAct ? "Write actions AI agents asked for. Requests from background runs wait here for you." : "Write actions AI agents asked for on your behalf."}
      actions={
        <Select value={filter} onValueChange={(v) => setFilter(STATUS_FILTERS.find((f) => f.value === v)?.value ?? "pending")}>
          <SelectTrigger className="h-8 w-32 rounded-xs text-[11px]" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
      }
    >
      {actions.isLoading ? <LoadingGrid count={1} /> : actions.isError || !actions.data ? (
        <ErrorState title="Approvals could not be loaded." error={actions.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={filter === "pending" ? "Nothing waits for approval" : "No actions here"}
          body="When an AI agent wants to change something — kill a query, save a dashboard, update table context — the request shows up here and in its chat."
        />
      ) : (
        <DataTable label="AI actions" head={["Action", "Asked by", "Check", "Status", "When", ""]}>
          {rows.map((a) => {
            const status = effectiveStatus(a, now);
            const hint = chatHint(a);
            const busy = decide.busyId === a.id;
            return (
              <tr key={a.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => setReviewId(a.id)}>
                <td className="max-w-[360px]">
                  <button type="button" className="text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); setReviewId(a.id); }}>{a.title}</button>
                  <span className="block truncate font-mono text-[10px] text-paper-faint" title={a.description}>{a.description}</span>
                </td>
                <td className="text-[12px] text-paper-muted">{sourceLabel(a)}</td>
                <td>{a.tier ? <StatusPill tone={TIER_TONE[a.tier]} dot={false}>{tierLabel(a.tier)}</StatusPill> : <span className="text-[11px] text-paper-faint">—</span>}</td>
                <td>
                  <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
                  {a.error && <span className="mt-0.5 block max-w-[220px] truncate text-[10px] text-red-400" title={a.error}>{a.error}</span>}
                </td>
                <td className="whitespace-nowrap text-[11px] text-paper-muted">
                  {status === "pending" ? <span title={new Date(a.expiresAt).toLocaleString()}>Expires {expiresIn(a.expiresAt, now)}</span> : <span title={new Date(a.decidedAt ?? a.createdAt).toLocaleString()}>{formatAgo(a.decidedAt ?? a.createdAt)}</span>}
                </td>
                <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                  {a.canDecide ? (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px] text-red-400 hover:text-red-300" disabled={busy} onClick={() => void decide.reject(a)} aria-label={`Reject ${a.title}`}>Reject</Button>
                      <Button variant="outline" className="h-7 rounded-xs px-2 text-[11px]" onClick={() => setReviewId(a.id)}>Review</Button>
                      <Button className="h-7 gap-1 rounded-xs bg-brand px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft" disabled={busy} onClick={() => void decide.approve(a)} aria-label={`Approve ${a.title}`}>
                        <Check className="h-3 w-3" /> Approve
                      </Button>
                    </div>
                  ) : hint && a.threadId ? (
                    <Button variant="ghost" className="h-7 rounded-xs px-2 text-[11px]" onClick={() => openChatThread(a.threadId!)}>
                      <MessageSquare className="mr-1 h-3 w-3" /> {hint}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
      {reviewing && <ReviewSheet key={reviewing.id} action={reviewing} onClose={() => setReviewId(null)} decide={decide} />}
    </Panel>
  );
}
