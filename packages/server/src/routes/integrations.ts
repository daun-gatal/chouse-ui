/**
 * `/api/integrations` — inbound chat-platform callbacks (ADR 0016 §8, ADR 0026 §3).
 *
 *   POST /slack/interactions     button clicks, signed with a Slack signing secret
 *   POST /google-chat/events     Chat app events, with a Google-signed bearer token
 *   POST /telegram/:botId        bot updates, with the secret token set by setWebhook
 *
 * These are public (a platform cannot send a CHouse session), so each request
 * is authenticated by its platform first, and every decision is then made as
 * the CHouse user behind the click (`notify/actions.ts`). A request that does
 * not verify is refused before its body is read as anything but bytes.
 */

import { timingSafeEqual } from "crypto";

import { Hono } from "hono";

import { AUDIT_ACTIONS } from "../rbac/schema/base";
import { createAuditLog, getUserById } from "../rbac/services/rbac";
import { decryptChannelConfig, listChannels } from "../services/alerting/store";
import { ChannelType, type NotificationChannelRow } from "../services/alerting/types";
import { handleClick } from "../services/alerting/notify/actions";
import { consumeLinkCode, linkIdentity } from "../services/alerting/notify/actors";
import { verifyGoogleChatToken } from "../services/alerting/notify/googleVerify";
import { getMessage } from "../services/alerting/notify/log";
import { publicBaseUrl } from "../services/alerting/notify/links";
import { slackApi } from "../services/alerting/notify/platforms/slack";
import { telegramApi } from "../services/alerting/notify/platforms/telegram";
import { channelsForBot, telegramSecretToken } from "../services/alerting/notify/telegramWebhook";
import { handleInteraction, slackConfigured, verifySlackSignature } from "../services/remediation/slack";
import { logger } from "../utils/logger";

const integrations = new Hono();

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

interface AppChannel {
  row: NotificationChannelRow;
  config: Record<string, unknown>;
}

async function appChannels(type: ChannelType): Promise<AppChannel[]> {
  const out: AppChannel[] = [];
  for (const row of await listChannels()) {
    if (row.type !== type || !row.enabled) continue;
    const config = decryptChannelConfig(row.type, JSON.parse(row.config) as Record<string, unknown>);
    if (config.mode === "app") out.push({ row, config });
  }
  return out;
}

/** The channel, among those a request verified for, that posted the message this button belongs to. */
async function channelOfButton(candidates: AppChannel[], button: string): Promise<AppChannel | undefined> {
  const message = await getMessage(button.split(":")[0] ?? "");
  return message ? candidates.find((ch) => ch.row.id === message.channelId) : undefined;
}

// --- Slack ------------------------------------------------------------------

interface SlackBlockActions {
  type: string;
  user: { id: string; name?: string; username?: string };
  channel?: { id: string };
  container?: { message_ts?: string; channel_id?: string };
  actions?: Array<{ action_id: string; value: string }>;
  response_url?: string;
}

