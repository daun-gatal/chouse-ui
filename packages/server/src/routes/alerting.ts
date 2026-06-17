/**
 * Alerting routes (/api/alerting)
 *
 * Manage the normalized alerting model from Admin → Settings → Alerting:
 * notification channels (where to deliver), a read view of alert rules and their
 * channel links, and recent alert events. Channel secrets are encrypted by the
 * store and never returned to the client — list/get expose a `configured` map
 * instead. Mutations are gated by alerting:edit and audited.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { rbacAuthMiddleware, requirePermission, getRbacUser } from "../rbac/middleware/rbacAuth";
import { PERMISSIONS, AUDIT_ACTIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { logger } from "../utils/logger";
import {
  ChannelType,
  CHANNEL_TYPES,
  isChannelType,
  AlertSourceType,
  AlertSeverity,
} from "../services/alerting/types";
import * as store from "../services/alerting/store";
import { sendChannelTest } from "../services/alerting/deliver";

const alerting = new Hono();

alerting.use("*", rbacAuthMiddleware);

function userId(c: Context): string | undefined {
  try {
    return getRbacUser(c).sub;
  } catch {
    return undefined;
  }
}

// --- per-type config validation ---------------------------------------------

/**
 * Validate + clean an incoming channel config for its type. On create, required
 * secrets must be present; on update a blank secret means "keep existing" and is
 * dropped here (the store merges the previous encrypted value). Returns the
 * cleaned config or throws a message for the route to surface as 400.
 */
function cleanChannelConfig(
  type: ChannelType,
  raw: Record<string, unknown>,
  isCreate: boolean,
): Record<string, unknown> {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  switch (type) {
    case ChannelType.Slack:
    case ChannelType.GoogleChat: {
      const webhookUrl = str(raw.webhookUrl);
      if (isCreate && !webhookUrl) throw new Error("webhookUrl is required");
      return webhookUrl ? { webhookUrl } : {};
    }
    case ChannelType.Webhook: {
      const url = str(raw.url);
      if (!url) throw new Error("url is required");
      const secret = str(raw.secret);
      return secret ? { url, secret } : { url };
    }
    case ChannelType.Email: {
      const host = str(raw.host) || "smtp.gmail.com";
      const port = Number(raw.port) || 465;
      const secure = raw.secure !== undefined ? Boolean(raw.secure) : true;
      const user = str(raw.user);
      const to = str(raw.to);
      const from = str(raw.from) || user;
      const password = str(raw.password);
      if (!user) throw new Error("user is required");
      if (!to) throw new Error("to is required");
      if (isCreate && !password) throw new Error("password is required");
      const out: Record<string, unknown> = { host, port, secure, user, to, from };
      if (password) out.password = password;
      return out;
    }
    default:
      throw new Error(`Unknown channel type: ${type}`);
  }
}

const channelBodySchema = z.object({
  name: z.string().min(1).max(120),
  type: z.nativeEnum(ChannelType),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
});

// --- channels ---------------------------------------------------------------

alerting.get("/channels", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const channels = await store.listChannels();
  const data = channels.map((ch) => {
    const stored = JSON.parse(ch.config) as Record<string, unknown>;
    const { config, configured } = store.maskChannelConfig(ch.type, stored);
    return {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      enabled: ch.enabled,
      config,
      configured,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    };
  });
  return c.json({ success: true, data });
});

alerting.post(
  "/channels",
  requirePermission(PERMISSIONS.ALERTING_EDIT),
  zValidator("json", channelBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    let config: Record<string, unknown>;
    try {
      config = cleanChannelConfig(body.type, body.config, true);
    } catch (err) {
      return c.json({ success: false, error: err instanceof Error ? err.message : "Invalid config" }, 400);
    }
    const id = await store.createChannel(
      { name: body.name, type: body.type, enabled: body.enabled, config },
      userId(c),
    );
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_CREATE, userId(c), {
      resourceType: "notification_channel",
      resourceId: id,
      details: { name: body.name, type: body.type },
    });
    return c.json({ success: true, data: { id } }, 201);
  },
);

