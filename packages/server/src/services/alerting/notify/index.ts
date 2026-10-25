/**
 * The shared notify layer (ADR 0026 §1). Every feature that talks to a
 * notification channel goes through here:
 *
 * - `sendToChannel` renders a message for one channel, claims it in the
 *   message log (so it is sent once), delivers it and records the outcome;
 * - `notifyChannelIds` does that for a feature's channel list, collecting
 *   what was delivered and what failed, as each feature reports it;
 * - `editSubject` re-renders what was posted about a subject wherever the
 *   channel can edit (an alert resolved, a request decided).
 */

import { randomUUID } from "crypto";

import { logger } from "../../../utils/logger";
import { decryptChannelConfig, getChannel } from "../store";
import { ChannelType, type NotificationChannelRow } from "../types";
import { claimMessage, markEdited, markFailed, markSent, openMessages } from "./log";
import { sendEmail } from "./platforms/email";
import { postGoogleChatWebhook, renderGoogleChat } from "./platforms/googleChat";
import { postSlackWebhook, renderSlack } from "./platforms/slack";
import { postWebhook } from "./platforms/webhook";
import type { ChannelCapabilities, NotifyFeature, NotifyMessage, PlatformRef, StoredButton } from "./types";

export type { NotifyMessage, NotifyFeature } from "./types";

const TEST_TITLE = "✅ CHouse UI — alerting test";
const TEST_TEXT = "This is a test message from CHouse UI alerting. If you can read this, the channel is configured correctly.";

/**
 * The channel test. It uses the real alert shapes (Block Kit attachments,
 * cardsV2), not a bare `{text}`: a bare text body is accepted by both Slack and
 * Google Chat, so it would pass for a channel typed Slack that points at a
 * Google Chat webhook, and real alerts would then be rejected.
 */
export const TEST_MESSAGE: NotifyMessage = {
  title: TEST_TITLE,
  severity: "success",
  text: TEST_TEXT,
  webhook: { title: TEST_TITLE, text: TEST_TEXT, test: true },
};

export interface NotifyKey {
  feature: NotifyFeature;
  /** What the message is about; omit for a one-off message (each send is new). */
  subjectId?: string;
  /** Tells apart several messages about one subject (fired, resolved…); defaults to "post". */
  kind?: string;
}

function parseConfig(row: NotificationChannelRow): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row.config);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** What a channel can do with a message, from its type and settings (no secrets needed). */
export function capabilitiesOf(_row: NotificationChannelRow): ChannelCapabilities {
  return { edit: false, actions: false };
}

/**
 * Whether a channel has what it needs to deliver. Secrets are checked for
 * presence only (they stay encrypted here).
 */
export function isDeliverable(row: NotificationChannelRow): boolean {
  const config = parseConfig(row);
  const has = (key: string): boolean => typeof config[key] === "string" && (config[key] as string).length > 0;
  switch (row.type) {
    case ChannelType.Slack:
    case ChannelType.GoogleChat:
      return has("webhookUrl");
    case ChannelType.Webhook:
      return has("url");
    case ChannelType.Email:
      return has("user") && has("password") && has("to");
    default:
      return false;
  }
}

interface Delivered {
  ref: PlatformRef | null;
  buttons: StoredButton[];
}

async function deliver(row: NotificationChannelRow, config: Record<string, unknown>, message: NotifyMessage, rowId: string): Promise<Delivered> {
  const actions = capabilitiesOf(row).actions;
  switch (row.type) {
    case ChannelType.Slack: {
      const { payload, buttons } = renderSlack(message, { actions, rowId });
      await postSlackWebhook(String(config.webhookUrl ?? ""), payload);
      return { ref: null, buttons };
    }
    case ChannelType.GoogleChat: {
      const { payload, buttons } = renderGoogleChat(message, { actions, rowId });
      await postGoogleChatWebhook(String(config.webhookUrl ?? ""), payload);
      return { ref: null, buttons };
    }
    case ChannelType.Webhook:
      await postWebhook(config, message);
      return { ref: null, buttons: [] };
    case ChannelType.Email:
      await sendEmail(config, message);
      return { ref: null, buttons: [] };
    default:
      throw new Error(`Unknown channel type: ${String(row.type)}`);
  }
}

