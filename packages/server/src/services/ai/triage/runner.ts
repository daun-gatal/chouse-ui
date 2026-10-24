/**
 * The auto-triage runner (ADR 0024 §Phase 4). One replica at a time holds the
 * lease and, every minute, looks at each enabled trigger for subjects newer
 * than its watermark. Each subject is claimed once, checked against the
 * cooldown and the daily token budget, investigated by the triage-incident
 * feature, written to its notebook and announced on the rule's channels.
 */

import { randomUUID } from "crypto";

import { getUserPermissions, getUserRoles } from "../../../rbac/services/rbac";
import { logger } from "../../../utils/logger";
import { decryptChannelConfig, getChannel } from "../../alerting/store";
import { sendChannelMessage } from "../../alerting/deliver";
import { addCell, ensureNotebook } from "../../notebooks/store";
import { acquireLease } from "../../observe/lease";
import { runStructuredCapability } from "../engine";
import { triageIncidentCapability, type TriageFindings } from "../capabilities/triage";
import { parseToolResult } from "../runtime/chatOutput";
import type { AgentRunContext } from "../types";
import { newSubjects, TRIGGER_LABELS, type TriageSubject } from "./subjects";
import {
  claimRun,
  failStaleRuns,
  finishRun,
  lastInvestigatedAt,
  listRules,
  pruneRuns,
  setWatermark,
  tokensToday,
  type TriageRule,
  type TriageRun,
} from "./store";

const TICK_MS = 60_000;
const LEASE_KEY = "ai-triage";
const LEASE_TTL_SECONDS = 180;
/** A run still "running" after this long belonged to a replica that stopped. */
const STALE_RUN_MS = 30 * 60_000;
const HOLDER = `triage-${randomUUID()}`;

/** The run context: no user (usage is "background"), the rule owner's permissions for what it may propose. */
async function triageContext(rule: TriageRule, subject: TriageSubject): Promise<AgentRunContext> {
  const base: AgentRunContext = { connectionId: subject.connectionId ?? undefined };
  if (!rule.proposeAs) return base;
  try {
    const [permissions, roles] = await Promise.all([getUserPermissions(rule.proposeAs), getUserRoles(rule.proposeAs)]);
    return { ...base, proposeAs: rule.proposeAs, permissions, isAdmin: roles.includes("super_admin") };
  } catch {
    // The person who set the rule up is gone: investigate, but propose nothing.
    return base;
  }
}

/** The notebook cell: notebooks show findings as plain text. */
function findingsText(findings: TriageFindings, actionCount: number): string {
  const lines = [`Auto-triage · ${findings.severity} severity · ${findings.confidence} confidence`, "", findings.summary, "", `Likely cause: ${findings.likelyCause}`];
  if (findings.findings.length > 0) lines.push("", "What it checked:", ...findings.findings.map((f) => `- ${f}`));
  if (findings.nextSteps.length > 0) lines.push("", "Next steps:", ...findings.nextSteps.map((step, i) => `${i + 1}. ${step}`));
  if (actionCount > 0) lines.push("", `${actionCount} proposed action${actionCount === 1 ? "" : "s"} wait for approval in AI Governance › Approvals.`);
  return lines.join("\n");
}

async function notify(rule: TriageRule, subject: TriageSubject, findings: TriageFindings, actionCount: number): Promise<void> {
  const title = `CHouse AI investigated: ${subject.title}`.slice(0, 200);
  const text = [
    `${TRIGGER_LABELS[subject.trigger]} · ${findings.severity} severity · ${findings.confidence} confidence`,
    findings.summary,
    `Likely cause: ${findings.likelyCause}`,
    ...(actionCount > 0 ? [`${actionCount} proposed action(s) wait for approval in AI Governance › Approvals.`] : []),
  ].join("\n");
  for (const channelId of rule.channelIds) {
    try {
      const channel = await getChannel(channelId);
      if (!channel || !channel.enabled) continue;
      await sendChannelMessage(channel.type, decryptChannelConfig(channel.type, JSON.parse(channel.config) as Record<string, unknown>), { title, text });
    } catch (error) {
      logger.warn({ module: "AiTriage", channelId, err: error instanceof Error ? error.message : String(error) }, "Could not deliver the triage notice");
    }
  }
}

