/**
 * fleetAlertConfig — adapter shim for the legacy fleet alert config.
 *
 * The fleet alert config (rules/thresholds + Slack/Google Chat/email delivery)
 * used to live as a single JSON blob (fleet_alert_config, id=1). It is now
 * normalized across the alerting tables (notification_channels, alert_rules,
 * alert_rule_channels) — see services/alerting/store.ts.
 *
 * This module keeps the original `RawAlertConfig` shape and the
 * load/saveRawAlertConfig contract verbatim, projecting it onto the well-known
 * fleet-default rule + its three legacy channels (fleet-slack /
 * fleet-google_chat / fleet-email). The fleet route and the alerter consume this
 * shim unchanged, so the existing Fleet alert experience is byte-for-byte the
 * same while the storage underneath is normalized. Migration 1.39.0 imported the
 * old blob into these rows; channel secrets are now encrypted at rest.
 */

import {
  ChannelType,
  AlertSourceType,
  AlertSeverity,
  LEGACY_FLEET_RULE_ID,
  LEGACY_CHANNEL_IDS,
} from "./alerting/types";
import {
  getRule,
  upsertRule,
  getChannel,
  upsertChannel,
  deleteChannel,
  linkChannel,
  getRuleChannelIds,
} from "./alerting/store";
import { decryptChannelConfig } from "./alerting/store";
import { logger } from "../utils/logger";

