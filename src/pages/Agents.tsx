/**
 * Agents (ADR 0016 §10, ADR 0017): every agent connected over MCP or a
 * personal access token — what it read, what it cost, whether the data was
 * healthy — plus budget policies, the pause switch, and the MCP endpoint
 * with its tool switches.
 */

import { useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Bot, ListChecks, Pause, Play, Plug, Plus, Shield, Trash2 } from "lucide-react";

import type { AgentPolicy, AgentSession } from "@/api/agents";
import { NavPill, PageHeader } from "@/components/common/PageShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { McpPanel } from "@/features/agents/McpPanel";
import { budgetShare, formToPolicy, policyToForm, type PolicyForm } from "@/features/agents/policyForm";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useAgentMutations, useAgentPolicies, useAgentSession, useAgentSessions, useAgentSummary } from "@/features/observe/hooks";
import { formatAgo, formatBytes, formatCount, formatPercent } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, Panel, RatioBar, StatusPill } from "@/features/observe/ui";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";

type Tab = "sessions" | "policies" | "mcp";
const TABS: Array<{ key: Tab; label: string; icon: typeof Bot }> = [
  { key: "sessions", label: "Sessions", icon: ListChecks },
  { key: "policies", label: "Policies", icon: Shield },
  { key: "mcp", label: "MCP", icon: Plug },
];

/** Earlier builds linked to /agents/tools. */
const TAB_ALIASES: Record<string, Tab> = { tools: "mcp" };

const OUTCOME_TONE = { ok: "ok", warned: "warn", blocked: "bad", error: "bad" } as const;

