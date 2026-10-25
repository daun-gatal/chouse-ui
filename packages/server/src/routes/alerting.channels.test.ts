/**
 * Channel config validation (ADR 0026 §2): Slack and Google Chat modes,
 * Telegram, and which secrets an update may leave blank.
 */

import { describe, expect, it } from "bun:test";

import { ChannelType } from "../services/alerting/types";
import { cleanChannelConfig } from "./alerting";

const SIGNING = "abcdef0123456789abcdef0123456789";
const TG = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123";
const SA = JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" });

const fail = (type: ChannelType, raw: Record<string, unknown>, prev: Parameters<typeof cleanChannelConfig>[2] = null): string => {
  try {
    cleanChannelConfig(type, raw, prev);
    return "accepted";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

describe("Slack", () => {
  it("keeps webhook channels exactly as before (no mode key)", () => {
    expect(cleanChannelConfig(ChannelType.Slack, { webhookUrl: " https://hooks.slack.com/x " }, null)).toEqual({ webhookUrl: "https://hooks.slack.com/x" });
    expect(fail(ChannelType.Slack, {})).toBe("webhookUrl is required");
  });

  it("validates App mode", () => {
    expect(cleanChannelConfig(ChannelType.Slack, { mode: "app", botToken: "xoxb-1-2", signingSecret: SIGNING, channelId: "C0123ABCD" }, null)).toEqual({ mode: "app", channelId: "C0123ABCD", botToken: "xoxb-1-2", signingSecret: SIGNING });
    expect(fail(ChannelType.Slack, { mode: "app", botToken: "xoxb-1", signingSecret: SIGNING, channelId: "general" })).toContain("channel ID");
    expect(fail(ChannelType.Slack, { mode: "app", botToken: "nope", signingSecret: SIGNING, channelId: "C0123ABCD" })).toBe("The bot token starts with xoxb-");
    expect(fail(ChannelType.Slack, { mode: "app", botToken: "xoxb-1", signingSecret: "x y", channelId: "C0123ABCD" })).toContain("signing secret");
    expect(fail(ChannelType.Slack, { mode: "app", channelId: "C0123ABCD" })).toBe("The bot token is required");
  });

  it("an update in the same mode keeps blank secrets; a mode switch needs the new ones", () => {
    const app = { config: { mode: "app", channelId: "C0123ABCD" }, configured: { botToken: true, signingSecret: true, webhookUrl: false } };
    expect(cleanChannelConfig(ChannelType.Slack, { mode: "app", channelId: "C0123ABCD" }, app)).toEqual({ mode: "app", channelId: "C0123ABCD" });
    const webhook = { config: {}, configured: { webhookUrl: true } };
    expect(fail(ChannelType.Slack, { mode: "app", channelId: "C0123ABCD" }, webhook)).toBe("The bot token is required");
    expect(fail(ChannelType.Slack, { mode: "webhook" }, app)).toBe("webhookUrl is required");
    expect(cleanChannelConfig(ChannelType.Slack, {}, webhook)).toEqual({});
  });
});

describe("Google Chat", () => {
  it("validates App mode and normalizes the space", () => {
    expect(cleanChannelConfig(ChannelType.GoogleChat, { mode: "app", serviceAccountJson: SA, space: "AAAAbbbb" }, null)).toEqual({ mode: "app", space: "spaces/AAAAbbbb", serviceAccountJson: SA });
    expect(cleanChannelConfig(ChannelType.GoogleChat, { mode: "app", serviceAccountJson: SA, space: "spaces/AAAAbbbb", audience: "123456789012" }, null)).toMatchObject({ audience: "123456789012" });
    expect(fail(ChannelType.GoogleChat, { mode: "app", serviceAccountJson: "{}", space: "spaces/AAAA" })).toBe("The service account key has no client_email");
    expect(fail(ChannelType.GoogleChat, { mode: "app", serviceAccountJson: "nope", space: "spaces/AAAA" })).toBe("The service account key is not valid JSON");
    expect(fail(ChannelType.GoogleChat, { mode: "app", serviceAccountJson: SA, space: "spaces/../x" })).toContain("space");
    expect(fail(ChannelType.GoogleChat, { mode: "app", serviceAccountJson: SA, space: "spaces/AAAA", audience: "http://x" })).toContain("audience");
  });
});

describe("Telegram", () => {
  it("validates the bot token, chat and topic", () => {
    expect(cleanChannelConfig(ChannelType.Telegram, { botToken: TG, chatId: "-1001234567890", topicId: "42" }, null)).toEqual({ chatId: "-1001234567890", topicId: 42, botToken: TG });
    expect(cleanChannelConfig(ChannelType.Telegram, { botToken: TG, chatId: "@ops_alerts" }, null)).toEqual({ chatId: "@ops_alerts", botToken: TG });
    expect(fail(ChannelType.Telegram, { botToken: "abc", chatId: "-1" })).toContain("BotFather");
    expect(fail(ChannelType.Telegram, { botToken: TG, chatId: "ops" })).toContain("chat ID");
    expect(fail(ChannelType.Telegram, { botToken: TG, chatId: "-1", topicId: "-3" })).toBe("The topic ID is a positive number");
    expect(cleanChannelConfig(ChannelType.Telegram, { chatId: "-1" }, { config: { chatId: "-1" }, configured: { botToken: true } })).toEqual({ chatId: "-1" });
  });
});

describe("Email", () => {
  it("requires a password on create (and when a channel becomes email)", () => {
    expect(fail(ChannelType.Email, { user: "a", to: "b" })).toBe("password is required");
    expect(cleanChannelConfig(ChannelType.Email, { user: "a", to: "b" }, { config: {}, configured: { password: true } })).toEqual({ host: "smtp.gmail.com", port: 465, secure: true, user: "a", to: "b", from: "a" });
  });
});
