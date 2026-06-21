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
 * Deliver an arbitrary `{title, text}` message to one channel (DECRYPTED config).
 * Reused by the alerting test action and by the Scheduled Queries outbox delivery
 * pass — no per-feature delivery code. Throws with a human-readable message on
 * failure so the caller can surface/retry it.
 */
export async function sendChannelMessage(
  type: ChannelType,
  config: Record<string, unknown>,
  message: { title: string; text: string },
): Promise<boolean> {
  const { title, text } = message;
  switch (type) {
    case ChannelType.Slack: {
      const url = String(config.webhookUrl ?? "");
      if (!url) throw new Error("Slack webhook URL is not set");
      await postJson(url, {
        text: `${title}\n${text}`,
        attachments: [
          {
            color: "#2563eb",
            blocks: [
              { type: "header", text: { type: "plain_text", text: title, emoji: true } },
              { type: "section", text: { type: "mrkdwn", text } },
            ],
          },
        ],
      });
      return true;
    }
    case ChannelType.GoogleChat: {
      const url = String(config.webhookUrl ?? "");
      if (!url) throw new Error("Google Chat webhook URL is not set");
      await postJson(url, {
        text: title,
        cardsV2: [
          {
            cardId: "scheduled-query",
            card: {
              header: { title },
              sections: [{ widgets: [{ textParagraph: { text } }] }],
            },
          },
        ],
      });
      return true;
    }
    case ChannelType.Webhook: {
      const url = String(config.url ?? "");
      if (!url) throw new Error("Webhook URL is not set");
      const secret = typeof config.secret === "string" ? config.secret : "";
      await postJson(url, { title, text }, secret ? { Authorization: `Bearer ${secret}` } : undefined);
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
        subject: title,
        text,
      });
      return true;
    }
    default: {
      logger.error({ module: "AlertingDeliver", type }, "Unknown channel type for message");
      throw new Error(`Unknown channel type: ${type}`);
    }
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
      // Mirror the REAL breach payload shape (Block Kit `attachments`), not a
      // bare `{text}`. A bare text body is accepted by both Slack AND Google
      // Chat, so it silently passes for a channel that's typed Slack but points
      // at a Google Chat webhook — then real alerts (which DO send `attachments`)
      // get rejected 400 by Google Chat. Sending the real shape here makes the
      // test fail for that mismatch, instead of giving false confidence.
      await postJson(url, {
        text: `${TEST_TITLE}\n${TEST_TEXT}`,
        attachments: [
          {
            color: "#16a34a",
            blocks: [
              { type: "header", text: { type: "plain_text", text: TEST_TITLE, emoji: true } },
              { type: "section", text: { type: "mrkdwn", text: TEST_TEXT } },
            ],
          },
        ],
      });
      return true;
    }
    case ChannelType.GoogleChat: {
      const url = String(config.webhookUrl ?? "");
      if (!url) throw new Error("Google Chat webhook URL is not set");
      // Mirror the REAL breach payload shape (`cardsV2`). Same reasoning as
      // Slack above — a bare `{text}` would pass even against a Slack webhook,
      // masking a type/URL mismatch. The card forces a faithful round-trip.
      await postJson(url, {
        text: TEST_TITLE,
        cardsV2: [
          {
            cardId: "alerting-test",
            card: {
              header: { title: TEST_TITLE },
              sections: [{ widgets: [{ textParagraph: { text: TEST_TEXT } }] }],
            },
          },
        ],
      });
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
