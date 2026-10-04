/**
 * Agent governance store (ADR 0016 §10): sessions, tool calls, policies and
 * the global pause switch.
 *
 * MCP runs stateless here, so a "session" is derived: consecutive calls from
 * the same personal access token with less than 30 minutes between them.
 */

import { randomUUID } from "crypto";

import { z } from "zod";

import { all, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../observe/db";
import { DEFAULT_AGENT_POLICY, type AgentPolicy, type IncidentMode } from "./budget";

export const SESSION_GAP_MS = 30 * 60 * 1000;
const PAUSE_KEY = "agent_access_paused";

export type AgentSource = "mcp" | "pat";

export interface AgentSession {
  id: string;
  patId: string | null;
  userId: string | null;
  clientName: string | null;
  source: AgentSource;
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

function sessionRow(r: Row): AgentSession {
  return {
    id: str(r.id),
    patId: strOrNull(r.pat_id),
    userId: strOrNull(r.user_id),
    clientName: strOrNull(r.client_name),
    source: str(r.source) === "mcp" ? "mcp" : "pat",
    startedAt: num(r.started_at),
    lastSeenAt: num(r.last_seen_at),
    queries: num(r.queries),
    readBytes: num(r.read_bytes),
    warnings: num(r.warnings),
    blocked: num(r.blocked),
  };
}

/** The current session for a PAT, or a new one after a 30-minute gap. */
export async function touchSession(patId: string | null, userId: string | null, source: AgentSource, clientName: string | null, nowMs = Date.now()): Promise<AgentSession> {
  const key = patId ?? `user:${userId ?? "unknown"}`;
  const latest = await one(sql`
    SELECT * FROM agent_sessions WHERE (pat_id = ${patId} OR (pat_id IS NULL AND user_id = ${userId})) AND source = ${source}
    ORDER BY last_seen_at DESC LIMIT 1`);
  if (latest && nowMs - num(latest.last_seen_at) < SESSION_GAP_MS) {
    await run(sql`UPDATE agent_sessions SET last_seen_at = ${nowMs}, client_name = COALESCE(${clientName}, client_name) WHERE id = ${str(latest.id)}`);
    return { ...sessionRow(latest), lastSeenAt: nowMs };
  }
  const id = `${key.slice(0, 40)}:${nowMs}`;
  await run(sql`
    INSERT INTO agent_sessions (id, pat_id, user_id, client_name, source, started_at, last_seen_at) VALUES (${id}, ${patId}, ${userId}, ${clientName}, ${source}, ${nowMs}, ${nowMs})
    ON CONFLICT (id) DO NOTHING
  `);
  return { id, patId, userId, clientName, source, startedAt: nowMs, lastSeenAt: nowMs, queries: 0, readBytes: 0, warnings: 0, blocked: 0 };
}

export async function recordToolCall(input: {
  sessionId: string;
  patId: string | null;
  userId: string | null;
  tool: string;
  argsSummary?: string | null;
  outcome: AgentToolCall["outcome"];
  /** A ClickHouse query (counted on the session) rather than another tool call. */
  isQuery?: boolean;
  detail?: Record<string, unknown>;
  readBytes?: number;
}): Promise<void> {
  const now = Date.now();
  await run(sql`
    INSERT INTO agent_tool_calls (id, session_id, pat_id, user_id, tool, args_summary, outcome, detail, read_bytes, created_at)
    VALUES (${randomUUID()}, ${input.sessionId}, ${input.patId}, ${input.userId}, ${input.tool}, ${input.argsSummary?.slice(0, 1000) ?? null}, ${input.outcome}, ${JSON.stringify(input.detail ?? {})}, ${input.readBytes ?? 0}, ${now})
  `);
  const queries = input.isQuery ? 1 : 0;
  await run(sql`
    UPDATE agent_sessions SET last_seen_at = ${now}, queries = queries + ${queries}, read_bytes = read_bytes + ${input.readBytes ?? 0},
      warnings = warnings + ${input.outcome === "warned" ? 1 : 0}, blocked = blocked + ${input.outcome === "blocked" ? 1 : 0}
    WHERE id = ${input.sessionId}
  `);
}

export async function listSessions(sinceMs: number, limit = 200): Promise<AgentSession[]> {
  return (await all(sql`SELECT * FROM agent_sessions WHERE last_seen_at >= ${sinceMs} ORDER BY last_seen_at DESC LIMIT ${limit}`)).map(sessionRow);
}

export async function getSession(id: string): Promise<AgentSession | null> {
  const row = await one(sql`SELECT * FROM agent_sessions WHERE id = ${id}`);
  return row ? sessionRow(row) : null;
}

export async function listToolCalls(sessionId: string, limit = 500): Promise<AgentToolCall[]> {
  return (await all(sql`SELECT * FROM agent_tool_calls WHERE session_id = ${sessionId} ORDER BY created_at LIMIT ${limit}`)).map((r) => ({
    id: str(r.id),
    sessionId: str(r.session_id),
    tool: str(r.tool),
    argsSummary: strOrNull(r.args_summary),
    outcome: str(r.outcome) as AgentToolCall["outcome"],
    detail: (() => { try { return JSON.parse(str(r.detail)) as Record<string, unknown>; } catch { return {}; } })(),
    readBytes: num(r.read_bytes),
    createdAt: num(r.created_at),
  }));
}

export async function bytesUsedToday(patId: string | null, userId: string | null, nowMs = Date.now()): Promise<number> {
  const dayStart = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const row = await one(sql`
    SELECT COALESCE(SUM(read_bytes), 0) AS bytes FROM agent_tool_calls
    WHERE created_at >= ${dayStart} AND ${patId ? sql`pat_id = ${patId}` : sql`pat_id IS NULL AND user_id = ${userId}`}`);
  return row ? num(row.bytes) : 0;
}

// --- policies ------------------------------------------------------------------

export const policyInputSchema = z.object({
  scopeKind: z.enum(["default", "pat", "role"]),
  scopeId: z.string().min(1).max(100),
  maxBytesPerQuery: z.number().positive().nullable(),
  dailyBytes: z.number().positive().nullable(),
  partitionFilterBytes: z.number().positive().nullable(),
  incidentMode: z.enum(["off", "warn", "block"]),
  alertMultiplier: z.number().min(1).max(1000).nullable(),
});
export type PolicyInput = z.infer<typeof policyInputSchema>;

export interface StoredPolicy extends PolicyInput {
  id: string;
  updatedBy: string | null;
  updatedAt: number;
}

function policyRow(r: Row): StoredPolicy {
  return {
    id: str(r.id),
    scopeKind: str(r.scope_kind) as PolicyInput["scopeKind"],
    scopeId: str(r.scope_id),
    maxBytesPerQuery: numOrNull(r.max_bytes_per_query),
    dailyBytes: numOrNull(r.daily_bytes),
    partitionFilterBytes: numOrNull(r.partition_filter_bytes),
    incidentMode: (str(r.incident_mode) || "warn") as IncidentMode,
    alertMultiplier: numOrNull(r.alert_multiplier),
    updatedBy: strOrNull(r.updated_by),
    updatedAt: num(r.updated_at),
  };
}

export async function listPolicies(): Promise<StoredPolicy[]> {
  return (await all(sql`SELECT * FROM agent_policies ORDER BY scope_kind, scope_id`)).map(policyRow);
}

export async function upsertPolicy(input: PolicyInput, actorId: string | null): Promise<StoredPolicy> {
  const p = policyInputSchema.parse(input);
  const now = Date.now();
  await run(sql`
    INSERT INTO agent_policies (id, scope_kind, scope_id, max_bytes_per_query, daily_bytes, partition_filter_bytes, incident_mode, alert_multiplier, updated_by, updated_at)
    VALUES (${randomUUID()}, ${p.scopeKind}, ${p.scopeId}, ${p.maxBytesPerQuery}, ${p.dailyBytes}, ${p.partitionFilterBytes}, ${p.incidentMode}, ${p.alertMultiplier}, ${actorId}, ${now})
    ON CONFLICT (scope_kind, scope_id) DO UPDATE SET max_bytes_per_query = ${p.maxBytesPerQuery}, daily_bytes = ${p.dailyBytes},
      partition_filter_bytes = ${p.partitionFilterBytes}, incident_mode = ${p.incidentMode}, alert_multiplier = ${p.alertMultiplier}, updated_by = ${actorId}, updated_at = ${now}
  `);
  const row = await one(sql`SELECT * FROM agent_policies WHERE scope_kind = ${p.scopeKind} AND scope_id = ${p.scopeId}`);
  return policyRow(row!);
}

export async function deletePolicy(id: string): Promise<void> {
  await run(sql`DELETE FROM agent_policies WHERE id = ${id}`);
}

/** Most specific policy wins: PAT, then the strictest of the user's roles, then the default. */
export async function effectivePolicy(patId: string | null, roles: string[]): Promise<AgentPolicy> {
  const all_ = await listPolicies();
  const pat = patId ? all_.find((p) => p.scopeKind === "pat" && p.scopeId === patId) : undefined;
  if (pat) return toPolicy(pat);
  const roleMatches = all_.filter((p) => p.scopeKind === "role" && roles.includes(p.scopeId));
  if (roleMatches.length > 0) {
    const min = (values: Array<number | null>): number | null => {
      const set = values.filter((v): v is number => v !== null);
      return set.length > 0 ? Math.min(...set) : null;
    };
    const modes: IncidentMode[] = roleMatches.map((p) => p.incidentMode);
    return {
      maxBytesPerQuery: min(roleMatches.map((p) => p.maxBytesPerQuery)),
      dailyBytes: min(roleMatches.map((p) => p.dailyBytes)),
      partitionFilterBytes: min(roleMatches.map((p) => p.partitionFilterBytes)),
      incidentMode: modes.includes("block") ? "block" : modes.includes("warn") ? "warn" : "off",
    };
  }
  const fallback = all_.find((p) => p.scopeKind === "default");
  return fallback ? toPolicy(fallback) : DEFAULT_AGENT_POLICY;
}

function toPolicy(p: StoredPolicy): AgentPolicy {
  return { maxBytesPerQuery: p.maxBytesPerQuery, dailyBytes: p.dailyBytes, partitionFilterBytes: p.partitionFilterBytes, incidentMode: p.incidentMode };
}

// --- pause switch ---------------------------------------------------------------

export async function isAgentAccessPaused(): Promise<boolean> {
  const row = await one(sql`SELECT value FROM obs_settings WHERE setting_key = ${PAUSE_KEY}`);
  return row ? str(row.value) === "true" : false;
}

export async function setAgentAccessPaused(paused: boolean, actorId: string | null): Promise<void> {
  const now = Date.now();
  await run(sql`
    INSERT INTO obs_settings (setting_key, value, updated_by, updated_at) VALUES (${PAUSE_KEY}, ${String(paused)}, ${actorId}, ${now})
    ON CONFLICT (setting_key) DO UPDATE SET value = ${String(paused)}, updated_by = ${actorId}, updated_at = ${now}
  `);
}
