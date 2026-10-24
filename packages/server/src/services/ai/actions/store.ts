/**
 * Approved actions (ADR 0024 §Phase 2): every write an agent asked for, and
 * what became of it.
 *
 * - `chat` actions belong to a paused chat run; the user decides in the chat,
 *   and the run itself executes the tool once approved.
 * - `background` actions come from runs with no person in the loop (features,
 *   auto-triage). Someone with `ai:act` approves them in AI Governance ›
 *   Approvals, and the approval executes them as that person.
 */

import { randomUUID } from "crypto";

import { all, json, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../observe/db";

export const ACTION_STATUSES = ["pending", "approved", "rejected", "expired", "executed", "failed"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionSource = "chat" | "background";

/** How long a pending action waits: a person in a chat answers quickly, a queue less so. */
export const CHAT_APPROVAL_TTL_MS = 15 * 60_000;
export const BACKGROUND_APPROVAL_TTL_MS = 24 * 60 * 60_000;

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
}

function rowToAction(r: Row): AiAction {
  const status = str(r.status);
  return {
    id: str(r.id),
    source: str(r.source) === "background" ? "background" : "chat",
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
}

export async function createAction(input: NewAction): Promise<AiAction> {
  const now = Date.now();
  const id = randomUUID();
  const expiresAt = input.expiresAt ?? now + (input.source === "chat" ? CHAT_APPROVAL_TTL_MS : BACKGROUND_APPROVAL_TTL_MS);
  await run(sql`
    INSERT INTO ai_actions (id, source, run_id, interrupt_id, thread_id, user_id, connection_id, agent_path, tool, args, description, status, expires_at, created_at, updated_at)
    VALUES (${id}, ${input.source}, ${input.runId ?? null}, ${input.interruptId ?? null}, ${input.threadId ?? null}, ${input.userId}, ${input.connectionId ?? null},
      ${input.agentPath ?? null}, ${input.tool}, ${JSON.stringify(input.args)}, ${input.description}, 'pending', ${expiresAt}, ${now}, ${now})`);
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
  limit?: number;
}

export async function listActions(filter: ActionFilter): Promise<AiAction[]> {
  const conditions = [sql`1 = 1`];
  if (filter.status) conditions.push(sql`status = ${filter.status}`);
  if (filter.userId) conditions.push(sql`user_id = ${filter.userId}`);
  if (filter.source) conditions.push(sql`source = ${filter.source}`);
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
  return claimed ? getAction(id) : null;
}

/** Record what an approved action did. */
export async function finishAction(id: string, outcome: { result?: unknown; error?: string }): Promise<void> {
  const status: ActionStatus = outcome.error ? "failed" : "executed";
  await run(sql`
    UPDATE ai_actions SET status = ${status}, result = ${outcome.result === undefined ? null : JSON.stringify(outcome.result)},
      error = ${outcome.error ?? null}, updated_at = ${Date.now()}
    WHERE id = ${id}`);
}

/** The approved, not yet executed action of a run for this tool (the run executes it once resumed). */
export async function approvedActionForRun(runId: string, tool: string): Promise<AiAction | null> {
  const row = await one(sql`SELECT * FROM ai_actions WHERE run_id = ${runId} AND tool = ${tool} AND status = 'approved' ORDER BY decided_at LIMIT 1`);
  return row ? rowToAction(row) : null;
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

export async function pendingCount(userId: string | null, includeBackground: boolean): Promise<number> {
  const now = Date.now();
  const scope = includeBackground
    ? (userId ? sql`(user_id = ${userId} OR source = 'background')` : sql`1 = 1`)
    : sql`user_id = ${userId}`;
  const row = await one(sql`SELECT COUNT(*) AS n FROM ai_actions WHERE status = 'pending' AND expires_at > ${now} AND ${scope}`);
  return num(row?.n);
}
