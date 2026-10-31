/**
 * AI Governance › MCP › Sign-in for agents (ADR 0028 §5): turn OAuth on, decide
 * whether pasted tokens still work and whether new agents wait for approval,
 * and look after the agents that registered and the people connected through
 * them. Viewing needs agents:view; changing anything needs agents:manage.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Ban, Bot, Check, Copy, ShieldCheck, Trash2 } from "lucide-react";

import type { McpOAuthClient, McpOAuthGrantSummary, McpOverview, McpSettingsUpdate } from "@/api/agents";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useMcpOAuth, useRevokeMcpOAuthGrant, useSetMcpOAuthClientStatus } from "@/features/observe/hooks";
import { formatAgo } from "@/features/observe/lib";
import { EmptyState, Mono, Panel, StatusPill } from "@/features/observe/ui";
import { cn } from "@/lib/utils";
import { OAUTH_MAX_DAY_OPTIONS, parseRedirectHosts } from "./mcp";

const SWITCH_CLASS = "data-[state=checked]:bg-brand data-[state=unchecked]:bg-ink-500";
const ROW = "flex flex-wrap items-center gap-3 rounded-xs border border-ink-500 bg-ink-200/40 px-3 py-2.5";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; disabled: boolean; label: string }): ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="mt-1 flex w-fit max-w-full flex-wrap overflow-hidden rounded-xs border border-ink-500">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "border-r border-ink-500 px-3 py-1.5 text-[12px] last:border-r-0 disabled:cursor-default",
            value === option.value ? "bg-ink-300 text-paper" : "text-paper-muted hover:text-paper",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CopyField({ text, label }: { text: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  };
  return (
    <div className="mt-1 flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200/40 px-2 py-1">
      <Mono className="min-w-0 flex-1 truncate text-paper">{text}</Mono>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={label} onClick={() => void copy()}>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

export function OAuthSettingsPanel({ overview, canManage, save, saving }: { overview: McpOverview; canManage: boolean; save: (update: McpSettingsUpdate, done: string) => Promise<boolean>; saving: boolean }): ReactElement {
  const { settings, oauth } = overview;
  const [patsAllowed, setPatsAllowed] = useState(settings.oauthPatsAllowed);
  const [registration, setRegistration] = useState(settings.oauthRegistration);
  const [hostsText, setHostsText] = useState(settings.oauthRedirectHosts.join("\n"));
  const [maxDays, setMaxDays] = useState(settings.oauthMaxGrantDays);
  const [lastSettings, setLastSettings] = useState(settings);
  if (settings !== lastSettings) {
    setLastSettings(settings);
    setPatsAllowed(settings.oauthPatsAllowed);
    setRegistration(settings.oauthRegistration);
    setHostsText(settings.oauthRedirectHosts.join("\n"));
    setMaxDays(settings.oauthMaxGrantDays);
  }
  const parsed = parseRedirectHosts(hostsText);
  const dayOptions = [...new Set([...OAUTH_MAX_DAY_OPTIONS, settings.oauthMaxGrantDays])].sort((a, b) => a - b);
  const dirty =
    patsAllowed !== settings.oauthPatsAllowed ||
    registration !== settings.oauthRegistration ||
    parsed.hosts.join("\n") !== settings.oauthRedirectHosts.join("\n") ||
    maxDays !== settings.oauthMaxGrantDays;
  const canTurnOn = settings.enabled && oauth.issuer !== null;

  return (
    <Panel
      title="Sign-in for agents"
      meta="OAuth · agents connect with the URL alone, no token to paste"
      actions={
        <label className="flex items-center gap-2 text-[11px] text-paper-muted">
          <StatusPill tone={settings.oauthEnabled ? "ok" : "muted"}>{settings.oauthEnabled ? "On" : "Off"}</StatusPill>
          {canManage && (
            <Switch
              className={SWITCH_CLASS}
              checked={settings.oauthEnabled}
              disabled={saving || (!settings.oauthEnabled && !canTurnOn)}
              aria-label="Sign-in for agents"
              onCheckedChange={(oauthEnabled) => void save({ oauthEnabled }, oauthEnabled ? "Agents can now sign in" : "Sign-in for agents turned off")}
            />
          )}
        </label>
      }
    >
      {!settings.enabled ? (
        <p role="status" className="mb-3 text-[11px] text-paper-faint">Turn the MCP endpoint on first.</p>
      ) : oauth.problem ? (
        <p role="status" className="mb-3 text-[11px] text-amber-500">{oauth.problem}</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label>How agents connect</Label>
            <Segmented
              label="How agents connect"
              value={patsAllowed ? "both" : "oauth"}
              disabled={!canManage || saving}
              onChange={(value) => setPatsAllowed(value === "both")}
              options={[{ value: "both", label: "Sign-in and tokens" }, { value: "oauth", label: "Sign-in only" }]}
            />
            <p className="mt-1 text-[11px] text-paper-faint">Sign-in only turns pasted personal access tokens off for MCP while sign-in is on. The CLI keeps working.</p>
          </div>
          <div>
            <Label>New agents</Label>
            <Segmented
              label="New agents"
              value={registration}
              disabled={!canManage || saving}
              onChange={setRegistration}
              options={[{ value: "open", label: "Anyone can register" }, { value: "approval", label: "Only ones I approve" }]}
            />
            <p className="mt-1 text-[11px] text-paper-faint">Agents register themselves and pick their own names, so people see them marked unverified.</p>
          </div>
          <div>
            <Label htmlFor="oauth-max-days">Longest access</Label>
            <Select value={String(maxDays)} onValueChange={(value) => setMaxDays(Number(value))} disabled={!canManage || saving}>
              <SelectTrigger id="oauth-max-days" className="mt-1 w-48 rounded-xs text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>{dayOptions.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}</SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-paper-faint">People can pick shorter when they connect. Access tokens last an hour and renew.</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <Label htmlFor="oauth-hosts">Allowed return addresses</Label>
            <Textarea
              id="oauth-hosts"
              rows={4}
              value={hostsText}
              disabled={!canManage}
              placeholder="Any https address, localhost and app links"
              onChange={(e) => setHostsText(e.target.value)}
              className="mt-1 rounded-xs font-mono text-[11px]"
            />
            <p className="mt-1 text-[11px] text-paper-faint">One host per line. Leave empty to allow any https address, localhost and app links. Add <Mono>localhost</Mono> to keep desktop agents working.</p>
            {parsed.invalid.length > 0 && <p className="mt-1 text-[11px] text-amber-500">Not a host: {parsed.invalid.join(", ")}</p>}
          </div>
          {oauth.issuer && (
            <div>
              <Label>Sign-in address</Label>
              <CopyField text={oauth.issuer} label="Copy the sign-in address" />
              <p className="mt-1 text-[11px] text-paper-faint">From the public address. Agents find it through <Mono>/.well-known</Mono>; hosted agents must be able to reach it from the internet.</p>
            </div>
          )}
        </div>
      </div>
      {canManage && (
        <div className="mt-3 flex justify-end">
          <Button
            className={DH_PRIMARY}
            disabled={!dirty || parsed.invalid.length > 0 || saving}
            onClick={() => void save({ oauthPatsAllowed: patsAllowed, oauthRegistration: registration, oauthRedirectHosts: parsed.hosts, oauthMaxGrantDays: maxDays }, "Sign-in settings saved")}
          >
            Save sign-in settings
          </Button>
        </div>
      )}
    </Panel>
  );
}

const STATUS_TONE = { allowed: "ok", pending: "warn", blocked: "bad" } as const;
const STATUS_LABEL = { allowed: "Allowed", pending: "Waiting for approval", blocked: "Blocked" } as const;

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "1 person connected", "3 people connected". */
export function connectedLabel(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"} connected`;
}

