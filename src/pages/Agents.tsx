/**
 * AI Governance (ADR 0016 §10, ADR 0017): every agent connected over MCP or a
 * personal access token — what it read, what it cost, whether the data was
 * healthy — plus budget policies, the pause switch, and the MCP endpoint
 * with its tool switches. The Assistant tab (ADR 0019) manages CHouse's own
 * AI agents: the chat and every AI feature.
 */

import { useState, type ReactElement } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Bot, ListChecks, Pause, Play, Plug, Shield, Sparkles } from "lucide-react";

import type { AgentSession } from "@/api/agents";
import { NavPill, PageHeader } from "@/components/common/PageShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AssistantPanel } from "@/features/agents/assistant/AssistantPanel";
import { McpPanel } from "@/features/agents/McpPanel";
import { PoliciesPanel } from "@/features/agents/PoliciesPanel";
import { budgetShare } from "@/features/agents/policyForm";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useAgentMutations, useAgentPolicies, useAgentSession, useAgentSessions, useAgentSummary } from "@/features/observe/hooks";
import { formatAgo, formatBytes, formatCount, formatPercent } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, Panel, RatioBar, StatusPill } from "@/features/observe/ui";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

type Tab = "sessions" | "policies" | "mcp" | "assistant";
/** External agents (MCP / tokens) need agents:view; the built-in AI agents need ai_agents:view. */
const TABS: Array<{ key: Tab; label: string; icon: typeof Bot; permission: string }> = [
  { key: "sessions", label: "Sessions", icon: ListChecks, permission: RBAC_PERMISSIONS.AGENTS_VIEW },
  { key: "policies", label: "Policies", icon: Shield, permission: RBAC_PERMISSIONS.AGENTS_VIEW },
  { key: "mcp", label: "MCP", icon: Plug, permission: RBAC_PERMISSIONS.AGENTS_VIEW },
  { key: "assistant", label: "Assistant", icon: Sparkles, permission: RBAC_PERMISSIONS.AI_AGENTS_VIEW },
];

/** Earlier builds linked to /agents/tools (now /ai/tools via the legacy redirect). */
const TAB_ALIASES: Record<string, Tab> = { tools: "mcp" };

const OUTCOME_TONE = { ok: "ok", warned: "warn", blocked: "bad", error: "bad" } as const;

/** A governance notice or block reason as text (strings, or `{ message }` objects). */
function noticeText(notice: unknown): string {
  if (typeof notice === "string") return notice;
  if (notice && typeof notice === "object" && "message" in notice) return String(notice.message);
  return JSON.stringify(notice);
}

