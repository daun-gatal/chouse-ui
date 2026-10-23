/**
 * AI memory (ADR 0024 §Phase 3): short notes agents keep.
 *
 * - `user` memories belong to one person (`owner_id`), are active at once and
 *   go with the user (foreign key cascade).
 * - `connection` memories are team knowledge about one ClickHouse connection.
 *   They start as proposals and become active once someone with
 *   `ai_memories:manage` approves them; they go with the connection.
 */

import { randomUUID } from "crypto";

import { AppError } from "../../../types";
import { all, num, numOrNull, one, run, sql, str, strOrNull, type Row } from "../../observe/db";

export const MEMORY_SCOPES = ["user", "connection"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export const MEMORY_STATUSES = ["active", "proposed", "rejected"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemorySource = "agent" | "person";

/** A note is a sentence or two, not a document. */
export const MEMORY_MAX_CHARS = 500;
/** Per person, and per connection: enough for preferences and conventions, small enough for every prompt. */
export const MEMORY_MAX_PER_OWNER = 100;

export interface AiMemory {
  id: string;
  scope: MemoryScope;
  ownerId: string | null;
  connectionId: string | null;
  content: string;
  status: MemoryStatus;
  source: MemorySource;
  agentSlug: string | null;
  threadId: string | null;
  /** Why a guardrail flagged a team proposal, for the reviewer. */
  flag: string | null;
  proposedBy: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function rowToMemory(r: Row): AiMemory {
  const status = str(r.status);
  return {
    id: str(r.id),
    scope: str(r.scope) === "connection" ? "connection" : "user",
    ownerId: strOrNull(r.owner_id),
    connectionId: strOrNull(r.connection_id),
    content: str(r.content),
    status: (MEMORY_STATUSES as readonly string[]).includes(status) ? (status as MemoryStatus) : "rejected",
    source: str(r.source) === "person" ? "person" : "agent",
    agentSlug: strOrNull(r.agent_slug),
    threadId: strOrNull(r.thread_id),
    flag: strOrNull(r.flag),
    proposedBy: strOrNull(r.proposed_by),
    decidedBy: strOrNull(r.decided_by),
    decidedAt: numOrNull(r.decided_at),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/** Same note, ignoring case and spacing: saving it twice keeps one. */
export function normalizeNote(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

function sameNote(a: string, b: string): boolean {
  return normalizeNote(a).toLowerCase() === normalizeNote(b).toLowerCase();
}

export interface NewMemory {
  scope: MemoryScope;
  /** Who it is about (user scope) or who proposed it (connection scope). */
  userId: string;
  connectionId: string | null;
  content: string;
  source: MemorySource;
  agentSlug?: string | null;
  threadId?: string | null;
  flag?: string | null;
  /** Connection memories an admin writes directly skip review. */
  status?: MemoryStatus;
}

export async function getMemory(id: string): Promise<AiMemory | null> {
  const row = await one(sql`SELECT * FROM ai_memories WHERE id = ${id}`);
  return row ? rowToMemory(row) : null;
}

export async function listUserMemories(userId: string): Promise<AiMemory[]> {
  return (await all(sql`SELECT * FROM ai_memories WHERE scope = 'user' AND owner_id = ${userId} ORDER BY created_at DESC`)).map(rowToMemory);
}

/** Team memories; `connectionId` null lists every connection (admins). */
export async function listConnectionMemories(filter: { connectionId: string | null; status?: MemoryStatus; proposedBy?: string }): Promise<AiMemory[]> {
  const conditions = [sql`scope = 'connection'`];
  if (filter.connectionId) conditions.push(sql`connection_id = ${filter.connectionId}`);
  if (filter.status) conditions.push(sql`status = ${filter.status}`);
  if (filter.proposedBy) conditions.push(sql`proposed_by = ${filter.proposedBy}`);
  return (await all(sql`SELECT * FROM ai_memories WHERE ${sql.join(conditions, sql` AND `)} ORDER BY created_at DESC LIMIT 500`)).map(rowToMemory);
}

export async function pendingMemoryCount(): Promise<number> {
  const row = await one(sql`SELECT COUNT(*) AS n FROM ai_memories WHERE scope = 'connection' AND status = 'proposed'`);
  return row ? num(row.n) : 0;
}

/**
 * Save a note. A note that matches one already kept (or proposed) returns
 * that one instead of a duplicate; past the per-owner cap it is refused.
 */
export async function createMemory(input: NewMemory): Promise<{ memory: AiMemory; duplicate: boolean }> {
  const content = normalizeNote(input.content).slice(0, MEMORY_MAX_CHARS);
  const existing = input.scope === "user"
    ? await listUserMemories(input.userId)
    : input.connectionId ? (await listConnectionMemories({ connectionId: input.connectionId })).filter((m) => m.status !== "rejected") : [];
  const same = existing.find((m) => sameNote(m.content, content));
  if (same) return { memory: same, duplicate: true };
  if (existing.length >= MEMORY_MAX_PER_OWNER) {
    throw AppError.conflict(input.scope === "user"
      ? `You already keep ${MEMORY_MAX_PER_OWNER} memories. Delete some in AI Governance › Memories first.`
      : `This connection already has ${MEMORY_MAX_PER_OWNER} team memories. An admin needs to remove some first.`);
  }
  const now = Date.now();
  const id = randomUUID();
  const status: MemoryStatus = input.status ?? (input.scope === "user" ? "active" : "proposed");
  await run(sql`
    INSERT INTO ai_memories (id, scope, owner_id, connection_id, content, status, source, agent_slug, thread_id, flag, proposed_by, decided_by, decided_at, created_at, updated_at)
    VALUES (${id}, ${input.scope}, ${input.scope === "user" ? input.userId : null}, ${input.connectionId}, ${content}, ${status}, ${input.source},
            ${input.agentSlug ?? null}, ${input.threadId ?? null}, ${input.flag ?? null}, ${input.userId},
            ${status === "active" && input.scope === "connection" ? input.userId : null}, ${status === "active" && input.scope === "connection" ? now : null}, ${now}, ${now})`);
  const memory = await getMemory(id);
  if (!memory) throw AppError.internal("The memory was not saved");
  return { memory, duplicate: false };
}

export async function updateMemoryContent(id: string, content: string, flag: string | null): Promise<AiMemory | null> {
  await run(sql`UPDATE ai_memories SET content = ${normalizeNote(content).slice(0, MEMORY_MAX_CHARS)}, flag = ${flag}, updated_at = ${Date.now()} WHERE id = ${id}`);
  return getMemory(id);
}

export async function deleteMemory(id: string): Promise<void> {
  await run(sql`DELETE FROM ai_memories WHERE id = ${id}`);
}

/** Approve or reject a team proposal; only one decision wins. */
export async function decideMemory(id: string, approve: boolean, decidedBy: string): Promise<AiMemory | null> {
  const now = Date.now();
  const claimed = await one(sql`
    UPDATE ai_memories SET status = ${approve ? "active" : "rejected"}, decided_by = ${decidedBy}, decided_at = ${now}, updated_at = ${now}
    WHERE id = ${id} AND scope = 'connection' AND status = 'proposed' RETURNING id`);
  return claimed ? getMemory(id) : null;
}

/** Whether the user lets agents read and keep their memories (on unless turned off). */
export async function memoryEnabled(userId: string): Promise<boolean> {
  const row = await one(sql`SELECT enabled FROM ai_memory_settings WHERE user_id = ${userId}`);
  return row ? num(row.enabled) === 1 : true;
}

export async function setMemoryEnabled(userId: string, enabled: boolean): Promise<void> {
  const now = Date.now();
  const value = enabled ? 1 : 0;
  await run(sql`
    INSERT INTO ai_memory_settings (user_id, enabled, updated_at) VALUES (${userId}, ${value}, ${now})
    ON CONFLICT (user_id) DO UPDATE SET enabled = ${value}, updated_at = ${now}`);
}
