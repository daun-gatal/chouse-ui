/**
 * Agents API (ADR 0016 §10): sessions of MCP / PAT clients, budget policies
 * and the pause switch.
 */

import { api } from "./client";
import type { AiActionTier, AiToolkit } from "./aiActions";

export interface AgentSummary {
  paused: boolean;
  activeAgents: number;
  sessions: number;
  queries: number;
  readBytes: number;
  warnings: number;
  blocked: number;
}

export interface AgentSession {
  id: string;
  patId: string | null;
  userId: string | null;
  clientName: string | null;
  /** Token name, resolved by the server. */
  patName?: string | null;
  /** Display name of the user the session ran as. */
  userName?: string | null;
  /** The user's roles: name and display name. */
  roles?: Array<{ name: string; label: string }>;
  /** The policy that governs the session, by what it targets. */
  policy?: { source: "pat" | "role" | "default" | "none"; label: string; dailyBytes: number | null };
  source: "mcp" | "pat";
  startedAt: number;
  lastSeenAt: number;
  queries: number;
  readBytes: number;
  warnings: number;
  blocked: number;
}

export interface AgentToolCall {
  id: string;
  sessionId: string;
  tool: string;
  argsSummary: string | null;
  outcome: "ok" | "warned" | "blocked" | "error";
  detail: Record<string, unknown>;
  readBytes: number;
  createdAt: number;
}

export interface AgentPolicyInput {
  scopeKind: "default" | "pat" | "role";
  scopeId: string;
  maxBytesPerQuery: number | null;
  dailyBytes: number | null;
  partitionFilterBytes: number | null;
  incidentMode: "off" | "warn" | "block";
  alertMultiplier: number | null;
}

/** A policy's limits, without what it applies to. */
export type AgentPolicySettings = Omit<AgentPolicyInput, "scopeKind" | "scopeId">;

/** One thing a policy applies to: every agent (`default` / `*`), a role name, or a token id. */
export type AgentPolicyTarget = Pick<AgentPolicyInput, "scopeKind" | "scopeId">;

export interface AgentPolicy extends AgentPolicyInput {
  id: string;
  /** Display name of the role or token the policy applies to. */
  scopeLabel?: string;
  updatedBy: string | null;
  updatedAt: number;
}

export function getAgentSummary(): Promise<AgentSummary> {
  return api.get<AgentSummary>("/agents/summary");
}

export async function listAgentSessions(days = 1): Promise<AgentSession[]> {
  const res = await api.get<{ sessions: AgentSession[] }>("/agents/sessions", { params: { days } });
  return res.sessions;
}

export function getAgentSession(id: string): Promise<{ session: AgentSession; calls: AgentToolCall[] }> {
  return api.get(`/agents/sessions/${encodeURIComponent(id)}`);
}

export async function listAgentPolicies(): Promise<AgentPolicy[]> {
  const res = await api.get<{ policies: AgentPolicy[] }>("/agents/policies");
  return res.policies;
}

export interface PolicyScopeOption {
  /** Role name or token id: the value a policy stores. */
  id: string;
  label: string;
  detail: string | null;
}

export interface PolicyScopes {
  roles: PolicyScopeOption[];
  tokens: PolicyScopeOption[];
}

export function listPolicyScopes(): Promise<PolicyScopes> {
  return api.get<PolicyScopes>("/agents/policy-scopes");
}

/** Write the same limits to every target; `removeIds` are rows of the edited policy no longer assigned. */
export async function assignAgentPolicy(input: { settings: AgentPolicySettings; targets: AgentPolicyTarget[]; removeIds: string[] }): Promise<AgentPolicy[]> {
  const res = await api.put<{ policies: AgentPolicy[] }>("/agents/policies/assign", input);
  return res.policies;
}

export function saveAgentPolicy(input: AgentPolicyInput): Promise<AgentPolicy> {
  return api.put<AgentPolicy>("/agents/policies", input);
}

export function deleteAgentPolicy(id: string): Promise<{ deleted: string }> {
  return api.delete(`/agents/policies/${encodeURIComponent(id)}`);
}

export function setAgentsPaused(paused: boolean): Promise<{ paused: boolean }> {
  return api.post("/agents/pause", { paused });
}

// --- MCP (ADR 0017) -----------------------------------------------------------------

export type McpToolAccess = "read" | "write" | "destructive";

export type McpToolCategory =
  | "identity"
  | "explore"
  | "query"
  | "monitoring"
  | "scheduling"
  | "data_health"
  | "data_observability"
  | "performance"
  | "dashboards"
  | "ai"
  | "ai_governance"
  | "access";