/** A governance notice or block reason as text (strings, or `{ message }` objects). */
function noticeText(notice: unknown): string {
  if (typeof notice === "string") return notice;
  if (notice && typeof notice === "object" && "message" in notice) return String(notice.message);
  return JSON.stringify(notice);
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
          <SheetDescription>{data ? `${data.session.clientName ?? data.session.source.toUpperCase()} · ${data.calls.length} tool calls · ${formatBytes(data.session.readBytes)} read` : "Loading…"}</SheetDescription>
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
        <DataTable label="Agent sessions" head={["Agent", "Source", "Queries", "Read", "Daily budget", "Warned / blocked", "Last call"]}>
          {sessions.data.map((s: AgentSession) => {
            const share = budgetShare(s.readBytes, dailyBudget);
            return (
              <tr key={s.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => setOpen(s.id)}>
                <td><button type="button" className="text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); setOpen(s.id); }}>{s.clientName ?? "Unknown client"}</button><span className="block font-mono text-[10px] text-paper-faint">{s.patId ? `token ${s.patId.slice(0, 8)}` : s.userId}</span></td>
                <td><StatusPill tone={s.source === "mcp" ? "brand" : "muted"} dot={false}>{s.source}</StatusPill></td>
                <td className="tabular-nums">{formatCount(s.queries)}</td>
                <td className="tabular-nums text-paper-muted">{formatBytes(s.readBytes)}</td>
                <td className="w-36">{share === null ? <span className="text-[11px] text-paper-faint">no budget</span> : <div className="flex items-center gap-2"><RatioBar ratio={share} tone={share > 0.9 ? "bad" : share > 0.7 ? "warn" : "brand"} label="Daily budget used" /><span className="font-mono text-[10px] text-paper-muted">{formatPercent(share)}</span></div>}</td>
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

function PolicyDialog({ policy, open, onOpenChange }: { policy?: AgentPolicy; open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const { savePolicy } = useAgentMutations();
  const [form, setForm] = useState<PolicyForm>(() => policyToForm(policy));
  const [lastPolicy, setLastPolicy] = useState(policy);
  if (policy !== lastPolicy) {
    setLastPolicy(policy);
    setForm(policyToForm(policy));
  }
  const parsed = formToPolicy(form);
  const submit = async (): Promise<void> => {
    if ("error" in parsed) return;
    try {
      await savePolicy.mutateAsync(parsed);
      toast.success("Policy saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the policy"));
    }
  };
  const gibField = (key: "maxGiBPerQuery" | "dailyGiB" | "partitionFilterGiB", label: string, hint: string): ReactElement => (
    <div>
      <Label htmlFor={`policy-${key}`}>{label}</Label>
      <Input id={`policy-${key}`} type="number" min={0} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder="No limit" className="mt-1 rounded-xs" />
      <p className="mt-1 text-[10px] text-paper-faint">{hint}</p>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>{policy ? "Edit agent policy" : "New agent policy"}</DialogTitle>
          <DialogDescription>Most specific wins: token, then role, then the default. Queries are estimated with EXPLAIN ESTIMATE before they run.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Applies to</Label>
            <Select value={form.scopeKind} onValueChange={(v) => setForm({ ...form, scopeKind: v === "pat" || v === "role" ? v : "default", scopeId: v === "default" ? "*" : form.scopeId === "*" ? "" : form.scopeId })}>
              <SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="default">Every agent (default)</SelectItem><SelectItem value="role">A role</SelectItem><SelectItem value="pat">One token</SelectItem></SelectContent>
            </Select>
          </div>
          {form.scopeKind !== "default" && (
            <div>
              <Label htmlFor="policy-scope">{form.scopeKind === "pat" ? "Token id" : "Role name"}</Label>
              <Input id="policy-scope" value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })} className="mt-1 rounded-xs font-mono" />
            </div>
          )}
          {gibField("maxGiBPerQuery", "Max read per query, GiB", "Larger estimates are blocked")}
          {gibField("dailyGiB", "Daily read budget, GiB", "Across all of the agent's queries")}
          {gibField("partitionFilterGiB", "Partition filter above, GiB", "Bigger tables need a partition filter")}
          <div>
            <Label>Tables with a critical incident</Label>
            <Select value={form.incidentMode} onValueChange={(v) => setForm({ ...form, incidentMode: v === "off" || v === "block" ? v : "warn" })}>
              <SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="warn">Warn (attach a notice)</SelectItem><SelectItem value="block">Block the query</SelectItem><SelectItem value="off">Ignore</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="policy-alert">Alert at × usual usage</Label>
            <Input id="policy-alert" type="number" min={1} value={form.alertMultiplier} onChange={(e) => setForm({ ...form, alertMultiplier: e.target.value })} placeholder="Off" className="mt-1 rounded-xs" />
          </div>
        </div>
        {"error" in parsed && <p className="text-[11px] text-amber-500">{parsed.error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={DH_PRIMARY} disabled={"error" in parsed || savePolicy.isPending} onClick={() => void submit()}>Save policy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoliciesView(): ReactElement {
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AGENTS_MANAGE));
  const policies = useAgentPolicies();
  const { deletePolicy } = useAgentMutations();
  const [editing, setEditing] = useState<AgentPolicy | undefined>();
  const [open, setOpen] = useState(false);
  if (policies.isLoading) return <LoadingGrid count={2} />;
  if (policies.isError || !policies.data) return <ErrorState title="Policies could not be loaded." error={policies.error} />;
  const limit = (bytes: number | null): string => (bytes === null ? "no limit" : formatBytes(bytes));
  return (
    <Panel title="Budget policies" meta="Write and DDL tools always need a human" actions={canManage ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="mr-1 h-3 w-3" /> New policy</Button> : undefined}>
      {policies.data.length === 0 ? (
        <EmptyState icon={Shield} title="No policies" body="Without a policy agents run unbudgeted; incidents still attach notices." />
      ) : (
        <DataTable label="Agent policies" head={["Scope", "Per query", "Daily", "Partition filter", "Incidents", "Alert", ""]}>
          {policies.data.map((p) => (
            <tr key={p.id}>
              <td><Mono className="text-paper">{p.scopeKind === "default" ? "default" : `${p.scopeKind}: ${p.scopeId}`}</Mono></td>
              <td className="text-paper-muted">{limit(p.maxBytesPerQuery)}</td>
              <td className="text-paper-muted">{limit(p.dailyBytes)}</td>
              <td className="text-paper-muted">{p.partitionFilterBytes === null ? "off" : `tables > ${formatBytes(p.partitionFilterBytes)}`}</td>
              <td><StatusPill tone={p.incidentMode === "block" ? "bad" : p.incidentMode === "warn" ? "warn" : "muted"} dot={false}>{p.incidentMode}</StatusPill></td>
              <td className="text-paper-muted">{p.alertMultiplier === null ? "off" : `${p.alertMultiplier}×`}</td>
              <td className="text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="h-7 rounded-xs text-[11px]" onClick={() => { setEditing(p); setOpen(true); }}>Edit</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete policy ${p.scopeKind} ${p.scopeId}`} onClick={() => void deletePolicy.mutateAsync(p.id).then(() => toast.success("Policy deleted"), (e: unknown) => toast.error(errorMessage(e, "Delete failed")))}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <PolicyDialog policy={editing} open={open} onOpenChange={setOpen} />
    </Panel>
  );
}

export default function Agents(): ReactElement {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active: Tab = TABS.find((t) => t.key === tab)?.key ?? (tab ? TAB_ALIASES[tab] : undefined) ?? "sessions";
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AGENTS_MANAGE));
  const summary = useAgentSummary();
  const policies = useAgentPolicies();
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
        title="Agents"
        navLabel="Agent sections"
        layout="start"
        nav={TABS.map((t) => <NavPill key={t.key} icon={t.icon} label={t.label} isActive={t.key === active} onboardingId={`agents-tab-${t.key}`} onClick={() => navigate(`/agents/${t.key}`)} noShrink />)}
        actions={
          <>
            {canManage && summary.data && (summary.data.paused ? (
              <Button className={DH_PRIMARY} disabled={pause.isPending} onClick={() => void togglePause(false)}><Play className="h-3.5 w-3.5" /> Resume agents</Button>
            ) : (
              <Button variant="outline" className="h-9 rounded-xs border-brand/40 text-brand hover:bg-brand/10 hover:text-brand" onClick={() => setConfirmPause(true)}><Pause className="mr-1.5 h-3.5 w-3.5" /> Pause all agent access</Button>
            ))}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {summary.data?.paused && <div role="status" className="rounded-xs border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] text-amber-500">Agent access is paused. MCP tool calls and agent queries are refused until it is resumed.</div>}
          {summary.isLoading ? <LoadingGrid count={5} className="lg:grid-cols-5" /> : summary.data && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi label="Active agents · 24h" value={summary.data.activeAgents} meta={`${summary.data.sessions} sessions`} />
              <Kpi label="Queries · 24h" value={formatCount(summary.data.queries)} meta={`${formatBytes(summary.data.readBytes)} read`} />
              <Kpi label="Results with a warning" value={summary.data.warnings} meta="Stale data or an open incident" tone={summary.data.warnings > 0 ? "warn" : undefined} />
              <Kpi label="Blocked by policy" value={summary.data.blocked} meta="Estimated before running" tone={summary.data.blocked > 0 ? "bad" : undefined} />
              <Kpi label="Default daily budget" value={defaultBudget === null ? "None" : formatBytes(defaultBudget)} meta="Per agent" />
            </div>
          )}
          {active === "sessions" && <SessionsView dailyBudget={defaultBudget} />}
          {active === "policies" && <PoliciesView />}
          {active === "mcp" && <McpPanel />}
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
