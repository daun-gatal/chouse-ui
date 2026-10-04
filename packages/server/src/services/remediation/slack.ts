/**
 * Slack approvals for remediation (ADR 0016 §8).
 *
 * Requests are posted with a bot token (SLACK_BOT_TOKEN) to
 * REMEDIATION_SLACK_CHANNEL; button clicks arrive at
 * POST /api/integrations/slack/interactions, verified with
 * SLACK_SIGNING_SECRET. The clicking Slack user is mapped to a CHouse user by
 * verified email, and that user's own permissions decide — Slack grants nothing.
 */

import { createHmac, timingSafeEqual } from "crypto";

import { getUserByEmail, getUserPermissions, getUserRoles } from "../../rbac/services/rbac";
import { logger } from "../../utils/logger";
import { approveAction, rejectAction, RemediationError, type Actor } from "./executor";
import type { RemediationAction } from "./store";

const MAX_SKEW_SECONDS = 5 * 60;

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.REMEDIATION_SLACK_CHANNEL);
}

/** Slack request signing: v0=HMAC_SHA256(secret, "v0:{ts}:{body}"). */
export function verifySlackSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await response.json()) as T & { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? response.status}`);
  return json;
}

export function approvalBlocks(action: RemediationAction, baseUrl: string | null, status?: string): Array<Record<string, unknown>> {
  const link = baseUrl ? `<${baseUrl}/operate/remediation/${action.id}|Open in CHouse UI>` : "";
  const blocks: Array<Record<string, unknown>> = [
    { type: "header", text: { type: "plain_text", text: `Remediation approval: ${action.title}`.slice(0, 150) } },
    { type: "section", text: { type: "mrkdwn", text: `*Class ${action.approvalClass}* ${action.approvalClass === 2 ? "(two approvers, not the proposer)" : "(one approver)"} · ${action.windowOnly ? "maintenance window only" : "runs once approved"}\n${action.rationale ?? ""}`.slice(0, 2900) } },
    { type: "section", text: { type: "mrkdwn", text: `\`\`\`${action.previewSql.slice(0, 2800)}\`\`\`` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `Verify: ${action.verification.description}${link ? ` · ${link}` : ""}` }] },
  ];
  if (status) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: status } });
  } else {
    blocks.push({
      type: "actions",
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, action_id: "remediation_approve", value: action.id },
        { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" }, action_id: "remediation_reject", value: action.id },
      ],
    });
  }
  return blocks;
}

export async function postApprovalRequest(action: RemediationAction): Promise<void> {
  if (!slackConfigured()) return;
  try {
    await slackApi("chat.postMessage", {
      channel: process.env.REMEDIATION_SLACK_CHANNEL,
      text: `Remediation approval requested: ${action.title}`,
      blocks: approvalBlocks(action, process.env.PUBLIC_BASE_URL ?? null),
    });
  } catch (error) {
    logger.warn({ module: "Remediation", actionId: action.id, err: error instanceof Error ? error.message : String(error) }, "Slack approval request failed");
  }
}

interface SlackInteraction {
  type: string;
  user: { id: string };
  actions?: Array<{ action_id: string; value: string }>;
  response_url?: string;
}

/** Map the Slack user to a CHouse user by verified email; null when there is none. */
async function actorFor(slackUserId: string): Promise<Actor | null> {
  const info = await slackApi<{ user?: { profile?: { email?: string }; is_email_confirmed?: boolean } }>("users.info", { user: slackUserId });
  const email = info.user?.profile?.email;
  if (!email || info.user?.is_email_confirmed === false) return null;
  const user = await getUserByEmail(email);
  if (!user || !user.isActive) return null;
  return { id: user.id, roles: await getUserRoles(user.id), permissions: await getUserPermissions(user.id) };
}

export async function handleInteraction(payload: SlackInteraction): Promise<{ text: string; replaceOriginal: boolean; blocks?: Array<Record<string, unknown>> }> {
  const clicked = payload.actions?.[0];
  if (payload.type !== "block_actions" || !clicked || !["remediation_approve", "remediation_reject"].includes(clicked.action_id)) {
    return { text: "Unsupported interaction", replaceOriginal: false };
  }
  const actor = await actorFor(payload.user.id);
  if (!actor) return { text: "Your Slack email is not linked to an active CHouse UI user.", replaceOriginal: false };
  try {
    if (clicked.action_id === "remediation_reject") {
      const action = await rejectAction(clicked.value, actor, "slack", null);
      return { text: `Rejected by <@${payload.user.id}>`, replaceOriginal: true, blocks: approvalBlocks(action, process.env.PUBLIC_BASE_URL ?? null, `:no_entry: Rejected by <@${payload.user.id}>`) };
    }
    const outcome = await approveAction(clicked.value, actor, "slack", null);
    const done = outcome.action.status === "approved";
    const status = done
      ? `:white_check_mark: Approved by <@${payload.user.id}> — ${outcome.action.windowOnly ? "runs in the next maintenance window" : "running now"}`
      : `:hourglass: ${outcome.approvalsGiven}/${outcome.approvalsNeeded} approvals (latest: <@${payload.user.id}>)`;
    return { text: status, replaceOriginal: true, blocks: approvalBlocks(outcome.action, process.env.PUBLIC_BASE_URL ?? null, done ? status : undefined) };
  } catch (error) {
    const message = error instanceof RemediationError ? error.message : "The action could not be updated";
    return { text: message, replaceOriginal: false };
  }
}