integrations.post("/slack/interactions", async (c) => {
  const raw = await c.req.text();
  const timestamp = c.req.header("X-Slack-Request-Timestamp");
  const signature = c.req.header("X-Slack-Signature");
  const envVerified = slackConfigured() && verifySlackSignature(raw, timestamp, signature, process.env.SLACK_SIGNING_SECRET ?? "");
  const verifiedChannels = (await appChannels(ChannelType.Slack)).filter((ch) => verifySlackSignature(raw, timestamp, signature, String(ch.config.signingSecret ?? "")));
  if (!envVerified && verifiedChannels.length === 0) {
    if (!slackConfigured() && (await appChannels(ChannelType.Slack)).length === 0) return c.json({ success: false, error: "Slack approvals are not configured" }, 404);
    return c.json({ success: false, error: "Invalid signature" }, 401);
  }
  const payloadRaw = new URLSearchParams(raw).get("payload");
  if (!payloadRaw) return c.json({ success: false, error: "Missing payload" }, 400);
  let payload: SlackBlockActions;
  try {
    payload = JSON.parse(payloadRaw) as SlackBlockActions;
  } catch {
    return c.json({ success: false, error: "Malformed payload" }, 400);
  }
  const clicked = payload.actions?.[0];

  // Remediation's environment-variable bot (ADR 0016 §8) keeps working as it did.
  if (clicked && clicked.action_id.startsWith("remediation_")) {
    if (!envVerified) return c.json({ success: false, error: "Invalid signature" }, 401);
    const result = await handleInteraction(payload as Parameters<typeof handleInteraction>[0]);
    // Update the original message asynchronously; Slack only needs a fast 200.
    if (payload.response_url?.startsWith("https://hooks.slack.com/")) {
      void fetch(payload.response_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: result.replaceOriginal, text: result.text, ...(result.blocks ? { blocks: result.blocks } : {}), response_type: "ephemeral" }),
        signal: AbortSignal.timeout(10_000),
      }).catch((error) => logger.warn({ module: "Remediation", err: error instanceof Error ? error.message : String(error) }, "Slack response_url update failed"));
    }
    return c.body(null, 200);
  }

  if (payload.type !== "block_actions" || !clicked || !clicked.action_id.startsWith("chouse_")) return c.body(null, 200);
  // The button names the message it belongs to; only that message's channel may have signed the click.
  const message = await getMessage(clicked.value.split(":")[0] ?? "");
  const channel = message ? verifiedChannels.find((ch) => ch.row.id === message.channelId) : undefined;
  if (!channel) return c.json({ success: false, error: "Invalid signature" }, 401);
  const place = { platform: "slack" as const, channel: payload.channel?.id ?? payload.container?.channel_id ?? "", ts: payload.container?.message_ts ?? "" };
  // Slack wants an answer within three seconds; the action may take longer.
  void (async () => {
    const outcome = await handleClick({ platform: "slack", channel: channel.row, button: clicked.value, place, external: { id: payload.user.id, name: payload.user.username ?? payload.user.name } });
    await slackApi(String(channel.config.botToken ?? ""), "chat.postEphemeral", { channel: place.channel, user: payload.user.id, text: outcome.reply }).catch((error) =>
      logger.warn({ module: "ChatActions", err: error instanceof Error ? error.message : String(error) }, "Could not answer a Slack click"),
    );
  })();
  return c.body(null, 200);
});

// --- Google Chat -------------------------------------------------------------

interface GoogleChatEvent {
  type?: string;
  space?: { name?: string };
  message?: { name?: string };
  user?: { name?: string; email?: string; displayName?: string };
  common?: { parameters?: Record<string, string> };
  action?: { parameters?: Array<{ key: string; value: string }> };
}

/** The endpoint URL Google signs ID tokens for, when a channel sets no audience. */
function googleEventsUrl(): string | null {
  const base = publicBaseUrl();
  return base ? `${base}/api/integrations/google-chat/events` : null;
}

integrations.post("/google-chat/events", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const channels = await appChannels(ChannelType.GoogleChat);
  if (!token || channels.length === 0) return c.json({ success: false, error: "Unauthorized" }, 401);
  const audienceOf = (ch: AppChannel): string | null => (typeof ch.config.audience === "string" && ch.config.audience ? ch.config.audience : googleEventsUrl());
  const audience = await verifyGoogleChatToken(token, channels.map(audienceOf).filter((a): a is string => Boolean(a)));
  if (!audience) return c.json({ success: false, error: "Unauthorized" }, 401);
  let event: GoogleChatEvent;
  try {
    event = (await c.req.json()) as GoogleChatEvent;
  } catch {
    return c.json({ success: false, error: "Malformed event" }, 400);
  }
  if (event.type !== "CARD_CLICKED") return c.json({});
  const space = event.space?.name ?? "";
  const button = event.common?.parameters?.button ?? event.action?.parameters?.find((p) => p.key === "button")?.value ?? "";
  // Several channels may post to one space; the click belongs to the one that posted its message.
  const candidates = channels.filter((ch) => audienceOf(ch) === audience && ch.config.space === space);
  if (candidates.length === 0) return c.json({ success: false, error: "Unauthorized" }, 401);
  const channel = await channelOfButton(candidates, button) ?? candidates[0];
  const outcome = await handleClick({
    platform: "google_chat",
    channel: channel.row,
    button,
    place: { platform: "google_chat", space, name: event.message?.name ?? "" },
    external: { id: event.user?.name ?? "", email: event.user?.email, name: event.user?.displayName },
  });
  return c.json({ actionResponse: { type: "NEW_MESSAGE" }, privateMessageViewer: { name: event.user?.name }, text: outcome.reply });
});

