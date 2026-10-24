/**
 * Running and undoing AI actions (ADR 0025). Chat, MCP, the CLI and the
 * approval queue all execute through `performAction`, so every write is
 * recorded the same way: its tier, where it came from, what it returned, and
 * — for T1 calls that can be undone — a snapshot to undo it with.
 */

import { logger } from "../../../utils/logger";
import { RESOURCES } from "./resources";
import { CREATED_WRAPPERS } from "./toolkits/shared";
import { claimUndo, createAction, finishAction, getAction, releaseUndo, type AiAction, type ActionSource } from "./store";
import type { ActionApi, ActionContext, ActionDefinition, ActionOrigin, Tier, UndoRecord } from "./types";

/** A short, model-facing summary of what an action returned (never the whole object). */
export function outcome(result: unknown): unknown {
  if (!result || typeof result !== "object") return result ?? { ok: true };
  const record = result as Record<string, unknown>;
  const keep = ["id", "name", "title", "status", "message", "killed", "approvalClass", "approvalsNeeded", "deleted", "version"];
  const picked = Object.fromEntries(Object.entries(record).filter(([key]) => keep.includes(key)));
  if (Object.keys(picked).length > 0) return picked;
  // What the route created, when it wraps it (e.g. `{ promise }`).
  for (const key of CREATED_WRAPPERS) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = Object.fromEntries(Object.entries(nested as Record<string, unknown>).filter(([k]) => keep.includes(k)));
      if (Object.keys(inner).length > 0) return inner;
    }
  }
  return { ok: true };
}

export interface Actor {
  api: ActionApi;
  userId: string;
  connectionId: string | null;
  origin: ActionOrigin;
  tokenId?: string | null;
  runId?: string | null;
  threadId?: string | null;
  agentPath?: string | null;
}

function contextOf(actor: Actor): ActionContext {
  return { api: actor.api, connectionId: actor.connectionId, userId: actor.userId };
}

function sourceFor(origin: ActionOrigin): ActionSource {
  return origin === "background" ? "background" : "chat";
}

interface Prepared {
  before: Record<string, unknown> | null;
  id: string | null;
}

async function prepareUndo(definition: ActionDefinition, args: Record<string, unknown>, ctx: ActionContext): Promise<Prepared | null> {
  const spec = definition.undo;
  if (!spec || spec.mode === "delete-created") return null;
  const id = spec.id(args, ctx);
  if (!id) return null;
  try {
    return { id, before: await RESOURCES[spec.resource].read(ctx.api, id) };
  } catch (error) {
    // No snapshot means no undo, never a refused action.
    logger.warn({ module: "AiActions", tool: definition.name, err: error instanceof Error ? error.message : String(error) }, "Could not snapshot before an action; it will not be undoable");
    return null;
  }
}

async function finishUndo(definition: ActionDefinition, args: Record<string, unknown>, result: unknown, prepared: Prepared | null, ctx: ActionContext): Promise<UndoRecord | null> {
  const spec = definition.undo;
  if (!spec) return null;
  const adapter = RESOURCES[spec.resource];
  try {
    if (spec.mode === "delete-created") {
      const id = spec.id(result, args);
      if (!id) return null;
      const after = await adapter.read(ctx.api, id);
      return after ? { mode: spec.mode, resource: spec.resource, id, afterHash: adapter.fingerprint(after) } : null;
    }
    if (!prepared?.id) return null;
    if (spec.mode === "recreate-deleted") {
      return prepared.before ? { mode: spec.mode, resource: spec.resource, id: prepared.id, before: prepared.before } : null;
    }
    const after = await adapter.read(ctx.api, prepared.id);
    if (!after) return null;
    // An upsert that created the object is undone by deleting it.
    if (!prepared.before) return adapter.remove ? { mode: "delete-created", resource: spec.resource, id: prepared.id, afterHash: adapter.fingerprint(after) } : null;
    return { mode: spec.mode, resource: spec.resource, id: prepared.id, before: prepared.before, afterHash: adapter.fingerprint(after) };
  } catch (error) {
    logger.warn({ module: "AiActions", tool: definition.name, err: error instanceof Error ? error.message : String(error) }, "Could not snapshot after an action; it will not be undoable");
    return null;
  }
}

export interface Performed {
  action: AiAction;
  result: unknown;
}

/**
 * Execute an action as `actor` and record it. With `actionId` the action was
 * already recorded (approved in chat, or claimed from the queue); otherwise a
 * new, already-running row is written first. Throws the action's own error
 * after recording it as failed.
 */
