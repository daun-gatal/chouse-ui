/**
 * Linked chat accounts (ADR 0026 §4): Slack and Google Chat match you by your
 * email; a Telegram account is linked by opening a one-time link from it.
 */

import { api } from "./client";

export interface ChatIdentity {
  id: string;
  platform: "slack" | "google_chat" | "telegram";
  externalId: string;
  displayName: string | null;
  createdAt: number;
}

export interface ChatIdentities {
  identities: ChatIdentity[];
  /** Telegram bots you can link with (their channels take button presses). */
  telegramBots: string[];
  /** The email Slack and Google Chat are matched by. */
  email: string;
}

export function getChatIdentities(): Promise<ChatIdentities> {
  return api.get<ChatIdentities>("/chat-identities");
}

/** A one-time link that opens the bot; it works for ten minutes. */
export function createTelegramLink(bot: string): Promise<{ link: string; expiresAt: number }> {
  return api.post<{ link: string; expiresAt: number }>("/chat-identities/telegram/link-code", { bot });
}

export function unlinkChatIdentity(id: string): Promise<void> {
  return api.delete<void>(`/chat-identities/${encodeURIComponent(id)}`);
}
