/**
 * The shared notify layer (ADR 0026 §1): one structured message, rendered for
 * every platform. Features build a `NotifyMessage`; the platform modules turn
 * it into Block Kit, a Google Chat card, Telegram HTML, an email or webhook
 * JSON.
 */

export type NotifySeverity = "info" | "warning" | "critical" | "success";

/** Who sent it — the message log, history and Admin › Alerting group by this. */
export const NOTIFY_FEATURES = [
  "fleet_alert",
  "fleet_rca",
  "scheduled_query",
  "data_health",
  "dashboard_alert",
  "dashboard_report",
  "triage",
  "handoff",
  "remediation",
  "need_you",
  "test",
] as const;
export type NotifyFeature = (typeof NOTIFY_FEATURES)[number];

export function isNotifyFeature(value: unknown): value is NotifyFeature {
  return typeof value === "string" && (NOTIFY_FEATURES as readonly string[]).includes(value);
}

export interface NotifyFact {
  label: string;
  value: string;
}

export interface NotifySection {
  title?: string;
  text: string;
}

export interface NotifyLink {
  label: string;
  url: string;
}

/** A button that asks CHouse to do something; only rendered where the channel can carry it. */
export interface NotifyButton {
  /** A registered chat action, e.g. `ai_action.approve`. */
  action: string;
  label: string;
  /** What the action acts on (an id); never shown to people. */
  value: string;
  style?: "primary" | "danger";
}

export interface NotifyMessage {
  title: string;
  severity?: NotifySeverity;
  /** Body text, plain (newlines kept). */
  text?: string;
  facts?: NotifyFact[];
  sections?: NotifySection[];
  /** A monospace block (a SQL snippet, an error). */
  detail?: string;
  /** A monospace block only email shows: text that never went to chat before (a query's SQL). */
  emailDetail?: string;
  links?: NotifyLink[];
  buttons?: NotifyButton[];
  /** Small print at the bottom. */
  footer?: string;
  /** Notification preview text where the platform shows one; defaults to the title and text. */
  fallback?: string;
  /** The exact JSON a generic webhook receives; defaults to `{ title, text }`. */
  webhook?: Record<string, unknown>;
  emailSubject?: string;
}

/** Where a message landed on its platform, so it can be edited later. */
export type PlatformRef =
  | { platform: "slack"; channel: string; ts: string }
  | { platform: "google_chat"; name: string; space: string }
  | { platform: "telegram"; chatId: string; messageId: number };

/** What one channel can do with a message. */
export interface ChannelCapabilities {
  /** Can edit what it posted (App mode, Telegram). */
  edit: boolean;
  /** Can carry buttons that call back to CHouse. */
  actions: boolean;
}

/** A rendered button as stored with the message: clicks name it by index. */
export interface StoredButton {
  action: string;
  value: string;
}
