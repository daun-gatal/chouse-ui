/**
 * Durable chat runs (ADR 0024 §Phase 1).
 *
 * A chat turn runs on the server independently of the HTTP request that
 * started it: closing the panel or refreshing does not stop it. Its steps are
 * written to `ai_chat_runs` as they happen, so any replica can report it; the
 * replica executing it also pushes every event to live listeners (SSE).
 *
 * Stop sets `cancel_requested`; the executing replica checks it on every
 * heartbeat and aborts. A run whose heartbeat is older than STALE_MS was left
 * behind by a replica that stopped, and is reported (and stored) as failed.
 *
 * Steps stream live; the answer is sent only once it is final, after the root
 * agent's output guardrails (D1).
 */

import { randomUUID } from "crypto";

import { AppError } from "../../../types";
import { logger } from "../../../utils/logger";
import { addMessage, getThread, updateThreadAgent } from "../../chatHistory";
import { all, json, num, one, run, sql, str, strOrNull, type Row } from "../../observe/db";
import { invokeChat, type ChatAttachment, type ChatInterrupt } from "../engine";
import type { ToolEvent } from "../registry/builder";
import type { AgentMessage, AgentRunContext } from "../types";
import { chatAnswer, stripScratchpad, type ChatAnswerToolCall } from "./chatOutput";
import { checkpointSaver } from "./checkpointer";
import { actionDefinition } from "../actions/definitions";
import { CHAT_APPROVAL_TTL_MS, createAction, expireActions, rejectRunActions } from "../actions/store";
import { resolveTier } from "../actions/tiers";
import { runActionContext } from "../actions/tools";
import type { Tier } from "../actions/types";

