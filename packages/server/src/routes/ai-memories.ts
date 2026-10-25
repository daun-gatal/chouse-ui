/**
 * AI memory (ADR 0024 §Phase 3), shown in AI Governance › Memories.
 *
 *   GET    /mine               your memories and whether memory is on for you
 *   PUT    /settings           turn memory on or off for yourself
 *   GET    /export             your memories as JSON
 *   GET    /team               team memories of the connections you can reach (all of them with ai_memories:manage)
 *   GET    /for-table          team memories that name one table (shown with its context)
 *   GET    /pending-count      team proposals waiting for review (ai_memories:manage)
 *   POST   /suggest            notes worth keeping from one of your conversations (never saves)
 *   POST   /                   add a memory (user: saved; connection: proposed, or saved by a manager)
 *   PUT    /:id                edit (yours; team ones with ai_memories:manage, or your own proposal)
 *   DELETE /:id                delete (same rule)
 *   POST   /:id/approve|reject review a team proposal (ai_memories:manage)
 *
 * Notes pass the enforced input guardrails first: a match refuses a user
 * memory and flags a team proposal for the reviewer. Audit entries never
 * carry the note itself.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requireAnyPermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { getUserConnections } from "../rbac/services/connections";
import { userNames } from "../services/ai/actions/store";
import { mentionsTable, screenNote } from "../services/ai/memory/runtime";
import {
  createMemory,
  decideMemory,
  deleteMemory,
  getMemory,
  listConnectionMemories,
  listUserMemories,
  MEMORY_MAX_CHARS,
  memoryEnabled,
  normalizeNote,
  pendingMemoryCount,
  setMemoryEnabled,
  updateMemoryContent,
  type AiMemory,
} from "../services/ai/memory/store";
import { all, sql, str } from "../services/observe/db";
import { getMessages, getThread } from "../services/chatHistory";
import { getChobiSettings } from "../services/chobi/settings";
import { MAX_SUGGESTIONS, suggestMemoriesCapability } from "../services/ai/capabilities/memories";
import { AppError, requireParam } from "../types";

const aiMemories = new Hono();
aiMemories.use("*", rbacAuthMiddleware);
aiMemories.use("*", requireAnyPermission([PERMISSIONS.AI_CHAT, PERMISSIONS.AI_OPTIMIZE, PERMISSIONS.AI_MEMORIES_MANAGE]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

function isSuperAdmin(c: Context): boolean {
  return getRbacUser(c).roles.includes("super_admin");
}

async function canManage(c: Context): Promise<boolean> {
  if (isSuperAdmin(c)) return true;
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  return permissions.includes(PERMISSIONS.AI_MEMORIES_MANAGE) || userHasPermission(getRbacUser(c).sub, PERMISSIONS.AI_MEMORIES_MANAGE);
}

/** Connections the viewer can reach: null means all of them. */
async function reachableConnections(c: Context): Promise<Set<string> | null> {
  if (isSuperAdmin(c)) return null;
  return new Set((await getUserConnections(getRbacUser(c).sub)).map((conn) => conn.id));
}

async function assertConnection(c: Context, connectionId: string): Promise<void> {
  const reachable = await reachableConnections(c);
  if (reachable && !reachable.has(connectionId)) throw AppError.forbidden("You do not have access to this connection");
}

async function connectionNames(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await all(sql`SELECT id, name FROM rbac_clickhouse_connections WHERE id IN (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`);
  return new Map(rows.map((r) => [str(r.id), str(r.name)]));
}

type MemoryView = AiMemory & { connectionName: string | null; proposedByName: string | null; decidedByName: string | null; canEdit: boolean };

