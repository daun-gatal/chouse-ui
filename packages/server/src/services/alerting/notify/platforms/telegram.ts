/**
 * Telegram rendering (HTML parse mode with an inline keyboard) and delivery
 * through the Bot API. A bot can always edit what it posted; buttons work once
 * CHouse has registered its webhook with the bot.
 */

import { platformHost } from "../hosts";
import { clip, escapeHtml, isPublicHttpsUrl, requestJson } from "../text";
import type { NotifyMessage, StoredButton } from "../types";
import type { RenderOptions } from "./slack";

/** Telegram's limit on a message's text, after entities are parsed. */
const MAX_TEXT = 4096;

export interface TelegramPayload {
  text: string;
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
  reply_markup?: { inline_keyboard: Array<Array<Record<string, unknown>>> };
}

export function renderTelegram(message: NotifyMessage, options: RenderOptions): { payload: TelegramPayload; buttons: StoredButton[] } {
  const parts: string[] = [`<b>${escapeHtml(clip(message.title, 250))}</b>`];
  if (message.text) parts.push(escapeHtml(clip(message.text, 2500)));
  if (message.facts?.length) parts.push(message.facts.map((f) => `<b>${escapeHtml(clip(f.label, 60))}:</b> ${escapeHtml(clip(f.value, 300))}`).join("\n"));
  for (const section of message.sections ?? []) {
    parts.push(section.title ? `<b>${escapeHtml(clip(section.title, 120))}</b>\n${escapeHtml(clip(section.text, 800))}` : escapeHtml(clip(section.text, 800)));
  }
  if (message.detail) parts.push(`<pre>${escapeHtml(clip(message.detail, 600))}</pre>`);

  const rows: Array<Array<Record<string, unknown>>> = [];
  const stored: StoredButton[] = [];
  if (options.actions && message.buttons?.length) {
    const row: Array<Record<string, unknown>> = [];
    for (const button of message.buttons) {
      const index = stored.length;
      stored.push({ action: button.action, value: button.value });
      // callback_data is at most 64 bytes: the message row id and the button index fit.
      row.push({ text: clip(button.label, 60), callback_data: `${options.rowId}:${index}` });
    }
    rows.push(row);
  }
  const textLinks: string[] = [];
  for (const link of message.links ?? []) {
    if (isPublicHttpsUrl(link.url)) rows.push([{ text: clip(link.label, 60), url: link.url }]);
    else textLinks.push(`<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`);
  }
  if (textLinks.length) parts.push(textLinks.join(" · "));
  if (message.footer) parts.push(`<i>${escapeHtml(clip(message.footer, 200))}</i>`);

  let text = parts.join("\n\n");
  // Each part is clipped on its own, so this only bites on unusually long messages: drop whole parts from the end, never the title.
  while (text.length > MAX_TEXT && parts.length > 1) {
    parts.pop();
    text = parts.join("\n\n");
  }
  return {
    payload: { text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) },
    buttons: stored,
  };
}

interface TelegramAnswer {
  ok?: boolean;
  description?: string;
  result?: unknown;
}

/** Call one Bot API method; throws with Telegram's description. The token never appears in errors. */
export async function telegramApi(botToken: string, method: string, body: Record<string, unknown>): Promise<unknown> {
  if (!botToken) throw new Error("Telegram bot token is not set");
  const res = await requestJson(`${platformHost("telegram")}/bot${botToken}/${method}`, { body, secrets: [botToken] });
  const answer = (res.json ?? {}) as TelegramAnswer;
  if (!answer.ok) throw new Error(`Telegram ${method}: ${answer.description ?? `HTTP ${res.status}`}`);
  return answer.result;
}

/** The numeric bot id: the part of the token before the colon (not a secret). */
export function botIdOf(botToken: string): string {
  return botToken.split(":")[0] ?? "";
}

export async function postTelegram(botToken: string, chatId: string, topicId: number | null, payload: TelegramPayload): Promise<{ chatId: string; messageId: number }> {
  if (!chatId) throw new Error("Telegram chat ID is not set");
  const result = (await telegramApi(botToken, "sendMessage", { chat_id: chatId, ...(topicId ? { message_thread_id: topicId } : {}), ...payload })) as { message_id?: number; chat?: { id?: number | string } };
  if (typeof result?.message_id !== "number") throw new Error("Telegram sendMessage: no message id in the answer");
  return { chatId: String(result.chat?.id ?? chatId), messageId: result.message_id };
}

export async function updateTelegram(botToken: string, ref: { chatId: string; messageId: number }, payload: TelegramPayload): Promise<void> {
  try {
    await telegramApi(botToken, "editMessageText", { chat_id: ref.chatId, message_id: ref.messageId, ...payload, reply_markup: payload.reply_markup ?? { inline_keyboard: [] } });
  } catch (error) {
    // Editing to the same content is not a failure.
    if (!(error instanceof Error && /message is not modified/i.test(error.message))) throw error;
  }
}

/** The bot's username and the chat's title, for the channel check. */
export async function telegramIdentity(botToken: string, chatId: string): Promise<{ bot: string; chat: string }> {
  const me = (await telegramApi(botToken, "getMe", {})) as { username?: string };
  const chat = (await telegramApi(botToken, "getChat", { chat_id: chatId })) as { title?: string; username?: string; first_name?: string };
  return { bot: me?.username ? `@${me.username}` : "bot", chat: chat?.title ?? chat?.username ?? chat?.first_name ?? chatId };
}
