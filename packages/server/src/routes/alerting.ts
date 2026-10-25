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
import { requireParam } from "../types";
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
import { countAlertsUsingChannel } from "../services/dashboards/alertStore";
import { countReportsUsingChannel } from "../services/dashboards/reports";
import { checkChannel, sendToChannel, TEST_MESSAGE, type ChannelCheck } from "../services/alerting/notify";
import { channelHealth } from "../services/alerting/notify/log";
import { channelUsage, emptyUsage, firingNow, waitingRequests } from "../services/alerting/usage";
import { InProcessApiClient } from "../services/ai/registry/inProcessApi";
import { extractTokenFromHeader } from "../rbac/services/jwt";
import { parseServiceAccount } from "../services/alerting/notify/platforms/googleChat";
import { channelActorsSchema } from "../services/alerting/notify/actors";
import { registerTelegramWebhook } from "../services/alerting/notify/telegramWebhook";
import { getRemediationNotify, remediationNotifySchema, saveRemediationNotify } from "../services/remediation/notify";

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
 * dropped here (the store merges the previous encrypted value) — but only when
 * the channel keeps its mode: switching mode needs the new mode's secrets.
 * Returns the cleaned config or throws a message for the route to surface as 400.
 */
export function cleanChannelConfig(
  type: ChannelType,
  raw: Record<string, unknown>,
  prev: { config: Record<string, unknown>; configured: Record<string, boolean> } | null,
): Record<string, unknown> {
  const config = cleanTypeConfig(type, raw, prev);
  // Only channels that carry buttons have a "who can act from this channel" list.
  const bot = type === ChannelType.Telegram || ((type === ChannelType.Slack || type === ChannelType.GoogleChat) && config.mode === "app");
  if (!bot) return config;
  // Leaving the list out keeps the stored one: an edit must never widen who can act by omission.
  const sameMode = prev !== null && (prev.config.mode ?? "webhook") === (config.mode ?? "webhook");
  const given = raw.actors === undefined || raw.actors === null ? (sameMode ? prev?.config.actors : undefined) : raw.actors;
  if (given === undefined || given === null) return config;
  const actors = channelActorsSchema.safeParse(given);
  if (!actors.success) throw new Error(actors.error.issues[0]?.message ?? "The list of people who can act is not valid");
  return actors.data.mode === "any" ? config : { ...config, actors: actors.data };
}

function cleanTypeConfig(
  type: ChannelType,
  raw: Record<string, unknown>,
  prev: { config: Record<string, unknown>; configured: Record<string, boolean> } | null,
): Record<string, unknown> {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const mode = raw.mode === "app" ? "app" : "webhook";
  const prevMode = prev?.config.mode === "app" ? "app" : "webhook";
  /** A blank secret on update keeps the stored one, if the mode did not change. */
  const keeps = (key: string): boolean => prev !== null && prevMode === mode && prev.configured[key] === true;
  const secret = (key: string, label: string, check?: (v: string) => string | null): Record<string, string> => {
    const value = str(raw[key]);
    if (!value) {
      if (keeps(key)) return {};
      throw new Error(`${label} is required`);
    }
    const problem = check?.(value);
    if (problem) throw new Error(problem);
    return { [key]: value };
  };
  switch (type) {
    case ChannelType.Slack:
    case ChannelType.GoogleChat: {
      if (mode === "webhook") return secret("webhookUrl", "webhookUrl");
      if (type === ChannelType.Slack) {
        const channelId = str(raw.channelId);
        if (!/^[A-Z0-9]{8,20}$/.test(channelId)) throw new Error("The Slack channel ID looks like C0123ABCD (channel details › About)");
        return {
          mode: "app",
          channelId,
          ...secret("botToken", "The bot token", (v) => (/^xox[bp]-[A-Za-z0-9-]+$/.test(v) ? null : "The bot token starts with xoxb-")),
          ...secret("signingSecret", "The signing secret", (v) => (/^[A-Za-z0-9]{16,128}$/.test(v) ? null : "The signing secret is the hex string under Basic Information › App Credentials")),
        };
      }
      const space = str(raw.space).replace(/^spaces\//, "");
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(space)) throw new Error("The space looks like spaces/AAAA… (from the space's URL)");
      const audience = str(raw.audience);
      if (audience && !/^\d{6,20}$/.test(audience) && !/^https:\/\/\S+$/.test(audience)) throw new Error("The audience is the Cloud project number, or the events URL");
      return {
        mode: "app",
        space: `spaces/${space}`,
        ...(audience ? { audience } : {}),
        ...secret("serviceAccountJson", "The service account key", (v) => {
          try {
            parseServiceAccount(v);
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : "The service account key is not valid";
          }
        }),
      };
    }
    case ChannelType.Telegram: {
      const chatId = str(raw.chatId);
      if (!/^-?\d{1,20}$/.test(chatId) && !/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(chatId)) throw new Error("The chat ID is a number like -1001234567890, or @channelname");
      const topicRaw = raw.topicId;
      const topicId = topicRaw === undefined || topicRaw === null || topicRaw === "" ? null : Number(topicRaw);
      if (topicId !== null && (!Number.isInteger(topicId) || topicId <= 0)) throw new Error("The topic ID is a positive number");
      return {
        chatId,
        ...(topicId ? { topicId } : {}),
        ...secret("botToken", "The bot token", (v) => (/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(v) ? null : "The bot token looks like 123456789:AA… (from BotFather)")),
      };
    }
    case ChannelType.Webhook: {
      const url = str(raw.url);
      if (!url) throw new Error("url is required");
      const secretValue = str(raw.secret);
      return secretValue ? { url, secret: secretValue } : { url };
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
      if (prev === null && !password) throw new Error("password is required");
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
  const [channels, health, usage] = await Promise.all([store.listChannels(), channelHealth(), channelUsage()]);
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
      // ADR 0026: delivery health from the message log, and what sends here (counts only).
      health: health.get(ch.id) ?? { channelId: ch.id, lastSentAt: null, lastFailedAt: null, lastError: null, sent24h: 0, failed24h: 0 },
      usedBy: usage.get(ch.id) ?? emptyUsage(),
    };
  });
  return c.json({ success: true, data });
});

