/**
 * Google Chat rendering (a cardsV2 card) and delivery through an incoming
 * webhook.
 */

import { clip, escapeHtml, requestJson } from "../text";
import type { NotifyMessage, StoredButton } from "../types";
import type { RenderOptions } from "./slack";

export interface GoogleChatPayload {
  text: string;
  cardsV2: Array<{ cardId: string; card: Record<string, unknown> }>;
}

function html(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function renderGoogleChat(message: NotifyMessage, options: RenderOptions): { payload: GoogleChatPayload; buttons: StoredButton[] } {
  const widgets: Array<Record<string, unknown>> = [];
  if (message.text) widgets.push({ textParagraph: { text: clip(html(message.text), 4000) } });
  for (const fact of message.facts ?? []) widgets.push({ decoratedText: { topLabel: clip(fact.label, 100), text: clip(escapeHtml(fact.value), 1000) } });
  for (const section of message.sections ?? []) {
    widgets.push({ textParagraph: { text: clip(section.title ? `<b>${escapeHtml(section.title)}</b><br>${html(section.text)}` : html(section.text), 4000) } });
  }
  if (message.detail) widgets.push({ textParagraph: { text: `<font color="#6b7280">${clip(html(message.detail), 2000)}</font>` } });

  const buttons: Array<Record<string, unknown>> = [];
  const stored: StoredButton[] = [];
  if (options.actions) {
    for (const button of message.buttons ?? []) {
      const index = stored.length;
      stored.push({ action: button.action, value: button.value });
      buttons.push({
        text: clip(button.label, 40),
        onClick: { action: { function: "chouse", parameters: [{ key: "button", value: `${options.rowId}:${index}` }] } },
        ...(button.style === "primary" ? { color: { red: 0.09, green: 0.64, blue: 0.29, alpha: 1 } } : {}),
        ...(button.style === "danger" ? { color: { red: 0.86, green: 0.15, blue: 0.15, alpha: 1 } } : {}),
      });
    }
  }
  for (const link of message.links ?? []) buttons.push({ text: clip(link.label, 40), onClick: { openLink: { url: link.url } } });
  if (buttons.length > 0) widgets.push({ buttonList: { buttons } });
  if (message.footer) widgets.push({ textParagraph: { text: `<font color="#9ca3af">${clip(escapeHtml(message.footer), 500)}</font>` } });

  return {
    payload: {
      text: clip(message.fallback ?? message.title, 4000),
      cardsV2: [{ cardId: "chouse-notify", card: { header: { title: clip(message.title, 200) }, sections: [{ widgets }] } }],
    },
    buttons: stored,
  };
}

export async function postGoogleChatWebhook(webhookUrl: string, payload: GoogleChatPayload): Promise<void> {
  if (!webhookUrl) throw new Error("Google Chat webhook URL is not set");
  const res = await requestJson(webhookUrl, { body: payload, secrets: [webhookUrl] });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.text ? `: ${clip(res.text, 200)}` : ""}`);
}
