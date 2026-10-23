/**
 * Auto-triage (ADR 0024 §Phase 4), shown in AI Governance › Auto-triage.
 *
 *   GET /rules                one rule per trigger, today's spend, channels and agents to pick
 *   PUT /rules/:trigger       turn a trigger on or off and set its limits (ai_agents:manage)
 *   GET /runs                 what was investigated, newest first
 *   GET /runs/for-subject     the run for one incident, alert, run or report ("AI investigated")
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requireAnyPermission, requirePermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { listChannels } from "../services/alerting/store";
import { getRegistrySnapshot } from "../services/ai/registry/cache";
import { userNames } from "../services/ai/actions/store";
import { TRIAGE_TRIGGERS, TRIGGER_LABELS, type TriageTrigger } from "../services/ai/triage/subjects";
import { listRuns, listRules, runForSubject, saveRule, tokensToday, TRIAGE_RUN_STATUSES } from "../services/ai/triage/store";
import { AppError } from "../types";

const aiTriage = new Hono();
aiTriage.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

function triggerParam(c: Context): TriageTrigger {
  const value = c.req.param("trigger");
  const trigger = TRIAGE_TRIGGERS.find((t) => t === value);
  if (!trigger) throw AppError.notFound("Unknown triage trigger");
  return trigger;
}

/** People who can see the subject can see that AI looked at it. */
aiTriage.get(
  "/runs/for-subject",
  requireAnyPermission([PERMISSIONS.AI_AGENTS_VIEW, PERMISSIONS.OBSERVE_VIEW, PERMISSIONS.DATA_HEALTH_VIEW, PERMISSIONS.DOCTOR_VIEW, PERMISSIONS.SCHEDULED_QUERIES_VIEW]),
  zValidator("query", z.object({ trigger: z.enum(TRIAGE_TRIGGERS), subjectId: z.string().min(1).max(200) })),
  async (c) => {
    const { trigger, subjectId } = c.req.valid("query");
    return ok(c, await runForSubject(trigger, subjectId));
  },
);

aiTriage.get("/rules", requirePermission(PERMISSIONS.AI_AGENTS_VIEW), async (c) => {
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  const canManage = getRbacUser(c).roles.includes("super_admin") || permissions.includes(PERMISSIONS.AI_AGENTS_MANAGE);
  const [rules, channels, snapshot] = await Promise.all([listRules(), listChannels(), getRegistrySnapshot()]);
  const spent = await Promise.all(rules.map((r) => tokensToday(r.trigger)));
  const names = await userNames(rules.map((r) => r.updatedBy));
  const agents = [...snapshot.agents.values()]
    .filter((a) => a.enabled && a.kind === "agent")
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const binding = snapshot.bindings.get("triage-incident");
  return ok(c, {
    canManage,
    defaultAgentId: binding?.agentId ?? null,
    rules: rules.map((r, i) => ({ ...r, label: TRIGGER_LABELS[r.trigger], tokensToday: spent[i], updatedByName: r.updatedBy ? names.get(r.updatedBy) ?? null : null })),
    channels: channels.map((ch) => ({ id: ch.id, name: ch.name, type: ch.type, enabled: ch.enabled })),
    agents,
  });
});

const ruleBody = z.object({
  enabled: z.boolean(),
  agentId: z.string().min(1).nullable(),
  cooldownMinutes: z.number().int().min(0).max(24 * 60),
  dailyTokenBudget: z.number().int().min(1_000).max(100_000_000),
  channelIds: z.array(z.string().min(1)).max(20),
});

aiTriage.put("/rules/:trigger", requirePermission(PERMISSIONS.AI_AGENTS_MANAGE), zValidator("json", ruleBody), async (c) => {
  const trigger = triggerParam(c);
  const body = c.req.valid("json");
  const snapshot = await getRegistrySnapshot();
  if (body.agentId) {
    const agent = snapshot.agents.get(body.agentId);
    if (!agent || !agent.enabled) throw AppError.badRequest("Pick an enabled agent, or leave it empty for the default triage agent.");
  }
  const known = new Set((await listChannels()).map((ch) => ch.id));
  const missing = body.channelIds.filter((id) => !known.has(id));
  if (missing.length > 0) throw AppError.badRequest("A picked alerting channel no longer exists. Pick the channels again.");
  const user = getRbacUser(c);
  const rule = await saveRule(trigger, body, user.sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AI_TRIAGE_UPDATE, user.sub, {
    resourceType: "ai_triage", resourceId: trigger,
    details: { enabled: rule.enabled, agentId: rule.agentId, cooldownMinutes: rule.cooldownMinutes, dailyTokenBudget: rule.dailyTokenBudget, channels: rule.channelIds.length },
  });
  return ok(c, { ...rule, label: TRIGGER_LABELS[trigger], tokensToday: await tokensToday(trigger) });
});

const runsQuery = z.object({
  trigger: z.enum(TRIAGE_TRIGGERS).optional(),
  status: z.enum(TRIAGE_RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

aiTriage.get("/runs", requirePermission(PERMISSIONS.AI_AGENTS_VIEW), zValidator("query", runsQuery), async (c) => {
  return ok(c, await listRuns(c.req.valid("query")));
});

export default aiTriage;
