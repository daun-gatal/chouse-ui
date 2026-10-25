/**
 * Slack rendering (Block Kit inside a colored attachment, as alerts always
 * looked) and delivery: through an incoming webhook, or with a bot token (App
 * mode), which can edit what it posted and carry buttons.
 */

import { platformHost } from "../hosts";
import { clip, escapeSlack, plainText, requestJson, SEVERITY_COLOR } from "../text";
import type { NotifyMessage, StoredButton } from "../types";

export interface RenderOptions {
  /** Render action buttons (the channel can call back). */
  actions: boolean;
  /** The message log row id: a button's value is `<rowId>:<index>`. */
  rowId: string;
}

export interface SlackPayload {
  text: string;
  attachments: Array<{ color: string; blocks: Array<Record<string, unknown>> }>;
}

export function renderSlack(message: NotifyMessage, options: RenderOptions): { payload: SlackPayload; buttons: StoredButton[] } {
  const blocks: Array<Record<string, unknown>> = [
    { type: "header", text: { type: "plain_text", text: clip(message.title, 150), emoji: true } },
  ];
  if (message.text) blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(escapeSlack(message.text), 3000) } });
  if (message.facts?.length) {
    blocks.push({
      type: "section",
      fields: message.facts.slice(0, 10).map((f) => ({ type: "mrkdwn", text: clip(`*${escapeSlack(f.label)}*\n${escapeSlack(f.value)}`, 2000) })),
    });
  }
  for (const section of message.sections ?? []) {
    const text = section.title ? `*${escapeSlack(section.title)}*\n${escapeSlack(section.text)}` : escapeSlack(section.text);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(text, 3000) } });
  }
  if (message.detail) blocks.push({ type: "section", text: { type: "mrkdwn", text: `\`\`\`${clip(escapeSlack(message.detail), 2900)}\`\`\`` } });

  const elements: Array<Record<string, unknown>> = [];
  const stored: StoredButton[] = [];
  if (options.actions) {
    for (const button of message.buttons ?? []) {
      const index = stored.length;
      stored.push({ action: button.action, value: button.value });
      elements.push({
        type: "button",
        action_id: `chouse_${index}`,
        text: { type: "plain_text", text: clip(button.label, 75) },
        value: `${options.rowId}:${index}`,
        ...(button.style ? { style: button.style } : {}),
      });
    }
  }
  (message.links ?? []).forEach((link, i) => {
    elements.push({ type: "button", action_id: `link_${i}`, text: { type: "plain_text", text: clip(link.label, 75) }, url: link.url });
  });
  if (elements.length > 0) blocks.push({ type: "actions", elements: elements.slice(0, 25) });
  if (message.footer) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: clip(escapeSlack(message.footer), 2000) }] });

  const fallback = message.fallback ?? `${message.title}\n${message.text ?? plainText(message)}`;
  return {
    payload: { text: clip(escapeSlack(fallback), 3000), attachments: [{ color: SEVERITY_COLOR[message.severity ?? "info"], blocks }] },
    buttons: stored,
  };
}

export async function postSlackWebhook(webhookUrl: string, payload: SlackPayload): Promise<void> {
  if (!webhookUrl) throw new Error("Slack webhook URL is not set");
  const res = await requestJson(webhookUrl, { body: payload, secrets: [webhookUrl] });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.text ? `: ${clip(res.text, 200)}` : ""}`);
}

// --- App mode: a bot token, so messages can be edited and carry buttons -----

interface SlackApiAnswer {
  ok?: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  user?: string;
  team?: string;
}

/** Call one Slack Web API method with the bot token; throws with Slack's error code. */
export async function slackApi(botToken: string, method: string, body: Record<string, unknown>): Promise<SlackApiAnswer> {
  if (!botToken) throw new Error("Slack bot token is not set");
  const res = await requestJson(`${platformHost("slack")}/api/${method}`, {
    body,
    headers: { Authorization: `Bearer ${botToken}` },
    secrets: [botToken],
  });
  const answer = (res.json ?? {}) as SlackApiAnswer;
  if (res.status === 429) throw new Error(`Slack ${method}: rate limited`);
  if (!answer.ok) throw new Error(`Slack ${method}: ${answer.error ?? `HTTP ${res.status}`}`);
  return answer;
}

export async function postSlackApp(botToken: string, channel: string, payload: SlackPayload): Promise<{ channel: string; ts: string }> {
  if (!channel) throw new Error("Slack channel ID is not set");
  const answer = await slackApi(botToken, "chat.postMessage", { channel, ...payload, unfurl_links: false, unfurl_media: false });
  if (!answer.ts) throw new Error("Slack chat.postMessage: no message timestamp in the answer");
  return { channel: answer.channel ?? channel, ts: answer.ts };
}

export async function updateSlackApp(botToken: string, ref: { channel: string; ts: string }, payload: SlackPayload): Promise<void> {
  await slackApi(botToken, "chat.update", { channel: ref.channel, ts: ref.ts, ...payload });
}

/** Who the bot is, for the channel check. */
export async function slackIdentity(botToken: string): Promise<{ user: string; team: string }> {
  const answer = await slackApi(botToken, "auth.test", {});
  return { user: answer.user ?? "bot", team: answer.team ?? "" };
}
