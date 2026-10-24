/**
 * Agent evals (ADR 0024 §Phase 6), in the agent editor's Evals tab.
 *
 *   GET    /agents/:agentId              cases and recent runs
 *   POST   /agents/:agentId/cases        add a case (ai_agents:manage)
 *   PUT    /cases/:id · DELETE /cases/:id
 *   POST   /cases/from-request           save a chat request from AI activity as a case
 *   POST   /agents/:agentId/runs         score a draft (or the saved agent) in the background
 *   GET    /runs/:id                     poll a run
 *   POST   /agents/:agentId/gate         whether this draft may be saved (threshold and runs)
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { connectionContextMiddleware, type ConnectionContextVariables } from "../middleware/connectionContext";
import { getRbacUser, rbacAuthMiddleware, requirePermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, type AuditAction } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import { getMessages } from "../services/chatHistory";
import { getCapability } from "../services/ai/capabilities";
import { isStructured } from "../services/ai/engine";
import { agentDraftHash } from "../services/ai/evals/scoring";
import { evalGate, startEvalRun } from "../services/ai/evals/runner";
import { caseCount, createCase, deleteCase, getCase, getRun, listCases, listRuns, MAX_CASES_PER_AGENT, updateCase, type EvalCaseInput } from "../services/ai/evals/store";
import { agentSchema, normalizedAgent } from "../services/ai/registry/schemas";
import { loadSnapshot } from "../services/ai/registry/store";
import type { AgentDef, RegistrySnapshot } from "../services/ai/registry/types";
import { withChanges } from "../services/ai/registry/validation";
import { one, sql, str, strOrNull, num } from "../services/observe/db";
import { AppError, requireParam } from "../types";

type Variables = ConnectionContextVariables & { rbacUserId?: string; rbacPermissions?: string[] };

const aiEvals = new Hono<{ Variables: Variables }>();
aiEvals.use("*", rbacAuthMiddleware);

const VIEW = requirePermission(PERMISSIONS.AI_AGENTS_VIEW);
const MANAGE = requirePermission(PERMISSIONS.AI_AGENTS_MANAGE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status = 200): any {
  return c.json({ success: true, data }, status as 200);
}

const ATTACHED_SUFFIX = /\n\n\[attached: [^\]]+\]$/;

async function audit(c: Context, action: AuditAction, resourceId: string, details: Record<string, unknown>): Promise<void> {
  await createAuditLogWithContext(c, action, getRbacUser(c).sub, { resourceType: "ai_eval", resourceId, details });
}

const caseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["chat", "feature"]),
  featureId: z.string().min(1).nullable().optional(),
  input: z.record(z.string(), z.unknown()),
  expectedTools: z.array(z.string().min(1).max(100)).max(30),
  rubric: z.string().trim().max(4_000).nullable().optional(),
});

/** Check a case's shape: a chat case needs a user message, a feature case a known feature whose input validates. */
function caseInput(body: z.infer<typeof caseSchema>): EvalCaseInput {
  if (body.kind === "chat") {
    const messages = Array.isArray(body.input.messages) ? body.input.messages : [];
    const valid = messages.length > 0 && messages.every((m) => m && typeof m === "object" && typeof (m as { content?: unknown }).content === "string" && ["user", "assistant"].includes(String((m as { role?: unknown }).role)));
    if (!valid || String((messages.at(-1) as { role?: unknown }).role) !== "user") throw AppError.badRequest("A chat case is a conversation that ends with the user's message.");
    return { name: body.name, kind: "chat", featureId: null, input: { messages }, expectedTools: body.expectedTools, rubric: body.rubric || null };
  }
  const cap = body.featureId ? getCapability(body.featureId) : undefined;
  if (!cap || !isStructured(cap)) throw AppError.badRequest("Pick the feature whose input this case is.");
  const parsed = cap.inputSchema.safeParse(body.input);
  if (!parsed.success) throw AppError.badRequest(`The input does not fit '${cap.title}': ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`);
  return { name: body.name, kind: "feature", featureId: cap.id, input: body.input, expectedTools: body.expectedTools, rubric: body.rubric || null };
}

async function storedAgent(agentId: string): Promise<{ snapshot: RegistrySnapshot; agent: AgentDef }> {
  const snapshot = await loadSnapshot();
  const agent = snapshot.agents.get(agentId);
  if (!agent) throw AppError.notFound("Agent not found");
  return { snapshot, agent };
}

/** The draft as the editor holds it, applied over the stored agent. */
function draftOf(stored: AgentDef, body: z.infer<typeof agentSchema> | undefined): AgentDef {
  return body ? { ...stored, ...normalizedAgent(body) } : stored;
}

aiEvals.get("/agents/:agentId", VIEW, async (c) => {
  const agentId = requireParam(c, "agentId");
  await storedAgent(agentId);
  const [cases, runs] = await Promise.all([listCases(agentId), listRuns(agentId, 10)]);
  return ok(c, { cases, runs, maxCases: MAX_CASES_PER_AGENT });
});

aiEvals.post("/agents/:agentId/cases", MANAGE, zValidator("json", caseSchema), async (c) => {
  const agentId = requireParam(c, "agentId");
  await storedAgent(agentId);
  if ((await caseCount(agentId)) >= MAX_CASES_PER_AGENT) throw AppError.conflict(`An agent has at most ${MAX_CASES_PER_AGENT} test cases.`);
  const source = c.req.query("source") === "console" ? "console" : "manual";
  const created = await createCase(agentId, caseInput(c.req.valid("json")), source, getRbacUser(c).sub);
  await audit(c, AUDIT_ACTIONS.AI_EVAL_CASE_CREATE, created.id, { agentId, kind: created.kind, source });
  return ok(c, created, 201);
});