export const CHAT_RUN_STATUSES = ["running", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export type ChatRunStatus = (typeof CHAT_RUN_STATUSES)[number];

const HEARTBEAT_MS = 5_000;
export const STALE_MS = 2 * 60_000;
const PERSIST_DEBOUNCE_MS = 400;
/** Finished runs keep their buffered events briefly so a reconnect right after the end still gets them. */
const BUFFER_GRACE_MS = 60_000;

export interface ChatRunStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  agent?: string;
  status: "running" | "done" | "failed";
  summary: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface ChatRunAnswer {
  messageId: string | null;
  content: string;
  toolCalls: ChatAnswerToolCall[];
  chartSpecs: Array<Record<string, unknown>>;
  agent: { id: string; slug: string; name: string };
}

export interface PendingApproval extends ChatInterrupt {
  /** The recorded action (ADR 0024 §Phase 2): what the approval card decides. */
  actionId: string;
  /** The tool's title, for the approval card. */
  title: string;
  expiresAt: number;
  /** How the call is checked (ADR 0025); a plan of several calls shows the highest. */
  tier: Tier;
  /** The connection is marked production, which raised the tier. */
  production: boolean;
}

export interface ChatRun {
  id: string;
  threadId: string;
  userId: string;
  agentId: string | null;
  connectionId: string | null;
  status: ChatRunStatus;
  steps: ChatRunStep[];
  pending: PendingApproval[];
  result: ChatRunAnswer | null;
  error: string | null;
  cancelRequested: boolean;
  createdAt: number;
  updatedAt: number;
  /** Why the run failed, for the replica that ran it (not stored): the error's code and HTTP status. */
  failure?: { code: string; status: number };
}

export type ChatRunEvent =
  | { type: "run"; run: ChatRun }
  | { type: "step"; step: ChatRunStep }
  | { type: "status"; status: ChatRunStatus; pending: PendingApproval[] }
  | { type: "final"; result: ChatRunAnswer }
  | { type: "error"; message: string; code: string; status: ChatRunStatus };

// ============================================
// Store
// ============================================

function rowToRun(r: Row): ChatRun {
  const status = str(r.status);
  return {
    id: str(r.id),
    threadId: str(r.thread_id),
    userId: str(r.user_id),
    agentId: strOrNull(r.agent_id),
    connectionId: strOrNull(r.connection_id),
    status: (CHAT_RUN_STATUSES as readonly string[]).includes(status) ? (status as ChatRunStatus) : "failed",
    steps: json<ChatRunStep[]>(r.steps, []),
    pending: json<PendingApproval[]>(r.pending, []),
    result: json<ChatRunAnswer | null>(r.result, null),
    error: strOrNull(r.error),
    cancelRequested: num(r.cancel_requested) === 1,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/** A run as stored; one left `running` by a replica that stopped is marked failed here. */
export async function getChatRun(id: string): Promise<ChatRun | null> {
  const row = await one(sql`SELECT * FROM ai_chat_runs WHERE id = ${id}`);
  if (!row) return null;
  const found = rowToRun(row);
  if (found.status === "running" && !executing.has(found.id) && Date.now() - num(row.heartbeat_at) > STALE_MS) {
    const message = "The server running this reply stopped before it finished. Try again.";
    await run(sql`UPDATE ai_chat_runs SET status = 'failed', error = ${message}, updated_at = ${Date.now()} WHERE id = ${id} AND status = 'running'`);
    return { ...found, status: "failed", error: message };
  }
  return found;
}

/** The thread's newest run that is still going or waiting for approval, if any. */
export async function activeRunForThread(threadId: string): Promise<ChatRun | null> {
  const row = await one(sql`
    SELECT id FROM ai_chat_runs WHERE thread_id = ${threadId} AND status IN ('running', 'awaiting_approval')
    ORDER BY created_at DESC LIMIT 1`);
  if (!row) return null;
  const found = await getChatRun(str(row.id));
  return found && (found.status === "running" || found.status === "awaiting_approval") ? found : null;
}

async function insertRun(entry: ChatRun): Promise<void> {
  await run(sql`
    INSERT INTO ai_chat_runs (id, thread_id, user_id, agent_id, connection_id, status, steps, pending, result, error, cancel_requested, holder, heartbeat_at, created_at, updated_at)
    VALUES (${entry.id}, ${entry.threadId}, ${entry.userId}, ${entry.agentId}, ${entry.connectionId}, ${entry.status}, '[]', NULL, NULL, NULL, 0, ${HOLDER}, ${Date.now()}, ${entry.createdAt}, ${entry.updatedAt})`);
}

async function saveRun(entry: ChatRun): Promise<void> {
  entry.updatedAt = Date.now();
  await run(sql`
    UPDATE ai_chat_runs SET status = ${entry.status}, steps = ${JSON.stringify(entry.steps)},
      pending = ${entry.pending.length > 0 ? JSON.stringify(entry.pending) : null},
      result = ${entry.result ? JSON.stringify(entry.result) : null}, error = ${entry.error},
      heartbeat_at = ${Date.now()}, holder = ${HOLDER}, updated_at = ${entry.updatedAt}
    WHERE id = ${entry.id}`);
}

/** Delete runs (and their checkpoints) whose thread is gone. */
export async function pruneChatRuns(): Promise<number> {
  const orphans = await all(sql`
    SELECT r.id FROM ai_chat_runs r LEFT JOIN rbac_ai_chat_threads t ON t.id = r.thread_id WHERE t.id IS NULL`);
  for (const row of orphans) {
    const id = str(row.id);
    await checkpointSaver().deleteThread(id);
    await run(sql`DELETE FROM ai_chat_runs WHERE id = ${id}`);
  }
  return orphans.length;
}

// ============================================
// Live events (this replica only)
// ============================================

const HOLDER = `chat-runs:${randomUUID()}`;

interface LiveRun {
  controller: AbortController;
  events: ChatRunEvent[];
  listeners: Set<(event: ChatRunEvent) => void>;
}

const live = new Map<string, LiveRun>();
/** Runs this replica is executing right now (never reported stale). */
const executing = new Set<string>();

function emit(runId: string, event: ChatRunEvent): void {
  const entry = live.get(runId);
  if (!entry) return;
  entry.events.push(event);
  for (const listener of entry.listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.warn({ module: "ChatRuns", runId, err: error instanceof Error ? error.message : String(error) }, "Chat run listener failed");
    }
  }
}

/**
 * Follow a run on this replica: replays its events so far, then calls `listener`
 * for each new one. Returns null when this replica does not hold the run (the
 * caller then polls the stored row).
 */
export function subscribeChatRun(runId: string, listener: (event: ChatRunEvent) => void): { unsubscribe: () => void; replay: ChatRunEvent[] } | null {
  const entry = live.get(runId);
  if (!entry) return null;
  entry.listeners.add(listener);
  return { unsubscribe: () => entry.listeners.delete(listener), replay: [...entry.events] };
}

// ============================================
// Execution
// ============================================

export interface StartChatRunInput {
  userId: string;
  threadId: string;
  ctx: AgentRunContext;
  /** The conversation so far, ending with the user's new message. */
  messages: AgentMessage[];
  /** Agent picked for this turn: undefined keeps the thread's, null means the default agent. */
  agentId: string | null | undefined;
  /** The agent to run: the turn's pick, else the thread's (already resolved by the caller). */
  runAgentId: string | null;
  pinnedSkills?: string[];
  /** Files sent with the message, recorded as data sent to the provider. */
  attachments?: ChatAttachment[];
}

interface Execution {
  input: StartChatRunInput;
  resume?: Record<string, unknown>;
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function finalize(entry: ChatRun, input: StartChatRunInput, result: Awaited<ReturnType<typeof invokeChat>>): Promise<ChatRunAnswer> {
  const content = stripScratchpad(result.content);
  if (!content.trim()) throw AppError.internal("Chouse AI returned an empty response. Please try again.");
  const { toolCalls, chartSpecs } = chatAnswer(result.toolCalls, result.agent.slug);
  const saved = await addMessage(entry.threadId, "assistant", content, toolCalls.length > 0 ? toolCalls : undefined, chartSpecs.length > 0 ? chartSpecs : undefined);
  const thread = await getThread(entry.threadId, input.userId);
  if (input.agentId !== undefined && thread && input.agentId !== thread.agentId) {
    await updateThreadAgent(entry.threadId, input.userId, input.agentId);
  }
  return { messageId: saved?.id ?? null, content, toolCalls, chartSpecs, agent: result.agent };
}

/** Run (or resume) one turn to its end, a pause for approval, a stop or an error. */
async function execute(entry: ChatRun, { input, resume }: Execution): Promise<ChatRun> {
  const controller = new AbortController();
  const liveRun: LiveRun = live.get(entry.id) ?? { controller, events: [], listeners: new Set() };
  liveRun.controller = controller;
  live.set(entry.id, liveRun);
  executing.add(entry.id);

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persistSoon = (): void => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      saveRun(entry).catch((error: unknown) => logger.warn({ module: "ChatRuns", runId: entry.id, err: error instanceof Error ? error.message : String(error) }, "Could not save run steps"));
    }, PERSIST_DEBOUNCE_MS);
  };
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        const row = await one(sql`SELECT cancel_requested FROM ai_chat_runs WHERE id = ${entry.id}`);
        if (row && num(row.cancel_requested) === 1) controller.abort();
        await run(sql`UPDATE ai_chat_runs SET heartbeat_at = ${Date.now()} WHERE id = ${entry.id}`);
      } catch (error) {
        logger.warn({ module: "ChatRuns", runId: entry.id, err: error instanceof Error ? error.message : String(error) }, "Chat run heartbeat failed");
      }
    })();
  }, HEARTBEAT_MS);

  const onToolEvent = (event: ToolEvent): void => {
    if (event.type === "tool_start") {
      const step: ChatRunStep = { id: event.id, name: event.name, args: event.args, ...(event.agent ? { agent: event.agent } : {}), status: "running", summary: null, startedAt: Date.now(), endedAt: null };
      entry.steps.push(step);
      // Events are replayed later, so each carries a copy, not the step that keeps changing.
      emit(entry.id, { type: "step", step: { ...step } });
    } else {
      const step = entry.steps.find((s) => s.id === event.id);
      if (!step) return;
      step.status = event.ok ? "done" : "failed";
      step.summary = event.summary;
      step.endedAt = Date.now();
      emit(entry.id, { type: "step", step: { ...step } });
    }
    persistSoon();
  };

  try {
    // A chat run has a person in the loop: write tools pause for their approval.
    const ctx = { ...input.ctx, actionMode: "approve" as const, runId: entry.id, threadId: entry.threadId };
    const result = await invokeChat(ctx, input.messages, {
      agentId: input.runAgentId,
      threadId: entry.threadId,
      signal: controller.signal,
      // Attachments and pinned skills belong to the turn's first step, not to a resume.
      run: { id: entry.id, resume, onToolEvent, ...(resume ? {} : { pinnedSkills: input.pinnedSkills, attachments: input.attachments }) },
    });
    if (result.interrupts.length > 0) {
      entry.status = "awaiting_approval";
      entry.pending = [];
      for (const interrupt of result.interrupts) {
        const definition = actionDefinition(interrupt.name);
        const resolved = definition
          ? await resolveTier(definition, interrupt.args, runActionContext(ctx)).catch(() => ({ tier: "t2" as Tier, production: false }))
          : { tier: "t2" as Tier, production: false };
        const action = await createAction({
          source: "chat",
          runId: entry.id,
          interruptId: interrupt.id,
          toolCallId: interrupt.toolCallId || null,
          threadId: entry.threadId,
          userId: entry.userId,
          connectionId: entry.connectionId,
          tool: interrupt.name,
          args: interrupt.args,
          description: interrupt.description || interrupt.name,
          expiresAt: Date.now() + APPROVAL_TTL_MS,
          tier: resolved.tier,
          origin: "chat",
        });
        entry.pending.push({
          ...interrupt,
          actionId: action.id,
          title: definition?.title ?? interrupt.name,
          expiresAt: action.expiresAt,
          tier: resolved.tier,
          production: resolved.production,
        });
      }
      await saveRun(entry);
      emit(entry.id, { type: "status", status: entry.status, pending: entry.pending });
      return entry;
    }
    entry.result = await finalize(entry, input, result);
    entry.status = "completed";
    entry.pending = [];
    await saveRun(entry);
    emit(entry.id, { type: "final", result: entry.result });
    await checkpointSaver().deleteThread(entry.id);
    return entry;
  } catch (error) {
    const cancelled = isAbort(error, controller.signal) && (entry.cancelRequested || await cancelWasRequested(entry.id));
    entry.status = cancelled ? "cancelled" : "failed";
    entry.error = cancelled ? "Stopped." : error instanceof Error ? error.message : String(error);
    entry.pending = [];
    await saveRun(entry);
    const code = cancelled ? "CANCELLED" : error instanceof AppError ? error.code : "AI_CHAT_ERROR";
    entry.failure = { code, status: cancelled ? 499 : error instanceof AppError ? error.statusCode : 500 };
    emit(entry.id, { type: "error", message: entry.error, code, status: entry.status });
    if (!cancelled) logger.warn({ module: "ChatRuns", runId: entry.id, err: entry.error }, "Chat run failed");
    await checkpointSaver().deleteThread(entry.id);
    return entry;
  } finally {
    clearInterval(heartbeat);
    if (persistTimer) clearTimeout(persistTimer);
    executing.delete(entry.id);
    // Keep the buffer briefly for a reconnect, then drop it.
    setTimeout(() => {
      if (!executing.has(entry.id)) live.delete(entry.id);
    }, BUFFER_GRACE_MS).unref?.();
  }
}

