/**
 * `/api/ai-agents` — the AI agent registry behind AI Governance › Assistant (ADR 0019).
 *
 * Permission map:
 *   registry, revisions, prompt preview                ai_agents:view
 *   agent / harness / skill writes, bindings, reset,
 *   rollback, test console, Draft with AI              ai_agents:manage
 * The test console also needs the tested feature's own permission and runs on
 * the caller's ClickHouse session. Drafting also needs the drafter's own AI
 * permission, needs no ClickHouse connection, and never writes to the registry.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { connectionContextMiddleware, type ConnectionContextVariables } from "../middleware/connectionContext";
import { getRbacUser, rbacAuthMiddleware, requirePermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, type AuditAction, type Permission } from "../rbac/schema/base";
import { createAuditLogWithContext, userHasPermission } from "../rbac/services/rbac";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import { isAIEnabled } from "../services/aiConfig";
import { CAPABILITIES, getCapability } from "../services/ai/capabilities";
import { invokeChat, isStructured, runStructuredCapability, type RunTrace } from "../services/ai/engine";
import { evalGate } from "../services/ai/evals/runner";
import { agentDraftHash } from "../services/ai/evals/scoring";
import { renderAgentPrompts, renderTaskMessage } from "../services/ai/registry/builder";
import { describeCatalog } from "../services/ai/registry/catalog";
import { BUILTIN_TOOLS } from "../services/ai/registry/harness";
import { DRAFT_FEATURES, runDraft } from "../services/ai/registry/draftRunner";
import * as service from "../services/ai/registry/service";
import { agentSchema, harnessSchema, normalizedAgent, normalizedHarness, skillSchema } from "../services/ai/registry/schemas";
import { listRevisions, loadSnapshot } from "../services/ai/registry/store";
import type { TemplateValue } from "../services/ai/registry/template";
import { TOOL_CONTEXT_KINDS, type AgentDef, type RegistryEntity, type RegistrySnapshot } from "../services/ai/registry/types";
import type { DraftKind } from "../services/ai/registry/drafting";
import { introducedProblems, TUNING_LIMITS, usagesOf, validateGraph, withChanges } from "../services/ai/registry/validation";
import type { AnyCapability } from "../services/ai/types";
import { AppError, requireParam } from "../types";

type Variables = ConnectionContextVariables;

const aiAgents = new Hono<{ Variables: Variables }>();
aiAgents.use("*", rbacAuthMiddleware);

const VIEW = requirePermission(PERMISSIONS.AI_AGENTS_VIEW);
const MANAGE = requirePermission(PERMISSIONS.AI_AGENTS_MANAGE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status = 200): any {
  return c.json({ success: true, data }, status as 200);
}

function actor(c: Context): string {
  return getRbacUser(c).sub;
}

/** Same rule as the chat and query routes: admins and super admins bypass table-level checks. */
function isAdmin(c: Context): boolean {
  const roles = c.get("rbacRoles") ?? [];
  return roles.includes("super_admin") || roles.includes("admin");
}

async function audit(c: Context, action: AuditAction, resourceType: string, resourceId: string, details: Record<string, unknown> = {}): Promise<void> {
  await createAuditLogWithContext(c, action, actor(c), { resourceType, resourceId, details });
}

// ============================================
// Schemas
// ============================================

const versionSchema = z.object({ version: z.number().int().min(1) });

function versionQuery(c: Context): number {
  const version = Number(c.req.query("version"));
  if (!Number.isInteger(version) || version < 1) throw AppError.badRequest("Query parameter 'version' is required");
  return version;
}

// ============================================
// Read
// ============================================

function featureList(snapshotBindings: Map<string, { agentId: string }>): Array<Record<string, unknown>> {
  return Object.values(CAPABILITIES as Record<string, AnyCapability>).map((cap) => ({
    id: cap.id,
    title: cap.title,
    description: cap.description,
    surface: cap.surface,
    delivery: cap.delivery,
    permission: cap.permission,
    contexts: cap.contexts,
    variables: cap.variables,
    background: cap.background ?? false,
    agentId: snapshotBindings.get(cap.id)?.agentId ?? null,
  }));
}

/** Whether each drafter can run: a model is configured and its feature is bound to an enabled agent. */
async function draftingAvailability(snapshot: RegistrySnapshot): Promise<Record<DraftKind, boolean>> {
  const aiEnabled = await isAIEnabled().catch(() => false);
  const ready = (featureId: string): boolean => {
    const binding = snapshot.bindings.get(featureId);
    return aiEnabled && Boolean(binding && snapshot.agents.get(binding.agentId)?.enabled);
  };
  return { agent: ready(DRAFT_FEATURES.agent), harness: ready(DRAFT_FEATURES.harness), skill: ready(DRAFT_FEATURES.skill) };
}

