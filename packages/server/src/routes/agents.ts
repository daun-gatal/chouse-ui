/**
 * `/api/agents` — agent governance (ADR 0016 §10).
 *
 * Permission map:
 *   summary, sessions, tool calls, policies   agents:view
 *   (tool-call arguments of other users are shown only with query:history:view:all)
 *   policy upsert / delete, pause switch      agents:manage
 *   MCP settings and tool catalog (read)      agents:view
 *   MCP settings and tool switches (write)    agents:manage
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import * as agents from "../services/agents/store";
import { listToolDefinitions, MCP_PATH, toolCatalog } from "../mcp/server";
import { getMcpSettings, mcpSettingsUpdateSchema, saveMcpSettings, type StoredMcpSettings } from "../mcp/settings";
import { resolveIssuer, resourceMetadataUrl } from "../mcp/oauth/issuer";
import { redirectLabel } from "../mcp/oauth/redirects";
import { listClients, listGrants, revokeGrant, setClientStatus } from "../mcp/oauth/store";
import { AppError, requireParam } from "../types";
import { canSeeAllQueryText } from "./observe/access";
import { principalLabels } from "../services/observe/principals";
import { describeAgentClient } from "../services/agents/clients";
import { all, sql, str, strOrNull } from "../services/observe/db";

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

/** Role names → display names for each user, in one query. */
async function rolesByUser(userIds: string[]): Promise<Map<string, Array<{ name: string; label: string }>>> {
  const out = new Map<string, Array<{ name: string; label: string }>>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return out;
  const rows = await all(sql`
    SELECT ur.user_id, r.name, r.display_name FROM rbac_user_roles ur JOIN rbac_roles r ON r.id = ur.role_id
    WHERE ur.user_id IN (${sql.join(unique.map((id) => sql`${id}`), sql`, `)}) ORDER BY r.priority DESC, r.display_name`);
  for (const r of rows) {
    const list = out.get(str(r.user_id)) ?? [];
    list.push({ name: str(r.name), label: strOrNull(r.display_name) || str(r.name) });
    out.set(str(r.user_id), list);
  }
  return out;
}

interface SessionPolicy {
  source: agents.AppliedPolicy["source"];
  /** What the applied policy targets, by display name. */
  label: string;
  dailyBytes: number | null;
}

/**
 * Sessions record token and user ids; the UI shows the client, the token and
 * its owner, the user's roles and the policy that governs it, all by name.
 */
async function withNames<T extends agents.AgentSession>(sessions: T[]): Promise<Array<T & { patName: string | null; userName: string | null; roles: Array<{ name: string; label: string }>; policy: SessionPolicy }>> {
  const patIds = [...new Set(sessions.flatMap((s) => (s.patId ? [s.patId] : [])))];
  const [labels, tokenNames, roles, policies] = await Promise.all([
    principalLabels(sessions.flatMap((s) => (s.userId ? [{ kind: "person", id: s.userId }] : []))),
    patIds.length
      ? all(sql`SELECT id, name FROM rbac_api_keys WHERE id IN (${sql.join(patIds.map((id) => sql`${id}`), sql`, `)})`).then((rows) => new Map(rows.map((r) => [str(r.id), str(r.name)])))
      : Promise.resolve(new Map<string, string>()),
    rolesByUser(sessions.flatMap((s) => (s.userId ? [s.userId] : []))),
    agents.listPolicies(),
  ]);
  return Promise.all(sessions.map(async (s) => {
    const userRoles = s.userId ? roles.get(s.userId) ?? [] : [];
    const applied = await agents.appliedPolicy(s.patId, userRoles.map((r) => r.name), policies);
    const roleLabel = (name: string): string => userRoles.find((r) => r.name === name)?.label ?? name;
    return {
      ...s,
      // Normalized at read time too, so sessions recorded before client detection read the same way.
      clientName: describeAgentClient(s.clientName),
      patName: s.patId ? tokenNames.get(s.patId) ?? "Deleted token" : null,
      userName: s.userId ? labels.get(`person:${s.userId}`) ?? null : null,
      roles: userRoles,
      policy: {
        source: applied.source,
        label: applied.source === "pat" ? "This token" : applied.source === "role" ? applied.scopeIds.map(roleLabel).join(", ") : applied.source === "default" ? "Default" : "No policy",
        dailyBytes: applied.policy.dailyBytes,
      },
    };
  }));
}