export interface McpToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  category: McpToolCategory;
  access: McpToolAccess;
  spendsLlm: boolean;
  /** The token needs at least one of these for the tool to be listed. */
  permissions: string[];
  parameters: McpToolParameter[];
  enabled: boolean;
  enabledByDefault: boolean;
}

export interface McpSettings {
  enabled: boolean;
  allowedOrigins: string[];
  timeoutSeconds: number;
  /** Address agents use when it differs from the one the UI is opened on. */
  publicUrl: string | null;
  /** ADR 0025 ceiling: toolkits whose write tools any token may get. */
  actionToolkits: AiToolkit[];
  /** ADR 0025 ceiling: the highest tier a write tool may have over MCP. */
  actionMaxTier: AiActionTier;
  /** How long a write held for its user's confirmation waits in the MCP call. */
  approvalWaitSeconds: number;
  /** ADR 0028: agents may sign in with OAuth. */
  oauthEnabled: boolean;
  /** ADR 0028: pasted personal access tokens still work on MCP while OAuth is on. */
  oauthPatsAllowed: boolean;
  /** ADR 0028: new agents work at once ("open") or wait for an administrator ("approval"). */
  oauthRegistration: McpOAuthRegistration;
  /** ADR 0028: hosts an agent may return to; empty = any https host, localhost or app link. */
  oauthRedirectHosts: string[];
  /** ADR 0028: the longest an agent's access may last, in days. */
  oauthMaxGrantDays: number;
  updatedBy: string | null;
  updatedAt: number | null;
}

export type McpOAuthRegistration = "open" | "approval";

export interface McpOverview {
  settings: McpSettings;
  /**
   * `url` is set when the server knows the address agents use: the public
   * address set in AI Governance › MCP (`source: "settings"`) or PUBLIC_BASE_URL
   * (`source: "env"`). Otherwise the UI uses its own origin.
   */
  endpoint: { path: string; url: string | null; source: "settings" | "env" | null };
  /** Where agents sign in (ADR 0028), or why they can't yet. */
  oauth: { issuer: string | null; metadataUrl: string | null; problem: string | null };
  tools: McpTool[];
}

export interface McpSettingsUpdate {
  enabled?: boolean;
  allowedOrigins?: string[];
  timeoutSeconds?: number;
  /** `null` clears it, so the endpoint follows PUBLIC_BASE_URL or the page again. */
  publicUrl?: string | null;
  /** Per-tool switches; tools left out keep their current state. */
  toolOverrides?: Record<string, boolean>;
  actionToolkits?: AiToolkit[];
  actionMaxTier?: AiActionTier;
  approvalWaitSeconds?: number;
  oauthEnabled?: boolean;
  oauthPatsAllowed?: boolean;
  oauthRegistration?: McpOAuthRegistration;
  oauthRedirectHosts?: string[];
  oauthMaxGrantDays?: number;
}

export function getMcpOverview(): Promise<McpOverview> {
  return api.get<McpOverview>("/agents/mcp");
}

export function updateMcpSettings(update: McpSettingsUpdate): Promise<McpOverview> {
  return api.put<McpOverview>("/agents/mcp", update);
}

// --- MCP sign-in with OAuth (ADR 0028 §5) -----------------------------------

export type McpOAuthClientStatus = "allowed" | "pending" | "blocked";

/** An agent that registered itself to sign people in. Its name is its own claim. */
export interface McpOAuthClient {
  id: string;
  name: string;
  status: McpOAuthClientStatus;
  /** Hosts (or app links) it returns to after sign-in. */
  returnsTo: string[];
  clientUri: string | null;
  /** People with live access through it. */
  people: number;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface McpOAuthGrantSummary {
  id: string;
  clientId: string;
  clientName: string;
  user: { id: string; email: string | null; username: string | null; displayName: string | null };
  createdAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

export interface McpOAuthOverview {
  clients: McpOAuthClient[];
  grants: McpOAuthGrantSummary[];
}

export function getMcpOAuth(): Promise<McpOAuthOverview> {
  return api.get<McpOAuthOverview>("/agents/mcp/oauth");
}

/** Approve a waiting agent, or block one (which revokes everyone's access through it). */
export function setMcpOAuthClientStatus(id: string, status: Exclude<McpOAuthClientStatus, "pending">): Promise<{ id: string; status: McpOAuthClientStatus }> {
  return api.put<{ id: string; status: McpOAuthClientStatus }>(`/agents/mcp/oauth/clients/${encodeURIComponent(id)}`, { status });
}

export function revokeMcpOAuthGrant(id: string): Promise<{ id: string }> {
  return api.delete<{ id: string }>(`/agents/mcp/oauth/grants/${encodeURIComponent(id)}`);
}