async function cancelWasRequested(runId: string): Promise<boolean> {
  const row = await one(sql`SELECT cancel_requested FROM ai_chat_runs WHERE id = ${runId}`);
  return row !== null && num(row.cancel_requested) === 1;
}

/** Pending approvals in chat expire (ADR 0024 §Phase 2). */
export const APPROVAL_TTL_MS = CHAT_APPROVAL_TTL_MS;

const EXPIRED_MESSAGE = "The approval expired, so this reply stopped. Ask again to continue.";

/**
 * End runs whose approval expired: the action is marked expired and the run
 * stops (its checkpoints go). Safe on every replica — each step is conditional.
 */
export async function expireStaleApprovals(now: number = Date.now()): Promise<number> {
  const runIds = await expireActions(now);
  let ended = 0;
  for (const runId of runIds) {
    const row = await one(sql`UPDATE ai_chat_runs SET status = 'cancelled', error = ${EXPIRED_MESSAGE}, pending = NULL, updated_at = ${now}
      WHERE id = ${runId} AND status = 'awaiting_approval' RETURNING id`);
    if (!row) continue;
    ended += 1;
    paused.delete(runId);
    await rejectRunActions(runId, null);
    await checkpointSaver().deleteThread(runId);
    emit(runId, { type: "error", message: EXPIRED_MESSAGE, code: "APPROVAL_EXPIRED", status: "cancelled" });
  }
  return ended;
}