aiAgents.get("/registry", VIEW, async (c) => {
  const snapshot = await loadSnapshot();
  return ok(c, {
    version: snapshot.version,
    features: featureList(snapshot.bindings),
    agents: [...snapshot.agents.values()].map((agent) => ({
      ...agent,
      updateAvailable: service.builtInUpdateAvailable("agent", agent),
      usedBy: usagesOf(snapshot, "agent", agent.id),
    })),
    harnesses: [...snapshot.harnesses.values()].map((harness) => ({
      ...harness,
      updateAvailable: service.builtInUpdateAvailable("harness", harness),
      usedBy: usagesOf(snapshot, "harness", harness.id),
    })),
    skills: [...snapshot.skills.values()].map((skill) => ({
      ...skill,
      updateAvailable: service.builtInUpdateAvailable("skill", skill),
      usedBy: usagesOf(snapshot, "skill", skill.id),
    })),
    tools: describeCatalog(),
    builtinTools: BUILTIN_TOOLS,
    contexts: TOOL_CONTEXT_KINDS,
    limits: TUNING_LIMITS,
    problems: validateGraph(snapshot),
    drafting: await draftingAvailability(snapshot),
  });
});

const ENTITIES: RegistryEntity[] = ["agent", "harness", "skill", "binding"];

aiAgents.get("/revisions/:entity/:id", VIEW, async (c) => {
  const entity = requireParam(c, "entity") as RegistryEntity;
  if (!ENTITIES.includes(entity)) throw AppError.badRequest("Unknown entity");
  return ok(c, { revisions: await listRevisions(entity, requireParam(c, "id")) });
});

/** Placeholder values that make every section render, so the preview shows the whole prompt. */
function placeholderVariables(cap: AnyCapability | undefined): Record<string, TemplateValue> {
  if (!cap) return {};
  return Object.fromEntries(Object.entries(cap.variables).map(([name, spec]) => [name, spec.type === "boolean" ? true : `«${name}»`]));
}

