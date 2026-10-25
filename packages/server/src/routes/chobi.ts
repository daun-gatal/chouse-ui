/**
 * /api/chobi — Chobi, the CHouse buddy (ADR 0025 §6).
 *
 *   GET /briefing   the Now tab: what needs a look across the viewer's connections (ai:chat)
 *   GET /settings   plain mode, nudges and Need You alerts for the organization (ai:chat)
 *   PUT /settings   change them (ai_agents:manage, audited)
 */

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware, requirePermission } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS, PERMISSIONS, SYSTEM_ROLES } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import { buildBriefing, type Briefing } from "../services/chobi/briefing";
import { chobiSettingsUpdateSchema, getChobiSettings, saveChobiSettings, type StoredChobiSettings } from "../services/chobi/settings";
import { InProcessApiClient } from "../services/ai/registry/inProcessApi";
import { getChannel } from "../services/alerting/store";
import { publicBaseUrl } from "../services/alerting/notify/links";
import { AppError } from "../types";

const chobi = new Hono();
chobi.use("*", rbacAuthMiddleware);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(c: Context, data: unknown): any {
  return c.json({ success: true, data });
}

/** A briefing is many reads; one per user per window is plenty for a tab people glance at. */
const BRIEFING_TTL_MS = 30_000;
const MAX_CACHED_BRIEFINGS = 500;
const briefings = new Map<string, { value: Briefing; expiresAt: number }>();

/** The cache key covers what decides the briefing's content: the user and the permissions in this token. */
function cacheKey(userId: string, permissions: readonly string[], superAdmin: boolean): string {
  return `${userId}|${superAdmin ? "*" : [...permissions].sort().join(",")}`;
}

export function resetBriefingCache(): void {
  briefings.clear();
}

function settingsView(settings: StoredChobiSettings): Pick<StoredChobiSettings, "plainMode" | "nudges" | "alerts" | "memorySuggestions" | "updatedAt"> & { publicBaseUrl: boolean } {
  return { plainMode: settings.plainMode, nudges: settings.nudges, alerts: settings.alerts, memorySuggestions: settings.memorySuggestions, updatedAt: settings.updatedAt, publicBaseUrl: publicBaseUrl() !== null };
}

chobi.get("/briefing", requirePermission(PERMISSIONS.AI_CHAT), async (c) => {
  const user = getRbacUser(c);
  const permissions: string[] = c.get("rbacPermissions") ?? [];
  const superAdmin = user.roles.includes(SYSTEM_ROLES.SUPER_ADMIN);
  const key = cacheKey(user.sub, permissions, superAdmin);
  const now = Date.now();
  const fresh = c.req.query("fresh") === "1";
  const cached = briefings.get(key);
  if (cached && cached.expiresAt > now && !fresh) return ok(c, cached.value);

  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (!token) throw AppError.unauthorized("Sign in again to load the briefing.");
  const value = await buildBriefing(new InProcessApiClient(token), { id: user.sub, permissions, superAdmin }, now);
  if (briefings.size >= MAX_CACHED_BRIEFINGS) {
    for (const [k, entry] of briefings) if (entry.expiresAt <= now) briefings.delete(k);
    if (briefings.size >= MAX_CACHED_BRIEFINGS) briefings.delete(briefings.keys().next().value ?? "");
  }
  briefings.set(key, { value, expiresAt: now + BRIEFING_TTL_MS });
  return ok(c, value);
});

chobi.get("/settings", requirePermission(PERMISSIONS.AI_CHAT), async (c) => {
  return ok(c, settingsView(await getChobiSettings()));
});

chobi.put("/settings", requirePermission(PERMISSIONS.AI_AGENTS_MANAGE), zValidator("json", chobiSettingsUpdateSchema), async (c) => {
  const update = c.req.valid("json");
  const user = getRbacUser(c);
  for (const target of update.alerts?.channels ?? []) {
    if (!(await getChannel(target.channelId))) throw AppError.badRequest(`Channel ${target.channelId} not found`);
  }
  if (update.alerts && new Set(update.alerts.channels.map((t) => t.channelId)).size !== update.alerts.channels.length) {
    throw AppError.badRequest("A channel is listed twice");
  }
  const saved = await saveChobiSettings(update, user.sub);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CHOBI_SETTINGS_UPDATE, user.sub, {
    resourceType: "chobi_settings",
    details: { ...update },
  });
  return ok(c, settingsView(saved));
});

export default chobi;
