/**
 * AI Governance › MCP (ADR 0017): turn the MCP endpoint on, set its allowed origins
 * and timeout, connect clients, and switch each tool on or off. Viewing
 * needs agents:view; changing anything needs agents:manage.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, KeyRound, Plug, RotateCcw, Search, Wrench } from "lucide-react";

import type { McpOverview, McpSettingsUpdate, McpTool, McpToolCategory } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useMcpOverview, useUpdateMcpSettings } from "@/features/observe/hooks";
import { formatAgo } from "@/features/observe/lib";
import { EmptyState, ErrorState, LoadingGrid, Mono, Panel, StatusPill } from "@/features/observe/ui";
import { getBasePath } from "@/lib/basePath";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import {
  MCP_ACCESS_LABELS,
  MCP_ENDPOINT_SOURCE_LABELS,
  MCP_TOKEN_ENV,
  bulkToolOverrides,
  defaultToolOverrides,
  filterMcpTools,
  groupMcpTools,
  mcpClientSnippets,
  mcpEndpointUrl,
  parseOrigins,
  parsePublicUrl,
  type McpToolFilter,
  type ResolvedMcpEndpoint,
} from "./mcp";

const ACCESS_TONE = { read: "ok", write: "warn", destructive: "bad" } as const;
const SWITCH_CLASS = "data-[state=checked]:bg-brand data-[state=unchecked]:bg-ink-500";
const TAB_CLASS = "h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
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
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={label} onClick={() => void copy()}>
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ServerPanel({ overview, endpoint, canManage, save, saving }: { overview: McpOverview; endpoint: ResolvedMcpEndpoint; canManage: boolean; save: (update: McpSettingsUpdate, done: string) => Promise<boolean>; saving: boolean }): ReactElement {
  const { settings } = overview;
  const [originsText, setOriginsText] = useState(settings.allowedOrigins.join("\n"));
  const [timeout, setTimeoutText] = useState(String(settings.timeoutSeconds));
  const [publicText, setPublicText] = useState(settings.publicUrl ?? "");
  const [lastSettings, setLastSettings] = useState(settings);
  if (settings !== lastSettings) {
    setLastSettings(settings);
    setOriginsText(settings.allowedOrigins.join("\n"));
    setTimeoutText(String(settings.timeoutSeconds));
    setPublicText(settings.publicUrl ?? "");
  }
  const parsed = parseOrigins(originsText);
  const publicUrl = parsePublicUrl(publicText);
  const timeoutSeconds = Number(timeout);
  const timeoutValid = Number.isInteger(timeoutSeconds) && timeoutSeconds >= 1 && timeoutSeconds <= 600;
  const dirty =
    parsed.origins.join("\n") !== settings.allowedOrigins.join("\n") ||
    timeoutSeconds !== settings.timeoutSeconds ||
    ("value" in publicUrl && publicUrl.value !== settings.publicUrl);

  return (
    <Panel
      title="MCP server"
      meta={settings.updatedAt ? `Changed ${formatAgo(settings.updatedAt)}` : "Never configured"}
      actions={
        <label className="flex items-center gap-2 text-[11px] text-paper-muted">
          <StatusPill tone={settings.enabled ? "ok" : "muted"}>{settings.enabled ? "On" : "Off"}</StatusPill>
          {canManage && (
            <Switch
              className={SWITCH_CLASS}
              checked={settings.enabled}
              disabled={saving}
              aria-label="MCP endpoint"
              onCheckedChange={(enabled) => void save({ enabled }, enabled ? "MCP endpoint turned on" : "MCP endpoint turned off")}
            />
          )}
        </label>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Label>Endpoint</Label>
            <div className="mt-1 flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200/40 px-2 py-1">
              <Mono className="min-w-0 flex-1 truncate text-paper">{endpoint.url}</Mono>
              <CopyButton text={endpoint.url} label="Copy the endpoint URL" />
            </div>
            <p className="mt-1 text-[11px] text-paper-faint">
              {MCP_ENDPOINT_SOURCE_LABELS[endpoint.source]}. Served on the web port, so agents use the same Ingress and TLS as the UI; personal access tokens only.
              {!settings.enabled && " Answers 404 until it is turned on."}
            </p>
            {endpoint.local && (
              <p role="status" className="mt-1 text-[11px] text-amber-500">
                Only this machine can reach this address. If agents run elsewhere, set the public address they use below.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="mcp-public-url">Public address</Label>
            <Input
              id="mcp-public-url"
              value={publicText}
              disabled={!canManage}
              placeholder={endpoint.source === "page" ? endpoint.url.replace(/\/mcp$/, "") : "https://chouse.example.com"}
              onChange={(e) => setPublicText(e.target.value)}
              className="mt-1 rounded-xs font-mono text-[11px]"
            />
            <p className="mt-1 text-[11px] text-paper-faint">
              Only needed when agents reach CHouse UI on a different address than this page — a port-forward, an internal IP or another Ingress host. Leave empty to follow PUBLIC_BASE_URL or this page.
            </p>
            {"error" in publicUrl && <p className="mt-1 text-[11px] text-amber-500">{publicUrl.error}</p>}
          </div>
          <div>
            <Label htmlFor="mcp-timeout">Tool call timeout, seconds</Label>
            <Input id="mcp-timeout" type="number" min={1} max={600} value={timeout} disabled={!canManage} onChange={(e) => setTimeoutText(e.target.value)} className="mt-1 w-32 rounded-xs" />
            {!timeoutValid && <p className="mt-1 text-[11px] text-amber-500">Between 1 and 600 seconds.</p>}
          </div>
        </div>
        <div>
          <Label htmlFor="mcp-origins">Allowed origins</Label>
          <Textarea
            id="mcp-origins"
            rows={4}
            value={originsText}
            disabled={!canManage}
            placeholder="https://agent.example.com"
            onChange={(e) => setOriginsText(e.target.value)}
            className="mt-1 rounded-xs font-mono text-[11px]"
          />
          <p className="mt-1 text-[11px] text-paper-faint">
            One per line. Desktop and CLI agents send no Origin and always pass; browser-based agent hosts must be listed (DNS-rebinding protection).
          </p>
          {parsed.invalid.length > 0 && <p className="mt-1 text-[11px] text-amber-500">Not an origin: {parsed.invalid.join(", ")}</p>}
        </div>
      </div>
      {canManage && (
        <div className="mt-3 flex justify-end">
          <Button
            className={DH_PRIMARY}
            disabled={!dirty || !timeoutValid || parsed.invalid.length > 0 || "error" in publicUrl || saving}
            onClick={() => "value" in publicUrl && void save({ allowedOrigins: parsed.origins, timeoutSeconds, publicUrl: publicUrl.value }, "MCP settings saved")}
          >
            Save settings
          </Button>
        </div>
      )}
    </Panel>
  );
}

function ConnectPanel({ url }: { url: string }): ReactElement {
  const navigate = useNavigate();
  const snippets = useMemo(() => mcpClientSnippets(url), [url]);
  return (
    <Panel
      title="Connect an agent"
      meta={<>Mint a personal access token, then export it as <Mono>{MCP_TOKEN_ENV}</Mono> — tokens never go in config files.</>}
      actions={<Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate("/preferences")}><KeyRound className="mr-1 h-3 w-3" /> Personal access tokens</Button>}
    >
      <Tabs defaultValue={snippets[0].id}>
        <TabsList className="h-9 flex-wrap rounded-xs border border-ink-500 bg-ink-200 p-0.5">
          {snippets.map((s) => <TabsTrigger key={s.id} value={s.id} className={TAB_CLASS}>{s.label}</TabsTrigger>)}
        </TabsList>
        {snippets.map((s) => (
          <TabsContent key={s.id} value={s.id} className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-paper-muted">{s.target}</span>
              <CopyButton text={s.code} label={`Copy the ${s.label} setup`} />
            </div>
            <pre className="mt-1 max-h-72 overflow-auto rounded-xs border border-ink-500 bg-ink-300 p-3 font-mono text-[11px] leading-relaxed text-paper">{s.code}</pre>
          </TabsContent>
        ))}
      </Tabs>
      <p className="mt-3 text-[11px] text-paper-faint">
        The CLI prints the same setup for your profile: <Mono>chouse mcp config claude-code</Mono>. Each token sees only the tools below that are on and that its permissions allow.
      </p>
    </Panel>
  );
}

function ToolRow({ tool, canManage, saving, onToggle }: { tool: McpTool; canManage: boolean; saving: boolean; onToggle: (tool: McpTool, enabled: boolean) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        {canManage ? (
          <Switch className={cn("mt-0.5", SWITCH_CLASS)} checked={tool.enabled} disabled={saving} aria-label={`${tool.name} enabled`} onCheckedChange={(enabled) => onToggle(tool, enabled)} />
        ) : (
          <StatusPill tone={tool.enabled ? "ok" : "muted"} className="mt-0.5">{tool.enabled ? "on" : "off"}</StatusPill>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-paper">{tool.name}</Mono>
            <span className="text-[12px] text-paper-muted">{tool.title}</span>
            <StatusPill tone={ACCESS_TONE[tool.access]} dot={false}>{MCP_ACCESS_LABELS[tool.access]}</StatusPill>
            {tool.spendsLlm && <StatusPill tone="info" dot={false}>LLM spend</StatusPill>}
            {tool.enabled !== tool.enabledByDefault && <span className="font-mono text-[10px] text-paper-faint">default {tool.enabledByDefault ? "on" : "off"}</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-paper-muted">{tool.description}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-paper-faint">
            <span>Needs</span>
            {tool.permissions.length === 0 ? <span>any token</span> : tool.permissions.map((p, i) => (
              <span key={p} className="flex items-center gap-1.5">{i > 0 && <span>or</span>}<Mono className="text-paper-muted">{p}</Mono></span>
            ))}
            {tool.parameters.length > 0 && (
              <button type="button" className="ml-2 inline-flex items-center gap-0.5 text-paper-muted hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {tool.parameters.length} parameter{tool.parameters.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
          {open && (
            <table className="mt-2 w-full text-left text-[11px]">
              <tbody className="divide-y divide-ink-500/50">
                {tool.parameters.map((p) => (
                  <tr key={p.name}>
                    <td className="py-1 pr-3 align-top"><Mono className="text-paper">{p.name}</Mono>{p.required && <span className="ml-1 text-red-500" title="required">*</span>}</td>
                    <td className="py-1 pr-3 align-top font-mono text-[10px] text-paper-faint">{p.type}</td>
                    <td className="py-1 text-paper-muted">{p.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </li>
  );
}

function ToolsPanel({ tools, canManage, save, saving }: { tools: McpTool[]; canManage: boolean; save: (update: McpSettingsUpdate, done: string) => Promise<boolean>; saving: boolean }): ReactElement {
  const [filter, setFilter] = useState<McpToolFilter>({ search: "", access: "all", state: "all" });
  const [confirm, setConfirm] = useState<{ tools: McpTool[]; message: string } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<McpToolCategory>>(new Set());
  const groups = groupMcpTools(filterMcpTools(tools, filter));
  const enabledCount = tools.filter((t) => t.enabled).length;
  // A search or filter opens every category it matches, so results are never hidden.
  const filtering = filter.search.trim() !== "" || filter.access !== "all" || filter.state !== "all";
  const isOpen = (category: McpToolCategory): boolean => filtering || open.has(category);
  const allOpen = groups.every((g) => isOpen(g.category));
  const toggle = (category: McpToolCategory): void => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  // Turning on anything that changes or deletes things is confirmed first.
  const setEnabled = (subset: McpTool[], enabled: boolean, done: string): void => {
    const risky = enabled ? subset.filter((t) => !t.enabled && t.access !== "read") : [];
    if (risky.length > 0) {
      setConfirm({ tools: subset, message: done });
      return;
    }
    void save({ toolOverrides: bulkToolOverrides(subset, enabled) }, done);
  };

  return (
    <Panel
      title="Tools"
      meta={`${enabledCount} of ${tools.length} on · every call runs under the token's own permissions and data access`}
      actions={
        <>
          <Button variant="ghost" className="h-8 rounded-xs text-[11px]" disabled={filtering} onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.category)))}>
            {allOpen ? <ChevronsDownUp className="mr-1 h-3 w-3" /> : <ChevronsUpDown className="mr-1 h-3 w-3" />}
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
          {canManage && (
            <Button variant="ghost" className="h-8 rounded-xs text-[11px]" disabled={saving} onClick={() => void save({ toolOverrides: defaultToolOverrides(tools) }, "Tools reset to their defaults")}>
              <RotateCcw className="mr-1 h-3 w-3" /> Reset to defaults
            </Button>
          )}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-paper-faint" aria-hidden />
          <Input value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Search tools, descriptions, permissions" aria-label="Search tools" className="h-9 rounded-xs pl-7" />
        </div>
        <Select value={filter.access} onValueChange={(v) => setFilter({ ...filter, access: v === "read" || v === "write" || v === "destructive" ? v : "all" })}>
          <SelectTrigger className="h-9 w-36 rounded-xs text-[11px]" aria-label="Access"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any access</SelectItem><SelectItem value="read">Read</SelectItem><SelectItem value="write">Write</SelectItem><SelectItem value="destructive">Destructive</SelectItem></SelectContent>
        </Select>
        <Select value={filter.state} onValueChange={(v) => setFilter({ ...filter, state: v === "enabled" || v === "disabled" ? v : "all" })}>
          <SelectTrigger className="h-9 w-32 rounded-xs text-[11px]" aria-label="State"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">On and off</SelectItem><SelectItem value="enabled">On</SelectItem><SelectItem value="disabled">Off</SelectItem></SelectContent>
        </Select>
      </div>
      {groups.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools match" />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.category} aria-label={group.label}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-500 pb-1">
                <h3>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:text-paper focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:cursor-default"
                    aria-expanded={isOpen(group.category)}
                    aria-controls={`mcp-tools-${group.category}`}
                    disabled={filtering}
                    onClick={() => toggle(group.category)}
                  >
                    {isOpen(group.category) ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
                    {group.label} · {group.tools.filter((t) => t.enabled).length}/{group.tools.length} on
                  </button>
                </h3>
                {canManage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" className="h-6 rounded-xs px-2 text-[10px]" disabled={saving} onClick={() => setEnabled(group.tools, true, `${group.label}: all on`)}>All on</Button>
                    <Button variant="ghost" className="h-6 rounded-xs px-2 text-[10px]" disabled={saving} onClick={() => setEnabled(group.tools, false, `${group.label}: all off`)}>All off</Button>
                  </div>
                )}
              </div>
              <ul id={`mcp-tools-${group.category}`} hidden={!isOpen(group.category)} className="divide-y divide-ink-500/60">
                {group.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} canManage={canManage} saving={saving} onToggle={(t, enabled) => setEnabled([t], enabled, `${t.name} turned ${enabled ? "on" : "off"}`)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-paper-faint">There is no approve tool: fixes proposed by agents always wait for a person.</p>
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
          <DialogHeader>
            <DialogTitle>Let agents change things?</DialogTitle>
            <DialogDescription>
              {confirm && `This turns on ${confirm.tools.filter((t) => !t.enabled && t.access !== "read").map((t) => t.name).join(", ")}. `}
              Agents can call them with any token that holds the permission. Ask people to keep their client's approval prompt on for these tools.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              className="rounded-xs"
              disabled={saving}
              onClick={() => {
                if (!confirm) return;
                void save({ toolOverrides: bulkToolOverrides(confirm.tools, true) }, confirm.message).then((ok) => ok && setConfirm(null));
              }}
            >
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export function McpPanel(): ReactElement {
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AGENTS_MANAGE));
  const overview = useMcpOverview();
  const update = useUpdateMcpSettings();

  const save = async (change: McpSettingsUpdate, done: string): Promise<boolean> => {
    try {
      await update.mutateAsync(change);
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the MCP settings"));
      return false;
    }
  };

  if (overview.isLoading) return <LoadingGrid count={2} />;
  if (overview.isError || !overview.data) return <ErrorState title="MCP settings could not be loaded." error={overview.error} />;
  const endpoint = mcpEndpointUrl(overview.data.endpoint, window.location.origin, getBasePath());

  return (
    <div className="space-y-4">
      {!overview.data.settings.enabled && (
        <div role="status" className="flex items-start gap-2 rounded-xs border border-ink-500 bg-ink-200/40 p-3 text-[12px] text-paper-muted">
          <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>The MCP endpoint is off. {canManage ? "Turn it on below; read-only tools are ready, and anything that changes or deletes things stays off until you turn it on." : "Ask an administrator with agents:manage to turn it on."}</span>
        </div>
      )}
      <ServerPanel overview={overview.data} endpoint={endpoint} canManage={canManage} save={save} saving={update.isPending} />
      <ConnectPanel url={endpoint.url} />
      <ToolsPanel tools={overview.data.tools} canManage={canManage} save={save} saving={update.isPending} />
    </div>
  );
}

