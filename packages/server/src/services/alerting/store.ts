/**
 * Alerting store — normalized CRUD over the four alerting tables, with
 * AES-256-GCM encryption of channel secrets at rest.
 *
 * Secret-bearing JSON keys (per channel type) are encrypted before persist and
 * decrypted only when delivering. The UI never receives plaintext secrets — the
 * route layer masks them and exposes a `configured` flag instead.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

import {
  getDatabase,
  getDatabaseType,
  type SqliteDb,
  type PostgresDb,
} from "../../rbac/db";
import { encryptSecret, decryptSecret } from "../../rbac/services/connections";
import { logger } from "../../utils/logger";
import {
  ChannelType,
  AlertSourceType,
  AlertSeverity,
  isChannelType,
  isAlertSourceType,
  isAlertSeverity,
  type NotificationChannelRow,
  type AlertRuleRow,
} from "./types";

// --- dialect-aware low-level helpers ----------------------------------------

async function all(stmt: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    return (db as SqliteDb).all(stmt) as Array<Record<string, unknown>>;
  }
  const res = await (db as PostgresDb).execute(stmt);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  return (Array.isArray(anyRes) ? anyRes : anyRes.rows ?? []) as Array<Record<string, unknown>>;
}

async function run(stmt: ReturnType<typeof sql>): Promise<void> {
  const db = getDatabase();
  if (getDatabaseType() === "sqlite") {
    (db as SqliteDb).run(stmt);
    return;
  }
  await (db as PostgresDb).execute(stmt);
}

const bool = (v: unknown): boolean => Number(v) === 1;

// --- secret-field handling --------------------------------------------------

/** JSON keys whose values are secrets (encrypted at rest) per channel type. */
const SECRET_KEYS: Record<ChannelType, string[]> = {
  [ChannelType.Slack]: ["webhookUrl"],
  [ChannelType.GoogleChat]: ["webhookUrl"],
  [ChannelType.Webhook]: ["secret"],
  [ChannelType.Email]: ["password"],
};

/**
 * Encrypt the secret fields of an incoming (plaintext) channel config. A blank
 * secret means "keep existing", so it's dropped here and merged from `prev`.
 */
function encryptChannelConfig(
  type: ChannelType,
  incoming: Record<string, unknown>,
  prev?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  for (const key of SECRET_KEYS[type]) {
    const val = incoming[key];
    if (typeof val === "string" && val.length > 0) {
      out[key] = encryptSecret(val);
    } else if (prev && typeof prev[key] === "string") {
      out[key] = prev[key]; // keep existing encrypted secret
    } else {
      delete out[key];
    }
  }
  return out;
}

/** Decrypt the secret fields of a stored channel config for delivery use. */
export function decryptChannelConfig(
  type: ChannelType,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored };
  for (const key of SECRET_KEYS[type]) {
    const val = stored[key];
    if (typeof val === "string" && val.length > 0) {
      try {
        out[key] = decryptSecret(val);
      } catch (err) {
        logger.error(
          { module: "AlertingStore", channelType: type, err: err instanceof Error ? err.message : String(err) },
          "Failed to decrypt channel secret",
        );
        delete out[key];
      }
    }
  }
  return out;
}

/** Strip secret fields from a stored config, replacing them with a `configured` map. */
export function maskChannelConfig(
  type: ChannelType,
  stored: Record<string, unknown>,
): { config: Record<string, unknown>; configured: Record<string, boolean> } {
  const config: Record<string, unknown> = { ...stored };
  const configured: Record<string, boolean> = {};
  for (const key of SECRET_KEYS[type]) {
    configured[key] = typeof stored[key] === "string" && (stored[key] as string).length > 0;
    delete config[key];
  }
  return { config, configured };
}

// --- row mappers ------------------------------------------------------------

