/**
 * `/api/agents` — agent governance (ADR 0016 §10).
 *
 * Permission map:
 *   summary, sessions, tool calls, policies   agents:view
 *   (tool-call arguments of other users are shown only with query:history:view:all)
 *   policy upsert / delete, pause switch      agents:manage
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import * as agents from "../services/agents/store";
import { AppError, requireParam } from "../types";
import { canSeeAllQueryText } from "./observe/access";

const agentsRoute = new Hono();
agentsRoute.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

agentsRoute.get("/summary", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => {
  const since = Date.now() - 24 * 3600 * 1000;
  const sessions = await agents.listSessions(since, 1000);
  return ok(c, {
    paused: await agents.isAgentAccessPaused(),
    activeAgents: new Set(sessions.map((s) => s.patId ?? s.userId)).size,
    sessions: sessions.length,
    queries: sessions.reduce((sum, s) => sum + s.queries, 0),
    readBytes: sessions.reduce((sum, s) => sum + s.readBytes, 0),
    warnings: sessions.reduce((sum, s) => sum + s.warnings, 0),
    blocked: sessions.reduce((sum, s) => sum + s.blocked, 0),
  });
});

agentsRoute.get("/sessions", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => {
  const days = Math.min(30, Math.max(1, Number(c.req.query("days") ?? 1)));
  return ok(c, { sessions: await agents.listSessions(Date.now() - days * 86_400_000) });
});

agentsRoute.get("/sessions/:id", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => {
  const session = await agents.getSession(requireParam(c, "id"));
  if (!session) throw AppError.notFound("Session not found");
  const own = session.userId === getRbacUser(c).sub;
  const calls = await agents.listToolCalls(session.id);
  return ok(c, { session, calls: own || canSeeAllQueryText(c) ? calls : calls.map((call) => ({ ...call, argsSummary: call.argsSummary ? "(hidden: needs query:history:view:all)" : null })) });
});

agentsRoute.get("/policies", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => ok(c, { policies: await agents.listPolicies() }));

agentsRoute.put("/policies", requirePermission(PERMISSIONS.AGENTS_MANAGE), zValidator("json", agents.policyInputSchema), async (c) => {
  const policy = await agents.upsertPolicy(c.req.valid("json"), getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_POLICY_UPDATE, getRbacUser(c).sub, { resourceType: "agent_policy", resourceId: policy.id, details: { scopeKind: policy.scopeKind, scopeId: policy.scopeId } });
  return ok(c, policy);
});

agentsRoute.delete("/policies/:id", requirePermission(PERMISSIONS.AGENTS_MANAGE), async (c) => {
  const id = requireParam(c, "id");
  await agents.deletePolicy(id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_POLICY_UPDATE, getRbacUser(c).sub, { resourceType: "agent_policy", resourceId: id, details: { deleted: true } });
  return ok(c, { deleted: id });
});

agentsRoute.post("/pause", requirePermission(PERMISSIONS.AGENTS_MANAGE), zValidator("json", z.object({ paused: z.boolean() })), async (c) => {
  const { paused } = c.req.valid("json");
  await agents.setAgentAccessPaused(paused, getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_ACCESS_PAUSE, getRbacUser(c).sub, { details: { paused } });
  return ok(c, { paused });
});

export default agentsRoute;