let sweeper: ReturnType<typeof setInterval> | null = null;

/** Check for expired approvals every minute (started once at boot). */
export function startApprovalSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    expireStaleApprovals().catch((error: unknown) => logger.warn({ module: "ChatRuns", err: error instanceof Error ? error.message : String(error) }, "Approval sweep failed"));
  }, 60_000);
  sweeper.unref?.();
}

/** The inputs a paused run needs to resume, kept by the replica that paused it. */
const paused = new Map<string, StartChatRunInput>();

/**
 * Start a turn. Returns the stored run at once; `done` settles when the run
 * finishes, pauses or fails (the one-shot /invoke route awaits it).
 */
export async function startChatRun(input: StartChatRunInput): Promise<{ run: ChatRun; done: Promise<ChatRun> }> {
  const active = await activeRunForThread(input.threadId);
  if (active) throw AppError.conflict("This chat is still answering. Wait for it, or stop it, before sending another message.");
  const now = Date.now();
  const entry: ChatRun = {
    id: randomUUID(),
    threadId: input.threadId,
    userId: input.userId,
    agentId: input.runAgentId,
    connectionId: input.ctx.connectionId ?? null,
    status: "running",
    steps: [],
    pending: [],
    result: null,
    error: null,
    cancelRequested: false,
    createdAt: now,
    updatedAt: now,
  };
  await insertRun(entry);
  live.set(entry.id, { controller: new AbortController(), events: [{ type: "run", run: { ...entry } }], listeners: new Set() });
  const done = execute(entry, { input }).then((finished) => {
    if (finished.status === "awaiting_approval") paused.set(finished.id, input);
    return finished;
  });
  return { run: { ...entry }, done };
}

