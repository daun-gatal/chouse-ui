/**
 * Shared helpers for the platform renderers: escaping, plain-text fallbacks,
 * length limits and one HTTP call with a timeout that never leaks secrets in
 * its errors.
 */

import type { NotifyMessage, NotifySeverity } from "./types";

export const SEVERITY_COLOR: Record<NotifySeverity, string> = {
  info: "#2563eb",
  warning: "#d97706",
  critical: "#dc2626",
  success: "#16a34a",
};

/** A channel that does not answer in time fails the delivery instead of holding the caller open. */
export const DELIVERY_TIMEOUT_MS = 15_000;

/** Cut to `max` characters, ending with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** HTML escaping for email, Google Chat text and Telegram's HTML mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Slack mrkdwn escaping: names and values from data can never ping a channel or forge a link. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The whole message as plain text: email text parts, webhook bodies, previews. */
export function plainText(message: NotifyMessage): string {
  const parts: string[] = [];
  if (message.text) parts.push(message.text);
  if (message.facts?.length) parts.push(message.facts.map((f) => `${f.label}: ${f.value}`).join("\n"));
  for (const section of message.sections ?? []) parts.push(section.title ? `${section.title}\n${section.text}` : section.text);
  if (message.detail) parts.push(message.detail);
  if (message.links?.length) parts.push(message.links.map((l) => `${l.label}: ${l.url}`).join("\n"));
  if (message.footer) parts.push(message.footer);
  return parts.join("\n\n");
}

/** The text a generic webhook receives when the message has no webhook body of its own. */
export function webhookBody(message: NotifyMessage): Record<string, unknown> {
  return message.webhook ?? { title: message.title, text: message.text ?? plainText(message) };
}

/** Only an https link to a public host can be a Telegram button; anything else goes in the text. */
export function isPublicHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    return !(host === "localhost" || host.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":"));
  } catch {
    return false;
  }
}

/**
 * POST or PATCH JSON with a timeout. `secrets` are masked out of any error
 * message (a Telegram bot token lives in its URL).
 */
export async function requestJson(
  url: string,
  init: { method?: "POST" | "PATCH" | "GET"; body?: unknown; headers?: Record<string, string>; secrets?: string[] },
): Promise<{ status: number; ok: boolean; json: unknown; text: string }> {
  const mask = (message: string): string => (init.secrets ?? []).filter((s) => s.length > 0).reduce((m, s) => m.split(s).join("•••"), message);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body === undefined ? init.headers : { "Content-Type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(mask(/timeout|abort/i.test(reason) ? `no answer within ${DELIVERY_TIMEOUT_MS / 1000}s` : reason));
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text: mask(text) };
}