function personName(grant: McpOAuthGrantSummary): string {
  return grant.user.displayName || grant.user.email || grant.user.username || "Removed user";
}

export function OAuthAgentsPanel({ canManage, oauthEnabled }: { canManage: boolean; oauthEnabled: boolean }): ReactElement | null {
  const overview = useMcpOAuth();
  const setStatus = useSetMcpOAuthClientStatus();
  const revoke = useRevokeMcpOAuthGrant();
  const [blockTarget, setBlockTarget] = useState<McpOAuthClient | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<McpOAuthGrantSummary | null>(null);
  const [showPeople, setShowPeople] = useState<string | null>(null);

  if (overview.isLoading || overview.isError || !overview.data) return null;
  const { clients, grants } = overview.data;
  // Nothing to look after until sign-in has been on at least once.
  if (!oauthEnabled && clients.length === 0) return null;

  const decide = async (client: McpOAuthClient, status: "allowed" | "blocked"): Promise<void> => {
    try {
      await setStatus.mutateAsync({ id: client.id, status });
      toast.success(status === "allowed" ? `${client.name} can sign people in` : `${client.name} is blocked`);
      setBlockTarget(null);
    } catch (e) {
      toast.error(errorMessage(e, "Could not change the agent"));
    }
  };

  const revokeGrant = async (grant: McpOAuthGrantSummary): Promise<void> => {
    try {
      await revoke.mutateAsync(grant.id);
      toast.success(`Access revoked for ${personName(grant)}`);
      setRevokeTarget(null);
    } catch (e) {
      toast.error(errorMessage(e, "Could not revoke access"));
    }
  };

  return (
    <Panel title="Agents" meta={`${clients.length} registered · ${connectedLabel(new Set(grants.map((g) => g.user.id)).size)}`}>
      {clients.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet" body="Agents appear here the first time someone connects one to the MCP URL." />
      ) : (
        <ul className="space-y-2">
          {clients.map((client) => {
            const people = grants.filter((g) => g.clientId === client.id);
            const open = showPeople === client.id;
            return (
              <li key={client.id} className="space-y-2">
                <div className={ROW} data-testid="oauth-client-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="max-w-full truncate text-[13px] text-paper">{client.name}</span>
                      {client.returnsTo.map((target) => (
                        <span key={target} className="inline-flex max-w-full truncate rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">{target}</span>
                      ))}
                      <StatusPill tone={STATUS_TONE[client.status]}>{STATUS_LABEL[client.status]}</StatusPill>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                      Registered {formatAgo(client.createdAt)} · {client.people} {client.people === 1 ? "person" : "people"}{client.lastUsedAt ? ` · last call ${formatAgo(client.lastUsedAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {people.length > 0 && (
                      <Button variant="outline" className="h-7 rounded-xs text-[11px]" aria-expanded={open} onClick={() => setShowPeople(open ? null : client.id)}>
                        {open ? "Hide people" : "See who"}
                      </Button>
                    )}
                    {canManage && client.status !== "allowed" && (
                      <Button variant="outline" className="h-7 rounded-xs text-[11px]" disabled={setStatus.isPending} onClick={() => void decide(client, "allowed")}>
                        <ShieldCheck className="mr-1 h-3 w-3" /> {client.status === "pending" ? "Approve" : "Allow"}
                      </Button>
                    )}
                    {canManage && client.status !== "blocked" && (
                      <Button variant="outline" className="h-7 rounded-xs text-[11px] text-red-400 hover:text-red-300" disabled={setStatus.isPending} onClick={() => setBlockTarget(client)}>
                        <Ban className="mr-1 h-3 w-3" /> Block
                      </Button>
                    )}
                  </div>
                </div>
                {open && (
                  <ul className="ml-4 space-y-1 border-l border-ink-500 pl-3">
                    {people.map((grant) => (
                      <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                        <span className="min-w-0 text-[12px] text-paper">
                          {personName(grant)}
                          <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                            {grant.expiresAt ? `expires ${formatDay(grant.expiresAt)}` : "no expiry"}{grant.lastUsedAt ? ` · last call ${formatAgo(grant.lastUsedAt)}` : ""}
                          </span>
                        </span>
                        {canManage && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" aria-label={`Revoke ${personName(grant)}'s access through ${client.name}`} onClick={() => setRevokeTarget(grant)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-paper-faint">Blocking an agent revokes everyone's access through it at once. People revoke their own in Preferences.</p>

      <ConfirmationDialog
        isOpen={blockTarget !== null}
        onClose={() => setBlockTarget(null)}
        onConfirm={() => { if (blockTarget) void decide(blockTarget, "blocked"); }}
        title="Block this agent?"
        description={`“${blockTarget?.name}” can't sign anyone in${blockTarget && blockTarget.people > 0 ? `, and ${blockTarget.people === 1 ? "the 1 person" : `the ${blockTarget.people} people`} connected through it ${blockTarget.people === 1 ? "loses" : "lose"} access now` : ""}. You can allow it again later; people then connect again.`}
        confirmText={setStatus.isPending ? "Blocking..." : "Block"}
        cancelText="Cancel"
        variant="danger"
      />
      <ConfirmationDialog
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => { if (revokeTarget) void revokeGrant(revokeTarget); }}
        title="Revoke access?"
        description={`${revokeTarget ? personName(revokeTarget) : ""} loses access through “${revokeTarget?.clientName}” now. They can connect again unless you block the agent.`}
        confirmText={revoke.isPending ? "Revoking..." : "Revoke"}
        cancelText="Cancel"
        variant="danger"
      />
    </Panel>
  );
}