/** The Overview tab: what fires, what was sent and failed in the last day, what waits on a person. */
alerting.get("/overview", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const [channels, health, firing, waiting] = await Promise.all([store.listChannels(), channelHealth(), firingNow(), waitingRequests()]);
  let sent24h = 0;
  let failed24h = 0;
  const failing: Array<{ id: string; name: string; failed24h: number; lastError: string | null }> = [];
  for (const ch of channels) {
    const h = health.get(ch.id);
    if (!h) continue;
    sent24h += h.sent24h;
    failed24h += h.failed24h;
    // Failing now: its latest attempt failed.
    if (h.failed24h > 0 && (h.lastSentAt ?? 0) < (h.lastFailedAt ?? 0)) failing.push({ id: ch.id, name: ch.name, failed24h: h.failed24h, lastError: h.lastError });
  }
  return c.json({ success: true, data: { firing, sent24h, failed24h, waiting, failing } });
});

alerting.post(
  "/channels",
  requirePermission(PERMISSIONS.ALERTING_EDIT),
  zValidator("json", channelBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    let config: Record<string, unknown>;
    try {
      config = cleanChannelConfig(body.type, body.config, null);
    } catch (err) {
      return c.json({ success: false, error: err instanceof Error ? err.message : "Invalid config" }, 400);
    }
    const id = await store.createChannel(
      { name: body.name, type: body.type, enabled: body.enabled, config },
      userId(c),
    );
    if (body.type === ChannelType.Telegram) await registerTelegramWebhook(id);
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
    const id = requireParam(c, "id");
    const body = c.req.valid("json");
    const existing = await store.getChannel(id);
    if (!existing) return c.json({ success: false, error: "Channel not found" }, 404);
    let config: Record<string, unknown>;
    try {
      // A type change is validated like a new channel: the old type's secrets mean nothing to the new one.
      const prev = existing.type === body.type ? store.maskChannelConfig(existing.type, JSON.parse(existing.config) as Record<string, unknown>) : null;
      config = cleanChannelConfig(body.type, body.config, prev);
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
    if (body.type === ChannelType.Telegram) await registerTelegramWebhook(id);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_UPDATE, userId(c), {
      resourceType: "notification_channel",
      resourceId: id,
      details: { name: body.name, type: body.type },
    });
    return c.json({ success: true });
  },
);

