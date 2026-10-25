/** Generic webhook delivery: the message's webhook body, with an optional bearer secret. */

import { clip, requestJson, webhookBody } from "../text";
import type { NotifyMessage } from "../types";

export async function postWebhook(config: Record<string, unknown>, message: NotifyMessage): Promise<void> {
  const url = String(config.url ?? "");
  if (!url) throw new Error("Webhook URL is not set");
  const secret = typeof config.secret === "string" ? config.secret : "";
  const res = await requestJson(url, {
    body: webhookBody(message),
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
    secrets: secret ? [secret] : [],
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.text ? `: ${clip(res.text, 200)}` : ""}`);
}
