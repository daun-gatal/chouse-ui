/**
 * AI usage and data egress API (ADR 0020): what CHouse's own AI agents cost,
 * what ClickHouse work they caused, and what data they sent to LLM providers.
 * `scope` says whether the response covers everyone (`ai_usage:view`) or only
 * the caller's own requests.
 */

import { api } from "./client";

export type UsageScope = "all" | "own";

export interface UnpricedModel {
  modelConfigId: string | null;
  name: string;
  providerType: string | null;
  calls: number;
}

/**
 * Who started a request: the CHouse UI, an MCP agent, a personal access token
 * caller (the `chouse` CLI, scripts), or CHouse itself in the background.
 * `unknown` marks requests recorded before origins were tracked.
 */
export const AI_REQUEST_ORIGINS = ["ui", "mcp", "token", "background"] as const;
export type AiRequestOrigin = (typeof AI_REQUEST_ORIGINS)[number];

export interface AiOriginUsage {
  origin: AiRequestOrigin | "unknown";
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface AiUsageSummary {
  scope: UsageScope;
  days: number;
  retentionDays: number;
  requests: number;
  failedRequests: number;
  users: number;
  agents: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum over priced calls; null when nothing in the window was priced. */
  costUsd: number | null;
  unpricedCalls: number;
  /** Calls that reported no token usage (aborted, timed out, or the provider sent none). */
  incompleteCalls: number;
  chQueries: number;
  chReadRows: number;
  chReadBytes: number;
  egressRows: number;
  egressBytes: number;
  egressSources: number;
  unpricedModels: UnpricedModel[];
  /** Requests by who started them, most requests first. */
  byOrigin: AiOriginUsage[];
}

export interface AiModelUsage {
  modelConfigId: string | null;
  name: string;
  modelId: string | null;
  providerType: string | null;
  hasPrice: boolean;
  requests: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  incompleteCalls: number;
}

export type EgressKind = "clickhouse" | "chouse";

export interface AiEgressSource {
  kind: EgressKind;
  /** `db.table` (several joined with ", "), a CHouse tool title, or "query result". */
  source: string;
  columns: string[];
  rows: number;
  bytes: number;
  users: number;
  requests: number;
  providers: string[];
  connectionIds: string[];
  lastAt: number;
}

export type AiRequestStatus = "ok" | "error" | "timeout";

export interface AiUsageRequest {
  id: string;
  startedAt: number;
  durationMs: number;
  userId: string | null;
  userName: string | null;
  connectionId: string | null;
  /** The chat thread, for chat requests. */
  threadId: string | null;
  origin: AiRequestOrigin | "unknown";
  /** The personal access token an MCP or token request used. */
  patId: string | null;
  /** That token's name; null once it is deleted. */
  patName: string | null;
  /** The agent or client (Claude Code, chouse CLI, …) when known. */
  clientName: string | null;
  featureId: string;
  agentId: string | null;
  agentSlug: string | null;
  agentName: string | null;
  source: "chat" | "feature" | "background";
  status: AiRequestStatus;
  error: string | null;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  incompleteCalls: number;
  unpricedCalls: number;
  costUsd: number | null;
  chQueries: number;
  chReadRows: number;
  chReadBytes: number;
  egressRows: number;
  egressBytes: number;
}

export interface AiStepQuery {
  queryId: string;
  connectionId: string | null;
  sql: string;
  elapsedMs: number;
  readRows: number;
  readBytes: number;
  resultRows: number;
  tables: string[];
  columns: string[];
  error?: string;
}

export type AiStepStatus = "ok" | "error" | "duplicate" | "incomplete";

export interface AiUsageStep {
  id: string;
  seq: number;
  kind: "llm" | "tool";
  agentPath: string | null;
  name: string;
  modelConfigId: string | null;
  providerType: string | null;
  modelId: string | null;
  startedAt: number;
  durationMs: number;
  status: AiStepStatus;
  usageReported: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  chQueries: number;
  chReadRows: number;
  chReadBytes: number;
  resultBytes: number;
  queries: AiStepQuery[];
  /** Tools an LLM call asked for; `agent` names the subagent of a hand-off. Null when not recorded. */
  calls: Array<{ tool: string; agent?: string }> | null;
  error: string | null;
}

export interface AiUsageEgress {
  stepId: string;
  kind: EgressKind;
  source: string;
  columns: string[];
  rows: number;
  bytes: number;
  connectionId: string | null;
  providerType: string | null;
  modelId: string | null;
}

export interface AiUsageRequestDetail {
  request: AiUsageRequest;
  steps: AiUsageStep[];
  egress: AiUsageEgress[];
  /** Connection id → name for the connections the request's queries ran on. */
  connections: Record<string, string>;
}

export interface AiUsageRequestPage {
  scope: UsageScope;
  days: number;
  requests: AiUsageRequest[];
  total: number;
}

export function getAiUsageSummary(days: number): Promise<AiUsageSummary> {
  return api.get<AiUsageSummary>("/ai-usage/summary", { params: { days } });
}

export async function getAiUsageByModel(days: number): Promise<AiModelUsage[]> {
  const res = await api.get<{ models: AiModelUsage[] }>("/ai-usage/models", { params: { days } });
  return res.models;
}

export interface AiEgressPage {
  /** The top `limit` sources by rows, after the search. */
  sources: AiEgressSource[];
  /** How many sources match in all. */
  total: number;
  limit: number;
}

export async function getAiEgress(days: number, q?: string): Promise<AiEgressPage> {
  const search = q?.trim();
  const res = await api.get<AiEgressPage>("/ai-usage/egress", { params: { days, q: search ? search : undefined } });
  return { sources: res.sources, total: res.total, limit: res.limit };
}

export function listAiUsageRequests(options: { days: number; q?: string; origin?: AiRequestOrigin; limit?: number; offset?: number }): Promise<AiUsageRequestPage> {
  const q = options.q?.trim();
  return api.get<AiUsageRequestPage>("/ai-usage/requests", {
    params: { days: options.days, limit: options.limit, offset: options.offset, q: q ? q : undefined, origin: options.origin },
  });
}

export function getAiUsageRequest(id: string): Promise<AiUsageRequestDetail> {
  return api.get<AiUsageRequestDetail>(`/ai-usage/requests/${encodeURIComponent(id)}`);
}
