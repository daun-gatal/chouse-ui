/**
 * Google Chat rendering (a cardsV2 card) and delivery: through an incoming
 * webhook, or as a Chat app signed in with a service account (App mode), which
 * can edit what it posted and carry buttons.
 */

import { importPKCS8, SignJWT } from "jose";

import { platformHost } from "../hosts";
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

// --- App mode: a service account, so messages can be edited and carry buttons -

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** Parse a service account key file; throws with what is missing. */
export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("The service account key is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("The service account key is not a JSON object");
  const record = parsed as Record<string, unknown>;
  if (typeof record.client_email !== "string" || !record.client_email) throw new Error("The service account key has no client_email");
  if (typeof record.private_key !== "string" || !record.private_key.includes("PRIVATE KEY")) throw new Error("The service account key has no private_key");
  return { client_email: record.client_email, private_key: record.private_key, project_id: typeof record.project_id === "string" ? record.project_id : undefined };
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** An access token for the Chat API (chat.bot scope), cached until shortly before it expires. */
async function accessToken(serviceAccountJson: string): Promise<string> {
  const account = parseServiceAccount(serviceAccountJson);
  const cached = tokens.get(account.client_email);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const tokenUrl = `${platformHost("googleOauth")}/token`;
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/chat.bot" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience(tokenUrl)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await requestJson(tokenUrl, { form: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }, secrets: [assertion] });
  const answer = (res.json ?? {}) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !answer.access_token) throw new Error(`Google sign-in failed: ${answer.error_description ?? answer.error ?? `HTTP ${res.status}`}`);
  tokens.set(account.client_email, { token: answer.access_token, expiresAt: Date.now() + (answer.expires_in ?? 3600) * 1000 });
  return answer.access_token;
}

async function chatApi(serviceAccountJson: string, method: "POST" | "PATCH" | "GET", path: string, body?: unknown): Promise<Record<string, unknown>> {
  const token = await accessToken(serviceAccountJson);
  const res = await requestJson(`${platformHost("googleChat")}/v1/${path}`, { method, body, headers: { Authorization: `Bearer ${token}` }, secrets: [token] });
  const answer = (res.json ?? {}) as Record<string, unknown>;
  if (!res.ok) {
    const error = answer.error as { message?: string } | undefined;
    throw new Error(`Google Chat: ${error?.message ?? `HTTP ${res.status}`}`);
  }
  return answer;
}

/** A space name as the Chat API wants it ("spaces/AAAA…"). */
export function spaceName(space: string): string {
  const trimmed = space.trim();
  return trimmed.startsWith("spaces/") ? trimmed : `spaces/${trimmed}`;
}

export async function postGoogleChatApp(serviceAccountJson: string, space: string, payload: GoogleChatPayload): Promise<{ name: string; space: string }> {
  const answer = await chatApi(serviceAccountJson, "POST", `${spaceName(space)}/messages`, payload);
  if (typeof answer.name !== "string") throw new Error("Google Chat: no message name in the answer");
  return { name: answer.name, space: spaceName(space) };
}

export async function updateGoogleChatApp(serviceAccountJson: string, name: string, payload: GoogleChatPayload): Promise<void> {
  await chatApi(serviceAccountJson, "PATCH", `${name}?updateMask=text,cardsV2`, payload);
}

/** The space's display name, for the channel check. */
export async function googleChatSpace(serviceAccountJson: string, space: string): Promise<string> {
  const answer = await chatApi(serviceAccountJson, "GET", spaceName(space));
  return typeof answer.displayName === "string" && answer.displayName ? answer.displayName : spaceName(space);
}