aiAgents.post("/preview", VIEW, zValidator("json", z.object({ featureId: z.string().nullable(), agentId: z.string().nullable(), agent: agentSchema })), async (c) => {
  const { featureId, agentId, agent: body } = c.req.valid("json");
  const snapshot = await loadSnapshot();
  const existing = agentId ? snapshot.agents.get(agentId) : undefined;
  const draft: AgentDef = existing
    ? { ...existing, ...normalizedAgent(body) }
    : { ...normalizedAgent(body), id: "draft", isSystem: false, seedHash: null, customized: false, version: 0, createdAt: 0, updatedAt: 0, createdBy: null };
  const cap = featureId ? getCapability(featureId) : undefined;
  const variables = placeholderVariables(cap);
  const after = withChanges(snapshot, { agent: draft, ...(featureId && cap ? { binding: { featureId, agentId: draft.id } } : {}) });
  const problems = introducedProblems(snapshot, after).filter((p) => p.id === draft.id || p.id === featureId).map((p) => p.message);
  let system: string | null = null;
  let task: string | null = null;
  try {
    system = renderAgentPrompts(draft, variables, after).system;
    task = draft.taskTemplate === null ? null : renderTaskMessage(draft, variables, after);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return ok(c, { system, task, problems });
});

// ============================================
// Agents
// ============================================

aiAgents.post("/agents", MANAGE, zValidator("json", agentSchema), async (c) => {
  const agent = await service.createAgent(normalizedAgent(c.req.valid("json")), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_AGENT_CREATE, "ai_agent", agent.id, { slug: agent.slug });
  return ok(c, agent, 201);
});

aiAgents.put("/agents/:id", MANAGE, zValidator("json", agentSchema.merge(versionSchema)), async (c) => {
  const { version, ...body } = c.req.valid("json");
  const id = requireParam(c, "id");
  const input = normalizedAgent(body);
  // ADR 0024: with an eval threshold, only a draft that passed its evals is saved.
  const gate = await evalGate(id, agentDraftHash(input as unknown as Record<string, unknown>), input.tuning.evalThreshold ?? null);
  if (!gate.passing) {
    const message = !gate.run
      ? `Run the evals for this draft first: saving needs ${Math.round((gate.threshold ?? 0) * 100)}% of its ${gate.cases} test case(s) to pass.`
      : `This draft passed ${Math.round((gate.run.score ?? 0) * 100)}% of its evals (${gate.run.passed} of ${gate.run.total}); saving needs ${Math.round((gate.threshold ?? 0) * 100)}%.`;
    throw new AppError(message, "EVALS_REQUIRED", "validation", 409);
  }
  const agent = await service.updateAgent(id, input, version, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_AGENT_UPDATE, "ai_agent", agent.id, { slug: agent.slug, version: agent.version });
  return ok(c, agent);
});

aiAgents.delete("/agents/:id", MANAGE, async (c) => {
  const id = requireParam(c, "id");
  await service.deleteAgent(id, versionQuery(c), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_AGENT_DELETE, "ai_agent", id);
  return ok(c, { deleted: true });
});

aiAgents.post("/agents/:id/reset", MANAGE, async (c) => {
  const agent = await service.resetAgent(requireParam(c, "id"), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_REGISTRY_RESET, "ai_agent", agent.id, { slug: agent.slug });
  return ok(c, agent);
});

// ============================================
// Harnesses
// ============================================

aiAgents.post("/harnesses", MANAGE, zValidator("json", harnessSchema), async (c) => {
  const harness = await service.createHarness(normalizedHarness(c.req.valid("json")), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_HARNESS_CREATE, "ai_harness", harness.id, { slug: harness.slug });
  return ok(c, harness, 201);
});

aiAgents.put("/harnesses/:id", MANAGE, zValidator("json", harnessSchema.merge(versionSchema)), async (c) => {
  const { version, ...body } = c.req.valid("json");
  const harness = await service.updateHarness(requireParam(c, "id"), normalizedHarness(body), version, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_HARNESS_UPDATE, "ai_harness", harness.id, { slug: harness.slug, version: harness.version });
  return ok(c, harness);
});

aiAgents.delete("/harnesses/:id", MANAGE, async (c) => {
  const id = requireParam(c, "id");
  await service.deleteHarness(id, versionQuery(c), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_HARNESS_DELETE, "ai_harness", id);
  return ok(c, { deleted: true });
});

aiAgents.post("/harnesses/:id/reset", MANAGE, async (c) => {
  const harness = await service.resetHarness(requireParam(c, "id"), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_REGISTRY_RESET, "ai_harness", harness.id, { slug: harness.slug });
  return ok(c, harness);
});

// ============================================
// Skills
// ============================================

aiAgents.post("/skills", MANAGE, zValidator("json", skillSchema), async (c) => {
  const skill = await service.createSkill(c.req.valid("json"), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_SKILL_CREATE, "ai_skill", skill.id, { name: skill.name });
  return ok(c, skill, 201);
});

aiAgents.put("/skills/:id", MANAGE, zValidator("json", skillSchema.merge(versionSchema)), async (c) => {
  const { version, ...body } = c.req.valid("json");
  const skill = await service.updateSkill(requireParam(c, "id"), body, version, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_SKILL_UPDATE, "ai_skill", skill.id, { name: skill.name, version: skill.version });
  return ok(c, skill);
});

aiAgents.delete("/skills/:id", MANAGE, async (c) => {
  const id = requireParam(c, "id");
  await service.deleteSkill(id, versionQuery(c), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_SKILL_DELETE, "ai_skill", id);
  return ok(c, { deleted: true });
});

aiAgents.post("/skills/:id/reset", MANAGE, async (c) => {
  const skill = await service.resetSkill(requireParam(c, "id"), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_REGISTRY_RESET, "ai_skill", skill.id, { name: skill.name });
  return ok(c, skill);
});

// ============================================
// Bindings and rollback
// ============================================

aiAgents.put("/bindings/:featureId", MANAGE, zValidator("json", z.object({ agentId: z.string().min(1) })), async (c) => {
  const featureId = requireParam(c, "featureId");
  const binding = await service.bindFeature(featureId, c.req.valid("json").agentId, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_BINDING_UPDATE, "ai_binding", featureId, { agentId: binding.agentId });
  return ok(c, binding);
});

aiAgents.post("/revisions/:id/rollback", MANAGE, async (c) => {
  const id = requireParam(c, "id");
  const entity = await service.rollback(id, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_REGISTRY_ROLLBACK, `ai_${entity}`, id);
  return ok(c, { restored: entity });
});

// ============================================
// Test console
// ============================================

const testSchema = z.object({
  featureId: z.string().min(1),
  /** Structured features: the feature input. */
  input: z.unknown().optional(),
  /** Chat: the conversation to answer. */
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(32_000) })).max(50).optional(),
  /** Agent to test (unsaved draft when `agent` is set); defaults to the feature's bound agent. */
  agentId: z.string().nullable().optional(),
  agent: agentSchema.optional(),
  modelId: z.string().optional(),
});