alerting.delete("/channels/:id", requirePermission(PERMISSIONS.ALERTING_DELETE), async (c) => {
  const id = requireParam(c, "id");
  const existing = await store.getChannel(id);
  if (!existing) return c.json({ success: false, error: "Channel not found" }, 404);
  const usage = await store.countRulesUsingChannel(id);
  const panelAlerts = await countAlertsUsingChannel(id);
  const dashboardReports = await countReportsUsingChannel(id);
  if (usage > 0 || panelAlerts > 0 || dashboardReports > 0) {
    const parts = [
      ...(usage > 0 ? [`${usage} rule${usage === 1 ? "" : "s"}`] : []),
      ...(panelAlerts > 0 ? [`${panelAlerts} dashboard panel alert${panelAlerts === 1 ? "" : "s"}`] : []),
      ...(dashboardReports > 0 ? [`${dashboardReports} dashboard report${dashboardReports === 1 ? "" : "s"}`] : []),
    ];
    return c.json(
      { success: false, error: `Channel is used by ${parts.join(" and ")}; detach it first.` },
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
  const id = requireParam(c, "id");
  const ch = await store.getChannel(id);
  if (!ch) return c.json({ success: false, error: "Channel not found" }, 404);
  // A bot channel is checked first (who the bot is, that it reaches its chat), then gets the test message.
  const checks: ChannelCheck[] = [];
  try {
    checks.push(...(await checkChannel(ch)));
    if (ch.type === ChannelType.Telegram) {
      const registration = await registerTelegramWebhook(id);
      checks.push({ label: registration.registered ? "Button presses reach CHouse" : `Buttons are off: ${registration.error ?? "the webhook is not registered"}`, ok: registration.registered });
    }
    await sendToChannel(ch, TEST_MESSAGE, { feature: "test" });
    checks.push({ label: "Test message sent", ok: true });
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_TEST, userId(c), {
      resourceType: "notification_channel",
      resourceId: id,
      status: "success",
      details: { type: ch.type },
    });
    return c.json({ success: true, data: { checks } });
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
    return c.json({ success: false, error: message, data: { checks } }, 502);
  }
});

/**
 * POST /channels/:id/message — post a message to an alert channel: a handoff
 * from Chobi, or an agent's post the user confirmed (ADR 0025 §6). It reaches
 * real people, so it is audited with its title and length, never its text.
 */
const channelMessageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(4000),
});