/** Where a session came from: the detected client, else how it connected — never "unknown". */
function agentOrigin(session: AgentSession): string {
  return session.clientName ?? (session.source === "mcp" ? "MCP client" : "API client");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SessionSheet({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }): ReactElement {
  const { data, isLoading } = useAgentSession(sessionId);
  return (
    <Sheet open={Boolean(sessionId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Session replay</SheetTitle>
          <SheetDescription>{data ? `${agentOrigin(data.session)} · ${data.calls.length} tool calls · ${formatBytes(data.session.readBytes)} read` : "Loading…"}</SheetDescription>
        </SheetHeader>
        {isLoading || !data ? null : data.calls.length === 0 ? (
          <EmptyState title="No tool calls recorded" />
        ) : (
          <ol className="mt-4 space-y-2">
            {data.calls.map((call) => {
              const notices = Array.isArray(call.detail.notices) ? call.detail.notices : [];
              const reasons = Array.isArray(call.detail.reasons) ? call.detail.reasons : [];
              return (
                <li key={call.id} className="rounded-xs border border-ink-500 bg-ink-200/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-paper-faint">{new Date(call.createdAt).toLocaleTimeString()}</span>
                      <Mono className="text-paper">{call.tool}</Mono>
                    </div>
                    <StatusPill tone={OUTCOME_TONE[call.outcome]}>{call.outcome}</StatusPill>
                  </div>
                  {call.argsSummary && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{call.argsSummary}</pre>}
                  {(notices.length > 0 || reasons.length > 0) && (
                    <ul className="mt-2 space-y-0.5">
                      {[...reasons, ...notices].map((n, i) => <li key={i} className="text-[11px] text-amber-500">• {noticeText(n)}</li>)}
                    </ul>
                  )}
                  {call.readBytes > 0 && <p className="mt-1 text-[10px] text-paper-faint">{formatBytes(call.readBytes)} read</p>}
                </li>
              );
            })}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}

const POLICY_SOURCE_LABEL = { pat: "Token policy", role: "Role policy", default: "Default policy", none: "No policy" } as const;

function SessionsView({ dailyBudget }: { dailyBudget: number | null }): ReactElement {
  const [days, setDays] = useState(1);
  const sessions = useAgentSessions(days);
  const [open, setOpen] = useState<string | null>(null);
  if (sessions.isLoading) return <LoadingGrid count={2} />;
  if (sessions.isError || !sessions.data) return <ErrorState title="Agent sessions could not be loaded." error={sessions.error} />;
  return (
    <Panel
      title="Agent sessions"
      meta="Queries are tagged in log_comment, so system.query_log attributes every one"
      actions={
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 rounded-xs text-[11px]" aria-label="Window"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="1">Today</SelectItem><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem></SelectContent>
        </Select>
      }
    >
      {sessions.data.length === 0 ? (
        <EmptyState icon={Bot} title="No agent sessions" body="Agents appear here once they call CHouse over MCP or with a personal access token." />
      ) : (
        <DataTable label="Agent sessions" head={["Agent", "User", "Roles", "Source", "Queries", "Read", "Policy · daily budget", "Warned / blocked", "Last call"]}>
          {sessions.data.map((s: AgentSession) => {
            // The policy that actually governs this session; older servers only report the default budget.
            const share = budgetShare(s.readBytes, s.policy ? s.policy.dailyBytes : dailyBudget);
            return (
              <tr key={s.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => setOpen(s.id)}>
                <td><button type="button" className="text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); setOpen(s.id); }}>{agentOrigin(s)}</button><span className="block text-[10px] text-paper-faint">{s.patId ? `Token · ${s.patName ?? "deleted token"}` : "Signed-in session"}</span></td>
                <td className="text-[12px] text-paper">{s.userName ?? "Unknown user"}</td>
                <td className="max-w-[180px]">{s.roles && s.roles.length > 0 ? <span className="block truncate text-[11px] text-paper-muted" title={s.roles.map((r) => r.label).join(", ")}>{s.roles.map((r) => r.label).join(", ")}</span> : <span className="text-[11px] text-paper-faint">No roles</span>}</td>
                <td><StatusPill tone={s.source === "mcp" ? "brand" : "muted"} dot={false}>{s.source}</StatusPill></td>
                <td className="tabular-nums">{formatCount(s.queries)}</td>
                <td className="tabular-nums text-paper-muted">{formatBytes(s.readBytes)}</td>
                <td className="w-44">
                  {s.policy && <span className="block truncate text-[11px] text-paper" title={`${POLICY_SOURCE_LABEL[s.policy.source]} · ${s.policy.label}`}>{s.policy.source === "role" ? s.policy.label : POLICY_SOURCE_LABEL[s.policy.source]}</span>}
                  {share === null ? <span className="text-[10px] text-paper-faint">no daily budget</span> : <div className="flex items-center gap-2"><RatioBar ratio={share} tone={share > 0.9 ? "bad" : share > 0.7 ? "warn" : "brand"} label="Daily budget used" /><span className="font-mono text-[10px] text-paper-muted">{formatPercent(share)}</span></div>}
                </td>
                <td className="tabular-nums"><span className={s.warnings ? "text-amber-500" : "text-paper-muted"}>{s.warnings}</span> / <span className={s.blocked ? "text-red-500" : "text-paper-muted"}>{s.blocked}</span></td>
                <td className="whitespace-nowrap text-paper-muted">{formatAgo(s.lastSeenAt)}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
      <SessionSheet sessionId={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}

export default function Agents(): ReactElement {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const hasPermission = useRbacStore((s) => s.hasPermission);
  const tabs = TABS.filter((t) => hasPermission(t.permission));
  const requested = TABS.find((t) => t.key === tab)?.key ?? (tab ? TAB_ALIASES[tab] : undefined);
  const active: Tab = tabs.find((t) => t.key === requested)?.key ?? tabs[0]?.key ?? "sessions";
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AGENTS_MANAGE));
  const canSeeExternal = hasPermission(RBAC_PERMISSIONS.AGENTS_VIEW);
  const summary = useAgentSummary(canSeeExternal);
  const policies = useAgentPolicies(canSeeExternal);
  const { pause } = useAgentMutations();
  const [confirmPause, setConfirmPause] = useState(false);
  const defaultBudget = policies.data?.find((p) => p.scopeKind === "default")?.dailyBytes ?? null;

  const togglePause = async (paused: boolean): Promise<void> => {
    try {
      await pause.mutateAsync(paused);
      toast.success(paused ? "Agent access paused" : "Agent access resumed");
      setConfirmPause(false);
    } catch (e) {
      toast.error(errorMessage(e, "Could not change agent access"));
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50" data-onboarding-id="agents-page">
      <PageHeader
        icon={Bot}
        eyebrow="AI governance"
        title="AI Governance"
        navLabel="AI Governance sections"
        layout="start"
        nav={tabs.map((t) => <NavPill key={t.key} icon={t.icon} label={t.label} isActive={t.key === active} onboardingId={`agents-tab-${t.key}`} onClick={() => navigate(`/ai/${t.key}`)} noShrink />)}
        actions={
          <>
            {canManage && active !== "assistant" && summary.data && (summary.data.paused ? (
              <Button className={DH_PRIMARY} disabled={pause.isPending} onClick={() => void togglePause(false)}><Play className="h-3.5 w-3.5" /> Resume agents</Button>
            ) : (
              <Button variant="outline" className="h-9 rounded-xs border-brand/40 text-brand hover:bg-brand/10 hover:text-brand" onClick={() => setConfirmPause(true)}><Pause className="mr-1.5 h-3.5 w-3.5" /> Pause all agent access</Button>
            ))}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {active !== "assistant" && summary.data?.paused && <div role="status" className="rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">Agent access is paused. MCP tool calls and agent queries are refused until it is resumed.</div>}
          {active !== "assistant" && canSeeExternal && (summary.isLoading ? <LoadingGrid count={5} className="lg:grid-cols-5" /> : summary.data && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label="Active agents · 24h" value={summary.data.activeAgents} meta={`${summary.data.sessions} sessions`} />
              <Kpi label="Queries · 24h" value={formatCount(summary.data.queries)} meta={`${formatBytes(summary.data.readBytes)} read`} />
              <Kpi label="Results with a warning" value={summary.data.warnings} meta="Stale data or an open incident" tone={summary.data.warnings > 0 ? "warn" : undefined} />
              <Kpi label="Blocked by policy" value={summary.data.blocked} meta="Estimated before running" tone={summary.data.blocked > 0 ? "bad" : undefined} />
              <Kpi label="Default daily budget" value={defaultBudget === null ? "None" : formatBytes(defaultBudget)} meta="Per agent" />
            </div>
          ))}
          {active === "sessions" && <SessionsView dailyBudget={defaultBudget} />}
          {active === "policies" && <PoliciesPanel />}
          {active === "mcp" && <McpPanel />}
          {active === "assistant" && <AssistantPanel />}
        </div>
      </div>
      <Dialog open={confirmPause} onOpenChange={setConfirmPause}>
        <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
          <DialogHeader>
            <DialogTitle>Pause all agent access?</DialogTitle>
            <DialogDescription>Every MCP tool call and every query made with a personal access token is refused until you resume. People using the UI are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmPause(false)}>Cancel</Button>
            <Button variant="destructive" className="rounded-xs" disabled={pause.isPending} onClick={() => void togglePause(true)}>Pause agents</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** `/agents/:tab?/:id?` → `/ai/…` (the page was called Agents before it held the Assistant too; bookmarks only). */
export function LegacyAgentsRedirect(): ReactElement {
  const { tab, id } = useParams<{ tab?: string; id?: string }>();
  const rest = [tab, id].filter((part): part is string => Boolean(part)).map(encodeURIComponent).join("/");
  return <Navigate to={rest ? `/ai/${rest}` : "/ai"} replace />;
}
