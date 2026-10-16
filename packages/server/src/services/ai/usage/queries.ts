/**
 * Read side of AI usage tracking (ADR 0020 §6). Every query takes a scope:
 * `userId: null` reads everyone's requests (ai_usage:view), otherwise only that
 * user's. Windows are on `started_at`, which every table indexes.
 */

import { sql, type SQL } from "drizzle-orm";

import { rawAll, toNumber } from "../../../rbac/db/raw";
import { USAGE_ORIGINS, type UsageOrigin } from "./origin";

export interface UsageScope {
  /** Only this user's requests; null for everyone's. */
  userId: string | null;
  /** Window start, unix ms. */
  since: number;
}

export interface UsageSummary {
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
  incompleteCalls: number;
  chQueries: number;
  chReadRows: number;
  chReadBytes: number;
  egressRows: number;
  egressBytes: number;
  egressSources: number;
  /** Models used in the window that have no price now. */
  unpricedModels: Array<{ modelConfigId: string | null; name: string; providerType: string | null; calls: number }>;
  /** Requests by who started them, most requests first. */
  byOrigin: OriginUsage[];
}

/**
 * Who started a request: the UI, an MCP agent, a token caller (CLI, scripts),
 * or CHouse itself in the background. `unknown` is a request recorded before
 * origins were tracked.
 */
export const REQUEST_ORIGINS = [...USAGE_ORIGINS, "background"] as const;
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number];