async function views(c: Context, memories: AiMemory[], manager: boolean): Promise<MemoryView[]> {
  const viewer = getRbacUser(c).sub;
  const [people, connections] = await Promise.all([
    userNames(memories.flatMap((m) => [m.proposedBy, m.decidedBy])),
    connectionNames(memories.map((m) => m.connectionId)),
  ]);
  return memories.map((m) => ({
    ...m,
    connectionName: m.connectionId ? connections.get(m.connectionId) ?? null : null,
    proposedByName: m.proposedBy ? people.get(m.proposedBy) ?? null : null,
    decidedByName: m.decidedBy ? people.get(m.decidedBy) ?? null : null,
    canEdit: mayChange(m, viewer, manager),
  }));
}

/** Yours; team memories for managers; your own team proposal until it is reviewed. */
function mayChange(memory: AiMemory, viewer: string, manager: boolean): boolean {
  if (memory.scope === "user") return memory.ownerId === viewer;
  return manager || (memory.status === "proposed" && memory.proposedBy === viewer);
}

async function changeable(c: Context): Promise<{ memory: AiMemory; manager: boolean }> {
  const memory = await getMemory(requireParam(c, "id"));
  const viewer = getRbacUser(c).sub;
  // Someone else's user memory does not exist for this viewer.
  if (!memory || (memory.scope === "user" && memory.ownerId !== viewer)) throw AppError.notFound("Memory not found");
  const manager = await canManage(c);
  if (!mayChange(memory, viewer, manager)) throw AppError.forbidden("You need the ai_memories:manage permission to change team memories.");
  return { memory, manager };
}

aiMemories.get("/mine", async (c) => {
  const user = getRbacUser(c);
  const [enabled, memories] = await Promise.all([memoryEnabled(user.sub), listUserMemories(user.sub)]);
  return ok(c, { enabled, memories: await views(c, memories, false) });
});

aiMemories.put("/settings", zValidator("json", z.object({ enabled: z.boolean() })), async (c) => {
  const user = getRbacUser(c);
  const { enabled } = c.req.valid("json");
  await setMemoryEnabled(user.sub, enabled);
  return ok(c, { enabled });
});

aiMemories.get("/export", async (c) => {
  const user = getRbacUser(c);
  const memories = await listUserMemories(user.sub);
  return ok(c, {
    exportedAt: new Date().toISOString(),
    memories: memories.map((m) => ({ content: m.content, source: m.source, createdAt: new Date(m.createdAt).toISOString() })),
  });
});

const teamQuery = z.object({
  connectionId: z.string().min(1).optional(),
  status: z.enum(["active", "proposed", "rejected"]).optional(),
});

aiMemories.get("/team", zValidator("query", teamQuery), async (c) => {
  const { connectionId, status } = c.req.valid("query");
  const manager = await canManage(c);
  if (connectionId) await assertConnection(c, connectionId);
  const reachable = await reachableConnections(c);
  const viewer = getRbacUser(c).sub;
  const memories = (await listConnectionMemories({ connectionId: connectionId ?? null, status }))
    .filter((m) => !reachable || (m.connectionId !== null && reachable.has(m.connectionId)))
    // Proposals and rejected notes are for reviewers and their proposer.
    .filter((m) => m.status === "active" || manager || m.proposedBy === viewer);
  return ok(c, { canManage: manager, memories: await views(c, memories, manager) });
});

const tableQuery = z.object({
  connectionId: z.string().min(1),
  database: z.string().min(1),
  table: z.string().min(1),
});

aiMemories.get("/for-table", zValidator("query", tableQuery), async (c) => {
  const { connectionId, database, table } = c.req.valid("query");
  await assertConnection(c, connectionId);
  const manager = await canManage(c);
  const memories = (await listConnectionMemories({ connectionId }))
    .filter((m) => m.status === "active" || (manager && m.status === "proposed"))
    .filter((m) => mentionsTable(m.content, database, table));
  return ok(c, { canManage: manager, memories: await views(c, memories, manager) });
});

aiMemories.get("/pending-count", async (c) => {
  return ok(c, { count: (await canManage(c)) ? await pendingMemoryCount() : 0 });
});