alerting.put(
  "/channels/:id",
  requirePermission(PERMISSIONS.ALERTING_EDIT),
  zValidator("json", channelBodySchema),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    let config: Record<string, unknown>;
    try {
      config = cleanChannelConfig(body.type, body.config, false);
    } catch (err) {
      return c.json({ success: false, error: err instanceof Error ? err.message : "Invalid config" }, 400);
    }
    const ok = await store.updateChannel(id, {
      name: body.name,
      type: body.type,
      enabled: body.enabled,
      config,
    });
    if (!ok) return c.json({ success: false, error: "Channel not found" }, 404);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_UPDATE, userId(c), {
      resourceType: "notification_channel",
      resourceId: id,
      details: { name: body.name, type: body.type },
    });
    return c.json({ success: true });
  },
);

alerting.delete("/channels/:id", requirePermission(PERMISSIONS.ALERTING_DELETE), async (c) => {
  const id = c.req.param("id");
  const existing = await store.getChannel(id);
  if (!existing) return c.json({ success: false, error: "Channel not found" }, 404);
  const usage = await store.countRulesUsingChannel(id);
  if (usage > 0) {
    return c.json(
      { success: false, error: `Channel is used by ${usage} rule${usage === 1 ? "" : "s"}; detach it first.` },
      409,
    );
  }
  await store.deleteChannel(id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_DELETE, userId(c), {
    resourceType: "notification_channel",
    resourceId: id,
    details: { name: existing.name, type: existing.type },
  });
  return c.json({ success: true });
});

alerting.post("/channels/:id/test", requirePermission(PERMISSIONS.ALERTING_EDIT), async (c) => {
  const id = c.req.param("id");
  const ch = await store.getChannel(id);
  if (!ch) return c.json({ success: false, error: "Channel not found" }, 404);
  const stored = JSON.parse(ch.config) as Record<string, unknown>;
  const decrypted = store.decryptChannelConfig(ch.type, stored);
  try {
    await sendChannelTest(ch.type, decrypted);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_TEST, userId(c), {
      resourceType: "notification_channel",
      resourceId: id,
      status: "success",
      details: { type: ch.type },
    });
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delivery failed";
    logger.warn({ module: "Alerting", channelId: id, err: message }, "Channel test failed");
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_TEST, userId(c), {
      resourceType: "notification_channel",
      resourceId: id,
      status: "failed",
      errorMessage: message,
      details: { type: ch.type },
    });
    return c.json({ success: false, error: message }, 502);
  }
});

// --- rules (read) -----------------------------------------------------------

alerting.get("/rules", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const rules = await store.listRules();
  const data = await Promise.all(
    rules.map(async (r) => ({
      id: r.id,
      name: r.name,
      sourceType: r.sourceType,
      severity: r.severity,
      enabled: r.enabled,
      aiRcaEnabled: r.aiRcaEnabled,
      aiRcaModelId: r.aiRcaModelId,
      config: JSON.parse(r.config) as Record<string, unknown>,
      channelIds: await store.getRuleChannelIds(r.id),
    })),
  );
  return c.json({ success: true, data });
});

const ruleBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  enabled: z.boolean(),
  aiRcaEnabled: z.boolean().optional().default(false),
  aiRcaModelId: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  channelIds: z.array(z.string()).default([]),
});

const createRuleBodySchema = ruleBodySchema.extend({
  name: z.string().min(1).max(120),
  sourceType: z.nativeEnum(AlertSourceType).optional().default(AlertSourceType.FleetThreshold),
});

/** Create a new rule with its channel links. */
alerting.post(
  "/rules",
  requirePermission(PERMISSIONS.ALERTING_EDIT),
  zValidator("json", createRuleBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    // Only one fleet rule may be enabled at a time.
    if (body.enabled && body.sourceType === AlertSourceType.FleetThreshold) {
      const other = await store.findOtherEnabledFleetRule(null);
      if (other) {
        return c.json(
          { success: false, error: `Fleet rule "${other.name}" is already enabled; disable it before enabling another.` },
          409,
        );
      }
    }
    const id = await store.createRule({
      name: body.name,
      sourceType: body.sourceType,
      severity: body.severity ?? AlertSeverity.Warning,
      enabled: body.enabled,
      aiRcaEnabled: body.aiRcaEnabled,
      aiRcaModelId: body.aiRcaModelId ?? null,
      config: body.config,
    });
    await store.setRuleChannels(id, body.channelIds);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.FLEET_ALERT_CONFIG_UPDATE, userId(c), {
      resourceType: "alert_rule",
      resourceId: id,
      details: { created: true, channels: body.channelIds.length },
    });
    return c.json({ success: true, data: { id } }, 201);
  },
);

