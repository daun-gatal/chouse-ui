/**
 * AI actions (ADR 0024 §Phase 2, ADR 0025): every write an agent asked for or
 * made, and what became of it.
 *
 * - `chat` actions belong to a paused chat run; the user decides in the chat,
 *   and the run itself executes the tool once approved. T1 writes a chat run
 *   made at once are recorded as `chat` too, already executed.
 * - `background` actions wait in the approval queue: proposals from runs with
 *   no person in the loop (approved by someone with `ai:act`) and T3 calls
 *   (approved by a second person who holds the tool's permission). The
 *   approval executes them as the approver.
 * - `held` actions are MCP calls waiting for their own user's confirmation in
 *   CHouse. The approval only records the decision: the MCP request (or a
 *   later `get_action_status`) executes them with the caller's token, so a
 *   token never does more than its scopes allow.
 */

import { randomUUID } from "crypto";

import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../observe/db";
import { isTier, type ActionOrigin, type Tier, type UndoRecord } from "./types";

export const ACTION_STATUSES = ["pending", "approved", "rejected", "expired", "running", "executed", "failed"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_SOURCES = ["chat", "background", "held"] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

/** How long a pending action waits: a person in a chat answers quickly, a queue less so. */
export const CHAT_APPROVAL_TTL_MS = 15 * 60_000;
export const BACKGROUND_APPROVAL_TTL_MS = 24 * 60 * 60_000;
/** How long a T1 action can be undone (ADR 0025 §1). */
export const UNDO_TTL_MS = 24 * 60 * 60_000;

export interface AiAction {
  id: string;
  source: ActionSource;
  runId: string | null;
  interruptId: string | null;
  threadId: string | null;
  /** Who the action is for: the chatting user, or the user a background run ran as. */
  userId: string;
  connectionId: string | null;
  agentPath: string | null;
  tool: string;
  args: Record<string, unknown>;
  /** What will happen, in words — what the approver reads. */
  description: string;
  status: ActionStatus;
  result: unknown;
  error: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  /** The call's tier (null for actions recorded before tiers). */
  tier: Tier | null;
  origin: ActionOrigin;
  /** The personal access token an MCP or CLI call came with. */
  tokenId: string | null;
  undo: UndoRecord | null;
  undoExpiresAt: number | null;
  undoneAt: number | null;
  undoneBy: string | null;
}

function sourceOf(value: string): ActionSource {
  return value === "background" || value === "held" ? value : "chat";
}

function originOf(value: string | null, source: ActionSource): ActionOrigin {
  if (value === "chat" || value === "mcp" || value === "cli" || value === "background") return value;
  return source === "background" ? "background" : "chat";
}

function rowToAction(r: Row): AiAction {
  const status = str(r.status);
  const source = sourceOf(str(r.source));
  const tier = strOrNull(r.tier);
  return {
    id: str(r.id),
    source,
    runId: strOrNull(r.run_id),
    interruptId: strOrNull(r.interrupt_id),
    threadId: strOrNull(r.thread_id),
    userId: str(r.user_id),
    connectionId: strOrNull(r.connection_id),
    agentPath: strOrNull(r.agent_path),
    tool: str(r.tool),
    args: json<Record<string, unknown>>(r.args, {}),
    description: str(r.description),
    status: (ACTION_STATUSES as readonly string[]).includes(status) ? (status as ActionStatus) : "failed",
    result: json<unknown>(r.result, null),
    error: strOrNull(r.error),
    decidedBy: strOrNull(r.decided_by),
    decidedAt: numOrNull(r.decided_at),
    expiresAt: num(r.expires_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    tier: isTier(tier) ? tier : null,
    origin: originOf(strOrNull(r.origin), source),
    tokenId: strOrNull(r.token_id),
    undo: json<UndoRecord | null>(r.undo, null),
    undoExpiresAt: numOrNull(r.undo_expires_at),
    undoneAt: numOrNull(r.undone_at),
    undoneBy: strOrNull(r.undone_by),
  };
}

export interface NewAction {
  source: ActionSource;
  runId?: string | null;
  interruptId?: string | null;
  threadId?: string | null;
  userId: string;
  connectionId?: string | null;
  agentPath?: string | null;
  tool: string;
  args: Record<string, unknown>;
  description: string;
  expiresAt?: number;
  tier?: Tier | null;
  origin?: ActionOrigin;
  tokenId?: string | null;
  toolCallId?: string | null;
  /** Record an action that already ran (a T1 call) instead of a pending one. */
  status?: "pending" | "running";
}

export async function createAction(input: NewAction): Promise<AiAction> {
  const now = Date.now();
  const id = randomUUID();
  const expiresAt = input.expiresAt ?? now + (input.source === "chat" ? CHAT_APPROVAL_TTL_MS : BACKGROUND_APPROVAL_TTL_MS);
  const origin = input.origin ?? (input.source === "background" ? "background" : "chat");
  await run(sql`
    INSERT INTO ai_actions (id, source, run_id, interrupt_id, thread_id, user_id, connection_id, agent_path, tool, args, description, status, expires_at, created_at, updated_at, tier, origin, token_id, tool_call_id)
    VALUES (${id}, ${input.source}, ${input.runId ?? null}, ${input.interruptId ?? null}, ${input.threadId ?? null}, ${input.userId}, ${input.connectionId ?? null},
      ${input.agentPath ?? null}, ${input.tool}, ${JSON.stringify(input.args)}, ${input.description}, ${input.status ?? "pending"}, ${expiresAt}, ${now}, ${now},
      ${input.tier ?? null}, ${origin}, ${input.tokenId ?? null}, ${input.toolCallId ?? null})`);
  const created = await getAction(id);
  if (!created) throw new Error("The action was not saved");
  return created;
}

export async function getAction(id: string): Promise<AiAction | null> {
  const row = await one(sql`SELECT * FROM ai_actions WHERE id = ${id}`);
  return row ? rowToAction(row) : null;
}

export async function actionsForRun(runId: string): Promise<AiAction[]> {
  return (await all(sql`SELECT * FROM ai_actions WHERE run_id = ${runId} ORDER BY created_at`)).map(rowToAction);
}

export interface ActionFilter {
  status?: ActionStatus;
  /** Only this user's own actions; null = everyone's. */
  userId: string | null;
  source?: ActionSource;
  runId?: string;
  limit?: number;
}

export async function listActions(filter: ActionFilter): Promise<AiAction[]> {
  const conditions = [sql`1 = 1`];
  if (filter.status) conditions.push(sql`status = ${filter.status}`);
  if (filter.userId) conditions.push(sql`user_id = ${filter.userId}`);
  if (filter.source) conditions.push(sql`source = ${filter.source}`);
  if (filter.runId) conditions.push(sql`run_id = ${filter.runId}`);
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  return (await all(sql`SELECT * FROM ai_actions WHERE ${sql.join(conditions, sql` AND `)} ORDER BY created_at DESC LIMIT ${limit}`)).map(rowToAction);
}

/** Display names for the people on a list of actions (who asked, who decided). */
export async function userNames(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await all(sql`SELECT id, username, display_name FROM rbac_users WHERE id IN (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`);
  return new Map(rows.map((r) => [str(r.id), strOrNull(r.display_name) || str(r.username)]));
}

/**
 * Decide a pending action. Conditional on it still being pending (and not
 * expired), so two people answering at once cannot both win.
 */
export async function decideAction(id: string, decision: "approved" | "rejected", decidedBy: string, args?: Record<string, unknown>): Promise<AiAction | null> {
  const now = Date.now();
  const claimed = await one(sql`
    UPDATE ai_actions SET status = ${decision}, decided_by = ${decidedBy}, decided_at = ${now}, updated_at = ${now}
      ${args ? sql`, args = ${JSON.stringify(args)}` : sql``}
    WHERE id = ${id} AND status = 'pending' AND expires_at > ${now} RETURNING id`);
  if (claimed) settleAlerts(id);
  return claimed ? getAction(id) : null;
}

/** A decided or finished action updates its Need You alerts at once (the sweep would within seconds). */
function settleAlerts(id: string): void {
  void import("../../chobi/needYou").then((m) => m.refreshActionMessages(id)).catch(() => undefined);
}

/** Record what an approved action did, with its undo when it can be undone. */
export async function finishAction(id: string, outcome: { result?: unknown; error?: string; undo?: UndoRecord | null }): Promise<void> {
  const status: ActionStatus = outcome.error ? "failed" : "executed";
  const now = Date.now();
  const undo = outcome.error ? null : outcome.undo ?? null;
  await run(sql`
    UPDATE ai_actions SET status = ${status}, result = ${outcome.result === undefined ? null : JSON.stringify(outcome.result)},
      error = ${outcome.error ?? null}, undo = ${undo ? JSON.stringify(undo) : null}, undo_expires_at = ${undo ? now + UNDO_TTL_MS : null},
      updated_at = ${now}
    WHERE id = ${id}`);
  settleAlerts(id);
}

/**
 * Claim an approved action for execution, so it runs exactly once even when
 * two requests (an MCP call and its get_action_status) race for it.
 */
export async function claimApprovedAction(id: string): Promise<AiAction | null> {
  const claimed = await one(sql`
    UPDATE ai_actions SET status = 'running', updated_at = ${Date.now()} WHERE id = ${id} AND status = 'approved' RETURNING id`);
  return claimed ? getAction(id) : null;
}

/** Claim an executed action's undo, so two undo clicks cannot both run. */
export async function claimUndo(id: string, userId: string, now: number = Date.now()): Promise<boolean> {
  const claimed = await one(sql`
    UPDATE ai_actions SET undone_at = ${now}, undone_by = ${userId}, updated_at = ${now}
    WHERE id = ${id} AND status = 'executed' AND undo IS NOT NULL AND undone_at IS NULL AND undo_expires_at > ${now} RETURNING id`);
  return Boolean(claimed);
}

/** Give an undo claim back when the undo itself failed. */
export async function releaseUndo(id: string): Promise<void> {
  await run(sql`UPDATE ai_actions SET undone_at = NULL, undone_by = NULL, updated_at = ${Date.now()} WHERE id = ${id}`);
}

/**
 * Whether the user already answered this paused tool call. A resumed run must
 * pause on it again so the recorded decision (and any edited arguments) is
 * the one that applies, whatever else changed since.
 */
export async function decisionRecordedFor(runId: string, toolCallId: string): Promise<boolean> {
  const row = await one(sql`
    SELECT 1 AS ok FROM ai_actions WHERE run_id = ${runId} AND tool_call_id = ${toolCallId} AND status IN ('approved', 'rejected') LIMIT 1`);
  return row !== null;
}

/**
 * Claim the run's next approved, not yet executed action for this tool (the
 * run executes it once resumed). Claiming, not reading, so two calls of the
 * same tool approved together each get their own row.
 */
export async function claimApprovedForRun(runId: string, tool: string): Promise<AiAction | null> {
  const candidates = await all(sql`SELECT id FROM ai_actions WHERE run_id = ${runId} AND tool = ${tool} AND status = 'approved' ORDER BY decided_at, created_at`);
  for (const candidate of candidates) {
    const claimed = await claimApprovedAction(str(candidate.id));
    if (claimed) return claimed;
  }
  return null;
}

/** Mark every pending action past its deadline as expired; returns the run ids they belonged to. */
export async function expireActions(now: number = Date.now()): Promise<string[]> {
  const due = await all(sql`SELECT id, run_id FROM ai_actions WHERE status = 'pending' AND expires_at <= ${now}`);
  if (due.length === 0) return [];
  await run(sql`UPDATE ai_actions SET status = 'expired', updated_at = ${now} WHERE status = 'pending' AND expires_at <= ${now}`);
  return [...new Set(due.map((r) => strOrNull(r.run_id)).filter((id): id is string => id !== null))];
}

/** Cancel a run's pending actions (the run was stopped). */
export async function rejectRunActions(runId: string, decidedBy: string | null): Promise<void> {
  const now = Date.now();
  await run(sql`UPDATE ai_actions SET status = 'rejected', decided_by = ${decidedBy}, decided_at = ${now}, updated_at = ${now} WHERE run_id = ${runId} AND status = 'pending'`);
}