/** Legacy in-memory shape — mirrors the historical alert-config.json verbatim. */
export interface RawAlertConfig {
  enabled?: boolean;
  rules?: {
    memoryPercent?: number;
    queryMemoryGb?: number;
    longQueryMin?: number;
    partsEtaMin?: number;
  };
  slack?: { webhookUrl?: string; enabled?: boolean };
  googleChat?: { webhookUrl?: string; enabled?: boolean };
  email?: {
    user?: string;
    password?: string;
    to?: string;
    enabled?: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    from?: string;
  };
  /** When true, a new breach also fires a Chouse AI RCA to the channels. */
  aiRcaOnBreach?: boolean;
  /** AI config id for the auto-RCA scan (blank = default model). */
  aiRcaModelId?: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read a single legacy channel by its fixed id and decrypt its secrets. Returns
 * the parsed config plus the channel's enabled flag, or undefined when absent.
 */
async function readLegacyChannel(
  id: string,
  type: ChannelType,
): Promise<{ config: Record<string, unknown>; enabled: boolean } | undefined> {
  const row = await getChannel(id);
  if (!row) return undefined;
  const stored = JSON.parse(row.config) as Record<string, unknown>;
  return { config: decryptChannelConfig(type, stored), enabled: row.enabled };
}

/**
 * Load the legacy alert config, reconstructed from the normalized tables.
 * Returns {} when the fleet rule doesn't exist (fresh install) — callers already
 * treat an empty config as "delivery off / defaults", matching the old
 * missing-file path.
 */
export async function loadRawAlertConfig(): Promise<RawAlertConfig> {
  try {
    const rule = await getRule(LEGACY_FLEET_RULE_ID);
    if (!rule) return {};

    const rulesCfg = JSON.parse(rule.config) as Record<string, unknown>;
    const out: RawAlertConfig = {
      enabled: rule.enabled,
      aiRcaOnBreach: rule.aiRcaEnabled,
      aiRcaModelId: rule.aiRcaModelId ?? undefined,
      rules: {
        memoryPercent: num(rulesCfg.memoryPercent),
        queryMemoryGb: num(rulesCfg.queryMemoryGb),
        longQueryMin: num(rulesCfg.longQueryMin),
        partsEtaMin: num(rulesCfg.partsEtaMin),
      },
    };

    const slack = await readLegacyChannel(LEGACY_CHANNEL_IDS[ChannelType.Slack], ChannelType.Slack);
    if (slack && typeof slack.config.webhookUrl === "string") {
      out.slack = { webhookUrl: slack.config.webhookUrl, enabled: slack.enabled };
    }

    const gchat = await readLegacyChannel(LEGACY_CHANNEL_IDS[ChannelType.GoogleChat], ChannelType.GoogleChat);
    if (gchat && typeof gchat.config.webhookUrl === "string") {
      out.googleChat = { webhookUrl: gchat.config.webhookUrl, enabled: gchat.enabled };
    }

    const email = await readLegacyChannel(LEGACY_CHANNEL_IDS[ChannelType.Email], ChannelType.Email);
    if (email && typeof email.config.user === "string") {
      const c = email.config;
      out.email = {
        user: String(c.user),
        password: typeof c.password === "string" ? c.password : "",
        to: String(c.to ?? ""),
        host: typeof c.host === "string" ? c.host : undefined,
        port: c.port !== undefined ? num(c.port) : undefined,
        secure: c.secure !== undefined ? Boolean(c.secure) : undefined,
        from: typeof c.from === "string" ? c.from : undefined,
        enabled: email.enabled,
      };
    }

    return out;
  } catch (err) {
    logger.error(
      { module: "FleetAlertConfig", err: err instanceof Error ? err.message : String(err) },
      "Failed to load alert config",
    );
    return {};
  }
}

/**
 * Persist the legacy alert config onto the normalized tables. Upserts the
 * fleet-default rule and its three legacy channels; a channel absent from the
 * config is removed (mirroring the old blob's remove semantics).
 */
export async function saveRawAlertConfig(cfg: RawAlertConfig): Promise<void> {
  await upsertRule({
    id: LEGACY_FLEET_RULE_ID,
    name: "Fleet thresholds",
    sourceType: AlertSourceType.FleetThreshold,
    severity: AlertSeverity.Warning,
    enabled: cfg.enabled !== false,
    aiRcaEnabled: cfg.aiRcaOnBreach === true,
    aiRcaModelId: cfg.aiRcaModelId && cfg.aiRcaModelId.length > 0 ? cfg.aiRcaModelId : null,
    config: {
      memoryPercent: num(cfg.rules?.memoryPercent),
      queryMemoryGb: num(cfg.rules?.queryMemoryGb),
      longQueryMin: num(cfg.rules?.longQueryMin),
      partsEtaMin: num(cfg.rules?.partsEtaMin),
    },
  });

  const existingLinks = new Set(await getRuleChannelIds(LEGACY_FLEET_RULE_ID));

  // Slack
  const slackId = LEGACY_CHANNEL_IDS[ChannelType.Slack];
  if (cfg.slack?.webhookUrl) {
    await upsertChannel(slackId, {
      name: "Fleet Slack",
      type: ChannelType.Slack,
      enabled: cfg.slack.enabled !== false,
      config: { webhookUrl: cfg.slack.webhookUrl },
    });
    if (!existingLinks.has(slackId)) await linkChannel(LEGACY_FLEET_RULE_ID, slackId);
  } else {
    await deleteChannel(slackId);
  }

  // Google Chat
  const gchatId = LEGACY_CHANNEL_IDS[ChannelType.GoogleChat];
  if (cfg.googleChat?.webhookUrl) {
    await upsertChannel(gchatId, {
      name: "Fleet Google Chat",
      type: ChannelType.GoogleChat,
      enabled: cfg.googleChat.enabled !== false,
      config: { webhookUrl: cfg.googleChat.webhookUrl },
    });
    if (!existingLinks.has(gchatId)) await linkChannel(LEGACY_FLEET_RULE_ID, gchatId);
  } else {
    await deleteChannel(gchatId);
  }

  // Email
  const emailId = LEGACY_CHANNEL_IDS[ChannelType.Email];
  if (cfg.email?.user && cfg.email?.to) {
    await upsertChannel(emailId, {
      name: "Fleet Email",
      type: ChannelType.Email,
      enabled: cfg.email.enabled !== false,
      config: {
        host: cfg.email.host ?? "smtp.gmail.com",
        port: cfg.email.port ?? 465,
        secure: cfg.email.secure !== undefined ? cfg.email.secure : true,
        user: cfg.email.user,
        password: cfg.email.password ?? "",
        from: cfg.email.from ?? cfg.email.user,
        to: cfg.email.to,
      },
    });
    if (!existingLinks.has(emailId)) await linkChannel(LEGACY_FLEET_RULE_ID, emailId);
  } else {
    await deleteChannel(emailId);
  }
}