agentsRoute.get("/sessions", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => {
  const days = Math.min(30, Math.max(1, Number(c.req.query("days") ?? 1)));
  return ok(c, { sessions: await withNames(await agents.listSessions(Date.now() - days * 86_400_000)) });
});

agentsRoute.get("/sessions/:id", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => {
  const session = await agents.getSession(requireParam(c, "id"));
  if (!session) throw AppError.notFound("Session not found");
  const own = session.userId === getRbacUser(c).sub;
  const calls = await agents.listToolCalls(session.id);
  return ok(c, { session: (await withNames([session]))[0], calls: own || canSeeAllQueryText(c) ? calls : calls.map((call) => ({ ...call, argsSummary: call.argsSummary ? "(hidden: needs query:history:view:all)" : null })) });
});

agentsRoute.get("/policies", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => ok(c, { policies: await agents.withScopeLabels(await agents.listPolicies()) }));

/** What a policy can be scoped to, by display name: every role and every active token. */
agentsRoute.get("/policy-scopes", requirePermission(PERMISSIONS.AGENTS_MANAGE), async (c) => ok(c, await agents.listPolicyScopes()));

agentsRoute.put("/policies", requirePermission(PERMISSIONS.AGENTS_MANAGE), zValidator("json", agents.policyInputSchema), async (c) => {
  const input = c.req.valid("json");
  if (!(await agents.policyScopeExists(input.scopeKind, input.scopeId))) {
    throw AppError.badRequest(input.scopeKind === "role" ? "That role does not exist" : input.scopeKind === "pat" ? "That token does not exist or was revoked" : "The default policy applies to every agent");
  }
  const policy = await agents.upsertPolicy(input, getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_POLICY_UPDATE, getRbacUser(c).sub, { resourceType: "agent_policy", resourceId: policy.id, details: { scopeKind: policy.scopeKind, scopeId: policy.scopeId } });
  return ok(c, policy);
});

const policyTargetSchema = agents.policyInputSchema.pick({ scopeKind: true, scopeId: true });
const policyAssignSchema = z.object({
  settings: agents.policyInputSchema.omit({ scopeKind: true, scopeId: true }),
  /** Everything the policy applies to; each target keeps a single policy, so assigning one moves it here. */
  targets: z.array(policyTargetSchema).min(1).max(200),
  /** Policies of the group being edited whose target was deselected. */
  removeIds: z.array(z.string().min(1).max(100)).max(200).default([]),
});

/** One policy, many roles / tokens: the same limits written to every target (the wizard's save). */
agentsRoute.put("/policies/assign", requirePermission(PERMISSIONS.AGENTS_MANAGE), zValidator("json", policyAssignSchema), async (c) => {
  const { settings, targets, removeIds } = c.req.valid("json");
  // Validate every target before writing anything, so a bad pick never leaves a half-saved policy.
  for (const t of targets) {
    if (!(await agents.policyScopeExists(t.scopeKind, t.scopeId))) {
      throw AppError.badRequest(t.scopeKind === "role" ? `Role '${t.scopeId}' does not exist` : t.scopeKind === "pat" ? "A selected token does not exist or was revoked" : "The default policy applies to every agent");
    }
  }
  const actor = getRbacUser(c).sub;
  const saved: agents.StoredPolicy[] = [];
  for (const t of targets) {
    const policy = await agents.upsertPolicy({ ...settings, ...t }, actor);
    saved.push(policy);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_POLICY_UPDATE, actor, { resourceType: "agent_policy", resourceId: policy.id, details: { scopeKind: policy.scopeKind, scopeId: policy.scopeId } });
  }
  const keep = new Set(saved.map((p) => p.id));
  for (const id of removeIds.filter((id) => !keep.has(id))) {
    await agents.deletePolicy(id);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_POLICY_UPDATE, actor, { resourceType: "agent_policy", resourceId: id, details: { deleted: true } });
  }
  return ok(c, { policies: await agents.withScopeLabels(saved) });
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

