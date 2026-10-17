/**
 * `/api/ai-guardrails` — AI Governance › Guardrails (ADR 0022 §7).
 *
 * Permission map:
 *   list, revisions, events                  ai_guardrails:view
 *   create, update, state, reorder, delete,
 *   reset, rollback, test                    ai_guardrails:manage
 *   draft                                    ai_guardrails:manage and the drafter's AI permission
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requirePermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, type AuditAction } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { isAIEnabled } from "../services/aiConfig";
import { CAPABILITIES, getCapability } from "../services/ai/capabilities";
import { isStructured, runStructuredCapability } from "../services/ai/engine";
import { DETECTORS } from "../services/ai/guardrails/detectors";
import { judgeText } from "../services/ai/guardrails/runtime";
import { GuardrailBlockedError, GuardrailRunner } from "../services/ai/guardrails/runner";
import * as service from "../services/ai/guardrails/service";
import { guardrailEvents, triggerCounts } from "../services/ai/guardrails/events";
import { KIND_SPECS } from "../services/ai/guardrails/kinds";
import {
  GUARDRAIL_ACTIONS,
  GUARDRAIL_KINDS,
  GUARDRAIL_MODES,
  GUARDRAIL_STAGES,
  REDACT_STRATEGIES,
  type GuardrailDef,
  type GuardrailEvent,
} from "../services/ai/guardrails/types";
import { getRevision, listRevisions, loadSnapshot } from "../services/ai/registry/store";
import { AppError, requireParam } from "../types";

const aiGuardrails = new Hono();
aiGuardrails.use("*", rbacAuthMiddleware);

const VIEW = requirePermission(PERMISSIONS.AI_GUARDRAILS_VIEW);
const MANAGE = requirePermission(PERMISSIONS.AI_GUARDRAILS_MANAGE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status = 200): any {
  return c.json({ success: true, data }, status as 200);
}

function actor(c: Context): string {
  return getRbacUser(c).sub;
}

async function audit(c: Context, action: AuditAction, resourceId: string, details: Record<string, unknown> = {}): Promise<void> {
  await createAuditLogWithContext(c, action, actor(c), { resourceType: "ai_guardrail", resourceId, details });
}

function isAdmin(c: Context): boolean {
  const roles: string[] = c.get("rbacRoles") ?? [];
  return roles.includes("super_admin") || roles.includes("admin");
}

const scopeSchema = z.object({
  agents: z.union([z.literal("all"), z.array(z.string().min(1)).max(200)]),
  features: z.union([z.literal("all"), z.array(z.string().min(1)).max(100)]),
  mcp: z.boolean(),
}).strict();

const guardrailSchema = z.object({
  slug: z.string().trim().min(1).max(63),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000),
  kind: z.enum(GUARDRAIL_KINDS),
  config: z.record(z.unknown()),
  stages: z.array(z.enum(GUARDRAIL_STAGES)).max(GUARDRAIL_STAGES.length),
  action: z.enum(GUARDRAIL_ACTIONS),
  mode: z.enum(GUARDRAIL_MODES),
  scope: scopeSchema,
  position: z.number().int().min(0).max(1_000_000),
  enabled: z.boolean(),
}).strict();

const versionSchema = z.object({ version: z.number().int().min(1) });

function versionQuery(c: Context): number {
  const version = Number(c.req.query("version"));
  if (!Number.isInteger(version) || version < 1) throw AppError.badRequest("Query parameter 'version' is required");
  return version;
}

function withStageOrder(input: z.infer<typeof guardrailSchema>): service.GuardrailInput {
  return { ...input, stages: GUARDRAIL_STAGES.filter((s) => input.stages.includes(s)) };
}

// ============================================
// Read
// ============================================

aiGuardrails.get("/", VIEW, async (c) => {
  const snapshot = await loadSnapshot();
  const counts = await triggerCounts(Date.now() - 24 * 60 * 60 * 1000);
  const guardrails = [...snapshot.guardrails.values()]
    .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
    .map((g) => ({ ...g, updateAvailable: service.guardrailUpdateAvailable(g), triggers24h: counts.get(g.id) ?? { total: 0, applied: 0, blocked: 0 } }));
  const draftBinding = snapshot.bindings.get("draft-guardrail");
  return ok(c, {
    version: snapshot.version,
    guardrails,
    kinds: Object.fromEntries(Object.entries(KIND_SPECS).map(([kind, spec]) => [kind, { label: spec.label, description: spec.description, stages: spec.stages }])),
    detectors: DETECTORS.map((d) => ({ id: d.id, label: d.label, group: d.group, token: d.token })),
    strategies: REDACT_STRATEGIES,
    agents: [...snapshot.agents.values()].map((a) => ({ id: a.id, slug: a.slug, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
    features: Object.values(CAPABILITIES).map((cap) => ({ id: cap.id, title: cap.title })).sort((a, b) => a.title.localeCompare(b.title)),
    drafting: (await isAIEnabled().catch(() => false)) && Boolean(draftBinding && snapshot.agents.get(draftBinding.agentId)?.enabled),
  });
});

aiGuardrails.get("/events", VIEW, zValidator("query", z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  guardrailId: z.string().min(1).optional(),
  mode: z.enum(GUARDRAIL_MODES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})), async (c) => {
  const q = c.req.valid("query");
  return ok(c, await guardrailEvents({
    since: Date.now() - (q.days ?? 1) * 24 * 60 * 60 * 1000,
    guardrailId: q.guardrailId ?? null,
    mode: q.mode ?? null,
    limit: q.limit ?? 100,
    offset: q.offset ?? 0,
  }));
});

aiGuardrails.get("/:id/revisions", VIEW, async (c) => ok(c, { revisions: await listRevisions("guardrail", requireParam(c, "id")) }));

// ============================================
// Write
// ============================================

aiGuardrails.post("/", MANAGE, zValidator("json", guardrailSchema), async (c) => {
  const guardrail = await service.createGuardrail(withStageOrder(c.req.valid("json")), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_GUARDRAIL_CREATE, guardrail.id, { slug: guardrail.slug, kind: guardrail.kind, mode: guardrail.mode });
  return ok(c, guardrail, 201);
});

aiGuardrails.put("/:id", MANAGE, zValidator("json", guardrailSchema.merge(versionSchema)), async (c) => {
  const { version, ...body } = c.req.valid("json");
  const guardrail = await service.updateGuardrail(requireParam(c, "id"), withStageOrder(body), version, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_GUARDRAIL_UPDATE, guardrail.id, { slug: guardrail.slug, version: guardrail.version });
  return ok(c, guardrail);
});

aiGuardrails.patch("/:id/state", MANAGE, zValidator("json", z.object({ mode: z.enum(GUARDRAIL_MODES).optional(), enabled: z.boolean().optional() }).merge(versionSchema)), async (c) => {
  const { version, mode, enabled } = c.req.valid("json");
  if (mode === undefined && enabled === undefined) throw AppError.badRequest("Send a mode or an enabled flag");
  const guardrail = await service.setGuardrailState(requireParam(c, "id"), { mode, enabled }, version, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_GUARDRAIL_UPDATE, guardrail.id, { slug: guardrail.slug, mode: guardrail.mode, enabled: guardrail.enabled });
  return ok(c, guardrail);
});

aiGuardrails.post("/reorder", MANAGE, zValidator("json", z.object({ ids: z.array(z.string().min(1)).max(500) })), async (c) => {
  const saved = await service.reorderGuardrails(c.req.valid("json").ids, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_GUARDRAIL_UPDATE, "order", { ids: saved.map((g) => g.id) });
  return ok(c, { guardrails: saved });
});

aiGuardrails.delete("/:id", MANAGE, async (c) => {
  const id = requireParam(c, "id");
  await service.deleteGuardrail(id, versionQuery(c), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_GUARDRAIL_DELETE, id);
  return ok(c, { deleted: true });
});

aiGuardrails.post("/:id/reset", MANAGE, async (c) => {
  const guardrail = await service.resetGuardrail(requireParam(c, "id"), actor(c));
  await audit(c, AUDIT_ACTIONS.AI_REGISTRY_RESET, guardrail.id, { slug: guardrail.slug });
  return ok(c, guardrail);
});

aiGuardrails.post("/revisions/:id/rollback", MANAGE, async (c) => {
  const revision = await getRevision(requireParam(c, "id"));
  if (!revision || revision.entity !== "guardrail" || !revision.snapshot || typeof revision.snapshot !== "object") throw AppError.notFound("Revision not found");
  const guardrail = await service.rollbackGuardrail(revision.snapshot as GuardrailDef, actor(c));
  await audit(c, AUDIT_ACTIONS.AI_REGISTRY_ROLLBACK, guardrail.id, { revisionId: revision.id });
  return ok(c, guardrail);
});

// ============================================
// Test on sample text (nothing is stored)
// ============================================

const testSchema = z.object({
  guardrail: guardrailSchema,
  stage: z.enum(GUARDRAIL_STAGES),
  /** Sample text; a tool result may be JSON. For the tool call stage, the tool and its arguments. */
  text: z.string().max(1024 * 1024),
  tool: z.string().max(100).optional(),
  args: z.record(z.unknown()).optional(),
});