/**
 * Resume a paused run with the user's decisions (Phase 2). `ctx` is the
 * approving request's context, so the run continues with fresh credentials.
 */
export async function resumeChatRun(runId: string, userId: string, ctx: AgentRunContext, decisions: Record<string, unknown>, rebuild: (run: ChatRun) => Promise<StartChatRunInput>): Promise<{ run: ChatRun; done: Promise<ChatRun> }> {
  const entry = await getChatRun(runId);
  if (!entry || entry.userId !== userId) throw AppError.notFound("Chat run not found");
  if (entry.status !== "awaiting_approval") throw AppError.conflict("This reply is not waiting for an approval.");
  const claimed = await one(sql`
    UPDATE ai_chat_runs SET status = 'running', heartbeat_at = ${Date.now()}, holder = ${HOLDER}, updated_at = ${Date.now()}
    WHERE id = ${runId} AND status = 'awaiting_approval' RETURNING id`);
  if (!claimed) throw AppError.conflict("Someone already answered this approval.");
  const input = { ...(paused.get(runId) ?? await rebuild(entry)), ctx };
  paused.delete(runId);
  entry.status = "running";
  entry.pending = [];
  // A follower of the resumed run starts from its current state, not from the pause it already answered.
  const liveRun = live.get(runId);
  const events: ChatRunEvent[] = [{ type: "run", run: { ...entry, steps: entry.steps.map((s) => ({ ...s })) } }];
  if (liveRun) liveRun.events = events;
  else live.set(runId, { controller: new AbortController(), events, listeners: new Set() });
  emit(runId, { type: "status", status: "running", pending: [] });
  const done = execute(entry, { input, resume: decisions }).then((finished) => {
    if (finished.status === "awaiting_approval") paused.set(finished.id, input);
    return finished;
  });
  return { run: { ...entry }, done };
}

/** Ask a run to stop. The replica executing it aborts at its next heartbeat (at once when it is this one). */
export async function cancelChatRun(runId: string, userId: string): Promise<ChatRun> {
  const entry = await getChatRun(runId);
  if (!entry || entry.userId !== userId) throw AppError.notFound("Chat run not found");
  if (entry.status === "awaiting_approval") {
    entry.status = "cancelled";
    entry.error = "Stopped.";
    entry.pending = [];
    await rejectRunActions(runId, userId);
    await run(sql`UPDATE ai_chat_runs SET cancel_requested = 1 WHERE id = ${runId}`);
    await saveRun(entry);
    await checkpointSaver().deleteThread(runId);
    paused.delete(runId);
    emit(runId, { type: "error", message: entry.error, code: "CANCELLED", status: entry.status });
    return entry;
  }
  if (entry.status !== "running") return entry;
  entry.cancelRequested = true;
  await run(sql`UPDATE ai_chat_runs SET cancel_requested = 1, updated_at = ${Date.now()} WHERE id = ${runId}`);
  live.get(runId)?.controller.abort();
  return entry;
}
