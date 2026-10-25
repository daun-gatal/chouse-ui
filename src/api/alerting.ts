/**
 * Alerting API — notification channels, alert rules (read), and alert events.
 *
 * Backs Admin → Settings → Alerting. Channel secrets are never returned by the
 * server; list responses expose a `configured` map (which secret fields are set)
 * instead, and the UI sends a secret only when the user enters a new value.
 * See packages/server/src/routes/alerting.ts.
 */

import { api } from "./client";

/** Delivery destination kind (mirror of the server enum). */
export enum ChannelType {
  Slack = "slack",
  GoogleChat = "google_chat",
  Email = "email",
  Webhook = "webhook",
  Telegram = "telegram",
}

/** What produced an alert rule (mirror of the server enum). */
export enum AlertSourceType {
  FleetThreshold = "fleet_threshold",
  DataQuality = "data_quality",
}

/** Alert severity (mirror of the server enum). */
export enum AlertSeverity {
  Info = "info",
  Warning = "warning",
  Critical = "critical",
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  /** Non-secret config fields (secrets stripped). */
  config: Record<string, unknown>;
  /** Which secret fields are currently set on the server. */
  configured: Record<string, boolean>;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelInput {
  name: string;
  type: ChannelType;
  enabled: boolean;
  /** Plaintext config; omit a secret field (or leave blank) to keep the existing value. */
  config: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  sourceType: AlertSourceType;
  severity: AlertSeverity;
  enabled: boolean;
  aiRcaEnabled: boolean;
  aiRcaModelId: string | null;
  config: Record<string, unknown>;
  channelIds: string[];
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

// --- channels ---------------------------------------------------------------

export function listChannels(): Promise<NotificationChannel[]> {
  return api.get<NotificationChannel[]>("/alerting/channels");
}

export function createChannel(input: ChannelInput): Promise<{ id: string }> {
  return api.post<{ id: string }>("/alerting/channels", input);
}

export function updateChannel(id: string, input: ChannelInput): Promise<void> {
  return api.put<void>(`/alerting/channels/${id}`, input);
}

export function deleteChannel(id: string): Promise<void> {
  return api.delete<void>(`/alerting/channels/${id}`);
}

export interface ChannelCheck {
  label: string;
  ok: boolean;
}

/** Check a channel and send it the test message; bot channels report what was checked. */
export function testChannel(id: string): Promise<{ checks: ChannelCheck[] } | undefined> {
  return api.post<{ checks: ChannelCheck[] } | undefined>(`/alerting/channels/${id}/test`);
}

/** Post a message to a channel (a handoff from Chobi). It reaches real people. */
export function postChannelMessage(id: string, message: { title: string; text: string }): Promise<{ sent: boolean; channel: string }> {
  return api.post<{ sent: boolean; channel: string }>(`/alerting/channels/${encodeURIComponent(id)}/message`, message);
}

// --- rules + events ---------------------------------------------------------

export function listRules(): Promise<AlertRule[]> {
  return api.get<AlertRule[]>("/alerting/rules");
}

export interface RuleInput {
  name?: string;
  sourceType?: AlertSourceType;
  severity?: AlertSeverity;
  enabled: boolean;
  aiRcaEnabled: boolean;
  aiRcaModelId?: string | null;
  config: Record<string, unknown>;
  channelIds: string[];
}

export function updateRule(id: string, input: RuleInput): Promise<void> {
  return api.put<void>(`/alerting/rules/${id}`, input);
}

export function createRule(input: RuleInput & { name: string }): Promise<{ id: string }> {
  return api.post<{ id: string }>("/alerting/rules", input);
}

export function deleteRule(id: string): Promise<void> {
  return api.delete<void>(`/alerting/rules/${id}`);
}

/** Well-known id of the migrated fleet-threshold rule (shared with the server). */
export const FLEET_RULE_ID = "fleet-default";

export function listEvents(limit = 50): Promise<AlertEvent[]> {
  return api.get<AlertEvent[]>(`/alerting/events?limit=${limit}`);
}

/** Clear recent alerts — all, or only those at/older than `before` (epoch ms). */
export function clearEvents(before?: number): Promise<void> {
  const qs = before ? `?before=${before}` : "";
  return api.delete<void>(`/alerting/events${qs}`);
}

// --- per-type config field metadata (drives the dynamic forms) --------------

export interface ChannelFieldSpec {
  key: string;
  label: string;
  /** input kind */
  kind: "text" | "url" | "number" | "password" | "boolean" | "email" | "select" | "textarea";
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Short help under the field. */
  hint?: string;
  /** For `select`: the choices, the first is the default. */
  options?: Array<{ value: string; label: string }>;
  /** Only shown (and sent) while another field has this value. */
  showWhen?: { key: string; equals: string };
}

const MODE_OPTIONS = [
  { value: "webhook", label: "Webhook" },
  { value: "app", label: "App" },
];

/** Field specs per channel type — the UI renders these dynamically. */
export const CHANNEL_FIELD_SPECS: Record<ChannelType, ChannelFieldSpec[]> = {
  [ChannelType.Slack]: [
    { key: "mode", label: "Mode", kind: "select", options: MODE_OPTIONS, hint: "App mode posts with a bot, lets people press buttons, and updates messages when things change." },
    { key: "webhookUrl", label: "Webhook URL", kind: "url", secret: true, required: true, placeholder: "https://hooks.slack.com/services/…", showWhen: { key: "mode", equals: "webhook" } },
    { key: "botToken", label: "Bot token", kind: "password", secret: true, required: true, placeholder: "xoxb-…", showWhen: { key: "mode", equals: "app" } },
    { key: "signingSecret", label: "Signing secret", kind: "password", secret: true, required: true, hint: "Basic Information › App Credentials", showWhen: { key: "mode", equals: "app" } },
    { key: "channelId", label: "Channel ID", kind: "text", required: true, placeholder: "C0123ABCD", hint: "Channel details › About. Invite the bot to the channel.", showWhen: { key: "mode", equals: "app" } },
  ],
  [ChannelType.GoogleChat]: [
    { key: "mode", label: "Mode", kind: "select", options: MODE_OPTIONS, hint: "App mode posts as a Chat app, lets people press buttons, and updates messages when things change." },
    { key: "webhookUrl", label: "Webhook URL", kind: "url", secret: true, required: true, placeholder: "https://chat.googleapis.com/v1/spaces/…", showWhen: { key: "mode", equals: "webhook" } },
    { key: "serviceAccountJson", label: "Service account key (JSON)", kind: "textarea", secret: true, required: true, placeholder: '{ "type": "service_account", … }', showWhen: { key: "mode", equals: "app" } },
    { key: "space", label: "Space", kind: "text", required: true, placeholder: "spaces/AAAA…", hint: "From the space's URL. Add the app to the space.", showWhen: { key: "mode", equals: "app" } },
    { key: "audience", label: "Audience (optional)", kind: "text", placeholder: "Cloud project number", hint: "How Google signs button clicks: the project number, or the events URL.", showWhen: { key: "mode", equals: "app" } },
  ],
  [ChannelType.Telegram]: [
    { key: "botToken", label: "Bot token", kind: "password", secret: true, required: true, placeholder: "123456789:AA…", hint: "From BotFather. Add the bot to the group." },
    { key: "chatId", label: "Chat ID", kind: "text", required: true, placeholder: "-1001234567890" },
    { key: "topicId", label: "Topic ID (optional)", kind: "number", placeholder: "42", hint: "For a forum group: the topic to post in." },
  ],
  [ChannelType.Webhook]: [
    { key: "url", label: "Endpoint URL", kind: "url", required: true, placeholder: "https://example.com/hooks/alerts" },
    { key: "secret", label: "Bearer secret (optional)", kind: "password", secret: true, placeholder: "sent as Authorization: Bearer …" },
  ],
  [ChannelType.Email]: [
    { key: "host", label: "SMTP host", kind: "text", required: true, placeholder: "smtp.gmail.com" },
    { key: "port", label: "Port", kind: "number", required: true, placeholder: "465" },
    { key: "secure", label: "Use TLS", kind: "boolean" },
    { key: "user", label: "Username", kind: "text", required: true, placeholder: "alerts@example.com" },
    { key: "password", label: "Password", kind: "password", secret: true, required: true },
    { key: "from", label: "From (optional)", kind: "email", placeholder: "defaults to username" },
    { key: "to", label: "Recipient(s)", kind: "text", required: true, placeholder: "oncall@example.com" },
  ],
};

/** The fields a config shows (and sends) right now, given its `showWhen` conditions. */
export function visibleFieldSpecs(type: ChannelType, config: Record<string, unknown>): ChannelFieldSpec[] {
  const specs = CHANNEL_FIELD_SPECS[type];
  const valueOf = (key: string): string => {
    const value = config[key];
    if (typeof value === "string" && value) return value;
    return specs.find((s) => s.key === key)?.options?.[0]?.value ?? "";
  };
  return specs.filter((s) => !s.showWhen || valueOf(s.showWhen.key) === s.showWhen.equals);
}

/** Whether a channel is a bot that can edit messages and carry buttons (App mode, Telegram). */
export function isAppChannel(channel: Pick<NotificationChannel, "type" | "config">): boolean {
  if (channel.type === ChannelType.Telegram) return true;
  return (channel.type === ChannelType.Slack || channel.type === ChannelType.GoogleChat) && channel.config.mode === "app";
}

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  [ChannelType.Slack]: "Slack",
  [ChannelType.GoogleChat]: "Google Chat",
  [ChannelType.Telegram]: "Telegram",
  [ChannelType.Email]: "Email",
  [ChannelType.Webhook]: "Webhook",
};

// --- per-source-type rule config metadata (drives the dynamic rule form) -----

export interface RuleFieldSpec {
  key: string;
  label: string;
  kind: "number";
  min: number;
  max: number;
  hint?: string;
}

/** Config field specs per rule source type — the rule form renders these. */
export const RULE_SOURCE_FIELD_SPECS: Record<AlertSourceType, RuleFieldSpec[]> = {
  [AlertSourceType.FleetThreshold]: [
    { key: "memoryPercent", label: "Node mem %", kind: "number", min: 0, max: 100 },
    { key: "queryMemoryGb", label: "Query GB", kind: "number", min: 0, max: 1024 },
    { key: "longQueryMin", label: "Query min", kind: "number", min: 0, max: 1440 },
    { key: "partsEtaMin", label: "Parts ETA min", kind: "number", min: 0, max: 1440 },
  ],
  // Data-quality rules are not evaluated yet — kept here so the form/labels are
  // ready when they land. Not offered in the type picker until supported.
  [AlertSourceType.DataQuality]: [],
};

export const ALERT_SOURCE_TYPE_LABELS: Record<AlertSourceType, string> = {
  [AlertSourceType.FleetThreshold]: "Fleet thresholds",
  [AlertSourceType.DataQuality]: "Data quality",
};

/** Short scope word per source type — e.g. the "Active for {scope}" toggle label. */
export const ALERT_SOURCE_SCOPE_LABELS: Record<AlertSourceType, string> = {
  [AlertSourceType.FleetThreshold]: "fleet",
  [AlertSourceType.DataQuality]: "data quality",
};

/** Source types currently selectable when creating a rule (have a working evaluator). */
export const SUPPORTED_RULE_SOURCE_TYPES: AlertSourceType[] = [AlertSourceType.FleetThreshold];
