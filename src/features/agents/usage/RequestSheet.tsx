/**
 * One AI request, step by step (ADR 0020): each LLM call with its tokens and
 * cost, each tool call with the data it sent to the model and the ClickHouse
 * queries it ran. A query on the active connection links to Query logs; one
 * on another connection names it, since Query logs reads the active one.
 */

import type { ReactElement } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ArrowDownRight, CornerLeftUp, ExternalLink, Flag, FlaskConical, Lock, MessageSquare, Play, Sparkles, Square, Wrench } from "lucide-react";

import type { AiStepQuery, AiUsageEgress, AiUsageRequestDetail } from "@/api/aiUsage";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBytes, formatCount } from "@/features/observe/lib";
import { EmptyState, ErrorState, LoadingGrid, Mono, StatusPill } from "@/features/observe/ui";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { useEvalMutations } from "@/features/agents/evals/hooks";
import { cn } from "@/lib/utils";
import { useAiUsageRequest } from "./hooks";
import {
  buildTimeline,
  featureLabel,
  formatOffset,
  formatTokens,
  openChatThread,
  formatUsd,
  providerLabel,
  queryLogsLink,
  REQUEST_STATUS,
  requestCost,
  plural,
  requestCaller,
  requestOrigin,
  requestTokens,
  STEP_STATUS,
  type StepFlow,
  type TimelineStep,
} from "./lib";

/** Left margin per nesting level (Tailwind needs whole class names). */
const DEPTH_INDENT = ["ml-0", "ml-4", "ml-8", "ml-12", "ml-16"] as const;

/** The last segment of an agent path: the agent itself. */
function agentName(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(" › ");
  return parts[parts.length - 1] ?? null;
}

function FlowLine({ flow }: { flow: StepFlow }): ReactElement {
  const cls = "mt-1.5 flex items-center gap-1 text-[11px] text-paper-muted";
  if (flow.kind === "handoff") return <p className={cls}><ArrowDownRight className="h-3 w-3" aria-hidden /> Hands to <Mono className="text-paper">{flow.agents.join(", ")}</Mono></p>;
  if (flow.kind === "tools") return <p className={cls}><ArrowDownRight className="h-3 w-3" aria-hidden /> Calls <Mono className="text-paper">{flow.tools.join(", ")}</Mono></p>;
  if (flow.kind === "answer") return <p className={cls}><CornerLeftUp className="h-3 w-3" aria-hidden /> Answers <Mono className="text-paper">{flow.to}</Mono></p>;
  return <p className={cn(cls, "text-brand")}><Flag className="h-3 w-3" aria-hidden /> Final answer</p>;
}

function Marker({ icon: Icon, children }: { icon: typeof Play; children: string }): ReactElement {
  return (
    <div className="flex items-center gap-2 text-[11px] text-paper-faint">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 border-t border-dashed border-ink-500" aria-hidden />
    </div>
  );
}

function Tag({ children }: { children: string }): ReactElement {
  return <span className="whitespace-nowrap rounded-xs border border-ink-500 bg-ink-200/40 px-2 py-0.5 text-[11px] text-paper-muted">{children}</span>;
}

function QueryRow({ query, ranAt, connections }: { query: AiStepQuery; ranAt: number; connections: Record<string, string> }): ReactElement {
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const onActive = !query.connectionId || query.connectionId === activeConnectionId;
  const connectionName = query.connectionId ? connections[query.connectionId] ?? "another connection" : null;
  return (
    <li className="rounded-xs border border-ink-500 bg-ink-300/40 p-2">
      <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-paper">{query.sql}</pre>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-paper-muted">
        {query.error ? <span className="text-red-500">{query.error}</span> : (
          <>
            <span>{formatBytes(query.readBytes)} read</span>
            <span>{formatCount(query.readRows)} rows read</span>
            <span>{formatCount(query.resultRows)} returned</span>
            <span>{query.elapsedMs} ms</span>
          </>
        )}
        <span className="ml-auto">
          {onActive ? (
            <Link to={queryLogsLink(query.queryId, ranAt)} className="inline-flex items-center gap-1 text-brand hover:underline">Query logs <ExternalLink className="h-3 w-3" aria-hidden /></Link>
          ) : (
            <span title={`Switch to ${connectionName} to open it in Query logs`}>On {connectionName}</span>
          )}
        </span>
      </div>
    </li>
  );
}

