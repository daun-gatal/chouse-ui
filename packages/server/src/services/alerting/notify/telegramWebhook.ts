/**
 * Telegram webhooks (ADR 0026 §3). Buttons and account links reach CHouse
 * once its webhook is registered with the bot: `setWebhook` with the
 * endpoint and a secret token Telegram echoes in a header. The secret is
 * derived from the bot token and the server's encryption key, so channels
 * sharing a bot share a webhook and nothing extra is stored.
 */

import { deriveServerSecret } from "../../../rbac/services/connections";
import { logger } from "../../../utils/logger";
import { decryptChannelConfig, getChannel, listChannels, patchChannelConfig } from "../store";
import { ChannelType, type NotificationChannelRow } from "../types";
import { publicBaseUrl } from "./links";
import { botIdOf, telegramApi } from "./platforms/telegram";

export function telegramSecretToken(botToken: string): string {
  return deriveServerSecret(`telegram-webhook:${botToken}`);
}

/** Telegram only calls https endpoints; the e2e suite's fake platform is the exception. */
function webhookUrl(botId: string): string | null {
  const base = publicBaseUrl();
  if (!base) return null;
  if (!base.startsWith("https://") && process.env.CHOUSE_ALLOW_TEST_OVERRIDES !== "1") return null;
  return `${base}/api/integrations/telegram/${encodeURIComponent(botId)}`;
}

export interface Registration {
  registered: boolean;
  error: string | null;
  botUsername: string | null;
}

/**
 * Register the channel's bot webhook and remember the outcome on the channel
 * (`webhookRegistered`, `webhookError`, `botUsername`). Never throws.
 */
export async function registerTelegramWebhook(channelId: string): Promise<Registration> {
  const row = await getChannel(channelId);
  if (!row || row.type !== ChannelType.Telegram) return { registered: false, error: "Not a Telegram channel", botUsername: null };
  const config = decryptChannelConfig(row.type, JSON.parse(row.config) as Record<string, unknown>);
  const botToken = String(config.botToken ?? "");
  let outcome: Registration;
  try {
    const me = (await telegramApi(botToken, "getMe", {})) as { username?: string };
    const url = webhookUrl(botIdOf(botToken));
    if (!url) {
      outcome = { registered: false, error: "Set PUBLIC_BASE_URL to the https address of CHouse so Telegram can send button presses.", botUsername: me?.username ?? null };
    } else {
      await telegramApi(botToken, "setWebhook", { url, secret_token: telegramSecretToken(botToken), allowed_updates: ["callback_query", "message"] });
      outcome = { registered: true, error: null, botUsername: me?.username ?? null };
    }
  } catch (error) {
    outcome = { registered: false, error: error instanceof Error ? error.message : String(error), botUsername: null };
    logger.warn({ module: "Notify", channelId, err: outcome.error }, "Could not register the Telegram webhook");
  }
  await patchChannelConfig(channelId, { webhookRegistered: outcome.registered, webhookError: outcome.error, ...(outcome.botUsername ? { botUsername: outcome.botUsername } : {}) });
  return outcome;
}

/** The enabled Telegram channels whose bot this is, with their decrypted config. */
export async function channelsForBot(botId: string): Promise<Array<{ row: NotificationChannelRow; config: Record<string, unknown> }>> {
  const out: Array<{ row: NotificationChannelRow; config: Record<string, unknown> }> = [];
  for (const row of await listChannels()) {
    if (row.type !== ChannelType.Telegram || !row.enabled) continue;
    const config = decryptChannelConfig(row.type, JSON.parse(row.config) as Record<string, unknown>);
    if (botIdOf(String(config.botToken ?? "")) === botId) out.push({ row, config });
  }
  return out;
}
