/**
 * Agents API (ADR 0016 §10): sessions of MCP / PAT clients, budget policies
 * and the pause switch.
 */

import { api } from "./client";

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

export interface AgentPolicy extends AgentPolicyInput {
  id: string;
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
  | "ai";

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
  updatedBy: string | null;
  updatedAt: number | null;
}

export interface McpOverview {
  settings: McpSettings;
  /** `url` is set when the server knows its public address (PUBLIC_BASE_URL). */
  endpoint: { path: string; url: string | null };
  tools: McpTool[];
}

export interface McpSettingsUpdate {
  enabled?: boolean;
  allowedOrigins?: string[];
  timeoutSeconds?: number;
  /** Per-tool switches; tools left out keep their current state. */
  toolOverrides?: Record<string, boolean>;
}

export function getMcpOverview(): Promise<McpOverview> {
  return api.get<McpOverview>("/agents/mcp");
}

export function updateMcpSettings(update: McpSettingsUpdate): Promise<McpOverview> {
  return api.put<McpOverview>("/agents/mcp", update);
}
