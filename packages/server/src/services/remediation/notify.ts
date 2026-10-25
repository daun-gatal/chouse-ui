/**
 * Remediation approvals on alert channels (ADR 0026 §6). A proposed action is
 * posted to the channels chosen in Admin › Alerting, with Approve and Reject
 * where the channel can carry buttons; every message about it is updated when
 * someone approves, rejects, or the action runs. The Slack bot configured by
 * environment variables (ADR 0016 §8) keeps posting as before.
 */

import { z } from "zod";

import { editSubject, notifyChannelIds, type NotifyMessage } from "../alerting/notify";
import { registerChatAction } from "../alerting/notify/actions";
import { linkTo } from "../alerting/notify/links";
import { one, run, sql, str } from "../observe/db";
import { logger } from "../../utils/logger";
import * as store from "./store";

const SETTINGS_KEY = "remediation_notify";

export const remediationNotifySchema = z.object({ channelIds: z.array(z.string().min(1)).max(20) }).strict();
export type RemediationNotifySettings = z.infer<typeof remediationNotifySchema>;

export async function getRemediationNotify(): Promise<RemediationNotifySettings> {
  const row = await one(sql`SELECT value FROM obs_settings WHERE setting_key = ${SETTINGS_KEY}`);
  if (!row) return { channelIds: [] };
  try {
    const parsed = remediationNotifySchema.safeParse(JSON.parse(str(row.value)));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through to the default.
  }
  logger.warn({ module: "Remediation" }, "Stored remediation channels are invalid; sending to none");
  return { channelIds: [] };
}

export async function saveRemediationNotify(settings: RemediationNotifySettings, actorId: string | null): Promise<RemediationNotifySettings> {
  const value = JSON.stringify({ channelIds: [...new Set(settings.channelIds)] });
  const now = Date.now();
  await run(sql`
    INSERT INTO obs_settings (setting_key, value, updated_by, updated_at) VALUES (${SETTINGS_KEY}, ${value}, ${actorId}, ${now})
    ON CONFLICT (setting_key) DO UPDATE SET value = ${value}, updated_by = ${actorId}, updated_at = ${now}`);
  return getRemediationNotify();
}

const STATUS_LINE: Partial<Record<store.ActionStatus, string>> = {
  approved: "✅ Approved — runs in the next maintenance window or on Run now",
  executing: "⏳ Running",
  executed: "✅ Ran; verifying",
  verified: "✅ Ran and verified",
  failed_verification: "⚠️ Ran, but verification failed",
  failed: "❌ Failed",
  rolled_back: "↩️ Rolled back",
  rejected: "⛔ Rejected",
};

/** The approval request as it stands: buttons while it waits, a status line after. */
export function remediationMessage(action: store.RemediationAction, approvalsGiven: number): NotifyMessage {
  const needed = action.approvalClass === 2 ? 2 : 1;
  const waiting = action.status === "proposed";
  const status = waiting ? (approvalsGiven > 0 ? `${approvalsGiven} of ${needed} approvals` : `Waiting for ${needed === 2 ? "two approvers" : "an approver"}`) : STATUS_LINE[action.status] ?? action.status;
  return {
    title: `Remediation approval: ${action.title}`.slice(0, 150),
    severity: waiting ? "warning" : action.status === "failed" || action.status === "failed_verification" ? "critical" : action.status === "rejected" ? "info" : "success",
    text: action.rationale ?? undefined,
    facts: [
      { label: "Risk", value: action.approvalClass === 2 ? "Class 2 · two approvers, not the proposer" : "Class 1 · one approver" },
      { label: "When", value: action.windowOnly ? "Maintenance window only" : "Runs once approved" },
      { label: "Status", value: status },
    ],
    detail: action.previewSql.slice(0, 1500),
    buttons: waiting
      ? [
          { action: "remediation.approve", label: "Approve", value: action.id, style: "primary" },
          { action: "remediation.reject", label: "Reject", value: action.id, style: "danger" },
        ]
      : [],
    links: linkTo("Open in CHouse", "/data/incidents"),
    footer: `Verify: ${action.verification.description}`.slice(0, 200),
  };
}

async function approvalsOf(actionId: string): Promise<number> {
  return (await store.listApprovals(actionId)).filter((a) => a.decision === "approve").length;
}

/** Post a newly proposed action to the remediation channels. Never throws. */
export async function notifyProposed(action: store.RemediationAction): Promise<void> {
  try {
    const { channelIds } = await getRemediationNotify();
    if (channelIds.length === 0) return;
    await notifyChannelIds(channelIds, remediationMessage(action, 0), { feature: "remediation", subjectId: action.id });
  } catch (error) {
    logger.warn({ module: "Remediation", actionId: action.id, err: error instanceof Error ? error.message : String(error) }, "Could not post the approval request");
  }
}

const SETTLED: store.ActionStatus[] = ["verified", "failed_verification", "failed", "rolled_back", "rejected"];

/** Bring every message about this action up to date. Never throws. */
export async function refreshRemediationMessages(actionId: string): Promise<void> {
  try {
    const action = await store.getAction(actionId);
    if (!action) return;
    const message = remediationMessage(action, await approvalsOf(actionId));
    await editSubject("remediation", actionId, message, { close: SETTLED.includes(action.status) });
  } catch (error) {
    logger.warn({ module: "Remediation", actionId, err: error instanceof Error ? error.message : String(error) }, "Could not update the approval messages");
  }
}

registerChatAction({
  action: "remediation.approve",
  run: async (api, actionId) => {
    const outcome = await api.post<{ approvalsGiven: number; approvalsNeeded: number; action: { status: string } }>(`/api/remediation/actions/${encodeURIComponent(actionId)}/approve`, {});
    return outcome.action.status === "approved" ? "Approved." : `Approval recorded (${outcome.approvalsGiven} of ${outcome.approvalsNeeded}).`;
  },
});

registerChatAction({
  action: "remediation.reject",
  run: async (api, actionId) => {
    await api.post(`/api/remediation/actions/${encodeURIComponent(actionId)}/reject`, {});
    return "Rejected.";
  },
});