const createBody = z.object({
  scope: z.enum(["user", "connection"]),
  content: z.string().trim().min(3).max(MEMORY_MAX_CHARS),
  connectionId: z.string().min(1).optional(),
});

// --- suggestions (ADR 0026 §9) ------------------------------------------------

/** How much of a conversation one suggestion call reads. */
const SUGGEST_TURNS = 20;
const SUGGEST_TURN_CHARS = 1_500;
/** The same thread at the same length gets the same answer, without another model call. */
const SUGGEST_CACHE_MS = 10 * 60_000;
const suggestCache = new Map<string, { at: number; value: Array<{ note: string; scope: "user" | "connection" }> }>();

export function resetSuggestCache(): void {
  suggestCache.clear();
}

/**
 * POST /suggest — notes worth keeping from one of your conversations, for you
 * to save or dismiss. Never saves anything. Suggestions that match an enforced
 * guardrail, or that memory already holds, are left out.
 */
aiMemories.post("/suggest", zValidator("json", z.object({ threadId: z.string().min(1).max(100) })), async (c) => {
  const user = getRbacUser(c);
  const { threadId } = c.req.valid("json");
  if (!(await getChobiSettings()).memorySuggestions) return ok(c, { suggestions: [], off: true });
  const thread = await getThread(threadId, user.sub);
  if (!thread) throw AppError.notFound("Thread not found");
  const messages = (await getMessages(threadId)).filter((m) => m.content.trim().length > 0);
  if (!messages.some((m) => m.role === "user") || !messages.some((m) => m.role === "assistant")) return ok(c, { suggestions: [] });
  const userMemory = await memoryEnabled(user.sub);
  const connectionId = thread.connectionId;
  if (connectionId) await assertConnection(c, connectionId);
  const mine = userMemory ? await listUserMemories(user.sub) : [];
  const team = connectionId ? (await listConnectionMemories({ connectionId })).filter((m) => m.status !== "rejected") : [];

  // The model's answer is cached per thread length; what memory holds is checked on every ask.
  const key = `${user.sub}|${threadId}|${messages.length}`;
  let raw = suggestCache.get(key);
  if (!raw || raw.at <= Date.now() - SUGGEST_CACHE_MS) {
    // The AI engine loads on first use: the rest of this router never needs it.
    const [{ isAIEnabled }, { runStructuredCapability }] = await Promise.all([import("../services/aiConfig"), import("../services/ai/engine")]);
    if (!(await isAIEnabled().catch(() => false))) return ok(c, { suggestions: [] });
    const permissions: string[] = c.get("rbacPermissions") ?? [];
    const result = await runStructuredCapability(suggestMemoriesCapability, {
      turns: messages.slice(-SUGGEST_TURNS).map((m) => ({ role: m.role, text: m.content.slice(0, SUGGEST_TURN_CHARS) })),
      existing: { user: mine.map((m) => m.content), team: team.map((m) => m.content) },
      userMemory,
    }, { userId: user.sub, isAdmin: isSuperAdmin(c), permissions, connectionId: connectionId ?? undefined, threadId });
    raw = { at: Date.now(), value: result.suggestions };
    suggestCache.set(key, raw);
  }

  const known = new Set([...mine, ...team].map((m) => normalizeNote(m.content).toLowerCase()));
  const suggestions: Array<{ note: string; scope: "user" | "connection" }> = [];
  for (const s of raw.value) {
    const note = normalizeNote(s.note);
    const id = note.toLowerCase();
    if (known.has(id) || suggestions.some((x) => x.note.toLowerCase() === id)) continue;
    if (s.scope === "user" && !userMemory) continue;
    if (s.scope === "connection" && !connectionId) continue;
    // Whatever a guardrail keeps from the provider is never offered for keeping.
    if ((await screenNote(note)).length > 0) continue;
    suggestions.push({ note, scope: s.scope });
  }
  return ok(c, { suggestions: suggestions.slice(0, MAX_SUGGESTIONS), connectionId });
});