function StepItem({ item, egress, connections }: { item: TimelineStep; egress: AiUsageEgress[]; connections: Record<string, string> }): ReactElement {
  const { step } = item;
  const status = STEP_STATUS[step.status] ?? STEP_STATUS.error;
  const isLlm = step.kind === "llm";
  const agent = agentName(step.agentPath);
  return (
    <li className="flex gap-2">
      <div className="w-14 shrink-0 pt-3 text-right font-mono text-[10px] leading-4">
        <span className="block text-paper-muted">#{item.number}</span>
        <span className="block text-paper-faint">{formatOffset(item.offsetMs)}</span>
      </div>
      <div className={cn("min-w-0 flex-1 rounded-xs border border-ink-500 bg-ink-200/20 p-3", DEPTH_INDENT[item.depth])}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className={isLlm ? "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-brand/10 text-brand" : "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-emerald-500/10 text-emerald-500"} aria-hidden>
              {isLlm ? <Sparkles className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] text-paper">{isLlm ? <>LLM call · <Mono>{agent ?? step.name}</Mono></> : <Mono className="text-paper">{step.name}</Mono>}</p>
              <p className="truncate text-[10px] text-paper-faint" title={step.agentPath ?? undefined}>
                {[isLlm ? step.name : agent ? `by ${agent}` : null, isLlm ? providerLabel(step.providerType) : null, `${(step.durationMs / 1000).toFixed(1)} s`].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isLlm && step.usageReported && (
              <span className="whitespace-nowrap text-[11px] tabular-nums text-paper-muted">
                {formatTokens(step.inputTokens)} in · {formatTokens(step.outputTokens)} out · {formatUsd(step.costUsd)}
              </span>
            )}
            {step.status !== "ok" && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
          </div>
        </div>
        {step.error && <p className="mt-2 text-[11px] text-red-500">{step.error}</p>}
        {egress.length > 0 && (
          <ul className="mt-2 space-y-1">
            {egress.map((e, i) => (
              <li key={`${e.source}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className="text-paper-faint">Sent</span>
                {e.kind === "chouse" && <StatusPill tone="muted" dot={false}>CHouse</StatusPill>}
                <Mono className="text-paper">{e.source}</Mono>
                <span className="text-paper-muted">{plural(e.rows, "row", formatCount(e.rows))}</span>
                {e.columns.length > 0 && <Mono className="min-w-0 truncate text-paper-faint">{e.columns.join(", ")}</Mono>}
              </li>
            ))}
          </ul>
        )}
        {step.queries.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {step.queries.map((q) => <QueryRow key={q.queryId} query={q} ranAt={step.startedAt} connections={connections} />)}
          </ul>
        )}
        {step.chQueries > step.queries.length && <p className="mt-1 text-[10px] text-paper-faint">{step.chQueries - step.queries.length} more queries not shown.</p>}
        {item.flow && <FlowLine flow={item.flow} />}
      </div>
    </li>
  );
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Detail({ data, onClose }: { data: AiUsageRequestDetail; onClose: () => void }): ReactElement {
  const r = data.request;
  const viewerId = useRbacStore((s) => s.user?.id ?? null);
  const egressByStep = new Map<string, AiUsageEgress[]>();
  for (const e of data.egress) egressByStep.set(e.stepId, [...(egressByStep.get(e.stepId) ?? []), e]);
  const status = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.error;
  const timeline = buildTimeline(data.steps, r.startedAt);
  // Threads are private: only the person who asked can open theirs.
  const ownThread = r.threadId && r.userId && r.userId === viewerId ? r.threadId : null;
  // A chat request keeps its question in the thread, so it can become a test case of the agent that answered.
  const canManageAgents = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_AGENTS_MANAGE));
  const savable = canManageAgents && r.featureId === "chat" && Boolean(r.threadId) && Boolean(r.agentId);
  const { fromRequest } = useEvalMutations();
  const saveAsCase = async (): Promise<void> => {
    try {
      await fromRequest.mutateAsync(r.id);
      toast.success(`Saved as a test case of ${r.agentName ?? "the agent"}: open it in AI Governance › Assistant › Evals`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the test case");
    }
  };
  const ended = r.status === "ok" ? "Finished" : r.status === "timeout" ? "Timed out" : "Failed";
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Tag>{`${requestTokens(r)} tokens · ${requestCost(r)}`}</Tag>
        <Tag>{`${formatCount(r.chQueries)} queries · ${formatBytes(r.chReadBytes)} read`}</Tag>
        <Tag>{`${plural(r.egressRows, "row", formatCount(r.egressRows))} sent`}</Tag>
        <Tag>{plural(timeline.length, "step")}</Tag>
        {r.status !== "ok" && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
      </div>
      {r.error && <p className="text-[11px] text-red-500">{r.error}</p>}
      {timeline.length === 0 ? <EmptyState title="No steps recorded" /> : (
        <div className="space-y-2">
          <Marker icon={Play}>{`Start · ${timeOf(r.startedAt)}`}</Marker>
          <ol className="space-y-2" aria-label="Steps, first to last">
            {timeline.map((item) => <StepItem key={item.step.id} item={item} egress={egressByStep.get(item.step.id) ?? []} connections={data.connections} />)}
          </ol>
          <Marker icon={Square}>{`${ended} · ${timeOf(r.startedAt + r.durationMs)} · ${(r.durationMs / 1000).toFixed(1)} s`}</Marker>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-paper-faint">
          <Lock className="h-3 w-3" aria-hidden /> Prompt and response text aren't stored.{r.source === "chat" ? " The question and answer are in the chat thread." : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {savable && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-xs text-[11px]" disabled={fromRequest.isPending} onClick={() => void saveAsCase()}>
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Save as test case
            </Button>
          )}
          {ownThread && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-xs text-[11px]" onClick={() => { onClose(); openChatThread(ownThread); }}>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Open in chat
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function RequestSheet({ requestId, onClose }: { requestId: string | null; onClose: () => void }): ReactElement {
  const { data, isLoading, isError, error } = useAiUsageRequest(requestId);
  const r = data?.request;
  return (
    <Sheet open={Boolean(requestId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{r ? r.agentName ?? featureLabel(r.featureId) : "AI request"}</SheetTitle>
          <SheetDescription>
            {r
              ? [r.userName ?? (r.source === "background" ? "CHouse (background)" : "Deleted user"), requestOrigin(r.source, r.featureId), requestCaller(r), new Date(r.startedAt).toLocaleString(), `${(r.durationMs / 1000).toFixed(1)} s`].filter(Boolean).join(" · ")
              : "Loading…"}
          </SheetDescription>
        </SheetHeader>
        {isLoading ? <LoadingGrid count={2} className="mt-4" /> : isError || !data ? (
          requestId ? <div className="mt-4"><ErrorState title="This AI request could not be loaded." error={error} /></div> : null
        ) : <Detail data={data} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
