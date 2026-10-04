/**
 * `/api/integrations` — inbound third-party callbacks (ADR 0016 §8).
 *
 * POST /slack/interactions is public (Slack cannot send a CHouse session), so
 * it authenticates the request with Slack's signing secret instead, and every
 * decision is authorized against the CHouse user mapped from the Slack user.
 */

import { Hono } from "hono";

import { handleInteraction, slackConfigured, verifySlackSignature } from "../services/remediation/slack";
import { logger } from "../utils/logger";

const integrations = new Hono();

integrations.post("/slack/interactions", async (c) => {
  if (!slackConfigured()) return c.json({ success: false, error: "Slack approvals are not configured" }, 404);
  const raw = await c.req.text();
  const valid = verifySlackSignature(raw, c.req.header("X-Slack-Request-Timestamp"), c.req.header("X-Slack-Signature"), process.env.SLACK_SIGNING_SECRET ?? "");
  if (!valid) return c.json({ success: false, error: "Invalid signature" }, 401);
  const payloadRaw = new URLSearchParams(raw).get("payload");
  if (!payloadRaw) return c.json({ success: false, error: "Missing payload" }, 400);
  let payload: Parameters<typeof handleInteraction>[0];
  try {
    payload = JSON.parse(payloadRaw) as Parameters<typeof handleInteraction>[0];
  } catch {
    return c.json({ success: false, error: "Malformed payload" }, 400);
  }
  const result = await handleInteraction(payload);
  // Update the original message asynchronously; Slack only needs a fast 200.
  if (payload.response_url?.startsWith("https://hooks.slack.com/")) {
    void fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace_original: result.replaceOriginal, text: result.text, ...(result.blocks ? { blocks: result.blocks } : {}), response_type: "ephemeral" }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => logger.warn({ module: "Remediation", err: error instanceof Error ? error.message : String(error) }, "Slack response_url update failed"));
  }
  return c.body(null, 200);
});

export default integrations;
