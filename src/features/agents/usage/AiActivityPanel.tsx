/**
 * AI Governance › AI activity (ADR 0020): what CHouse's own AI agents cost,
 * what ClickHouse work they caused, and what data they sent to LLM
 * providers. With `ai_usage:view` it covers everyone; otherwise the server
 * returns only the viewer's own requests and the panel says so.
 */

import { useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react";

import type { AiEgressSource, AiModelUsage, AiUsageRequest, AiUsageSummary } from "@/api/aiUsage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatAgo, formatBytes, formatCount } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, Panel, StatusPill } from "@/features/observe/ui";
import { useDebounce } from "@/hooks";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useAiEgress, useAiUsageByModel, useAiUsageRequests, useAiUsageSummary } from "./hooks";
import {
  cachedShare,
  featureLabel,
  formatTokens,
  formatUsd,
  providerLabel,
  REQUEST_STATUS,
  requestCost,
  plural,
  requestOrigin,
  requestTokens,
  USAGE_WINDOWS,
} from "./lib";
import { RequestSheet } from "./RequestSheet";

const PAGE_SIZE = 25;
const SHOWN_COLUMNS = 4;
/**
 * The two side-by-side panels keep one fixed body height whatever they hold,
 * so they always line up; a longer list scrolls inside with its header pinned.
 */
const SIDE_PANEL_BODY = "h-80";
const SIDE_TABLE_SCROLL = "h-full overflow-y-auto";
/** The request list scrolls inside the panel past about 15 rows. */
const REQUESTS_TABLE_SCROLL = "max-h-[560px] overflow-y-auto";

function Banner({ tone, children }: { tone: "warn" | "muted"; children: ReactNode }): ReactElement {
  return (
    <div role="status" className={tone === "warn" ? "flex flex-wrap items-center gap-2 rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500" : "flex flex-wrap items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 p-3 text-[12px] text-paper-muted"}>
      {children}
    </div>
  );
}

function costMeta(summary: AiUsageSummary): string {
  if (summary.llmCalls === 0) return "No AI calls yet";
  if (summary.costUsd === null) return "No model has a price";
  return summary.unpricedCalls > 0 ? "Priced models only" : "All calls priced";
}

function Kpis({ summary }: { summary: AiUsageSummary }): ReactElement {
  const own = summary.scope === "own";
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Kpi label={own ? "Your AI requests" : "AI requests"} value={formatCount(summary.requests)} meta={own ? `${summary.failedRequests} failed` : `${plural(summary.users, "user")} · ${plural(summary.agents, "agent")}`} />
      <Kpi label="Tokens" value={`${summary.incompleteCalls > 0 ? "≥ " : ""}${formatTokens(summary.inputTokens + summary.outputTokens)}`} meta={`${formatTokens(summary.inputTokens)} in · ${formatTokens(summary.outputTokens)} out`} />
      <Kpi label="Est. cost" value={formatUsd(summary.costUsd)} meta={costMeta(summary)} tone={summary.costUsd !== null && summary.unpricedCalls > 0 ? "warn" : undefined} />
      <Kpi label="ClickHouse read by AI" value={formatBytes(summary.chReadBytes)} meta={`${formatCount(summary.chQueries)} queries`} />
      <Kpi label="Sent to providers" value={plural(summary.egressRows, "row", formatCount(summary.egressRows))} meta={`${plural(summary.egressSources, "source")} · ${formatBytes(summary.egressBytes)}`} />
    </div>
  );
}

function ColumnList({ columns }: { columns: string[] }): ReactElement {
  if (columns.length === 0) return <span className="text-[11px] text-paper-faint">—</span>;
  const shown = columns.slice(0, SHOWN_COLUMNS);
  const more = columns.length - shown.length;
  return (
    <span className="block max-w-[260px] truncate font-mono text-[11px] text-paper-muted" title={columns.join(", ")}>
      {shown.join(", ")}{more > 0 ? ` +${more}` : ""}
    </span>
  );
}

