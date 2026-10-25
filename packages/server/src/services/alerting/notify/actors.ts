/**
 * Who pressed a button (ADR 0026 §4): the platform user mapped to a CHouse
 * user, and the channel's "who can act from this channel" allowlist.
 *
 * - Slack: `users.info` with the bot token, confirmed email → CHouse user.
 * - Google Chat: the event's email → CHouse user.
 * - Telegram: an account linked in the profile (`chat_identities`).
 *
 * The allowlist only narrows: the clicker still needs the CHouse permission
 * for the action, checked by the route the action runs through.
 */

import { createHash, randomBytes, randomUUID } from "crypto";

import { z } from "zod";

import { getUserByEmail, getUserById } from "../../../rbac/services/rbac";
import { all, one, run, sql, str, strOrNull } from "../../observe/db";
import { slackApi } from "./platforms/slack";

export type ChatPlatform = "slack" | "google_chat" | "telegram";

export const channelActorsSchema = z.object({
  mode: z.enum(["any", "only"]).default("any"),
  /** Slack user IDs, Google emails, or Telegram user IDs. */
  platformUsers: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
  /** Slack user group IDs. */
  platformGroups: z.array(z.string().trim().regex(/^S[A-Z0-9]{6,20}$/, "A Slack user group ID looks like S0123ABCD")).max(50).default([]),
  /** Google Workspace domains. */
  domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "A domain looks like example.com")).max(50).default([]),
  /** CHouse user ids. */
  users: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  /** CHouse role names. */
  roles: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
});
export type ChannelActors = z.infer<typeof channelActorsSchema>;

export const ANYONE: ChannelActors = { mode: "any", platformUsers: [], platformGroups: [], domains: [], users: [], roles: [] };

/** The allowlist a channel stores, or "anyone with the permission" when it has none or it is unreadable. */
export function actorsOf(config: Record<string, unknown>): ChannelActors {
  const parsed = channelActorsSchema.safeParse(config.actors ?? {});
  return parsed.success ? parsed.data : ANYONE;
}

export interface ExternalUser {
  /** The platform's user id (Slack U…, Google users/…, Telegram numeric id). */
  id: string;
  /** Google Chat sends the email with the event. */
  email?: string;
  name?: string;
}

export interface ChatActor {
  userId: string;
  username: string;
  email: string;
  roles: string[];
  permissions: string[];
  platform: ChatPlatform;
  external: ExternalUser;
  /** The email the mapping used (Slack, Google Chat). */
  mappedEmail: string | null;
}

/** Why a click cannot be mapped to a person, said to the clicker. */
export class UnmappedError extends Error {}

async function activeUser(userId: string): Promise<Omit<ChatActor, "platform" | "external" | "mappedEmail"> | null> {
  const user = await getUserById(userId);
  if (!user || !user.isActive) return null;
  return { userId: user.id, username: user.username, email: user.email, roles: user.roles, permissions: user.permissions };
}

async function byEmail(email: string): Promise<Omit<ChatActor, "platform" | "external" | "mappedEmail"> | null> {
  const user = await getUserByEmail(email.trim().toLowerCase());
  return user ? activeUser(user.id) : null;
}

/** The CHouse user behind a click. Throws UnmappedError with what the person can do about it. */
export async function resolveActor(platform: ChatPlatform, config: Record<string, unknown>, external: ExternalUser): Promise<ChatActor> {
  if (platform === "slack") {
    const info = (await slackApi(String(config.botToken ?? ""), "users.info", { user: external.id })) as { user?: { profile?: { email?: string }; is_email_confirmed?: boolean; real_name?: string } };
    const email = info.user?.profile?.email;
    if (!email) throw new UnmappedError("CHouse cannot see your Slack email. Ask an admin to grant the app users:read.email.");
    if (info.user?.is_email_confirmed === false) throw new UnmappedError("Confirm your Slack email first, so CHouse knows it is you.");
    const user = await byEmail(email);
    if (!user) throw new UnmappedError(`No active CHouse user has the email ${email}.`);
    return { ...user, platform, external: { ...external, email, name: external.name ?? info.user?.real_name }, mappedEmail: email };
  }
  if (platform === "google_chat") {
    if (!external.email) throw new UnmappedError("Google Chat did not say who you are.");
    const user = await byEmail(external.email);
    if (!user) throw new UnmappedError(`No active CHouse user has the email ${external.email}.`);
    return { ...user, platform, external, mappedEmail: external.email };
  }
  const linked = await one(sql`SELECT user_id FROM chat_identities WHERE platform = 'telegram' AND external_id = ${external.id}`);
  if (!linked) throw new UnmappedError("Link your Telegram account first: CHouse › your profile › Linked chat accounts.");
  const user = await activeUser(str(linked.user_id));
  if (!user) throw new UnmappedError("The CHouse user linked to this Telegram account is not active.");
  return { ...user, platform, external, mappedEmail: null };
}

