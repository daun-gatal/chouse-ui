/**
 * Actions from chat (ADR 0026 §4). A button names a registered action and
 * the value it acts on; the platform endpoints verify the request and hand
 * the click here, which:
 *
 * 1. finds the message the button belongs to, and checks the click came from
 *    where that message was posted;
 * 2. maps the platform user to an active CHouse user;
 * 3. checks the channel's "who can act from this channel" allowlist;
 * 4. runs the action through the route the UI uses, as that user, with an
 *    access token minted for two minutes — so the route's permission checks,
 *    visibility rules and audit apply exactly as in CHouse;
 * 5. audits the click with the platform, the channel and the platform user.
 */

import { randomUUID } from "crypto";

import { AUDIT_ACTIONS } from "../../../rbac/schema/base";
import { createAuditLog } from "../../../rbac/services/rbac";
import { generateAccessToken } from "../../../rbac/services/jwt";
import { logger } from "../../../utils/logger";
import { CHAT_ACTION_USER_AGENT, InProcessApiClient, InProcessApiError } from "../../ai/registry/inProcessApi";
import { decryptChannelConfig } from "../store";
import type { NotificationChannelRow } from "../types";
import { actorsOf, allowedToAct, resolveActor, UnmappedError, type ChatActor, type ChatPlatform, type ExternalUser } from "./actors";
import { getMessage } from "./log";
import type { PlatformRef } from "./types";

export interface ChatActionSpec {
  action: string;
  /** Run it as the clicker, through the API route the UI uses. Returns what to tell them. */
  run(api: InProcessApiClient, value: string): Promise<string>;
}

const REGISTRY = new Map<string, ChatActionSpec>();

export function registerChatAction(spec: ChatActionSpec): void {
  REGISTRY.set(spec.action, spec);
}

/** Where the click says it happened; must match where the message was posted. */
export type ClickPlace =
  | { platform: "slack"; channel: string; ts: string }
  | { platform: "google_chat"; space: string; name: string }
  | { platform: "telegram"; chatId: string; messageId: number };

export interface Click {
  platform: ChatPlatform;
  channel: NotificationChannelRow;
  /** The button's value as posted: `<message row id>:<button index>`. */
  button: string;
  place: ClickPlace;
  external: ExternalUser;
}

export interface ClickOutcome {
  ok: boolean;
  /** What to tell the person who clicked (shown only to them where the platform can). */
  reply: string;
  actor: ChatActor | null;
}

function samePlace(ref: PlatformRef | null, place: ClickPlace): boolean {
  if (!ref || ref.platform !== place.platform) return false;
  if (ref.platform === "slack" && place.platform === "slack") return ref.channel === place.channel && ref.ts === place.ts;
  if (ref.platform === "google_chat" && place.platform === "google_chat") return ref.space === place.space && ref.name === place.name;
  if (ref.platform === "telegram" && place.platform === "telegram") return String(ref.chatId) === String(place.chatId) && ref.messageId === place.messageId;
  return false;
}

/** Clicks per person per minute, so a stuck client cannot hammer the routes behind the buttons. */
const CLICK_LIMIT = 20;
const clickWindows = new Map<string, { count: number; resetAt: number }>();

function underLimit(key: string, now: number): boolean {
  const window = clickWindows.get(key);
  if (!window || window.resetAt <= now) {
    clickWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  window.count++;
  return window.count <= CLICK_LIMIT;
}

/** An access token for one click: the clicker's current roles and permissions, valid two minutes. */
async function tokenFor(actor: ChatActor): Promise<string> {
  return generateAccessToken(
    { sub: actor.userId, email: actor.email, username: actor.username, roles: actor.roles, permissions: actor.permissions, sessionId: `chat:${actor.platform}:${randomUUID()}` },
    "2m",
  );
}

/** Handle one button click. Never throws: every outcome is a reply to the clicker. */
export async function handleClick(click: Click): Promise<ClickOutcome> {
  const refuse = (reply: string, actor: ChatActor | null = null): ClickOutcome => ({ ok: false, reply, actor });
  const match = /^([0-9a-f-]{36}):(\d{1,2})$/.exec(click.button);
  if (!match) return refuse("This button is not one CHouse posted.");
  const message = await getMessage(match[1]);
  if (!message || message.channelId !== click.channel.id || !samePlace(message.ref, click.place)) return refuse("This button is not one CHouse posted here.");
  if (message.closedAt !== null) return refuse("This was already settled.");
  const button = message.buttons[Number(match[2])];
  const spec = button ? REGISTRY.get(button.action) : undefined;
  if (!button || !spec) return refuse("This button no longer does anything.");

  const config = decryptChannelConfig(click.channel.type, JSON.parse(click.channel.config) as Record<string, unknown>);
  let actor: ChatActor;
  try {
    actor = await resolveActor(click.platform, config, click.external);
  } catch (error) {
    const reply = error instanceof UnmappedError ? error.message : "CHouse could not tell who you are.";
    if (!(error instanceof UnmappedError)) logger.warn({ module: "ChatActions", platform: click.platform, err: error instanceof Error ? error.message : String(error) }, "Could not resolve a chat user");
    await audit(click, message.id, button, null, "failed", reply);
    return refuse(reply);
  }
  if (!underLimit(`${actor.userId}`, Date.now())) return refuse("Too many clicks; wait a minute.", actor);
  if (!(await allowedToAct(actorsOf(config), actor, config))) {
    const reply = "You are not on this channel's list of people who can act from it.";
    await audit(click, message.id, button, actor, "failed", reply);
    return refuse(reply, actor);
  }

  const api = new InProcessApiClient(await tokenFor(actor), undefined, 60_000, CHAT_ACTION_USER_AGENT);
  try {
    const reply = await spec.run(api, button.value);
    await audit(click, message.id, button, actor, "success");
    return { ok: true, reply, actor };
  } catch (error) {
    const reply = error instanceof InProcessApiError || error instanceof Error ? error.message : "That did not work.";
    await audit(click, message.id, button, actor, "failed", reply);
    return refuse(reply, actor);
  }
}

async function audit(click: Click, messageId: string, button: { action: string; value: string }, actor: ChatActor | null, status: "success" | "failed", errorMessage?: string): Promise<void> {
  await createAuditLog(AUDIT_ACTIONS.ALERTING_CHAT_ACTION, actor?.userId, {
    resourceType: "channel_message",
    resourceId: messageId,
    status,
    errorMessage,
    details: {
      platform: click.platform,
      channelId: click.channel.id,
      channelName: click.channel.name,
      action: button.action,
      target: button.value,
      platformUser: click.external.id,
      platformUserName: click.external.name ?? null,
      email: actor?.mappedEmail ?? null,
    },
  }).catch((err) => logger.warn({ module: "ChatActions", err: String(err) }, "Could not audit a chat action"));
}
