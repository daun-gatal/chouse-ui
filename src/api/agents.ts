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
