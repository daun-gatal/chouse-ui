/**
 * Connect an agent (ADR 0028 §4): the consent step of signing an agent in to
 * MCP. The agent sends the browser to /oauth/authorize, which hands over here
 * with a request id. A signed-out person signs in first and comes back.
 *
 * Standalone, in the login page's layout: it is one step of a sign-in, not a
 * page anyone navigates to, and nothing should cover it or lead away from it.
 */

import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, Bot, Check, Eye, Loader2, ShieldCheck } from "lucide-react";

import { approveSignIn, denySignIn, getSignInRequest } from "@/api/oauth";
import type { PatWritePolicy } from "@/api/rbac";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WritePolicyFields } from "@/features/rbac/components/WritePolicyFields";
import { useRbacStore } from "@/stores";
import { withBasePath } from "@/lib/basePath";
import { log } from "@/lib/log";

const Logo = withBasePath("logo.svg");
/** Long enough to read "Connected", short enough not to make the agent wait. */
const RETURN_DELAY_MS = 900;

/** Problems /oauth/authorize can't send back to the agent, shown here instead. */
export const CONNECT_ERRORS: Record<string, { title: string; body: string }> = {
  unknown_client: { title: "This agent isn't registered", body: "CHouse doesn't know the agent that sent you here. Start again from the agent." },
  redirect_mismatch: { title: "This sign-in can't continue", body: "The agent asked to return somewhere it didn't register. Start again from the agent, or ask whoever runs it." },
  redirect_not_allowed: { title: "This agent's address isn't allowed", body: "An administrator only allows agents that return to certain addresses. Ask them to allow it in AI Governance › MCP." },
  client_blocked: { title: "This agent is blocked", body: "An administrator has blocked this agent from signing in to CHouse." },
  client_pending: { title: "This agent isn't approved yet", body: "Your administrator approves new agents before they can sign in. Ask them to approve it in AI Governance › MCP, then start again from the agent." },
};

const GENERIC_ERROR = { title: "This sign-in can't continue", body: "Start again from your agent." };

function dayLabel(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

function Shell({ step, label, children }: { step: string; label: string; children: ReactNode }): ReactElement {
  return (
    <div className="dark min-h-screen w-full bg-ink-50 text-paper">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-50"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse 60% 50% at 50% 40%, black, transparent)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 50% at 50% 40%, black, transparent)",
        }}
      />
      <div className="relative grid min-h-screen place-items-center px-4 py-10 sm:px-6 sm:py-12">
        <div className="w-full max-w-[540px]">
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <img src={Logo} alt="" aria-hidden className="h-7 w-7" />
            <span className="text-[16px] font-semibold tracking-tight text-paper">
              chouse<span className="text-paper-dim">-fleet</span>
            </span>
          </div>
          <div className="rounded-md border border-ink-500 bg-ink-100">
            <div className="px-6 pt-6 sm:px-7">
              <span className="inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                <span className="text-paper-faint">{step}</span>
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                {label}
              </span>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ title, body, icon }: { title: string; body: string; icon?: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-3 px-6 pb-7 pt-3 sm:px-7" role="alert">
      <div className="flex items-start gap-3">
        {icon}
        <h1 className="text-[20px] font-semibold tracking-tight text-paper">{title}</h1>
      </div>
      <p className="text-sm text-paper-muted">{body}</p>
    </div>
  );
}

