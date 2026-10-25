/**
 * `/api/chat-identities` — your linked chat accounts (ADR 0026 §4).
 *
 *   GET    /                       your links, and the Telegram bots you can link with
 *   POST   /telegram/link-code     a one-time link that opens the bot with a code
 *   DELETE /:id                    unlink one of yours
 *
 * Slack and Google Chat need no link: CHouse matches them by your email.
 * Telegram has no email, so you prove the account is yours by opening the
 * link from it: the bot receives `/start <code>` and links the sender.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { getRbacUser, rbacAuthMiddleware } from "../rbac/middleware/rbacAuth";
import { AUDIT_ACTIONS } from "../rbac/schema/base";
import { createAuditLogWithContext } from "../rbac/services/rbac";
import { listChannels } from "../services/alerting/store";
import { ChannelType } from "../services/alerting/types";
import { createLinkCode, listIdentities, unlinkIdentity } from "../services/alerting/notify/actors";
import { AppError, requireParam } from "../types";

const chatIdentities = new Hono();
chatIdentities.use("*", rbacAuthMiddleware);

/** Telegram bots that can take a link: an enabled channel whose webhook is registered. Names only. */
async function linkableBots(): Promise<string[]> {
  const bots = new Set<string>();
  for (const row of await listChannels()) {
    if (row.type !== ChannelType.Telegram || !row.enabled) continue;
    const config = JSON.parse(row.config) as Record<string, unknown>;
    if (config.webhookRegistered === true && typeof config.botUsername === "string" && config.botUsername) bots.add(config.botUsername);
  }
  return [...bots].sort();
}

chatIdentities.get("/", async (c) => {
  const user = getRbacUser(c);
  return c.json({ success: true, data: { identities: await listIdentities(user.sub), telegramBots: await linkableBots(), email: user.email } });
});

chatIdentities.post("/telegram/link-code", zValidator("json", z.object({ bot: z.string().trim().regex(/^[A-Za-z0-9_]{5,32}$/) })), async (c) => {
  const user = getRbacUser(c);
  const { bot } = c.req.valid("json");
  if (!(await linkableBots()).includes(bot)) throw AppError.badRequest("That bot cannot take links right now. Ask an admin to check its channel in Admin › Alerting.");
  const { code, expiresAt } = await createLinkCode(user.sub, "telegram");
  return c.json({ success: true, data: { link: `https://t.me/${bot}?start=${code}`, expiresAt } });
});

chatIdentities.delete("/:id", async (c) => {
  const user = getRbacUser(c);
  const id = requireParam(c, "id");
  if (!(await unlinkIdentity(user.sub, id))) throw AppError.notFound("Linked account not found");
  await createAuditLogWithContext(c, AUDIT_ACTIONS.CHAT_IDENTITY_UNLINK, user.sub, { resourceType: "chat_identity", resourceId: id });
  return c.json({ success: true });
});

export default chatIdentities;
