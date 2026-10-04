/**
 * `/api/upgrades` — upgrade readiness (ADR 0016 §9).
 *
 * Permission map:
 *   rules, assessments, replays, rollout   upgrades:view
 *   run assessment / workload replay       upgrades:run (+ access to both connections)
 *   replayed query text                    query:history:view:all
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { getUserConnections, listConnections } from "../rbac/services/connections";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { all, json, num, numOrNull, sql, str, strOrNull } from "../services/observe/db";
import { getAssessment, getReplay, listAssessments, listReplays, RULES, RULES_VERSION, runAssessment, runReplay } from "../services/upgrades/assess";
import { AppError, requireParam } from "../types";
import { assertConnectionAccess, canSeeAllQueryText, scopedConnection } from "./observe/access";

const upgrades = new Hono();
upgrades.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown, status: 200 | 201 = 200): any {
  return c.json({ success: true, data }, status);
}

upgrades.get("/rules", requirePermission(PERMISSIONS.UPGRADES_VIEW), (c) => ok(c, { version: RULES_VERSION, rules: RULES }));

upgrades.get("/assessments", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const { connectionId } = await scopedConnection(c);
  return ok(c, { assessments: await listAssessments(connectionId), replays: await listReplays(connectionId) });
});

upgrades.get("/assessments/:id", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const assessment = await getAssessment(requireParam(c, "id"));
  if (!assessment) throw AppError.notFound("Assessment not found");
  await assertConnectionAccess(c, assessment.connectionId);
  return ok(c, assessment);
});

upgrades.post(
  "/assessments",
  requirePermission(PERMISSIONS.UPGRADES_RUN),
  zValidator("json", z.object({ targetVersion: z.string().trim().regex(/^\d+(\.\d+){1,3}$/, "Use a version such as 25.3") })),
  async (c) => {
    const { connectionId } = await scopedConnection(c);
    const { targetVersion } = c.req.valid("json");
    const assessment = await runAssessment(connectionId, targetVersion, getRbacUser(c).sub);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.UPGRADE_ASSESS, getRbacUser(c).sub, { resourceType: "connection", resourceId: connectionId, details: { targetVersion, verdict: assessment.verdict } });
    return ok(c, assessment, 201);
  },
);

upgrades.post(
  "/replays",
  requirePermission(PERMISSIONS.UPGRADES_RUN),
  zValidator("json", z.object({ canaryConnectionId: z.string().min(1), assessmentId: z.string().nullish(), limit: z.number().int().min(1).max(500).default(500) })),
  async (c) => {
    const { connectionId } = await scopedConnection(c);
    const body = c.req.valid("json");
    if (body.canaryConnectionId === connectionId) throw AppError.badRequest("Pick a different connection as the canary");
    await assertConnectionAccess(c, body.canaryConnectionId);
    const id = await runReplay(connectionId, body.canaryConnectionId, body.assessmentId ?? null, getRbacUser(c).sub, body.limit);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.UPGRADE_REPLAY, getRbacUser(c).sub, { resourceType: "connection", resourceId: connectionId, details: { canary: body.canaryConnectionId, replayId: id } });
    return ok(c, { id }, 201);
  },
);

upgrades.get("/replays/:id", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const replay = await getReplay(requireParam(c, "id"), canSeeAllQueryText(c));
  if (!replay) throw AppError.notFound("Replay not found");
  await assertConnectionAccess(c, String(replay.connectionId));
  return ok(c, replay);
});

/** Rollout tracker: every accessible connection's version and health gates. */
upgrades.get("/rollout", requirePermission(PERMISSIONS.UPGRADES_VIEW), async (c) => {
  const user = getRbacUser(c);
  const connections = user.roles.includes("super_admin") ? (await listConnections({ activeOnly: true })).connections : await getUserConnections(user.sub);
  const nodes = [];
  for (const conn of connections) {
    const caps = await all(sql`SELECT server_version, probed_at FROM obs_capabilities WHERE connection_id = ${conn.id}`);
    const summary = await all(sql`SELECT payload FROM fleet_snapshots WHERE connection_id = ${conn.id} AND metric = 'summary' AND error IS NULL ORDER BY captured_at DESC LIMIT 1`);
    const s = json<Array<Record<string, unknown>>>(summary[0]?.payload, [])[0] ?? {};
    const regressions = await all(sql`SELECT COUNT(*) AS n FROM obs_regressions WHERE connection_id = ${conn.id} AND status = 'open'`);
    const lag = numOrNull(s.max_replica_lag_seconds);
    nodes.push({
      connectionId: conn.id,
      name: conn.name,
      version: caps[0] ? strOrNull(caps[0].server_version) : null,
      gates: {
        replicaLagOk: lag === null ? null : lag < 10,
        replicaLagSeconds: lag,
        openRegressions: num(regressions[0]?.n),
        sickReplicas: numOrNull(s.sick_replicas),
      },
      checkedAt: caps[0] ? num(caps[0].probed_at) : null,
    });
  }
  return ok(c, { nodes: nodes.sort((a, b) => str(a.name).localeCompare(str(b.name))) });
});

export default upgrades;
