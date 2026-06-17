/**
 * Alerting deliver — send a test message to a single notification channel.
 *
 * Used by the "Send test" action in Admin → Settings → Alerting to verify a
 * channel's config before relying on it. Takes the DECRYPTED channel config.
 * Production breach delivery still flows through fleetAlerter (unchanged).
 */

import { ChannelType } from "./types";
import { logger } from "../../utils/logger";

const TEST_TITLE = "✅ CHouse UI — alerting test";
const TEST_TEXT =
  "This is a test message from CHouse UI alerting. If you can read this, the channel is configured correctly.";

async function postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
}

/**
 * Deliver a test message to one channel. Returns true on success; throws with a
 * human-readable message on failure so the route can surface it.
 */
export async function sendChannelTest(
  type: ChannelType,
  config: Record<string, unknown>,
): Promise<boolean> {
  switch (type) {
    case ChannelType.Slack: {
      const url = String(config.webhookUrl ?? "");
      if (!url) throw new Error("Slack webhook URL is not set");
      await postJson(url, { text: `${TEST_TITLE}\n${TEST_TEXT}` });
      return true;
    }
    case ChannelType.GoogleChat: {
      const url = String(config.webhookUrl ?? "");
      if (!url) throw new Error("Google Chat webhook URL is not set");
      await postJson(url, { text: `${TEST_TITLE}\n${TEST_TEXT}` });
      return true;
    }
    case ChannelType.Webhook: {
      const url = String(config.url ?? "");
      if (!url) throw new Error("Webhook URL is not set");
      const secret = typeof config.secret === "string" ? config.secret : "";
      await postJson(
        url,
        { title: TEST_TITLE, text: TEST_TEXT, test: true },
        secret ? { Authorization: `Bearer ${secret}` } : undefined,
      );
      return true;
    }
    case ChannelType.Email: {
      const nodemailer = (await import("nodemailer")).default;
      const transport = nodemailer.createTransport({
        host: String(config.host ?? "smtp.gmail.com"),
        port: Number(config.port ?? 465),
        secure: config.secure !== undefined ? Boolean(config.secure) : true,
        auth: { user: String(config.user ?? ""), pass: String(config.password ?? "") },
      });
      await transport.sendMail({
        from: String(config.from ?? config.user ?? ""),
        to: String(config.to ?? ""),
        subject: TEST_TITLE,
        text: TEST_TEXT,
      });
      return true;
    }
    default: {
      logger.error({ module: "AlertingDeliver", type }, "Unknown channel type for test");
      throw new Error(`Unknown channel type: ${type}`);
    }
  }
}