alerting.post("/channels/:id/message", requirePermission(PERMISSIONS.ALERTING_EDIT), zValidator("json", channelMessageSchema), async (c) => {
  const id = requireParam(c, "id");
  const { title, text } = c.req.valid("json");
  const ch = await store.getChannel(id);
  if (!ch) return c.json({ success: false, error: "Channel not found" }, 404);
  if (!ch.enabled) return c.json({ success: false, error: "This channel is turned off" }, 409);
  const audit = { resourceType: "notification_channel", resourceId: id, details: { type: ch.type, title, length: text.length } };
  try {
    await sendToChannel(ch, { title, text }, { feature: "handoff" });
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_MESSAGE, userId(c), { ...audit, status: "success" });
    return c.json({ success: true, data: { sent: true, channel: ch.name } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delivery failed";
    logger.warn({ module: "Alerting", channelId: id, err: message }, "Channel message failed");
    await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_CHANNEL_MESSAGE, userId(c), { ...audit, status: "failed", errorMessage: message });
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
    const id = requireParam(c, "id");
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
  const id = requireParam(c, "id");
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

const searchEventsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  source: z.string().trim().max(50).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  channelId: z.string().trim().max(100).optional(),
  failed: z.enum(["true", "false"]).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().positive().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

function decodeCursor(raw: string | undefined): { firedAt: number; id: string } | undefined {
  if (!raw) return undefined;
  try {
    const [firedAt, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const at = Number(firedAt);
    return Number.isFinite(at) && id ? { firedAt: at, id } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * History with search, filters and pages (ADR 0026 §7). `GET /events` keeps
 * answering a plain list for its existing callers.
 */
alerting.get("/events/search", requirePermission(PERMISSIONS.ALERTING_VIEW), zValidator("query", searchEventsQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const channel = query.channelId ? await store.getChannel(query.channelId) : null;
  if (query.channelId && !channel) return c.json({ success: true, data: { events: [], nextCursor: null } });
  const { events, next } = await store.searchEvents({
    q: query.q || undefined,
    source: query.source || undefined,
    severity: query.severity,
    channel: channel ? { id: channel.id, name: channel.name } : undefined,
    failed: query.failed === undefined ? undefined : query.failed === "true",
    from: query.from,
    to: query.to,
    cursor: decodeCursor(query.cursor),
    limit: query.limit,
  });
  const nextCursor = next ? Buffer.from(`${next.firedAt}|${next.id}`, "utf8").toString("base64url") : null;
  return c.json({ success: true, data: { events, nextCursor } });
});

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

// --- sources (for AI and MCP) ---------------------------------------------------

type Row = Record<string, unknown>;
const pick = (row: Row, keys: string[]): Row => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));
const listOf = (value: unknown, key?: string): Row[] => {
  const list = key && value && typeof value === "object" && !Array.isArray(value) ? (value as Row)[key] : value;
  return Array.isArray(list) ? (list as Row[]) : [];
};

/**
 * Everything that sends alerts, read from each feature's own list route as
 * the caller, so the answer holds only what they can already see; a list they
 * may not read is named in `hidden`.
 */
alerting.get("/sources", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (!token) return c.json({ success: false, error: "Sign in again" }, 401);
  const api = new InProcessApiClient(token);
  const hidden: string[] = [];
  const read = async (name: string, path: string): Promise<unknown> => {
    try {
      return await api.get(path);
    } catch {
      hidden.push(name);
      return null;
    }
  };
  const [rules, panelAlerts, promises, jobs, triage, remediation] = await Promise.all([
    read("fleet rules", "/api/alerting/rules"),
    read("dashboard alerts", "/api/dashboards/alerts"),
    read("Data Health", "/api/data-health"),
    read("scheduled queries", "/api/scheduled-queries"),
    read("auto-triage", "/api/ai-triage/rules"),
    read("remediation", "/api/alerting/settings/remediation"),
  ]);
  const promiseJobs = new Set(listOf(promises, "promises").map((p) => String(p.scheduledQueryId)));
  return c.json({ success: true, data: {
    fleetRules: listOf(rules).map((r) => pick(r, ["id", "name", "enabled", "severity", "channelIds"])),
    dashboardAlerts: listOf(panelAlerts).map((a) => ({ ...pick(a, ["id", "name", "dashboardId", "dashboardTitle", "enabled", "severity", "channelIds"]), state: (a.status as Row | null | undefined)?.state ?? null })),
    dataHealth: listOf(promises, "promises").map((p) => pick(p, ["id", "name", "enabled", "status", "channelIds"])),
    // A promise's monitor job is the promise; a job without channels alerts nobody.
    scheduledQueries: listOf(jobs, "jobs").filter((j) => !promiseJobs.has(String(j.id)) && listOf(j.channelIds).length > 0)
      .map((j) => ({ ...pick(j, ["id", "name", "enabled", "channelIds"]), lastRunStatus: (j.lastRun as Row | null | undefined)?.status ?? null })),
    triage: listOf(triage, "rules").map((t) => pick(t, ["trigger", "label", "enabled", "channelIds"])),
    remediation: remediation ? pick(remediation as Row, ["channelIds", "envSlack"]) : null,
    hidden,
  } });
});

// --- settings -----------------------------------------------------------------

/** Where remediation approvals are posted (ADR 0026 §6), besides the Slack bot set by environment variables. */
alerting.get("/settings/remediation", requirePermission(PERMISSIONS.ALERTING_VIEW), async (c) => {
  return c.json({ success: true, data: { ...(await getRemediationNotify()), envSlack: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.REMEDIATION_SLACK_CHANNEL) } });
});

alerting.put("/settings/remediation", requirePermission(PERMISSIONS.ALERTING_EDIT), zValidator("json", remediationNotifySchema), async (c) => {
  const body = c.req.valid("json");
  for (const channelId of body.channelIds) {
    if (!(await store.getChannel(channelId))) return c.json({ success: false, error: `Channel ${channelId} not found` }, 400);
  }
  const saved = await saveRemediationNotify(body, userId(c) ?? null);
  await createAuditLogWithContext(c, AUDIT_ACTIONS.ALERTING_SETTINGS_UPDATE, userId(c), {
    resourceType: "alerting_settings",
    resourceId: "remediation",
    details: { channels: saved.channelIds.length },
  });
  return c.json({ success: true, data: saved });
});

// --- meta -------------------------------------------------------------------

alerting.get("/channel-types", requirePermission(PERMISSIONS.ALERTING_VIEW), (c) => {
  return c.json({ success: true, data: CHANNEL_TYPES.filter(isChannelType) });
});

export default alerting;