// --- MCP (ADR 0017) ---------------------------------------------------------------

/**
 * Where agents reach /mcp: the address set in AI Governance › MCP, else
 * PUBLIC_BASE_URL, else unknown here (the UI falls back to its own origin,
 * which is right whenever people and agents use the same address).
 */
function mcpEndpoint(settings: StoredMcpSettings): { path: string; url: string | null; source: "settings" | "env" | null } {
  if (settings.publicUrl) return { path: MCP_PATH, url: `${settings.publicUrl}${MCP_PATH}`, source: "settings" };
  const env = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (env) return { path: MCP_PATH, url: `${env}${MCP_PATH}`, source: "env" };
  return { path: MCP_PATH, url: null, source: null };
}

/** Where agents sign in (ADR 0028), or why they can't yet. */
function oauthView(settings: StoredMcpSettings): { issuer: string | null; metadataUrl: string | null; problem: string | null } {
  const issuer = resolveIssuer(settings);
  return issuer.ok
    ? { issuer: issuer.value.issuer, metadataUrl: resourceMetadataUrl(issuer.value), problem: null }
    : { issuer: null, metadataUrl: null, problem: issuer.reason };
}

function mcpView(settings: StoredMcpSettings): Record<string, unknown> {
  return {
    settings: {
      enabled: settings.enabled,
      allowedOrigins: settings.allowedOrigins,
      timeoutSeconds: settings.timeoutSeconds,
      publicUrl: settings.publicUrl,
      actionToolkits: settings.actionToolkits,
      actionMaxTier: settings.actionMaxTier,
      approvalWaitSeconds: settings.approvalWaitSeconds,
      oauthEnabled: settings.oauthEnabled,
      oauthPatsAllowed: settings.oauthPatsAllowed,
      oauthRegistration: settings.oauthRegistration,
      oauthRedirectHosts: settings.oauthRedirectHosts,
      oauthMaxGrantDays: settings.oauthMaxGrantDays,
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt,
    },
    endpoint: mcpEndpoint(settings),
    oauth: oauthView(settings),
    tools: toolCatalog(listToolDefinitions(), settings),
  };
}

agentsRoute.get("/mcp", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => ok(c, mcpView(await getMcpSettings())));