aiMemories.post("/", zValidator("json", createBody), async (c) => {
  const user = getRbacUser(c);
  const body = c.req.valid("json");
  if (body.scope === "connection") {
    if (!body.connectionId) throw AppError.badRequest("Pick the connection this team memory is about.");
    await assertConnection(c, body.connectionId);
  }
  const matched = await screenNote(body.content);
  if (body.scope === "user" && matched.length > 0) {
    throw AppError.badRequest(`Not saved: the note matched the ${matched.join(", ")} guardrail. Don't keep personal data or secrets in memory.`);
  }
  const manager = body.scope === "connection" && await canManage(c);
  const { memory, duplicate } = await createMemory({
    scope: body.scope,
    userId: user.sub,
    connectionId: body.scope === "connection" ? body.connectionId ?? null : null,
    content: body.content,
    source: "person",
    flag: matched.length > 0 ? `Matched ${matched.join(", ")}` : null,
    // A manager's own team note needs no second reviewer, unless a guardrail flagged it.
    ...(manager && matched.length === 0 ? { status: "active" as const } : {}),
  });
  if (!duplicate) {
    await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_MEMORY_CREATE, user.sub, {
      resourceType: "ai_memory", resourceId: memory.id, details: { scope: memory.scope, status: memory.status, connectionId: memory.connectionId },
    });
  }
  return ok(c, { ...(await views(c, [memory], manager))[0], duplicate });
});

aiMemories.put("/:id", zValidator("json", z.object({ content: z.string().trim().min(3).max(MEMORY_MAX_CHARS) })), async (c) => {
  const { memory, manager } = await changeable(c);
  const { content } = c.req.valid("json");
  const matched = await screenNote(content);
  if (memory.scope === "user" && matched.length > 0) {
    throw AppError.badRequest(`Not saved: the note matched the ${matched.join(", ")} guardrail. Don't keep personal data or secrets in memory.`);
  }
  const updated = await updateMemoryContent(memory.id, content, matched.length > 0 ? `Matched ${matched.join(", ")}` : null);
  if (!updated) throw AppError.notFound("Memory not found");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_MEMORY_UPDATE, getRbacUser(c).sub, {
    resourceType: "ai_memory", resourceId: memory.id, details: { scope: memory.scope, connectionId: memory.connectionId },
  });
  return ok(c, (await views(c, [updated], manager))[0]);
});

aiMemories.delete("/:id", async (c) => {
  const { memory } = await changeable(c);
  await deleteMemory(memory.id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_MEMORY_DELETE, getRbacUser(c).sub, {
    resourceType: "ai_memory", resourceId: memory.id, details: { scope: memory.scope, connectionId: memory.connectionId },
  });
  return ok(c, { deleted: true });
});

async function review(c: Context, approve: boolean): Promise<Response> {
  if (!(await canManage(c))) throw AppError.forbidden("You need the ai_memories:manage permission to review team memories.");
  const id = requireParam(c, "id");
  const existing = await getMemory(id);
  if (!existing || existing.scope !== "connection") throw AppError.notFound("Memory not found");
  if (existing.connectionId) await assertConnection(c, existing.connectionId);
  const decided = await decideMemory(id, approve, getRbacUser(c).sub);
  if (!decided) throw AppError.conflict(`This memory was already ${existing.status === "active" ? "approved" : existing.status}.`);
  await createAuditLogWithContext(c, approve ? AUDIT_ACTIONS.AI_MEMORY_APPROVE : AUDIT_ACTIONS.AI_MEMORY_REJECT, getRbacUser(c).sub, {
    resourceType: "ai_memory", resourceId: id, details: { scope: decided.scope, connectionId: decided.connectionId },
  });
  return ok(c, (await views(c, [decided], true))[0]);
}

aiMemories.post("/:id/approve", (c) => review(c, true));
aiMemories.post("/:id/reject", (c) => review(c, false));

export default aiMemories;