aiEvals.put("/cases/:id", MANAGE, zValidator("json", caseSchema), async (c) => {
  const existing = await getCase(requireParam(c, "id"));
  if (!existing) throw AppError.notFound("Test case not found");
  const updated = await updateCase(existing.id, caseInput(c.req.valid("json")));
  await audit(c, AUDIT_ACTIONS.AI_EVAL_CASE_UPDATE, existing.id, { agentId: existing.agentId });
  return ok(c, updated);
});

aiEvals.delete("/cases/:id", MANAGE, async (c) => {
  const existing = await getCase(requireParam(c, "id"));
  if (!existing) throw AppError.notFound("Test case not found");
  await deleteCase(existing.id);
  await audit(c, AUDIT_ACTIONS.AI_EVAL_CASE_DELETE, existing.id, { agentId: existing.agentId });
  return ok(c, { deleted: true });
});

/** A chat request from AI activity: the question asked, and the tools the answer called. */
aiEvals.post("/cases/from-request", MANAGE, zValidator("json", z.object({ requestId: z.string().min(1).max(64), name: z.string().trim().min(1).max(200).optional() })), async (c) => {
  const { requestId, name } = c.req.valid("json");
  const user = getRbacUser(c);
  const request = await one(sql`SELECT user_id, feature_id, thread_id, agent_id, started_at FROM ai_usage_requests WHERE id = ${requestId}`);
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  const mayView = request && (strOrNull(request.user_id) === user.sub || permissions.includes(PERMISSIONS.AI_USAGE_VIEW) || user.roles.includes("super_admin"));
  if (!request || !mayView) throw AppError.notFound("AI request not found");
  const threadId = strOrNull(request.thread_id);
  const agentId = strOrNull(request.agent_id);
  if (str(request.feature_id) !== "chat" || !threadId) {
    throw AppError.badRequest("Only chat requests can be saved as a test case: features don't keep their input. Save one from the agent's test console instead.");
  }
  if (!agentId) throw AppError.badRequest("This request has no agent to attach a test case to.");
  await storedAgent(agentId);
  if ((await caseCount(agentId)) >= MAX_CASES_PER_AGENT) throw AppError.conflict(`An agent has at most ${MAX_CASES_PER_AGENT} test cases.`);
  const startedAt = num(request.started_at);
  const messages = await getMessages(threadId);
  // The question is stored when the turn starts, just before the request.
  const askedIndex = messages.reduce((found, m, i) => (m.role === "user" && m.createdAt.getTime() <= startedAt + 5_000 ? i : found), -1);
  if (askedIndex < 0) throw AppError.badRequest("The chat message for this request is no longer there.");
  const question = messages[askedIndex].content.replace(ATTACHED_SUFFIX, "");
  const answer = messages.slice(askedIndex + 1).find((m) => m.role === "assistant");
  const tools = [...new Set((answer?.toolCalls ?? []).map((t) => t.name))];
  const created = await createCase(agentId, {
    name: name ?? question.slice(0, 80),
    kind: "chat",
    featureId: null,
    input: { messages: [{ role: "user", content: question }] },
    expectedTools: tools,
    rubric: null,
  }, "request", user.sub);
  await audit(c, AUDIT_ACTIONS.AI_EVAL_CASE_CREATE, created.id, { agentId, kind: "chat", source: "request", requestId });
  return ok(c, created, 201);
});

const runBody = z.object({ agent: agentSchema.optional(), modelId: z.string().min(1).optional() });

aiEvals.post("/agents/:agentId/runs", MANAGE, connectionContextMiddleware, zValidator("json", runBody), async (c) => {
  const agentId = requireParam(c, "agentId");
  const body = c.req.valid("json");
  const { snapshot: stored, agent } = await storedAgent(agentId);
  const draft = draftOf(agent, body.agent);
  const snapshot = body.agent ? withChanges(stored, { agent: draft }) : stored;
  const session = c.get("session");
  const user = getRbacUser(c);
  const { run } = await startEvalRun({
    agentId,
    draftHash: agentDraftHash(draft as unknown as Record<string, unknown>),
    snapshot,
    modelId: body.modelId,
    actor: user.sub,
    ctx: {
      userId: user.sub,
      isAdmin: user.roles.includes("super_admin"),
      permissions: c.get("rbacPermissions") ?? [],
      connectionId: session?.rbacConnectionId ?? c.get("rbacConnectionId"),
      clickhouseService: c.get("service"),
      defaultDatabase: session?.connectionConfig?.database,
      bearerToken: extractTokenFromHeader(c.req.header("Authorization")) ?? undefined,
    },
  });
  await audit(c, AUDIT_ACTIONS.AI_EVAL_RUN, run.id, { agentId, cases: run.total, draft: Boolean(body.agent) });
  return ok(c, run, 202);
});

aiEvals.get("/runs/:id", VIEW, async (c) => {
  const found = await getRun(requireParam(c, "id"));
  if (!found) throw AppError.notFound("Eval run not found");
  return ok(c, found);
});

aiEvals.post("/agents/:agentId/gate", VIEW, zValidator("json", z.object({ agent: agentSchema.optional() })), async (c) => {
  const agentId = requireParam(c, "agentId");
  const { agent } = await storedAgent(agentId);
  const draft = draftOf(agent, c.req.valid("json").agent);
  const gate = await evalGate(agentId, agentDraftHash(draft as unknown as Record<string, unknown>), draft.tuning.evalThreshold ?? null);
  return ok(c, gate);
});

export default aiEvals;
