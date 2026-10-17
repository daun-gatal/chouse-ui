/**
 * Reading guardrail triggers (ADR 0022 §4) for AI Governance › Guardrails, and
 * writing MCP triggers, which have no usage run to carry them.
 */

import { randomUUID } from "crypto";

import { all, num, run, sql, str, strOrNull } from "../../observe/db";
import type { GuardrailEvent } from "./types";

export interface StoredGuardrailEvent {
  id: string;
  createdAt: number;
  guardrailId: string;
  guardrailName: string;
  kind: string;
  stage: string;
  action: string;
  mode: string;
  matchCount: number;
  source: "agent" | "mcp";
  userId: string | null;
  requestId: string | null;
  agentPath: string | null;
  tool: string | null;
  reason: string | null;
}

export interface TriggerCount {
  total: number;
  /** Triggers that changed something (enforce mode). */
  applied: number;
  blocked: number;
}

/** Per-guardrail trigger counts since `since` (unix ms). */
export async function triggerCounts(since: number): Promise<Map<string, TriggerCount>> {
  const rows = await all(sql`
    SELECT guardrail_id,
      COUNT(*) AS total,
      SUM(CASE WHEN mode = 'enforce' THEN 1 ELSE 0 END) AS applied,
      SUM(CASE WHEN mode = 'enforce' AND action = 'block' THEN 1 ELSE 0 END) AS blocked
    FROM ai_guardrail_events WHERE created_at >= ${since} GROUP BY guardrail_id`);
  return new Map(rows.map((r) => [str(r.guardrail_id), { total: num(r.total), applied: num(r.applied), blocked: num(r.blocked) }]));
}

export async function guardrailEvents(filter: { since: number; guardrailId: string | null; limit: number }): Promise<StoredGuardrailEvent[]> {
  const rows = filter.guardrailId
    ? await all(sql`SELECT * FROM ai_guardrail_events WHERE created_at >= ${filter.since} AND guardrail_id = ${filter.guardrailId} ORDER BY created_at DESC LIMIT ${filter.limit}`)
    : await all(sql`SELECT * FROM ai_guardrail_events WHERE created_at >= ${filter.since} ORDER BY created_at DESC LIMIT ${filter.limit}`);
  return rows.map((r) => ({
    id: str(r.id),
    createdAt: num(r.created_at),
    guardrailId: str(r.guardrail_id),
    guardrailName: str(r.guardrail_name),
    kind: str(r.kind),
    stage: str(r.stage),
    action: str(r.action),
    mode: str(r.mode),
    matchCount: num(r.match_count),
    source: str(r.source) === "mcp" ? "mcp" : "agent",
    userId: strOrNull(r.user_id),
    requestId: strOrNull(r.request_id),
    agentPath: strOrNull(r.agent_path),
    tool: strOrNull(r.tool),
    reason: strOrNull(r.reason),
  }));
}

/** Write MCP triggers right away: an MCP call has no usage run. */
export async function writeMcpGuardrailEvents(events: GuardrailEvent[], userId: string | null): Promise<void> {
  const now = Date.now();
  for (const e of events) {
    await run(sql`
      INSERT INTO ai_guardrail_events (id, created_at, guardrail_id, guardrail_name, kind, stage, action, mode, match_count, source, user_id, request_id, step_id, agent_path, tool, reason)
      VALUES (${randomUUID()}, ${now}, ${e.guardrailId}, ${e.guardrailName}, ${e.kind}, ${e.stage}, ${e.action}, ${e.mode}, ${e.matchCount}, 'mcp', ${userId}, NULL, NULL, NULL, ${e.tool}, ${e.reason})`);
  }
}