const groupCache = new Map<string, { members: Set<string>; expiresAt: number }>();
const GROUP_CACHE_MS = 5 * 60_000;

async function slackGroupMembers(botToken: string, group: string): Promise<Set<string>> {
  const cached = groupCache.get(group);
  if (cached && cached.expiresAt > Date.now()) return cached.members;
  const answer = (await slackApi(botToken, "usergroups.users.list", { usergroup: group })) as { users?: string[] };
  const members = new Set(answer.users ?? []);
  groupCache.set(group, { members, expiresAt: Date.now() + GROUP_CACHE_MS });
  return members;
}

/** Whether the channel's allowlist lets this person act from it. */
export async function allowedToAct(actors: ChannelActors, actor: ChatActor, config: Record<string, unknown>): Promise<boolean> {
  if (actors.mode === "any") return true;
  if (actors.users.includes(actor.userId)) return true;
  if (actor.roles.some((role) => actors.roles.includes(role))) return true;
  if (actor.platform === "slack") {
    if (actors.platformUsers.includes(actor.external.id)) return true;
    for (const group of actors.platformGroups) {
      if ((await slackGroupMembers(String(config.botToken ?? ""), group)).has(actor.external.id)) return true;
    }
    return false;
  }
  if (actor.platform === "google_chat") {
    const email = (actor.external.email ?? "").toLowerCase();
    if (actors.platformUsers.some((u) => u.toLowerCase() === email)) return true;
    const domain = email.split("@")[1] ?? "";
    return domain !== "" && actors.domains.includes(domain);
  }
  return actors.platformUsers.includes(actor.external.id);
}

// --- Telegram account links ------------------------------------------------

export interface ChatIdentity {
  id: string;
  platform: ChatPlatform;
  externalId: string;
  displayName: string | null;
  createdAt: number;
}

export async function listIdentities(userId: string): Promise<ChatIdentity[]> {
  const rows = await all(sql`SELECT id, platform, external_id, display_name, created_at FROM chat_identities WHERE user_id = ${userId} ORDER BY created_at`);
  return rows.map((r) => ({ id: str(r.id), platform: str(r.platform) as ChatPlatform, externalId: str(r.external_id), displayName: strOrNull(r.display_name), createdAt: Number(r.created_at) }));
}

/**
 * Link a platform account to a user. An account belongs to one CHouse user:
 * linking it again moves it (the new link proves the person holds it now).
 */
export async function linkIdentity(userId: string, platform: ChatPlatform, externalId: string, displayName: string | null): Promise<void> {
  await run(sql`DELETE FROM chat_identities WHERE platform = ${platform} AND external_id = ${externalId}`);
  await run(sql`DELETE FROM chat_identities WHERE platform = ${platform} AND user_id = ${userId}`);
  await run(sql`INSERT INTO chat_identities (id, user_id, platform, external_id, display_name, created_at) VALUES (${randomUUID()}, ${userId}, ${platform}, ${externalId}, ${displayName}, ${Date.now()})`);
}

export async function unlinkIdentity(userId: string, id: string): Promise<boolean> {
  const row = await one(sql`DELETE FROM chat_identities WHERE id = ${id} AND user_id = ${userId} RETURNING id`);
  return row !== null;
}

// --- one-time linking codes -------------------------------------------------

/** A linking code works once, for this long. */
export const LINK_CODE_TTL_MS = 10 * 60_000;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** A new code for this user; any unused earlier code stops working. Only its hash is kept. */
export async function createLinkCode(userId: string, platform: ChatPlatform, now: number = Date.now()): Promise<{ code: string; expiresAt: number }> {
  // Telegram's /start parameter allows [A-Za-z0-9_-], up to 64 characters.
  const code = randomBytes(24).toString("base64url");
  await run(sql`DELETE FROM chat_link_codes WHERE user_id = ${userId} AND platform = ${platform} AND used_at IS NULL`);
  await run(sql`INSERT INTO chat_link_codes (code_hash, user_id, platform, expires_at, created_at) VALUES (${hashCode(code)}, ${userId}, ${platform}, ${now + LINK_CODE_TTL_MS}, ${now})`);
  return { code, expiresAt: now + LINK_CODE_TTL_MS };
}

/** Use a code: the user it was made for, or null when it is unknown, used or expired. Atomic. */
export async function consumeLinkCode(code: string, platform: ChatPlatform, now: number = Date.now()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
  const row = await one(sql`
    UPDATE chat_link_codes SET used_at = ${now}
    WHERE code_hash = ${hashCode(code)} AND platform = ${platform} AND used_at IS NULL AND expires_at > ${now}
    RETURNING user_id`);
  return row ? str(row.user_id) : null;
}

export async function pruneLinkCodes(now: number = Date.now()): Promise<void> {
  await run(sql`DELETE FROM chat_link_codes WHERE expires_at < ${now - 24 * 60 * 60_000}`);
}