export type SendStatus = "sent" | "duplicate";

/**
 * Send one message to one channel. Returns "duplicate" when this exact
 * message (same feature, subject and kind) was already sent there. Throws
 * with a readable reason when delivery fails; the failure is logged.
 */
export async function sendToChannel(row: NotificationChannelRow, message: NotifyMessage, key: NotifyKey): Promise<{ status: SendStatus; messageId: string | null }> {
  const messageId = await claimMessage({ channelId: row.id, feature: key.feature, subjectId: key.subjectId ?? randomUUID(), kind: key.kind ?? "post" });
  if (!messageId) return { status: "duplicate", messageId: null };
  try {
    const config = decryptChannelConfig(row.type, parseConfig(row));
    const delivered = await deliver(row, config, message, messageId);
    await markSent(messageId, delivered.ref, delivered.buttons, message);
    return { status: "sent", messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markFailed(messageId, reason).catch(() => undefined);
    throw new Error(reason);
  }
}

export interface ChannelFailure {
  channelId: string;
  /** The channel's name, when it still exists. */
  name: string | null;
  reason: "missing" | "disabled" | "error";
  error: string;
}

export interface BatchResult {
  /** Names of the channels the message reached (or had already reached). */
  deliveredTo: string[];
  channelIds: string[];
  failed: ChannelFailure[];
}

/** Send one message to a feature's channels, collecting what reached where. */
export async function notifyChannelIds(channelIds: string[], message: NotifyMessage, key: NotifyKey): Promise<BatchResult> {
  const result: BatchResult = { deliveredTo: [], channelIds: [], failed: [] };
  for (const channelId of [...new Set(channelIds)]) {
    const row = await getChannel(channelId);
    if (!row) {
      result.failed.push({ channelId, name: null, reason: "missing", error: "channel no longer exists" });
      continue;
    }
    if (!row.enabled) {
      result.failed.push({ channelId, name: row.name, reason: "disabled", error: "channel is disabled" });
      continue;
    }
    try {
      await sendToChannel(row, message, key);
      result.deliveredTo.push(row.name);
      result.channelIds.push(row.id);
    } catch (error) {
      result.failed.push({ channelId, name: row.name, reason: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (result.failed.some((f) => f.reason === "error")) {
    logger.warn({ module: "Notify", feature: key.feature, failed: result.failed.map((f) => ({ channelId: f.channelId, error: f.error })) }, "Delivery failed on some channels");
  }
  return result;
}

/** How an edit is described: a new message, or a change to what was posted (with when it was posted). */
export type EditMessage = NotifyMessage | ((posted: NotifyMessage, postedAt: number) => NotifyMessage);

/**
 * Re-render what was posted about a subject, on every channel that can edit
 * it. `close` marks the subject settled: those messages are never edited
 * again. Channels that cannot edit are left as they are. Never throws.
 */
export async function editSubject(feature: NotifyFeature, subjectId: string, edit: EditMessage, options: { close: boolean }): Promise<number> {
  let edited = 0;
  for (const posted of await openMessages(feature, subjectId)) {
    try {
      const row = await getChannel(posted.channelId);
      if (!row || !capabilitiesOf(row).edit || !posted.ref || !posted.message) {
        if (options.close) await markEdited(posted.id, [], null, true);
        continue;
      }
      const message = typeof edit === "function" ? edit(posted.message, posted.createdAt) : edit;
      await markEdited(posted.id, [], message, options.close);
      edited++;
    } catch (error) {
      logger.warn({ module: "Notify", feature, subjectId, messageId: posted.id, err: error instanceof Error ? error.message : String(error) }, "Could not edit a posted message");
    }
  }
  return edited;
}