export default function OAuthConnect(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const requestId = params.get("request");
  const errorCode = params.get("error");
  const { isAuthenticated, isInitialized, isLoading: authLoading, logout } = useRbacStore();

  const [policy, setPolicy] = useState<PatWritePolicy | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState<{ name: string; days: number; redirectUrl: string } | null>(null);

  const here = `${location.pathname}${location.search}`;
  useEffect(() => {
    if (isInitialized && !authLoading && !isAuthenticated && requestId) {
      navigate(`/login?redirect=${encodeURIComponent(here)}`, { replace: true });
    }
  }, [isInitialized, authLoading, isAuthenticated, requestId, here, navigate]);

  const request = useQuery({
    queryKey: ["oauth-sign-in", requestId],
    queryFn: () => getSignInRequest(requestId ?? ""),
    enabled: Boolean(requestId) && isAuthenticated && !errorCode,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (request.data && policy === null) {
      setPolicy(request.data.defaults);
      setDays(request.data.defaultDays);
    }
  }, [request.data, policy]);

  useEffect(() => {
    if (!connected) return undefined;
    const timer = window.setTimeout(() => window.location.assign(connected.redirectUrl), RETURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [connected]);

  const signInAgain = async (): Promise<void> => {
    await logout();
    navigate(`/login?redirect=${encodeURIComponent(here)}`, { replace: true });
  };

  const decide = async (approve: boolean): Promise<void> => {
    if (!requestId || !request.data || (approve && (!policy || days === null))) return;
    setBusy(approve ? "approve" : "deny");
    setActionError(null);
    try {
      if (approve && policy && days !== null) {
        const decision = await approveSignIn(requestId, policy, days);
        setConnected({ name: request.data.client.name, days, redirectUrl: decision.redirectUrl });
      } else {
        const decision = await denySignIn(requestId);
        window.location.assign(decision.redirectUrl);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      log.error("[OAuthConnect] Failed to answer the sign-in", { message });
      setActionError(message);
      setBusy(null);
    }
  };

  const toolkitsSummary = useMemo(() => {
    if (!policy || policy.toolkits.length === 0) return "reads only";
    return `${policy.toolkits.length} toolkit${policy.toolkits.length === 1 ? "" : "s"}`;
  }, [policy]);

  if (errorCode || !requestId) {
    const shown = (errorCode && CONNECT_ERRORS[errorCode]) || GENERIC_ERROR;
    return (
      <Shell step="02" label="Allow access">
        <Message title={shown.title} body={shown.body} icon={<AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-500" aria-hidden />} />
      </Shell>
    );
  }

  if (connected) {
    return (
      <Shell step="03" label="Connected">
        <div className="flex flex-col gap-3 px-6 pb-7 pt-3 sm:px-7" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xs border border-emerald-500/40 bg-emerald-950/40 text-emerald-300">
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <h1 className="break-words text-[22px] font-semibold tracking-tight text-paper">{connected.name} is connected.</h1>
          </div>
          <p className="text-sm text-paper-muted">Taking you back to the agent… If nothing happens, you can close this tab.</p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2">
            <span className="text-[12px] text-paper-muted">{toolkitsSummary} · {dayLabel(connected.days)}</span>
            <span className="text-[12px] text-paper-faint">Manage it in Preferences › Personal access tokens</span>
          </div>
        </div>
      </Shell>
    );
  }

  if (!isInitialized || authLoading || !isAuthenticated || request.isLoading || (request.data && !policy)) {
    return (
      <Shell step="02" label="Allow access">
        <div className="flex justify-center px-7 pb-10 pt-6"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" aria-label="Loading" /></div>
      </Shell>
    );
  }

  if (request.isError || !request.data || !policy || days === null) {
    const message = request.error instanceof Error ? request.error.message : "This sign-in request has expired or was already answered. Start again from your agent.";
    return (
      <Shell step="02" label="Allow access">
        <Message title="This sign-in can't continue" body={message} icon={<AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-500" aria-hidden />} />
      </Shell>
    );
  }

  const data = request.data;
  if (data.client.status !== "allowed") {
    const shown = CONNECT_ERRORS[data.client.status === "pending" ? "client_pending" : "client_blocked"];
    return (
      <Shell step="02" label="Allow access">
        <Message title={shown.title} body={shown.body} icon={<AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-500" aria-hidden />} />
      </Shell>
    );
  }

  return (
    <Shell step="02" label="Allow access">
      <div className="flex flex-col gap-3 border-b border-ink-500 px-6 pb-6 pt-3 sm:px-7">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <Bot className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-[20px] font-semibold tracking-tight text-paper">{data.client.name} wants to use CHouse as you</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="status-pill status-warn" title="Agents name themselves when they register, so this name is only their claim.">
                <AlertTriangle className="h-3 w-3" aria-hidden /> Unverified name
              </span>
              <span className="inline-flex max-w-full items-center truncate rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint" title="Where your browser goes after you answer">
                Returns to {data.client.returnsTo}
              </span>
            </div>
          </div>
        </div>
        <p className="text-sm text-paper-muted">
          Signed in as <span className="text-paper">{data.user.email}</span> ·{" "}
          <button type="button" onClick={() => void signInAgain()} className="underline decoration-ink-700 underline-offset-2 hover:text-paper">
            not you?
          </button>
        </p>
      </div>

      <div className="flex flex-col gap-5 px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">It can always</p>
          <div className="flex items-start gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
            <p className="text-[13px] text-paper-muted">Read what you can read: connections, schemas, queries, monitoring. Your roles and data access rules apply to every call.</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">It can change things</p>
          {data.canAct ? (
            <WritePolicyFields policy={policy} ceiling={data.ceiling} onChange={setPolicy} disabled={busy !== null} idPrefix="connect" showLegend={false} />
          ) : (
            <p className="rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-[13px] text-paper-muted">Your role doesn't let agents change anything, so this agent will only read.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:max-w-[240px]">
          <label htmlFor="connect-days" className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Access lasts</label>
          <Select value={String(days)} onValueChange={(value) => setDays(Number(value))} disabled={busy !== null}>
            <SelectTrigger id="connect-days" className="rounded-xs text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>{data.dayChoices.map((d) => <SelectItem key={d} value={String(d)}>{dayLabel(d)}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-[11px] text-paper-faint">Revoke any time in Preferences.</p>
        </div>

        <div className="flex items-start gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2 text-[12px] text-paper-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>The agent only gets a token for CHouse MCP. It can't sign in to CHouse, call other APIs, or see your password.</span>
        </div>

        {actionError && <p role="alert" className="text-[12px] text-red-300">{actionError}</p>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-ink-500 px-6 py-4 sm:px-7">
        <Button variant="ghost" onClick={() => void decide(false)} disabled={busy !== null} className="h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
          {busy === "deny" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Deny
        </Button>
        <Button onClick={() => void decide(true)} disabled={busy !== null} className="h-9 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft">
          {busy === "approve" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Allow
        </Button>
      </div>
    </Shell>
  );
}