function toChannelRow(r: Record<string, unknown>): NotificationChannelRow {
  const type = String(r.type);
  return {
    id: String(r.id),
    name: String(r.name),
    type: isChannelType(type) ? type : ChannelType.Webhook,
    config: String(r.config ?? "{}"),
    enabled: bool(r.enabled),
    createdBy: r.created_by == null ? null : String(r.created_by),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

function toRuleRow(r: Record<string, unknown>): AlertRuleRow {
  const sourceType = String(r.source_type);
  const severity = String(r.severity);
  return {
    id: String(r.id),
    name: String(r.name),
    sourceType: isAlertSourceType(sourceType) ? sourceType : AlertSourceType.FleetThreshold,
    config: String(r.config ?? "{}"),
    severity: isAlertSeverity(severity) ? severity : AlertSeverity.Warning,
    enabled: bool(r.enabled),
    aiRcaEnabled: bool(r.ai_rca_enabled),
    aiRcaModelId: r.ai_rca_model_id == null ? null : String(r.ai_rca_model_id),
    createdAt: Number(r.created_at ?? 0),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

// --- channels ---------------------------------------------------------------

export async function listChannels(): Promise<NotificationChannelRow[]> {
  const rows = await all(sql`SELECT * FROM notification_channels ORDER BY name`);
  return rows.map(toChannelRow);
}

export async function getChannel(id: string): Promise<NotificationChannelRow | null> {
  const rows = await all(sql`SELECT * FROM notification_channels WHERE id = ${id} LIMIT 1`);
  return rows[0] ? toChannelRow(rows[0]) : null;
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  enabled: boolean;
}

export async function createChannel(input: ChannelInput, createdBy?: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const config = JSON.stringify(encryptChannelConfig(input.type, input.config));
  await run(sql`
    INSERT INTO notification_channels (id, name, type, config, enabled, created_by, created_at, updated_at)
    VALUES (${id}, ${input.name}, ${input.type}, ${config}, ${input.enabled ? 1 : 0}, ${createdBy ?? null}, ${now}, ${now})
  `);
  return id;
}

export async function updateChannel(id: string, input: ChannelInput): Promise<boolean> {
  const existing = await getChannel(id);
  if (!existing) return false;
  const prev = JSON.parse(existing.config) as Record<string, unknown>;
  const config = JSON.stringify(encryptChannelConfig(input.type, input.config, prev));
  const now = Date.now();
  await run(sql`
    UPDATE notification_channels
    SET name = ${input.name}, type = ${input.type}, config = ${config}, enabled = ${input.enabled ? 1 : 0}, updated_at = ${now}
    WHERE id = ${id}
  `);
  return true;
}

/** Insert-or-update a channel at a fixed id (used by the legacy fleet shim). */
export async function upsertChannel(id: string, input: ChannelInput): Promise<void> {
  const existing = await getChannel(id);
  if (existing) {
    await updateChannel(id, input);
    return;
  }
  const now = Date.now();
  const config = JSON.stringify(encryptChannelConfig(input.type, input.config));
  await run(sql`
    INSERT INTO notification_channels (id, name, type, config, enabled, created_by, created_at, updated_at)
    VALUES (${id}, ${input.name}, ${input.type}, ${config}, ${input.enabled ? 1 : 0}, NULL, ${now}, ${now})
  `);
}

export async function setChannelEnabled(id: string, enabled: boolean): Promise<void> {
  await run(sql`UPDATE notification_channels SET enabled = ${enabled ? 1 : 0}, updated_at = ${Date.now()} WHERE id = ${id}`);
}

/** How many rules currently link this channel (used to block in-use deletes). */
export async function countRulesUsingChannel(channelId: string): Promise<number> {
  const rows = await all(sql`SELECT COUNT(*) AS c FROM alert_rule_channels WHERE channel_id = ${channelId}`);
  return Number(rows[0]?.c ?? 0);
}

export async function deleteChannel(id: string): Promise<void> {
  await run(sql`DELETE FROM alert_rule_channels WHERE channel_id = ${id}`);
  await run(sql`DELETE FROM notification_channels WHERE id = ${id}`);
}

// --- rules ------------------------------------------------------------------

export async function listRules(): Promise<AlertRuleRow[]> {
  const rows = await all(sql`SELECT * FROM alert_rules ORDER BY name`);
  return rows.map(toRuleRow);
}

export async function getRule(id: string): Promise<AlertRuleRow | null> {
  const rows = await all(sql`SELECT * FROM alert_rules WHERE id = ${id} LIMIT 1`);
  return rows[0] ? toRuleRow(rows[0]) : null;
}

export interface RuleUpsert {
  id: string;
  name: string;
  sourceType: AlertSourceType;
  config: Record<string, unknown>;
  severity: AlertSeverity;
  enabled: boolean;
  aiRcaEnabled: boolean;
  aiRcaModelId: string | null;
}

/** Insert-or-update a rule by id (used for the well-known fleet-default rule). */
export async function upsertRule(input: RuleUpsert): Promise<void> {
  const now = Date.now();
  const config = JSON.stringify(input.config);
  const existing = await getRule(input.id);
  if (existing) {
    await run(sql`
      UPDATE alert_rules
      SET name = ${input.name}, source_type = ${input.sourceType}, config = ${config},
          severity = ${input.severity}, enabled = ${input.enabled ? 1 : 0},
          ai_rca_enabled = ${input.aiRcaEnabled ? 1 : 0}, ai_rca_model_id = ${input.aiRcaModelId}, updated_at = ${now}
      WHERE id = ${input.id}
    `);
  } else {
    await run(sql`
      INSERT INTO alert_rules (id, name, source_type, config, severity, enabled, ai_rca_enabled, ai_rca_model_id, created_at, updated_at)
      VALUES (${input.id}, ${input.name}, ${input.sourceType}, ${config}, ${input.severity}, ${input.enabled ? 1 : 0}, ${input.aiRcaEnabled ? 1 : 0}, ${input.aiRcaModelId}, ${now}, ${now})
    `);
  }
}

export interface RuleCreate {
  name: string;
  sourceType: AlertSourceType;
  config: Record<string, unknown>;
  severity: AlertSeverity;
  enabled: boolean;
  aiRcaEnabled: boolean;
  aiRcaModelId: string | null;
}

/** Create a new rule with a generated id. Returns the id. */
export async function createRule(input: RuleCreate): Promise<string> {
  const id = randomUUID();
  await upsertRule({ id, ...input });
  return id;
}

export async function deleteRule(id: string): Promise<void> {
  await run(sql`DELETE FROM alert_rule_channels WHERE rule_id = ${id}`);
  await run(sql`DELETE FROM alert_rules WHERE id = ${id}`);
}

/**
 * Find an enabled fleet-threshold rule other than `exceptId` (null when creating).
 * Used to enforce "only one fleet rule active at a time".
 */
export async function findOtherEnabledFleetRule(
  exceptId: string | null,
): Promise<{ id: string; name: string } | null> {
  const rows = await all(sql`
    SELECT id, name FROM alert_rules
    WHERE source_type = ${AlertSourceType.FleetThreshold} AND enabled = 1 AND id != ${exceptId ?? ""}
    LIMIT 1
  `);
  return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
}

// --- rule <-> channel links -------------------------------------------------

export async function getRuleChannelIds(ruleId: string): Promise<string[]> {
  const rows = await all(sql`SELECT channel_id FROM alert_rule_channels WHERE rule_id = ${ruleId}`);
  return rows.map((r) => String(r.channel_id));
}

export async function linkChannel(ruleId: string, channelId: string): Promise<void> {
  if (getDatabaseType() === "sqlite") {
    await run(sql`INSERT OR IGNORE INTO alert_rule_channels (rule_id, channel_id) VALUES (${ruleId}, ${channelId})`);
  } else {
    await run(sql`INSERT INTO alert_rule_channels (rule_id, channel_id) VALUES (${ruleId}, ${channelId}) ON CONFLICT (rule_id, channel_id) DO NOTHING`);
  }
}

export async function unlinkChannel(ruleId: string, channelId: string): Promise<void> {
  await run(sql`DELETE FROM alert_rule_channels WHERE rule_id = ${ruleId} AND channel_id = ${channelId}`);
}

/** Replace a rule's channel set with exactly `channelIds`. */
export async function setRuleChannels(ruleId: string, channelIds: string[]): Promise<void> {
  await run(sql`DELETE FROM alert_rule_channels WHERE rule_id = ${ruleId}`);
  for (const channelId of channelIds) {
    await linkChannel(ruleId, channelId);
  }
}

/** Channels linked to a rule, with secrets decrypted (for delivery). */
export async function getRuleChannelsDecrypted(
  ruleId: string,
): Promise<Array<{ row: NotificationChannelRow; config: Record<string, unknown> }>> {
  const ids = await getRuleChannelIds(ruleId);
  const out: Array<{ row: NotificationChannelRow; config: Record<string, unknown> }> = [];
  for (const id of ids) {
    const row = await getChannel(id);
    if (!row || !row.enabled) continue;
    const stored = JSON.parse(row.config) as Record<string, unknown>;
    out.push({ row, config: decryptChannelConfig(row.type, stored) });
  }
  return out;
}

// --- events -----------------------------------------------------------------

export interface AlertEventInput {
  ruleId: string | null;
  severity: AlertSeverity;
  payload: string;
  deliveredTo: string[];
}

export async function recordEvent(input: AlertEventInput): Promise<void> {
  const id = randomUUID();
  await run(sql`
    INSERT INTO alert_events (id, rule_id, severity, fired_at, payload, delivered_to, resolved_at)
    VALUES (${id}, ${input.ruleId}, ${input.severity}, ${Date.now()}, ${input.payload}, ${JSON.stringify(input.deliveredTo)}, NULL)
  `);
}

export interface AlertEvent {
  id: string;
  ruleId: string | null;
  severity: string;
  firedAt: number;
  payload: string | null;
  deliveredTo: string[];
  resolvedAt: number | null;
}

/**
 * Delete recorded alert events. With `before` set, only events fired at or
 * before that epoch-ms cutoff are removed (clear-by-time-range); otherwise all
 * events are cleared.
 */
export async function clearEvents(before?: number): Promise<void> {
  if (before !== undefined && Number.isFinite(before)) {
    await run(sql`DELETE FROM alert_events WHERE fired_at <= ${before}`);
  } else {
    await run(sql`DELETE FROM alert_events`);
  }
}

export async function listEvents(limit = 50): Promise<AlertEvent[]> {
  const rows = await all(sql`SELECT * FROM alert_events ORDER BY fired_at DESC LIMIT ${limit}`);
  return rows.map((r) => {
    let deliveredTo: string[] = [];
    try {
      const parsed = JSON.parse(String(r.delivered_to ?? "[]"));
      if (Array.isArray(parsed)) deliveredTo = parsed.map(String);
    } catch {
      deliveredTo = [];
    }
    return {
      id: String(r.id),
      ruleId: r.rule_id == null ? null : String(r.rule_id),
      severity: String(r.severity),
      firedAt: Number(r.fired_at ?? 0),
      payload: r.payload == null ? null : String(r.payload),
      deliveredTo,
      resolvedAt: r.resolved_at == null ? null : Number(r.resolved_at),
    };
  });
}