// --- Telegram ----------------------------------------------------------------

interface TelegramUpdate {
  callback_query?: { id: string; from: { id: number; username?: string; first_name?: string }; data?: string; message?: { message_id: number; chat: { id: number; username?: string } } };
  message?: { text?: string; from?: { id: number; username?: string; first_name?: string }; chat: { id: number; type: string } };
}

integrations.post("/telegram/:botId", async (c) => {
  const botId = c.req.param("botId");
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const channels = (await channelsForBot(botId)).filter((ch) => sameSecret(secret, telegramSecretToken(String(ch.config.botToken ?? ""))));
  if (!secret || channels.length === 0) return c.json({ success: false, error: "Unauthorized" }, 401);
  let update: TelegramUpdate;
  try {
    update = (await c.req.json()) as TelegramUpdate;
  } catch {
    return c.json({ ok: true });
  }
  const botToken = String(channels[0].config.botToken ?? "");

  const query = update.callback_query;
  if (query?.message && query.data) {
    const chatId = String(query.message.chat.id);
    const chatName = query.message.chat.username ? `@${query.message.chat.username}` : null;
    const inChat = channels.filter((ch) => String(ch.config.chatId) === chatId || (chatName !== null && ch.config.chatId === chatName));
    // Several channels may share a bot and a chat; the click belongs to the one that posted its message.
    const channel = inChat.length > 0 ? (await channelOfButton(inChat, query.data)) ?? inChat[0] : undefined;
    const outcome = channel
      ? await handleClick({
          platform: "telegram",
          channel: channel.row,
          button: query.data,
          place: { platform: "telegram", chatId, messageId: query.message.message_id },
          external: { id: String(query.from.id), name: query.from.username ?? query.from.first_name },
        })
      : { ok: false, reply: "This chat is not a CHouse channel." };
    await telegramApi(botToken, "answerCallbackQuery", { callback_query_id: query.id, text: outcome.reply.slice(0, 200), show_alert: !outcome.ok }).catch((error) =>
      logger.warn({ module: "ChatActions", err: error instanceof Error ? error.message : String(error) }, "Could not answer a Telegram click"),
    );
    return c.json({ ok: true });
  }

  const message = update.message;
  if (message?.text?.startsWith("/start") && message.from) {
    const reply = await linkFromStart(message.text.slice("/start".length).trim(), message.chat.type, message.from);
    await telegramApi(botToken, "sendMessage", { chat_id: message.chat.id, text: reply }).catch((error) =>
      logger.warn({ module: "ChatActions", err: error instanceof Error ? error.message : String(error) }, "Could not answer a Telegram link"),
    );
  }
  return c.json({ ok: true });
});

/** `/start <code>` in a private chat links the Telegram account to the CHouse user who made the code. */
async function linkFromStart(code: string, chatType: string, from: { id: number; username?: string; first_name?: string }): Promise<string> {
  if (!code) return "To use buttons in CHouse alerts, link this account: CHouse › your profile › Linked chat accounts.";
  if (chatType !== "private") return "Open this link in a private chat with the bot.";
  const userId = await consumeLinkCode(code, "telegram");
  if (!userId) return "This link expired or was already used. Make a new one in CHouse.";
  const user = await getUserById(userId);
  if (!user || !user.isActive) return "The CHouse user for this link is not active.";
  const name = from.username ? `@${from.username}` : from.first_name ?? null;
  await linkIdentity(userId, "telegram", String(from.id), name);
  await createAuditLog(AUDIT_ACTIONS.CHAT_IDENTITY_LINK, userId, { resourceType: "chat_identity", details: { platform: "telegram", platformUser: String(from.id), platformUserName: name } });
  return `Linked to CHouse user ${user.username}. You can now use the buttons in CHouse alerts.`;
}

export default integrations;
