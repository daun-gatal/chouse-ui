/**
 * Chobi › Need You alerts (ADR 0026 §6). Requests that wait on a person —
 * a T3 change waiting for a second approver, a background proposal, an MCP or
 * CLI call held for its own user's confirmation — are sent to the team
 * channels chosen in AI Governance › Assistant › Chobi, once they have waited
 * the configured delay. Each request is alerted once per channel (the message
 * log is the claim, so any number of replicas can run the sweep), and every
 * message is edited once the request is decided, expires or finishes,
 * whichever replica or person settled it.
 *
 * Messages carry the action's description, who asked, where and when it
 * expires — never its raw arguments.
 */

import { randomUUID } from "crypto";
import { hostname } from "os";

import { AUDIT_ACTIONS } from "../../rbac/schema/base";
import { createAuditLog } from "../../rbac/services/rbac";
import { getConnectionById } from "../../rbac/services/connections";
import { logger } from "../../utils/logger";
import { getChannel } from "../alerting/store";
import { capabilitiesOf, editSubject, sendToChannel, type NotifyMessage } from "../alerting/notify";
import { registerChatAction } from "../alerting/notify/actions";
import { pruneLinkCodes } from "../alerting/notify/actors";
import { linkTo, publicBaseUrl } from "../alerting/notify/links";
import { pruneMessages } from "../alerting/notify/log";
import { actionDefinition } from "../ai/actions/definitions";
import { getAction, userNames, type AiAction } from "../ai/actions/store";
import { all, sql, str } from "../observe/db";
import { acquireLease } from "../observe/lease";
import { getChobiSettings, type ChobiAlerts } from "./settings";

export type NeedYouKind = "secondApprover" | "background" | "heldMcp";

/** Which Need You event an action is, or null when nobody else waits on it (chat actions). */
export function needYouKind(action: Pick<AiAction, "source" | "tier">): NeedYouKind | null {
  if (action.source === "held") return "heldMcp";
  if (action.source !== "background") return null;
  return action.tier === "t3" ? "secondApprover" : "background";
}

const ORIGIN: Record<AiAction["origin"], string> = { chat: "Chobi", mcp: "MCP", cli: "the CLI", background: "a background run" };

function waitingFor(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  return hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
}

const SETTLED_LINE: Partial<Record<AiAction["status"], string>> = {
  approved: "✅ Approved",
  running: "⏳ Running",
  executed: "✅ Done",
  failed: "❌ Approved, but it failed",
  rejected: "⛔ Declined",
  expired: "⌛ Expired without an answer",
};

export interface NeedYouContext {
  requester: string;
  decider: string | null;
  connection: string | null;
}

/** The alert as it stands: buttons while it waits (when the channel allows them), a status line after. */
export function needYouMessage(action: AiAction, kind: NeedYouKind, ctx: NeedYouContext, withButtons: boolean, now: number = Date.now()): NotifyMessage {
  const title = actionDefinition(action.tool)?.title ?? action.tool;
  const heading = kind === "secondApprover" ? `Needs a second approver: ${title}` : kind === "background" ? `Waiting for approval: ${title}` : `Waiting for ${ctx.requester} to confirm: ${title}`;
  const pending = action.status === "pending" && action.expiresAt > now;
  // A pending action past its deadline is expired, whether or not the sweep has marked it yet.
  const shown = action.status === "pending" && !pending ? "expired" : action.status;
  const status = pending
    ? `Waiting · expires in ${waitingFor((action.expiresAt - now) / 60_000)}`
    : `${SETTLED_LINE[shown] ?? shown}${ctx.decider && (action.status === "approved" || action.status === "rejected" || action.status === "executed" || action.status === "failed") ? ` by ${ctx.decider}` : ""}`;
  return {
    title: heading.slice(0, 150),
    severity: pending ? (kind === "secondApprover" ? "critical" : "warning") : shown === "failed" ? "critical" : shown === "rejected" || shown === "expired" ? "info" : "success",
    text: action.description,
    facts: [
      { label: "Requested by", value: `${ctx.requester} via ${ORIGIN[action.origin]}` },
      ...(ctx.connection ? [{ label: "Connection", value: ctx.connection }] : []),
      { label: "Status", value: status },
    ],
    buttons: pending && withButtons
      ? [
          { action: "ai_action.approve", label: kind === "heldMcp" ? "Confirm" : "Approve", value: action.id, style: "primary" },
          { action: "ai_action.reject", label: "Decline", value: action.id, style: "danger" },
        ]
      : [],
    links: linkTo("Review in CHouse", "/ai/approvals"),
  };
}

async function contextOf(action: AiAction): Promise<NeedYouContext> {
  const names = await userNames([action.userId, action.decidedBy]);
  const connection = action.connectionId ? (await getConnectionById(action.connectionId).catch(() => null))?.name ?? null : null;
  return { requester: names.get(action.userId) ?? "someone", decider: action.decidedBy ? names.get(action.decidedBy) ?? null : null, connection };
}

function wanted(alerts: ChobiAlerts, kind: NeedYouKind): boolean {
  return alerts.events[kind];
}