export async function performAction(definition: ActionDefinition, args: Record<string, unknown>, actor: Actor, options: { tier: Tier; actionId?: string | null }): Promise<Performed> {
  const ctx = contextOf(actor);
  const id = options.actionId ?? (await createAction({
    source: sourceFor(actor.origin),
    status: "running",
    runId: actor.runId ?? null,
    threadId: actor.threadId ?? null,
    userId: actor.userId,
    connectionId: actor.connectionId,
    agentPath: actor.agentPath ?? null,
    tool: definition.name,
    args,
    description: definition.describe(args),
    tier: options.tier,
    origin: actor.origin,
    tokenId: actor.tokenId ?? null,
  })).id;
  const prepared = await prepareUndo(definition, args, ctx);
  let raw: unknown;
  try {
    raw = await definition.execute(args, ctx);
  } catch (error) {
    await finishAction(id, { error: error instanceof Error ? error.message : "The action failed" });
    throw error;
  }
  const undo = options.tier === "t1" ? await finishUndo(definition, args, raw, prepared, ctx) : null;
  const result = outcome(raw);
  await finishAction(id, { result, undo });
  const action = await getAction(id);
  if (!action) throw new Error("The action was not recorded");
  return { action, result };
}

/** Put a T3 call in the approval queue for a second person (ADR 0025 §3). */
export async function fileForApproval(definition: ActionDefinition, args: Record<string, unknown>, actor: Actor): Promise<AiAction> {
  return createAction({
    source: "background",
    runId: actor.runId ?? null,
    threadId: actor.threadId ?? null,
    userId: actor.userId,
    connectionId: actor.connectionId,
    agentPath: actor.agentPath ?? null,
    tool: definition.name,
    args,
    description: definition.describe(args),
    tier: "t3",
    origin: actor.origin,
    tokenId: actor.tokenId ?? null,
  });
}

export class UndoError extends Error {
  readonly code: "NOT_UNDOABLE" | "CHANGED_SINCE" | "GONE" | "ALREADY_UNDONE" | "EXPIRED";

  constructor(code: UndoError["code"], message: string) {
    super(message);
    this.name = "UndoError";
    this.code = code;
  }
}

/** Whether an action can still be undone (the activity feed's Undo button). */
export function undoAvailable(action: AiAction, now: number = Date.now()): boolean {
  return action.status === "executed" && action.undo !== null && action.undoneAt === null && (action.undoExpiresAt ?? 0) > now;
}

/**
 * Undo an executed T1 action as `userId`, through `api`. Refuses when the
 * object changed since the action (someone else's change is never
 * overwritten), when it is gone, or when the undo window passed.
 */
export async function undoAction(action: AiAction, userId: string, api: ActionApi): Promise<{ restoredId: string | null }> {
  if (action.userId !== userId) throw new UndoError("NOT_UNDOABLE", "Only the person the action ran for can undo it.");
  if (action.undoneAt !== null) throw new UndoError("ALREADY_UNDONE", "This action was already undone.");
  if (!action.undo || action.status !== "executed") throw new UndoError("NOT_UNDOABLE", "This action cannot be undone.");
  if ((action.undoExpiresAt ?? 0) <= Date.now()) throw new UndoError("EXPIRED", "The undo window for this action has passed (24 hours).");
  const undo = action.undo;
  const adapter = RESOURCES[undo.resource];
  const current = await adapter.read(api, undo.id);
  if (undo.mode !== "recreate-deleted") {
    if (!current) throw new UndoError("GONE", "It no longer exists, so there is nothing to undo.");
    if (undo.afterHash && adapter.fingerprint(current) !== undo.afterHash) {
      throw new UndoError("CHANGED_SINCE", "It changed after the assistant's action, so undo would overwrite that change. Change it by hand instead.");
    }
  } else if (current) {
    throw new UndoError("CHANGED_SINCE", "It exists again, so there is nothing to restore.");
  }
  if (!(await claimUndo(action.id, userId))) throw new UndoError("ALREADY_UNDONE", "This action was already undone, or its undo window passed.");
  try {
    if (undo.mode === "restore") {
      if (!adapter.restore || !undo.before) throw new UndoError("NOT_UNDOABLE", "This action cannot be undone.");
      await adapter.restore(api, undo.id, undo.before, current ?? {});
      return { restoredId: undo.id };
    }
    if (undo.mode === "delete-created") {
      if (!adapter.remove) throw new UndoError("NOT_UNDOABLE", "This action cannot be undone.");
      await adapter.remove(api, undo.id);
      return { restoredId: null };
    }
    if (!adapter.recreate || !undo.before) throw new UndoError("NOT_UNDOABLE", "This action cannot be undone.");
    return { restoredId: await adapter.recreate(api, undo.before) };
  } catch (error) {
    await releaseUndo(action.id);
    throw error;
  }
}