/** Action ids the agent proposed, from its tool results (ToolMessages or JSON). */
function proposedActionIds(calls: Array<{ result?: unknown }>): string[] {
  const ids: string[] = [];
  for (const call of calls) {
    const value = parseToolResult(call.result);
    if (value && typeof value === "object" && (value as { proposed?: unknown }).proposed === true) {
      const id = (value as { actionId?: unknown }).actionId;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

/**
 * Investigate one subject under one rule. Returns the finished run, or null
 * when the subject was already claimed.
 */
export async function triageSubject(rule: TriageRule, subject: TriageSubject, now = Date.now()): Promise<TriageRun | null> {
  const claimed = await claimRun(subject);
  if (!claimed) return null;

  if (rule.cooldownMinutes > 0) {
    const last = await lastInvestigatedAt(subject.trigger, subject.connectionId, claimed.id);
    if (last !== null && now - last < rule.cooldownMinutes * 60_000) {
      return finishRun(claimed.id, { status: "skipped", reason: `Cooldown: this connection was investigated less than ${rule.cooldownMinutes} minutes ago.` });
    }
  }
  const spent = await tokensToday(subject.trigger, now);
  if (spent >= rule.dailyTokenBudget) {
    return finishRun(claimed.id, { status: "skipped", reason: `Daily token budget used (${spent.toLocaleString("en-US")} of ${rule.dailyTokenBudget.toLocaleString("en-US")}).` });
  }

  let usage = { tokens: 0, costUsd: null as number | null };
  let calls: Array<{ result?: unknown }> = [];
  try {
    const ctx = await triageContext(rule, subject);
    const findings = await runStructuredCapability(
      triageIncidentCapability,
      { trigger: subject.trigger, title: subject.title, connectionId: subject.connectionId, evidence: subject.evidence },
      ctx,
      {
        ...(rule.agentId ? { agentId: rule.agentId } : {}),
        onUsage: (u) => { usage = u; },
        onTrace: (trace) => { calls = trace.calls; },
      },
    );
    const actionIds = proposedActionIds(calls);
    let notebookId: string | null = null;
    if (subject.notebook) {
      const notebook = await ensureNotebook(subject.notebook.kind, subject.notebook.ref, subject.title.slice(0, 200), null, subject.connectionId);
      await addCell(notebook.id, {
        kind: "ai_finding",
        summary: findingsText(findings, actionIds.length),
        status: findings.confidence,
        detail: { triageRunId: claimed.id, likelyCause: findings.likelyCause, severity: findings.severity, actionIds },
      }, "ai", null);
      notebookId = notebook.id;
    }
    const finished = await finishRun(claimed.id, {
      status: "completed",
      summary: findings.summary,
      result: { ...findings },
      notebookId,
      actionIds,
      tokens: usage.tokens,
      costUsd: usage.costUsd,
    });
    await notify(rule, subject, findings, actionIds.length);
    return finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The investigation failed";
    logger.warn({ module: "AiTriage", trigger: subject.trigger, subjectId: subject.id, err: message }, "Triage run failed");
    return finishRun(claimed.id, { status: "failed", error: message, tokens: usage.tokens, costUsd: usage.costUsd, actionIds: proposedActionIds(calls) });
  }
}

/** One pass over every enabled rule (exported for tests). */
export async function triageTick(): Promise<void> {
  for (const rule of await listRules()) {
    if (!rule.enabled) continue;
    for (const subject of await newSubjects(rule.trigger, rule.watermark)) {
      await triageSubject(rule, subject);
      await setWatermark(rule.trigger, subject.at);
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastPrune = 0;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    if (!(await acquireLease(LEASE_KEY, HOLDER, LEASE_TTL_SECONDS))) return;
    await failStaleRuns(STALE_RUN_MS);
    await triageTick();
    if (Date.now() - lastPrune > 24 * 3_600_000) {
      lastPrune = Date.now();
      await pruneRuns();
    }
  } catch (error) {
    logger.error({ module: "AiTriage", err: error instanceof Error ? error.message : String(error) }, "Triage tick failed");
  } finally {
    ticking = false;
  }
}

/** Start the runner once per process (index.ts). */
export function startTriageRunner(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}

export function stopTriageRunner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