/**
 * Update a rule's settings + its channel links (used by the Settings → Alerting
 * rule editor). Upserts by id so the well-known fleet rule self-heals if it
 * doesn't exist yet; source type and name are preserved unless given.
 */
alerting.put(
  "/rules/:id",
  requirePermission(PERMISSIONS.ALERTING_EDIT),
  zValidator("json", ruleBodySchema),
  async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const existing = await store.getRule(id);

    // Only one fleet rule may be enabled at a time.
    const willBeFleet = (existing?.sourceType ?? AlertSourceType.FleetThreshold) === AlertSourceType.FleetThreshold;
    if (body.enabled && willBeFleet) {
      const other = await store.findOtherEnabledFleetRule(id);
      if (other) {
        return c.json(
          { success: false, error: `Fleet rule "${other.name}" is already enabled; disable it before enabling another.` },
          409,
        );
      }
    }

    await store.upsertRule({
      id,
      name: body.name ?? existing?.name ?? "Fleet thresholds",
      // Only fleet_threshold rules are editable today; default to it when the
      // well-known fleet rule doesn't exist yet (fresh install, never configured).
      sourceType: existing?.sourceType ?? AlertSourceType.FleetThreshold,
      severity: body.severity ?? existing?.severity ?? AlertSeverity.Warning,
      enabled: body.enabled,
      aiRcaEnabled: body.aiRcaEnabled,
      aiRcaModelId: body.aiRcaModelId ?? null,
      config: body.config,
    });
    await store.setRuleChannels(id, body.channelIds);

    await createAuditLogWithContext(c, AUDIT_ACTIONS.FLEET_ALERT_CONFIG_UPDATE, userId(c), {
      resourceType: "alert_rule",
      resourceId: id,
      details: { channels: body.channelIds.length, aiRca: body.aiRcaEnabled },
    });
    return c.json({ success: true });
  },
);

alerting.delete("/rules/:id", requirePermission(PERMISSIONS.ALERTING_DELETE), async (c) => {
  const id = c.req.param("id");
  const existing = await store.getRule(id);
  if (!existing) return c.json({ success: false, error: "Rule not found" }, 404);
  if (existing.enabled) {
    return c.json({ success: false, error: "Rule is enabled; disable it first." }, 409);
  }
  await store.deleteRule(id);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.FLEET_ALERT_CONFIG_UPDATE, userId(c), {
    resourceType: "alert_rule",
    resourceId: id,
    details: { deleted: true, name: existing.name },
  });
  return c.json({ success: true });
});

// --- events -----------------------------------------------------------------

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

alerting.get(
  "/events",
  requirePermission(PERMISSIONS.ALERTING_VIEW),
  zValidator("query", eventsQuerySchema),
  async (c) => {
    const { limit } = c.req.valid("query");
    const events = await store.listEvents(limit);
    return c.json({ success: true, data: events });
  },
);

const clearEventsQuerySchema = z.object({
  /** Clear events fired at or before this epoch-ms cutoff. Omit to clear all. */
  before: z.coerce.number().int().positive().optional(),
});

/** Clear recent alerts — all, or only those older than a `before` cutoff. */
alerting.delete(
  "/events",
  requirePermission(PERMISSIONS.ALERTING_DELETE),
  zValidator("query", clearEventsQuerySchema),
  async (c) => {
    const { before } = c.req.valid("query");
    await store.clearEvents(before);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_EVENTS_CLEAR, userId(c), {
      resourceType: "alert_event",
      details: before ? { before } : { all: true },
    });
    return c.json({ success: true });
  },
);

// --- meta -------------------------------------------------------------------

alerting.get("/channel-types", requirePermission(PERMISSIONS.ALERTING_VIEW), (c) => {
  return c.json({ success: true, data: CHANNEL_TYPES.filter(isChannelType) });
});

export default alerting;
