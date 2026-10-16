/**
 * One AI request, step by step (ADR 0020): each LLM call with its tokens and
 * cost, each tool call with the data it sent to the model and the ClickHouse
 * queries it ran. A query on the active connection links to Query logs; one
 * on another connection names it, since Query logs reads the active one.
 */

import type { ReactElement } from "react";
import { Link } from "react-router";
import { ExternalLink, Lock, Sparkles, Wrench } from "lucide-react";

import type { AiStepQuery, AiUsageEgress, AiUsageRequestDetail, AiUsageStep } from "@/api/aiUsage";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBytes, formatCount } from "@/features/observe/lib";
import { EmptyState, ErrorState, LoadingGrid, Mono, StatusPill } from "@/features/observe/ui";
import { useAuthStore } from "@/stores";
import { useAiUsageRequest } from "./hooks";
import {
  featureLabel,
  formatTokens,
  formatUsd,
  providerLabel,
  queryLogsLink,
  REQUEST_STATUS,
  requestCost,
  plural,
  requestOrigin,
  requestTokens,
  STEP_STATUS,
} from "./lib";

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

function StepItem({ step, egress, connections }: { step: AiUsageStep; egress: AiUsageEgress[]; connections: Record<string, string> }): ReactElement {
  const status = STEP_STATUS[step.status] ?? STEP_STATUS.error;
  const isLlm = step.kind === "llm";
  return (
    <li className="rounded-xs border border-ink-500 bg-ink-200/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={isLlm ? "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-brand/10 text-brand" : "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-emerald-500/10 text-emerald-500"} aria-hidden>
            {isLlm ? <Sparkles className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] text-paper">{isLlm ? <>LLM call · <Mono>{step.name}</Mono></> : <Mono className="text-paper">{step.name}</Mono>}</p>
            <p className="truncate text-[10px] text-paper-faint">{[step.agentPath, isLlm ? providerLabel(step.providerType) : null, `${(step.durationMs / 1000).toFixed(1)} s`].filter(Boolean).join(" · ")}</p>
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
    </li>
  );
}

function Detail({ data }: { data: AiUsageRequestDetail }): ReactElement {
  const r = data.request;
  const egressByStep = new Map<string, AiUsageEgress[]>();
  for (const e of data.egress) egressByStep.set(e.stepId, [...(egressByStep.get(e.stepId) ?? []), e]);
  const status = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.error;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Tag>{`${requestTokens(r)} tokens · ${requestCost(r)}`}</Tag>
        <Tag>{`${formatCount(r.chQueries)} queries · ${formatBytes(r.chReadBytes)} read`}</Tag>
        <Tag>{`${plural(r.egressRows, "row", formatCount(r.egressRows))} sent`}</Tag>
        {r.status !== "ok" && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
      </div>
      {r.error && <p className="text-[11px] text-red-500">{r.error}</p>}
      {data.steps.length === 0 ? <EmptyState title="No steps recorded" /> : (
        <ol className="space-y-2">
          {data.steps.map((s) => <StepItem key={s.id} step={s} egress={egressByStep.get(s.id) ?? []} connections={data.connections} />)}
        </ol>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-paper-faint">
        <Lock className="h-3 w-3" aria-hidden /> Prompt and response text aren't stored.{r.source === "chat" ? " The question and answer are in the chat thread." : ""}
      </p>
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
              ? [r.userName ?? (r.source === "background" ? "CHouse (background)" : "Deleted user"), requestOrigin(r.source, r.featureId), new Date(r.startedAt).toLocaleString(), `${(r.durationMs / 1000).toFixed(1)} s`].join(" · ")
              : "Loading…"}
          </SheetDescription>
        </SheetHeader>
        {isLoading ? <LoadingGrid count={2} className="mt-4" /> : isError || !data ? (
          requestId ? <div className="mt-4"><ErrorState title="This AI request could not be loaded." error={error} /></div> : null
        ) : <Detail data={data} />}
      </SheetContent>
    </Sheet>
  );
}