function EgressPanel({ days, own }: { days: number; own: boolean }): ReactElement {
  const egress = useAiEgress(days);
  return (
    <Panel title="Data sent to providers" meta="Each tool result counted once" bodyClassName={SIDE_PANEL_BODY}>
      {egress.isLoading ? <LoadingGrid count={2} /> : egress.isError || !egress.data ? (
        <ErrorState title="Data sent to providers could not be loaded." error={egress.error} />
      ) : egress.data.length === 0 ? (
        <EmptyState title="No data sent yet" body="Tables, columns and CHouse records appear here when an AI tool returns them to a model." />
      ) : (
        <DataTable label="Data sent to providers" scrollClassName={SIDE_TABLE_SCROLL} head={own ? ["Source", "Columns", "Rows", "Provider"] : ["Source", "Columns", "Rows", "Users", "Provider"]}>
          {egress.data.map((s: AiEgressSource) => (
            <tr key={`${s.kind}|${s.source}`}>
              <td className="max-w-[240px]">
                <span className="flex min-w-0 items-center gap-2">
                  {s.kind === "chouse" && <StatusPill tone="muted" dot={false}>CHouse</StatusPill>}
                  <Mono className="truncate text-paper">{s.source}</Mono>
                </span>
              </td>
              <td><ColumnList columns={s.columns} /></td>
              <td className="tabular-nums">{formatCount(s.rows)}</td>
              {!own && <td className="tabular-nums text-paper-muted">{s.users}</td>}
              <td className="whitespace-nowrap text-paper-muted">{s.providers.length > 0 ? s.providers.map(providerLabel).join(", ") : "—"}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}

function ModelsPanel({ days }: { days: number }): ReactElement {
  const models = useAiUsageByModel(days);
  return (
    <Panel title="Usage by model" meta="Most tokens first" bodyClassName={SIDE_PANEL_BODY}>
      {models.isLoading ? <LoadingGrid count={2} /> : models.isError || !models.data ? (
        <ErrorState title="Usage by model could not be loaded." error={models.error} />
      ) : models.data.length === 0 ? (
        <EmptyState title="No model calls yet" />
      ) : (
        <DataTable label="Usage by model" scrollClassName={SIDE_TABLE_SCROLL} head={["Model", "Requests", "Tokens", "Cached", "Cost"]}>
          {models.data.map((m: AiModelUsage) => {
            const cached = cachedShare(m.inputTokens, m.cacheReadTokens);
            return (
              <tr key={m.modelConfigId ?? m.name}>
                <td><span className="block text-[12px] text-paper">{m.name}</span><span className="block text-[10px] text-paper-faint">{providerLabel(m.providerType)}</span></td>
                <td className="tabular-nums">{formatCount(m.requests)}</td>
                <td className="tabular-nums">{m.incompleteCalls > 0 ? "≥ " : ""}{formatTokens(m.inputTokens + m.outputTokens)}</td>
                <td className="tabular-nums text-paper-muted">{cached === null ? "—" : `${cached}%`}</td>
                <td>
                  {m.costUsd !== null ? <span className="tabular-nums">{formatUsd(m.costUsd)}</span>
                    : m.hasPrice ? <span className="text-paper-faint" title="Priced after these calls; past costs don't change">–</span>
                    : <StatusPill tone="warn" dot={false}>No price</StatusPill>}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Panel>
  );
}

function RequestsPanel({ days, own, onOpen }: { days: number; own: boolean; onOpen: (id: string) => void }): ReactElement {
  const [search, setSearch] = useState("");
  const q = useDebounce(search.trim(), 300);
  // The page belongs to one search and window; a new one starts from the first page.
  const pageKey = `${days}|${q}`;
  const [paging, setPaging] = useState({ key: pageKey, offset: 0 });
  const offset = paging.key === pageKey ? paging.offset : 0;
  const setOffset = (next: number): void => setPaging({ key: pageKey, offset: next });
  const page = useAiUsageRequests(days, q, offset, PAGE_SIZE);
  const total = page.data?.total ?? 0;

  return (
    <Panel
      title={own ? "Your recent AI requests" : "Recent AI requests"}
      meta={page.data ? `${formatCount(total)} in this window` : undefined}
      actions={
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={own ? "Agent, feature or table" : "User, agent, feature or table"} aria-label="Search AI requests" className="h-8 w-60 rounded-xs pl-7 text-[12px]" />
        </div>
      }
    >
      {page.isLoading ? <LoadingGrid count={2} /> : page.isError || !page.data ? (
        <ErrorState title="AI requests could not be loaded." error={page.error} />
      ) : page.data.requests.length === 0 ? (
        <EmptyState icon={Activity} title={q ? "No requests match" : "No AI requests yet"} body={q ? "Try another user, agent, feature or table." : "Requests appear here once the chat or an AI feature runs."} />
      ) : (
        <>
          <DataTable label="AI requests" scrollClassName={REQUESTS_TABLE_SCROLL} head={own ? ["When", "Agent", "Tokens", "Cost", "CH read", "Sent", "Status"] : ["When", "User", "Agent", "Tokens", "Cost", "CH read", "Sent", "Status"]}>
            {page.data.requests.map((r: AiUsageRequest) => (
              <tr key={r.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => onOpen(r.id)}>
                <td className="whitespace-nowrap text-paper-muted" title={new Date(r.startedAt).toLocaleString()}>{formatAgo(r.startedAt)}</td>
                {!own && <td className="text-[12px] text-paper">{r.userName ?? (r.source === "background" ? "CHouse (background)" : "Deleted user")}</td>}
                <td>
                  <button type="button" className="text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>
                    {r.agentName ?? featureLabel(r.featureId)}
                  </button>
                  <span className="block text-[10px] text-paper-faint">{requestOrigin(r.source, r.featureId)}</span>
                </td>
                <td className="whitespace-nowrap tabular-nums">{requestTokens(r)}</td>
                <td className="whitespace-nowrap tabular-nums">{requestCost(r)}</td>
                <td className="whitespace-nowrap tabular-nums text-paper-muted">{formatBytes(r.chReadBytes)}</td>
                <td className="whitespace-nowrap tabular-nums text-paper-muted">{plural(r.egressRows, "row", formatCount(r.egressRows))}</td>
                <td><StatusPill tone={(REQUEST_STATUS[r.status] ?? REQUEST_STATUS.error).tone}>{(REQUEST_STATUS[r.status] ?? REQUEST_STATUS.error).label}</StatusPill></td>
              </tr>
            ))}
          </DataTable>
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-paper-muted">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {formatCount(total)}</span>
              <Button variant="outline" size="sm" className="h-7 rounded-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <Button variant="outline" size="sm" className="h-7 rounded-xs" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export function AiActivityPanel(): ReactElement {
  const [days, setDays] = useState<number>(7);
  const [open, setOpen] = useState<string | null>(null);
  const summary = useAiUsageSummary(days);
  const canPrice = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_MODELS_UPDATE));
  const own = summary.data?.scope === "own";

  return (
    <div className="space-y-4" data-onboarding-id="ai-activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-paper-muted">
          {own ? "Your own AI requests" : "Every request of the chat and the AI features"}: tokens, estimated cost, the ClickHouse queries they ran and the data sent to providers. Prompt and response text aren't stored.
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 rounded-xs text-[11px]" aria-label="Window"><SelectValue /></SelectTrigger>
          <SelectContent>{USAGE_WINDOWS.map((w) => <SelectItem key={w.days} value={String(w.days)}>{w.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {summary.isLoading ? <LoadingGrid count={5} className="lg:grid-cols-5" /> : summary.isError || !summary.data ? (
        <ErrorState title="AI usage could not be loaded." error={summary.error} />
      ) : (
        <>
          {summary.data.unpricedModels.length > 0 && (
            <Banner tone="warn">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                {summary.data.unpricedModels.length === 1 ? "1 model has" : `${summary.data.unpricedModels.length} models have`} no price, so cost is incomplete: {summary.data.unpricedModels.map((m) => m.name).join(", ")}.
              </span>
              {canPrice && <Link to="/admin/ai-models" className="ml-auto underline underline-offset-2 hover:text-amber-400">Set prices</Link>}
            </Banner>
          )}
          {summary.data.incompleteCalls > 0 && (
            <Banner tone="muted">
              {`${formatCount(summary.data.incompleteCalls)} ${summary.data.incompleteCalls === 1 ? "call" : "calls"} reported no token usage (timed out, stopped, or the provider sent none), so token and cost totals are a lower bound.`}
            </Banner>
          )}
          <Kpis summary={summary.data} />
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <EgressPanel days={days} own={own} />
        <ModelsPanel days={days} />
      </div>
      <RequestsPanel days={days} own={own} onOpen={setOpen} />
      <RequestSheet requestId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
