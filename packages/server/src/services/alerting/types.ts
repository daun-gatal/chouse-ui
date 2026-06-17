/**
 * Alerting — shared enums and types for the normalized alerting model.
 *
 * The alerting config used to live as a single JSON blob (fleet_alert_config),
 * welding together "what fires" (rules), "where it delivers" (channels) and the
 * AI-RCA toggle. That blob is now normalized across four tables:
 *
 *   - notification_channels   where to deliver (slack/google_chat/email/webhook)
 *   - alert_rules             what fires (fleet_threshold today, data_quality next)
 *   - alert_rule_channels     M:N link between a rule and its channels
 *   - alert_events            history of fires + deliveries
 *
 * `type` / `source_type` / `severity` are modelled as enums (not free strings)
 * so the storage layer, the Zod validators and the UI all agree on the closed
 * set of values.
 */

/** Delivery destination kind. Persisted verbatim in notification_channels.type. */
export enum ChannelType {
  Slack = "slack",
  GoogleChat = "google_chat",
  Email = "email",
  Webhook = "webhook",
}

/** What produced an alert rule. Persisted verbatim in alert_rules.source_type. */
export enum AlertSourceType {
  /** Fleet threshold rules (node memory %, per-query memory, long queries, parts ETA). */
  FleetThreshold = "fleet_threshold",
  /** Data-quality check failures (added in a later pass). */
  DataQuality = "data_quality",
}

/** Alert severity. Persisted verbatim in alert_rules.severity / alert_events.severity. */
export enum AlertSeverity {
  Info = "info",
  Warning = "warning",
  Critical = "critical",
}

export const CHANNEL_TYPES: ChannelType[] = Object.values(ChannelType);
export const ALERT_SOURCE_TYPES: AlertSourceType[] = Object.values(AlertSourceType);
export const ALERT_SEVERITIES: AlertSeverity[] = Object.values(AlertSeverity);

export function isChannelType(v: unknown): v is ChannelType {
  return typeof v === "string" && (CHANNEL_TYPES as string[]).includes(v);
}

export function isAlertSourceType(v: unknown): v is AlertSourceType {
  return typeof v === "string" && (ALERT_SOURCE_TYPES as string[]).includes(v);
}

export function isAlertSeverity(v: unknown): v is AlertSeverity {
  return typeof v === "string" && (ALERT_SEVERITIES as string[]).includes(v);
}

/**
 * Per-type channel config shapes. The secret-bearing fields (webhookUrl,
 * password) are encrypted at rest with AES-256-GCM (encryptSecret) and never
 * returned to the client in plaintext.
 */
export interface SlackChannelConfig {
  webhookUrl: string;
}

export interface GoogleChatChannelConfig {
  webhookUrl: string;
}

export interface WebhookChannelConfig {
  url: string;
  /** Optional bearer/secret header value, encrypted at rest. */
  secret?: string;
}

export interface EmailChannelConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from?: string;
  to: string;
}

export type ChannelConfig =
  | SlackChannelConfig
  | GoogleChatChannelConfig
  | WebhookChannelConfig
  | EmailChannelConfig;

/** Fleet-threshold rule parameters (mirrors the legacy RawAlertConfig.rules). */
export interface FleetThresholdRuleConfig {
  memoryPercent: number;
  queryMemoryGb: number;
  longQueryMin: number;
  partsEtaMin: number;
}

/** A notification channel as stored (secrets stay encrypted in `config`). */
export interface NotificationChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  /** JSON string; secret fields are encrypted. */
  config: string;
  enabled: boolean;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** An alert rule as stored. */
export interface AlertRuleRow {
  id: string;
  name: string;
  sourceType: AlertSourceType;
  /** JSON string of the source-specific config (e.g. FleetThresholdRuleConfig). */
  config: string;
  severity: AlertSeverity;
  enabled: boolean;
  aiRcaEnabled: boolean;
  aiRcaModelId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Well-known fixed ids for the single legacy fleet-threshold rule and the three
 * legacy channels it could deliver to. The adapter shim
 * (loadRawAlertConfig/saveRawAlertConfig) reads and writes exactly these rows so
 * the existing Fleet alert dialog keeps working byte-for-byte against the
 * normalized tables.
 */
export const LEGACY_FLEET_RULE_ID = "fleet-default";
export const LEGACY_CHANNEL_IDS: Record<
  ChannelType.Slack | ChannelType.GoogleChat | ChannelType.Email,
  string
> = {
  [ChannelType.Slack]: "fleet-slack",
  [ChannelType.GoogleChat]: "fleet-google_chat",
  [ChannelType.Email]: "fleet-email",
};