aiGuardrails.post("/test", MANAGE, zValidator("json", testSchema), async (c) => {
  const body = c.req.valid("json");
  const input = withStageOrder(body.guardrail);
  const problems = (await import("../services/ai/guardrails/kinds")).guardrailProblems(input);
  if (problems.length > 0) throw AppError.badRequest(problems.join("; "), { problems });
  if (!input.stages.includes(body.stage)) throw AppError.badRequest(`The guardrail does not run at the ${body.stage.replace("_", " ")} stage`);
  // The test always enforces, so the result shows what the guardrail would do.
  const draft: GuardrailDef = {
    ...input, mode: "enforce", enabled: true, id: "test", isSystem: false, seedHash: null, customized: false, version: 0, createdAt: 0, updatedAt: 0, createdBy: null,
  };
  const events: GuardrailEvent[] = [];
  const runner = new GuardrailRunner([draft], {
    featureId: null, permissions: c.get("rbacPermissions") ?? [], isAdmin: isAdmin(c), estimateRows: null,
    judge: judgeText, record: (e) => events.push(e),
  });
  const meta = { agentPath: null, tool: body.tool ?? null };
  try {
    let output: string;
    if (body.stage === "tool_call") {
      const notes = await runner.checkToolCall([draft], body.tool ?? "", body.args ?? {}, meta);
      output = notes.join("\n");
    } else if (body.stage === "tool_result") {
      output = await runner.checkToolResult([draft], body.text, meta);
    } else {
      output = await runner.checkText(body.stage, [draft], body.text, meta);
    }
    return ok(c, { outcome: events.length > 0 ? "matched" : "no-match", output, events });
  } catch (error) {
    if (error instanceof GuardrailBlockedError) return ok(c, { outcome: "blocked", output: error.message, events });
    throw error;
  }
});

// ============================================
// Draft with AI
// ============================================

aiGuardrails.post("/draft", MANAGE, async (c) => {
  const cap = getCapability("draft-guardrail");
  if (!cap || !isStructured(cap)) throw AppError.internal("The guardrail drafter is not registered");
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  if (!isAdmin(c) && !permissions.includes(cap.permission)) throw AppError.forbidden(`Drafting with AI needs '${cap.permission}'`);
  if (!(await isAIEnabled().catch(() => false))) throw AppError.badRequest("No AI model is configured.");
  const parsed = cap.inputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const result = await runStructuredCapability(cap, parsed.data, {
    userId: actor(c),
    isAdmin: isAdmin(c),
    // MANAGE already verified ai_guardrails:manage, possibly against the database.
    permissions: [...permissions, PERMISSIONS.AI_GUARDRAILS_MANAGE],
    modelId: c.req.query("modelId") || undefined,
  });
  return ok(c, result);
});

export default aiGuardrails;