async function requireFeaturePermission(c: Context<{ Variables: Variables }>, permission: Permission, action = "Testing this feature"): Promise<void> {
  if (isAdmin(c)) return;
  if (c.get("rbacPermissions")?.includes(permission)) return;
  if (await userHasPermission(actor(c), permission)) return;
  throw AppError.forbidden(`${action} needs '${permission}'`);
}

aiAgents.post("/test", MANAGE, connectionContextMiddleware, zValidator("json", testSchema), async (c) => {
  const body = c.req.valid("json");
  const cap = getCapability(body.featureId);
  if (!cap) throw AppError.notFound(`Unknown AI feature '${body.featureId}'`);
  await requireFeaturePermission(c, cap.permission);
  if (!(await isAIEnabled().catch(() => false))) throw AppError.badRequest("No AI model is configured.");

  const stored = await loadSnapshot();
  let snapshot = stored;
  let agentId = body.agentId ?? undefined;
  if (body.agent) {
    const existing = agentId ? stored.agents.get(agentId) : undefined;
    const draft: AgentDef = existing
      ? { ...existing, ...normalizedAgent(body.agent) }
      : { ...normalizedAgent(body.agent), id: "draft", isSystem: false, seedHash: null, customized: false, version: 0, createdAt: 0, updatedAt: 0, createdBy: null };
    snapshot = withChanges(stored, { agent: draft });
    agentId = draft.id;
  }

  const session = c.get("session");
  const ctx = {
    userId: actor(c),
    isAdmin: isAdmin(c),
    permissions: c.get("rbacPermissions") ?? [],
    connectionId: session?.rbacConnectionId ?? c.get("rbacConnectionId"),
    clickhouseService: c.get("service"),
    defaultDatabase: session?.connectionConfig?.database,
    modelId: body.modelId,
    bearerToken: extractTokenFromHeader(c.req.header("Authorization")) ?? undefined,
    // A test run never carries out or records actions (ADR 0024).
    actionMode: "simulate" as const,
  };
  const startedAt = Date.now();

  if (isStructured(cap)) {
    let trace: RunTrace | null = null;
    const output = await runStructuredCapability(cap, cap.inputSchema.parse(body.input ?? {}), ctx, {
      snapshot,
      agentId,
      onTrace: (t) => {
        trace = t;
      },
    });
    return ok(c, { kind: "structured", output, trace, durationMs: Date.now() - startedAt });
  }

  const messages = body.messages ?? [];
  if (messages.length === 0) throw AppError.badRequest("Add a message to test the chat");
  const result = await invokeChat(ctx, messages, { agentId: agentId ?? null, snapshot: body.agent || agentId ? snapshot : undefined });
  return ok(c, { kind: "chat", content: result.content, agent: result.agent, toolCalls: result.toolCalls, durationMs: Date.now() - startedAt });
});

// ============================================
// Draft with AI
// ============================================

const DRAFT_KINDS: DraftKind[] = ["agent", "harness", "skill"];

aiAgents.post("/draft/:kind", MANAGE, async (c) => {
  const kind = requireParam(c, "kind") as DraftKind;
  if (!DRAFT_KINDS.includes(kind)) throw AppError.notFound(`Unknown draft kind '${kind}'`);
  const cap = getCapability(DRAFT_FEATURES[kind]);
  if (!cap || !isStructured(cap)) throw AppError.internal(`The ${kind} drafter is not registered`);
  await requireFeaturePermission(c, cap.permission, "Drafting with AI");
  if (!(await isAIEnabled().catch(() => false))) throw AppError.badRequest("No AI model is configured.");

  const parsed = cap.inputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const result = await runDraft(kind, parsed.data, {
    userId: actor(c),
    isAdmin: isAdmin(c),
    // MANAGE already verified ai_agents:manage, possibly against the database
    // rather than the token, so the drafter's own check must agree with it.
    permissions: [...(c.get("rbacPermissions") ?? []), PERMISSIONS.AI_AGENTS_MANAGE],
    modelId: c.req.query("modelId") || undefined,
  });
  return ok(c, result);
});

export default aiAgents;