export interface OriginUsage {
  origin: RequestOrigin | "unknown";
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ModelUsage {
  modelConfigId: string | null;
  name: string;
  modelId: string | null;
  providerType: string | null;
  /** Whether the model has a price now. */
  hasPrice: boolean;
  requests: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
  incompleteCalls: number;
}

export interface EgressSource {
  kind: "clickhouse" | "chouse";
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

export interface UsageRequestRow {
  id: string;
  startedAt: number;
  durationMs: number;
  userId: string | null;
  userName: string | null;
  connectionId: string | null;
  /** The chat thread the request belongs to, for chat requests. */
  threadId: string | null;
  origin: RequestOrigin | "unknown";
  /** The personal access token an MCP or token request used. */
  patId: string | null;
  /** That token's name; null when it was deleted. */
  patName: string | null;
  /** The agent or client (Claude Code, chouse CLI, …) when known. */
  clientName: string | null;
  featureId: string;
  agentId: string | null;
  agentSlug: string | null;
  agentName: string | null;
  source: string;
  status: string;
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

export interface UsageStepRow {
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
  status: string;
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
  queries: Array<Record<string, unknown>>;
  /** Tools an LLM call asked for (`agent` for a hand-off to a subagent); null when not recorded. */
  calls: Array<{ tool: string; agent?: string }> | null;
  error: string | null;
}

export interface UsageEgressRow {
  stepId: string;
  kind: "clickhouse" | "chouse";
  source: string;
  columns: string[];
  rows: number;
  bytes: number;
  connectionId: string | null;
  providerType: string | null;
  modelId: string | null;
}

export interface UsageRequestDetail {
  request: UsageRequestRow;
  steps: UsageStepRow[];
  egress: UsageEgressRow[];
  /** Names of the connections the steps' queries ran on. */
  connections: Record<string, string>;
}

export const MAX_EGRESS_SOURCES = 100;
const MAX_SOURCE_COLUMNS = 40;
const MAX_LIST = 200;

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isUsageOrigin(value: unknown): value is UsageOrigin {
  return typeof value === "string" && (USAGE_ORIGINS as readonly string[]).includes(value);
}

/** A request's origin from its stored `origin` and `source`. */
function originOf(origin: unknown, source: unknown): RequestOrigin | "unknown" {
  if (source === "background") return "background";
  return isUsageOrigin(origin) ? origin : "unknown";
}

/** `AND <origin matches>` for a list filter. */
function originFilter(origin: RequestOrigin | undefined): SQL {
  if (!origin) return sql``;
  if (origin === "background") return sql` AND r.source = 'background'`;
  return sql` AND r.origin = ${origin} AND r.source <> 'background'`;
}

function egressKind(value: unknown): "clickhouse" | "chouse" {
  return value === "chouse" ? "chouse" : "clickhouse";
}

/** `AND <column> = user` when the scope is one user. */
function userFilter(scope: UsageScope, column: string): SQL {
  return scope.userId === null ? sql`` : sql` AND ${sql.raw(column)} = ${scope.userId}`;
}

/** Escape LIKE wildcards; every query uses `ESCAPE '\'`. */
export function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function usageSummary(scope: UsageScope): Promise<UsageSummary> {
  const [totals] = await rawAll(sql`
    SELECT COUNT(*) AS requests,
      SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS failed,
      COUNT(DISTINCT user_id) AS users,
      COUNT(DISTINCT agent_slug) AS agents,
      SUM(llm_calls) AS llm_calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cache_read_tokens) AS cache_read, SUM(cache_write_tokens) AS cache_write,
      SUM(cost_usd) AS cost, SUM(unpriced_calls) AS unpriced, SUM(incomplete_calls) AS incomplete,
      SUM(ch_queries) AS ch_queries, SUM(ch_read_rows) AS ch_rows, SUM(ch_read_bytes) AS ch_bytes,
      SUM(egress_rows) AS egress_rows, SUM(egress_bytes) AS egress_bytes
    FROM ai_usage_requests WHERE started_at >= ${scope.since}${userFilter(scope, "user_id")}`);
  const [sources] = await rawAll(sql`
    SELECT COUNT(DISTINCT source) AS n FROM ai_usage_egress WHERE started_at >= ${scope.since}${userFilter(scope, "user_id")}`);
  const unpriced = await rawAll(sql`
    SELECT s.model_config_id, MAX(s.model_id) AS model_id, MAX(s.provider_type) AS provider_type, MAX(m.name) AS name, COUNT(*) AS calls
    FROM ai_usage_steps s
    JOIN ai_usage_requests r ON r.id = s.request_id
    LEFT JOIN rbac_ai_models m ON m.id = s.model_config_id
    WHERE r.started_at >= ${scope.since}${userFilter(scope, "r.user_id")}
      AND s.kind = 'llm' AND s.usage_reported = 1 AND s.cost_usd IS NULL AND m.pricing IS NULL
    GROUP BY s.model_config_id
    ORDER BY COUNT(*) DESC`);
  const origins = await rawAll(sql`
    SELECT origin, CASE WHEN source = 'background' THEN 'background' ELSE '' END AS bg, COUNT(*) AS requests,
      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost
    FROM ai_usage_requests WHERE started_at >= ${scope.since}${userFilter(scope, "user_id")}
    GROUP BY origin, CASE WHEN source = 'background' THEN 'background' ELSE '' END`);
  const byOrigin = new Map<OriginUsage["origin"], OriginUsage>();
  for (const r of origins) {
    const origin = originOf(r.origin, r.bg === "background" ? "background" : null);
    const entry = byOrigin.get(origin) ?? { origin, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: null };
    const cost = numOrNull(r.cost);
    entry.requests += toNumber(r.requests);
    entry.inputTokens += toNumber(r.input_tokens);
    entry.outputTokens += toNumber(r.output_tokens);
    if (cost !== null) entry.costUsd = (entry.costUsd ?? 0) + cost;
    byOrigin.set(origin, entry);
  }
  return {
    requests: toNumber(totals?.requests),
    failedRequests: toNumber(totals?.failed),
    users: toNumber(totals?.users),
    agents: toNumber(totals?.agents),
    llmCalls: toNumber(totals?.llm_calls),
    inputTokens: toNumber(totals?.input_tokens),
    outputTokens: toNumber(totals?.output_tokens),
    cacheReadTokens: toNumber(totals?.cache_read),
    cacheWriteTokens: toNumber(totals?.cache_write),
    costUsd: numOrNull(totals?.cost),
    unpricedCalls: toNumber(totals?.unpriced),
    incompleteCalls: toNumber(totals?.incomplete),
    chQueries: toNumber(totals?.ch_queries),
    chReadRows: toNumber(totals?.ch_rows),
    chReadBytes: toNumber(totals?.ch_bytes),
    egressRows: toNumber(totals?.egress_rows),
    egressBytes: toNumber(totals?.egress_bytes),
    egressSources: toNumber(sources?.n),
    unpricedModels: unpriced.map((r) => ({
      modelConfigId: strOrNull(r.model_config_id),
      name: strOrNull(r.name) ?? strOrNull(r.model_id) ?? "Deleted model",
      providerType: strOrNull(r.provider_type),
      calls: toNumber(r.calls),
    })),
    byOrigin: [...byOrigin.values()].sort((a, b) => b.requests - a.requests),
  };
}

export async function usageByModel(scope: UsageScope): Promise<ModelUsage[]> {
  const rows = await rawAll(sql`
    SELECT s.model_config_id, MAX(s.model_id) AS model_id, MAX(s.provider_type) AS provider_type, MAX(m.name) AS name,
      MAX(CASE WHEN m.pricing IS NULL THEN 0 ELSE 1 END) AS has_price,
      COUNT(DISTINCT s.request_id) AS requests, COUNT(*) AS calls,
      SUM(s.input_tokens) AS input_tokens, SUM(s.output_tokens) AS output_tokens, SUM(s.cache_read_tokens) AS cache_read,
      SUM(s.cost_usd) AS cost, SUM(CASE WHEN s.usage_reported = 0 THEN 1 ELSE 0 END) AS incomplete
    FROM ai_usage_steps s
    JOIN ai_usage_requests r ON r.id = s.request_id
    LEFT JOIN rbac_ai_models m ON m.id = s.model_config_id
    WHERE r.started_at >= ${scope.since}${userFilter(scope, "r.user_id")} AND s.kind = 'llm'
    GROUP BY s.model_config_id
    ORDER BY SUM(s.input_tokens) + SUM(s.output_tokens) DESC`);
  return rows.map((r) => ({
    modelConfigId: strOrNull(r.model_config_id),
    name: strOrNull(r.name) ?? strOrNull(r.model_id) ?? "Deleted model",
    modelId: strOrNull(r.model_id),
    providerType: strOrNull(r.provider_type),
    hasPrice: toNumber(r.has_price) === 1,
    requests: toNumber(r.requests),
    calls: toNumber(r.calls),
    inputTokens: toNumber(r.input_tokens),
    outputTokens: toNumber(r.output_tokens),
    cacheReadTokens: toNumber(r.cache_read),
    costUsd: numOrNull(r.cost),
    incompleteCalls: toNumber(r.incomplete),
  }));
}

/** Data sent by source, most rows first: the top `MAX_EGRESS_SOURCES`, optionally filtered, and how many match in all. */
export async function egressBySource(scope: UsageScope, options: { q?: string } = {}): Promise<{ sources: EgressSource[]; total: number }> {
  const q = options.q?.trim();
  const search = q ? sql` AND LOWER(source) LIKE ${likePattern(q)} ESCAPE '\\'` : sql``;
  const where = sql`WHERE started_at >= ${scope.since}${userFilter(scope, "user_id")}${search}`;
  const [count] = await rawAll(sql`SELECT COUNT(*) AS n FROM (SELECT 1 AS one FROM ai_usage_egress ${where} GROUP BY kind, source) grouped`);
  const totals = await rawAll(sql`
    SELECT kind, source, SUM(row_count) AS row_count, SUM(bytes) AS bytes, COUNT(DISTINCT user_id) AS users,
      COUNT(DISTINCT request_id) AS requests, MAX(started_at) AS last_at
    FROM ai_usage_egress ${where}
    GROUP BY kind, source
    ORDER BY SUM(row_count) DESC, source
    LIMIT ${MAX_EGRESS_SOURCES}`);
  const total = toNumber(count?.n);
  if (totals.length === 0) return { sources: [], total };
  const sources = totals.map((t) => str(t.source));
  const details = await rawAll(sql`
    SELECT DISTINCT kind, source, columns, provider_type, connection_id FROM ai_usage_egress
    WHERE started_at >= ${scope.since}${userFilter(scope, "user_id")}
      AND source IN (${sql.join(sources.map((s) => sql`${s}`), sql`, `)})`);
  const extra = new Map<string, { columns: Set<string>; providers: Set<string>; connections: Set<string> }>();
  for (const d of details) {
    const key = `${str(d.kind)}|${str(d.source)}`;
    const entry = extra.get(key) ?? { columns: new Set<string>(), providers: new Set<string>(), connections: new Set<string>() };
    for (const c of jsonArray(d.columns)) if (typeof c === "string" && entry.columns.size < MAX_SOURCE_COLUMNS) entry.columns.add(c);
    if (d.provider_type) entry.providers.add(str(d.provider_type));
    if (d.connection_id) entry.connections.add(str(d.connection_id));
    extra.set(key, entry);
  }
  return { total, sources: totals.map((t) => {
    const e = extra.get(`${str(t.kind)}|${str(t.source)}`);
    return {
      kind: egressKind(t.kind),
      source: str(t.source),
      columns: e ? [...e.columns] : [],
      rows: toNumber(t.row_count),
      bytes: toNumber(t.bytes),
      users: toNumber(t.users),
      requests: toNumber(t.requests),
      providers: e ? [...e.providers].sort() : [],
      connectionIds: e ? [...e.connections].sort() : [],
      lastAt: toNumber(t.last_at),
    };
  }) };
}

function requestRow(r: Record<string, unknown>): UsageRequestRow {
  return {
    id: str(r.id),
    startedAt: toNumber(r.started_at),
    durationMs: toNumber(r.duration_ms),
    userId: strOrNull(r.user_id),
    userName: strOrNull(r.display_name) ?? strOrNull(r.username),
    connectionId: strOrNull(r.connection_id),
    threadId: strOrNull(r.thread_id),
    origin: originOf(r.origin, r.source),
    patId: strOrNull(r.pat_id),
    patName: strOrNull(r.pat_name),
    clientName: strOrNull(r.client_name),
    featureId: str(r.feature_id),
    agentId: strOrNull(r.agent_id),
    agentSlug: strOrNull(r.agent_slug),
    agentName: strOrNull(r.agent_name),
    source: str(r.source),
    status: str(r.status),
    error: strOrNull(r.error),
    llmCalls: toNumber(r.llm_calls),
    toolCalls: toNumber(r.tool_calls),
    inputTokens: toNumber(r.input_tokens),
    outputTokens: toNumber(r.output_tokens),
    cacheReadTokens: toNumber(r.cache_read_tokens),
    cacheWriteTokens: toNumber(r.cache_write_tokens),
    incompleteCalls: toNumber(r.incomplete_calls),
    unpricedCalls: toNumber(r.unpriced_calls),
    costUsd: numOrNull(r.cost_usd),
    chQueries: toNumber(r.ch_queries),
    chReadRows: toNumber(r.ch_read_rows),
    chReadBytes: toNumber(r.ch_read_bytes),
    egressRows: toNumber(r.egress_rows),
    egressBytes: toNumber(r.egress_bytes),
  };
}

export async function listUsageRequests(
  scope: UsageScope,
  options: { q?: string; origin?: RequestOrigin; limit?: number; offset?: number } = {},
): Promise<{ requests: UsageRequestRow[]; total: number }> {
  const limit = Math.min(MAX_LIST, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const q = options.q?.trim();
  const search = q
    ? sql` AND (LOWER(COALESCE(u.username, '')) LIKE ${likePattern(q)} ESCAPE '\\'
        OR LOWER(COALESCE(u.display_name, '')) LIKE ${likePattern(q)} ESCAPE '\\'
        OR LOWER(COALESCE(r.agent_name, '')) LIKE ${likePattern(q)} ESCAPE '\\'
        OR LOWER(r.feature_id) LIKE ${likePattern(q)} ESCAPE '\\'
        OR LOWER(COALESCE(r.client_name, '')) LIKE ${likePattern(q)} ESCAPE '\\'
        OR LOWER(COALESCE(k.name, '')) LIKE ${likePattern(q)} ESCAPE '\\'
        OR r.id IN (SELECT e.request_id FROM ai_usage_egress e WHERE e.started_at >= ${scope.since} AND LOWER(e.source) LIKE ${likePattern(q)} ESCAPE '\\'))`
    : sql``;
  const where = sql`WHERE r.started_at >= ${scope.since}${userFilter(scope, "r.user_id")}${originFilter(options.origin)}${search}`;
  const rows = await rawAll(sql`
    SELECT r.*, u.username, u.display_name, k.name AS pat_name FROM ai_usage_requests r
    LEFT JOIN rbac_users u ON u.id = r.user_id
    LEFT JOIN rbac_api_keys k ON k.id = r.pat_id
    ${where}
    ORDER BY r.started_at DESC, r.id
    LIMIT ${limit} OFFSET ${offset}`);
  const [count] = await rawAll(sql`
    SELECT COUNT(*) AS n FROM ai_usage_requests r
    LEFT JOIN rbac_users u ON u.id = r.user_id
    LEFT JOIN rbac_api_keys k ON k.id = r.pat_id
    ${where}`);
  return { requests: rows.map(requestRow), total: toNumber(count?.n) };
}

/** One request with its steps and egress, or null when it does not exist or is outside the scope's user. */
export async function usageRequestDetail(id: string, userId: string | null): Promise<UsageRequestDetail | null> {
  const [row] = await rawAll(sql`
    SELECT r.*, u.username, u.display_name, k.name AS pat_name FROM ai_usage_requests r
    LEFT JOIN rbac_users u ON u.id = r.user_id
    LEFT JOIN rbac_api_keys k ON k.id = r.pat_id
    WHERE r.id = ${id}${userId === null ? sql`` : sql` AND r.user_id = ${userId}`}`);
  if (!row) return null;
  const stepRows = await rawAll(sql`SELECT * FROM ai_usage_steps WHERE request_id = ${id} ORDER BY seq`);
  const egressRows = await rawAll(sql`SELECT * FROM ai_usage_egress WHERE request_id = ${id}`);
  const steps: UsageStepRow[] = stepRows.map((s) => {
    const detail = jsonObject(s.detail);
    const queries = jsonArray(detail.queries).filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object" && !Array.isArray(q));
    return {
      id: str(s.id),
      seq: toNumber(s.seq),
      kind: s.kind === "tool" ? "tool" : "llm",
      agentPath: strOrNull(s.agent_path),
      name: str(s.name),
      modelConfigId: strOrNull(s.model_config_id),
      providerType: strOrNull(s.provider_type),
      modelId: strOrNull(s.model_id),
      startedAt: toNumber(s.started_at),
      durationMs: toNumber(s.duration_ms),
      status: str(s.status),
      usageReported: toNumber(s.usage_reported) === 1,
      inputTokens: toNumber(s.input_tokens),
      outputTokens: toNumber(s.output_tokens),
      cacheReadTokens: toNumber(s.cache_read_tokens),
      cacheWriteTokens: toNumber(s.cache_write_tokens),
      costUsd: numOrNull(s.cost_usd),
      chQueries: toNumber(s.ch_queries),
      chReadRows: toNumber(s.ch_read_rows),
      chReadBytes: toNumber(s.ch_read_bytes),
      resultBytes: toNumber(s.result_bytes),
      queries,
      calls: Array.isArray(detail.calls)
        ? detail.calls.flatMap((c): Array<{ tool: string; agent?: string }> => {
          if (!c || typeof c !== "object" || typeof (c as { tool?: unknown }).tool !== "string") return [];
          const { tool, agent } = c as { tool: string; agent?: unknown };
          return [typeof agent === "string" ? { tool, agent } : { tool }];
        })
        : null,
      error: typeof detail.error === "string" ? detail.error : null,
    };
  });
  const egress: UsageEgressRow[] = egressRows.map((e) => ({
    stepId: str(e.step_id),
    kind: egressKind(e.kind),
    source: str(e.source),
    columns: jsonArray(e.columns).filter((c): c is string => typeof c === "string"),
    rows: toNumber(e.row_count),
    bytes: toNumber(e.bytes),
    connectionId: strOrNull(e.connection_id),
    providerType: strOrNull(e.provider_type),
    modelId: strOrNull(e.model_id),
  }));
  const connectionIds = new Set<string>();
  if (row.connection_id) connectionIds.add(str(row.connection_id));
  for (const step of steps) for (const q of step.queries) if (typeof q.connectionId === "string") connectionIds.add(q.connectionId);
  for (const e of egress) if (e.connectionId) connectionIds.add(e.connectionId);
  const connections: Record<string, string> = {};
  if (connectionIds.size > 0) {
    const names = await rawAll(sql`
      SELECT id, name FROM rbac_clickhouse_connections WHERE id IN (${sql.join([...connectionIds].map((c) => sql`${c}`), sql`, `)})`);
    for (const n of names) connections[str(n.id)] = str(n.name);
  }
  return { request: requestRow(row), steps, egress, connections };
}