agentsRoute.put("/mcp", requirePermission(PERMISSIONS.AGENTS_MANAGE), zValidator("json", mcpSettingsUpdateSchema.strict()), async (c) => {
  const update = c.req.valid("json");
  const known = new Set(listToolDefinitions().map((tool) => tool.name));
  const unknown = Object.keys(update.toolOverrides ?? {}).filter((name) => !known.has(name));
  if (unknown.length > 0) throw AppError.badRequest(`Unknown MCP tool(s): ${unknown.join(", ")}`);
  const before = await getMcpSettings(0);
  // OAuth signs agents in at the public address, so it can't be on without a usable one (ADR 0028 §1).
  const oauthOn = update.oauthEnabled ?? before.oauthEnabled;
  if (oauthOn) {
    const issuer = resolveIssuer({ publicUrl: update.publicUrl === undefined ? before.publicUrl : update.publicUrl });
    if (!issuer.ok) throw AppError.badRequest(issuer.reason);
  }
  const settings = await saveMcpSettings(update, getRbacUser(c).sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.AGENT_MCP_UPDATE, getRbacUser(c).sub, {
    resourceType: "mcp_settings",
    details: {
      ...(update.enabled !== undefined && update.enabled !== before.enabled ? { enabled: update.enabled } : {}),
      ...(update.allowedOrigins ? { allowedOrigins: update.allowedOrigins } : {}),
      ...(update.timeoutSeconds !== undefined ? { timeoutSeconds: update.timeoutSeconds } : {}),
      ...(update.publicUrl !== undefined ? { publicUrl: update.publicUrl } : {}),
      ...(update.toolOverrides ? { tools: update.toolOverrides } : {}),
      ...(update.actionToolkits ? { actionToolkits: update.actionToolkits } : {}),
      ...(update.actionMaxTier ? { actionMaxTier: update.actionMaxTier } : {}),
      ...(update.approvalWaitSeconds !== undefined ? { approvalWaitSeconds: update.approvalWaitSeconds } : {}),
      ...(update.oauthEnabled !== undefined && update.oauthEnabled !== before.oauthEnabled ? { oauthEnabled: update.oauthEnabled } : {}),
      ...(update.oauthPatsAllowed !== undefined ? { oauthPatsAllowed: update.oauthPatsAllowed } : {}),
      ...(update.oauthRegistration ? { oauthRegistration: update.oauthRegistration } : {}),
      ...(update.oauthRedirectHosts ? { oauthRedirectHosts: update.oauthRedirectHosts } : {}),
      ...(update.oauthMaxGrantDays !== undefined ? { oauthMaxGrantDays: update.oauthMaxGrantDays } : {}),
    },
  });
  return ok(c, mcpView(settings));
});

// --- MCP sign-in with OAuth (ADR 0028 §5) -----------------------------------

agentsRoute.get("/mcp/oauth", requirePermission(PERMISSIONS.AGENTS_VIEW), async (c) => {
  const [clients, grants] = await Promise.all([listClients(), listGrants()]);
  return ok(c, {
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      status: client.status,
      returnsTo: [...new Set(client.redirectUris.map(redirectLabel))],
      clientUri: client.clientUri,
      people: client.people,
      createdAt: client.createdAt,
      lastUsedAt: client.lastUsedAt,
    })),
    grants: grants.map((grant) => ({
      id: grant.id,
      clientId: grant.clientId,
      clientName: grant.clientName,
      user: grant.user ? { id: grant.userId, email: grant.user.email, username: grant.user.username, displayName: grant.user.displayName } : { id: grant.userId, email: null, username: null, displayName: null },
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
      lastUsedAt: grant.lastUsedAt,
    })),
  });
});

agentsRoute.put(
  "/mcp/oauth/clients/:id",
  requirePermission(PERMISSIONS.AGENTS_MANAGE),
  zValidator("json", z.object({ status: z.enum(["allowed", "blocked"]) })),
  async (c) => {
    const id = requireParam(c, "id");
    const { status } = c.req.valid("json");
    const actor = getRbacUser(c).sub;
    const client = await setClientStatus(id, status, actor);
    if (!client) throw AppError.notFound("Agent not found");
    await createAuditLogWithContext(c, status === "allowed" ? AUDIT_ACTIONS.OAUTH_CLIENT_APPROVE : AUDIT_ACTIONS.OAUTH_CLIENT_BLOCK, actor, {
      resourceType: "oauth_client",
      resourceId: id,
      details: { name: client.name },
    });
    return ok(c, { id: client.id, status: client.status });
  },
);

agentsRoute.delete("/mcp/oauth/grants/:id", requirePermission(PERMISSIONS.AGENTS_MANAGE), async (c) => {
  const id = requireParam(c, "id");
  if (!(await revokeGrant(id))) throw AppError.notFound("Connected app not found");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.OAUTH_GRANT_REVOKE, getRbacUser(c).sub, {
    resourceType: "oauth_grant",
    resourceId: id,
    details: { by: "admin" },
  });
  return ok(c, { id });
});

export default agentsRoute;