/** Send what is due. Returns how many messages went out. */
export async function sendDue(now: number = Date.now()): Promise<number> {
  const { alerts } = await getChobiSettings();
  if (!alerts.enabled || alerts.channels.length === 0) return 0;
  if (!publicBaseUrl()) {
    logger.warn({ module: "ChobiNeedYou" }, "Need You alerts are on but PUBLIC_BASE_URL is not set, so no review link can be built; nothing was sent");
    return 0;
  }
  const cutoff = now - alerts.delayMinutes * 60_000;
  const due = await all(sql`
    SELECT id FROM ai_actions
    WHERE status = 'pending' AND source IN ('background', 'held') AND expires_at > ${now} AND created_at <= ${cutoff}
    ORDER BY created_at LIMIT 50`);
  let sent = 0;
  for (const row of due) {
    const action = await getAction(str(row.id));
    const kind = action ? needYouKind(action) : null;
    if (!action || !kind || !wanted(alerts, kind)) continue;
    const ctx = await contextOf(action);
    const reached: string[] = [];
    for (const target of alerts.channels) {
      const channel = await getChannel(target.channelId);
      if (!channel || !channel.enabled) continue;
      const buttons = target.approveFromChat && capabilitiesOf(channel).actions;
      try {
        const result = await sendToChannel(channel, needYouMessage(action, kind, ctx, buttons, now), { feature: "need_you", subjectId: action.id });
        if (result.status === "sent") {
          reached.push(channel.name);
          sent++;
        }
      } catch (error) {
        logger.warn({ module: "ChobiNeedYou", actionId: action.id, channelId: channel.id, err: error instanceof Error ? error.message : String(error) }, "Could not send a Need You alert");
      }
    }
    if (reached.length > 0) {
      await createAuditLog(AUDIT_ACTIONS.CHOBI_ALERT_SENT, undefined, { resourceType: "ai_action", resourceId: action.id, details: { kind, tool: action.tool, channels: reached } })
        .catch((err) => logger.warn({ module: "ChobiNeedYou", err: String(err) }, "Could not audit a Need You alert"));
    }
  }
  return sent;
}

/** Bring the messages about one action up to date. Never throws. */
export async function refreshActionMessages(actionId: string, now: number = Date.now()): Promise<void> {
  try {
    const action = await getAction(actionId);
    if (!action) return;
    const kind = needYouKind(action);
    if (!kind) return;
    // A waiting request's messages are as they were sent; only a decided one changes.
    if (action.status === "pending" && action.expiresAt > now) return;
    const ctx = await contextOf(action);
    // Approved and running are on the way to an outcome: the message keeps following until it lands.
    const final = action.status !== "approved" && action.status !== "running";
    await editSubject("need_you", actionId, needYouMessage(action, kind, ctx, false, now), { close: final });
  } catch (error) {
    logger.warn({ module: "ChobiNeedYou", actionId, err: error instanceof Error ? error.message : String(error) }, "Could not update a Need You alert");
  }
}

/** Settle the messages of every action that stopped waiting (decided, expired, run) since they were sent. */
export async function settleOpen(now: number = Date.now()): Promise<number> {
  const open = await all(sql`
    SELECT DISTINCT m.subject_id FROM channel_messages m JOIN ai_actions a ON a.id = m.subject_id
    WHERE m.feature = 'need_you' AND m.closed_at IS NULL AND m.state = 'sent'
      AND (a.status <> 'pending' OR a.expires_at <= ${now})`);
  for (const row of open) await refreshActionMessages(str(row.subject_id), now);
  return open.length;
}

const TICK_MS = 15_000;
const LEASE_KEY = "chobi-need-you";
const LEASE_SECONDS = 60;
const HOLDER = `need-you-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const PRUNE_EVERY_MS = 6 * 60 * 60_000;

/** The sweep: one replica at a time sends what is due and settles what was decided. */
export class NeedYouSweeper {
  private static instance: NeedYouSweeper | null = null;

  static getInstance(): NeedYouSweeper {
    NeedYouSweeper.instance ??= new NeedYouSweeper();
    return NeedYouSweeper.instance;
  }

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastPrune = 0;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await acquireLease(LEASE_KEY, HOLDER, LEASE_SECONDS))) return;
      await sendDue(now);
      await settleOpen(now);
      if (now - this.lastPrune > PRUNE_EVERY_MS) {
        this.lastPrune = now;
        await pruneMessages(now);
        await pruneLinkCodes(now);
      }
    } catch (error) {
      logger.warn({ module: "ChobiNeedYou", err: error instanceof Error ? error.message : String(error) }, "Need You sweep failed");
    } finally {
      this.running = false;
    }
  }
}

registerChatAction({
  action: "ai_action.approve",
  run: async (api, actionId) => {
    const done = await api.post<{ status: string; error: string | null; source: string }>(`/api/ai-actions/${encodeURIComponent(actionId)}/approve`, {});
    if (done.source === "held") return "Confirmed. The waiting call runs now.";
    return done.status === "failed" ? `Approved, but it failed: ${done.error ?? "unknown error"}` : "Approved.";
  },
});

registerChatAction({
  action: "ai_action.reject",
  run: async (api, actionId) => {
    await api.post(`/api/ai-actions/${encodeURIComponent(actionId)}/reject`, {});
    return "Declined.";
  },
});
