/**
 * `/api/oauth` — the consent page and each person's connected agents (ADR 0028 §4, §5).
 *
 *   GET    /requests/:id           a sign-in waiting for a decision, and what can be granted
 *   POST   /requests/:id/approve   create the grant; returns where to send the browser
 *   POST   /requests/:id/deny      returns where to send the browser
 *   GET    /grants                 your connected agents
 *   DELETE /grants/:id             revoke one of yours
 *
 * Browser sessions only: a token (a PAT or an agent's own access) can never
 * approve a sign-in or manage grants.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requireJwtSession } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { getMcpSettings, type StoredMcpSettings } from "../mcp/settings";
import { resolveIssuer } from "../mcp/oauth/issuer";
import { redirectLabel } from "../mcp/oauth/redirects";
import { withParams } from "../mcp/oauth/routes";
import { createGrant, decideRequest, getClient, getPendingRequest, listGrants, revokeGrant } from "../mcp/oauth/store";
import { DEFAULT_TOKEN_POLICY, getTokenPolicy, saveTokenPolicy, tokenPolicySchema, type TokenPolicy } from "../services/ai/actions/tokenPolicy";
import { AppError, requireParam } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_CHOICES = [1, 7, 30, 90, 180, 365];

/** The lifetimes a person may pick: the usual steps up to the administrator's limit, and the limit itself. */
export function grantDayChoices(maxDays: number): number[] {
  return [...new Set([...DAY_CHOICES.filter((d) => d < maxDays), maxDays])].sort((a, b) => a - b);
}

/** A policy held to what the administrator allows over MCP and what the person may do at all. */
export function clampPolicy(policy: TokenPolicy, settings: Pick<StoredMcpSettings, "actionToolkits">, canAct: boolean): TokenPolicy {
  return { ...policy, toolkits: canAct ? policy.toolkits.filter((t) => settings.actionToolkits.includes(t)) : [] };
}

const oauth = new Hono();
oauth.use("*", rbacAuthMiddleware);
oauth.use("*", async (c, next) => {
  requireJwtSession(c);
  await next();
});

async function oauthSettings(): Promise<{ settings: StoredMcpSettings; issuer: string }> {
  const settings = await getMcpSettings();
  const issuer = resolveIssuer(settings);
  if (!settings.enabled || !settings.oauthEnabled || !issuer.ok) throw AppError.notFound("Signing in to MCP with OAuth is not turned on.");
  return { settings, issuer: issuer.value.issuer };
}

async function pending(id: string): Promise<NonNullable<Awaited<ReturnType<typeof getPendingRequest>>>> {
  const request = await getPendingRequest(id);
  if (!request) throw AppError.notFound("This sign-in request has expired or was already answered. Start again from your agent.");
  return request;
}

oauth.get("/requests/:id", async (c) => {
  const { settings } = await oauthSettings();
  const request = await pending(requireParam(c, "id"));
  const client = await getClient(request.clientId);
  if (!client) throw AppError.notFound("This sign-in request has expired or was already answered. Start again from your agent.");
  const user = getRbacUser(c);
  const canAct = (c.get("rbacPermissions") ?? []).includes(PERMISSIONS.AI_ACT);
  return c.json({
    success: true,
    data: {
      request: { id: request.id, expiresAt: request.expiresAt },
      client: { id: client.id, name: client.name, status: client.status, returnsTo: redirectLabel(request.redirectUri), clientUri: client.clientUri },
      user: { email: user.email, username: user.username },
      canAct,
      ceiling: { toolkits: settings.actionToolkits, maxTier: settings.actionMaxTier },
      defaults: clampPolicy(DEFAULT_TOKEN_POLICY, settings, canAct),
      dayChoices: grantDayChoices(settings.oauthMaxGrantDays),
      defaultDays: Math.min(90, settings.oauthMaxGrantDays),
    },
  });
});

oauth.post(
  "/requests/:id/approve",
  zValidator("json", z.object({ policy: tokenPolicySchema, days: z.number().int().min(1) })),
  async (c) => {
    const { settings, issuer } = await oauthSettings();
    const request = await pending(requireParam(c, "id"));
    const client = await getClient(request.clientId);
    if (!client || client.status !== "allowed") throw AppError.forbidden("This agent is not allowed to sign in.");
    const { policy, days } = c.req.valid("json");
    if (!grantDayChoices(settings.oauthMaxGrantDays).includes(days)) {
      throw AppError.badRequest(`Pick how long access lasts: ${grantDayChoices(settings.oauthMaxGrantDays).join(", ")} days.`);
    }
    const user = getRbacUser(c);
    const canAct = (c.get("rbacPermissions") ?? []).includes(PERMISSIONS.AI_ACT);
    const now = Date.now();
    const grantId = await createGrant(user.sub, client, now + days * DAY_MS, now);
    const granted = clampPolicy(policy, settings, canAct);
    await saveTokenPolicy(grantId, granted);
    const decided = await decideRequest(request.id, user.sub, { approved: true, grantId }, now);
    if (!decided?.code) {
      await revokeGrant(grantId);
      throw AppError.conflict("This sign-in request was already answered. Start again from your agent.");
    }
    await createAuditLogWithContext(c, AUDIT_ACTIONS.OAUTH_GRANT_CREATE, user.sub, {
      resourceType: "oauth_grant",
      resourceId: grantId,
      details: { clientId: client.id, clientName: client.name, days, ...granted },
      status: "success",
    });
    return c.json({
      success: true,
      data: { redirectUrl: withParams(request.redirectUri, { code: decided.code, state: request.state, iss: issuer }), clientName: client.name, days, policy: granted },
    });
  },
);

oauth.post("/requests/:id/deny", async (c) => {
  const { issuer } = await oauthSettings();
  const request = await pending(requireParam(c, "id"));
  const user = getRbacUser(c);
  const decided = await decideRequest(request.id, user.sub, { approved: false });
  if (!decided) throw AppError.conflict("This sign-in request was already answered. Start again from your agent.");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.OAUTH_GRANT_DENY, user.sub, {
    resourceType: "oauth_client",
    resourceId: request.clientId,
    status: "success",
  });
  return c.json({
    success: true,
    data: { redirectUrl: withParams(request.redirectUri, { error: "access_denied", error_description: "The person denied access.", state: request.state, iss: issuer }) },
  });
});

oauth.get("/grants", async (c) => {
  const user = getRbacUser(c);
  const grants = await listGrants({ userId: user.sub });
  const withPolicies = await Promise.all(grants.map(async (grant) => ({
    id: grant.id,
    clientId: grant.clientId,
    clientName: grant.clientName,
    clientStatus: grant.clientStatus,
    returnsTo: grant.redirectUris.length ? redirectLabel(grant.redirectUris[0]) : null,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    lastUsedAt: grant.lastUsedAt,
    policy: await getTokenPolicy(grant.id),
  })));
  return c.json({ success: true, data: { grants: withPolicies } });
});

oauth.delete("/grants/:id", async (c) => {
  const user = getRbacUser(c);
  const id = requireParam(c, "id");
  if (!(await listGrants({ userId: user.sub })).some((grant) => grant.id === id)) throw AppError.notFound("Connected app not found");
  await revokeGrant(id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.OAUTH_GRANT_REVOKE, user.sub, {
    resourceType: "oauth_grant",
    resourceId: id,
    details: { by: "owner" },
    status: "success",
  });
  return c.json({ success: true });
});

export default oauth;
