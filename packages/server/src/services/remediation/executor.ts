/**
 * Remediation lifecycle (ADR 0016 §8): propose → approve → execute → verify,
 * with rollback and rejection.
 *
 * Safety properties enforced here, not in the UI:
 * - parameters are re-validated against the catalog on every transition;
 * - approvals require `remediation:approve` (class 1) or
 *   `remediation:approve_high` (class 2: two distinct approvers, never the
 *   proposer); AI and MCP proposals can never be approved by their proposer;
 * - preconditions are re-checked right before execution — if the captured
 *   prior state changed since approval, execution is refused;
 * - SQL runs only with the connection's dedicated remediation credential;
 *   there is no fallback to the read credential;
 * - window-only actions run only inside REMEDIATION_MAINTENANCE_WINDOW.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { randomUUID } from "crypto";

import { PERMISSIONS } from "../../rbac/schema/base";
import { AUDIT_ACTIONS } from "../../rbac/schema/base";
import { createAuditLog } from "../../rbac/services/rbac";
import { getConnectionWithPassword } from "../../rbac/services/connections";
import type { ConnectionConfig } from "../../types";
import { logger } from "../../utils/logger";
import { ClientManager } from "../clientManager";
import { clientForConnection } from "../scheduledQueries/chClient";
import { setJobEnabled, getJob } from "../scheduledQueries/store";
import { acquireLease } from "../observe/lease";
import { actionParamsSchema, buildAction, compare, quoteString, type ActionParams, type PriorState } from "./catalog";
import * as store from "./store";

export class RemediationError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "forbidden" | "conflict" | "not_found" | "precondition" | "no_credential",
  ) {
    super(message);
  }
}

export interface Actor {
  id: string;
  roles: string[];
  permissions: string[];
}

function isSuperAdmin(actor: Actor): boolean {
  return actor.roles.includes("super_admin");
}

function can(actor: Actor, permission: string): boolean {
  return isSuperAdmin(actor) || actor.permissions.includes(permission);
}

// --- maintenance window ------------------------------------------------------

/** "HH:MM-HH:MM" in UTC (may wrap midnight). Default 02:00-04:00 UTC. */
export function parseWindow(raw: string | undefined): { start: number; end: number } {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!match) return { start: 120, end: 240 };
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return { start: start % 1440, end: end % 1440 };
}

export function inWindow(nowMs: number, window: { start: number; end: number }): boolean {
  const date = new Date(nowMs);
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return window.start <= window.end ? minute >= window.start && minute < window.end : minute >= window.start || minute < window.end;
}

const WINDOW = (): { start: number; end: number } => parseWindow(process.env.REMEDIATION_MAINTENANCE_WINDOW);

// --- clients -----------------------------------------------------------------

async function remediationClient(connectionId: string, actionId: string): Promise<ClickHouseClient> {
  const conn = await getConnectionWithPassword(connectionId);
  if (!conn) throw new RemediationError(`Connection ${connectionId} not found`, "not_found");
  const credential = await store.getCredential(connectionId);
  if (!credential) {
    throw new RemediationError("Cannot execute: no remediation credential is configured for this connection", "no_credential");
  }
  const config: ConnectionConfig = {
    url: `${conn.sslEnabled ? "https" : "http"}://${conn.host}:${conn.port}`,
    username: credential.username,
    password: credential.password,
    database: conn.database || undefined,
  };
  return ClientManager.getInstance().getClient(config, JSON.stringify({ source: "remediation", action_id: actionId }));
}

async function readClient(connectionId: string): Promise<ClickHouseClient> {
  return clientForConnection(connectionId, JSON.stringify({ source: "remediation_preflight" }));
}

async function queryRows(client: ClickHouseClient, query: string): Promise<Array<Record<string, unknown>>> {
  const result = await client.query({ query, format: "JSONEachRow", clickhouse_settings: { readonly: "1", max_execution_time: 15 } });
  return (await result.json()) as Array<Record<string, unknown>>;
}

/** Render a user/role/profile SETTINGS list from system.settings_profile_elements. */
export function renderSettingsElements(rows: Array<Record<string, unknown>>): string {
  return rows
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((row) => {
      if (row.inherit_profile) return `PROFILE ${quoteString(String(row.inherit_profile))}`;
      const name = String(row.setting_name ?? "");
      if (!name) return null;
      const parts = [name];
      if (row.value !== null && row.value !== undefined && row.value !== "") parts.push(`= ${quoteString(String(row.value))}`);
      if (row.min !== null && row.min !== undefined && row.min !== "") parts.push(`MIN ${quoteString(String(row.min))}`);
      if (row.max !== null && row.max !== undefined && row.max !== "") parts.push(`MAX ${quoteString(String(row.max))}`);
      const writability = row.writability ?? (Number(row.readonly) === 1 ? "CONST" : null);
      if (writability && writability !== "") parts.push(String(writability));
      return parts.join(" ");
    })
    .filter((s): s is string => s !== null)
    .join(", ");
}

/** Extract the TTL clause (without the keyword) from a CREATE TABLE statement. */
export function extractTtl(createQuery: string): string {
  const match = /\bTTL\s+([\s\S]+?)(?=\s+SETTINGS\s|\s+COMMENT\s|$)/i.exec(createQuery);
  return match ? match[1].trim() : "";
}

export async function readPriorState(connectionId: string, params: ActionParams): Promise<PriorState> {
  if (params.type !== "set_profile_setting" && params.type !== "modify_ttl" && params.type !== "modify_column_codec") return {};
  const client = await readClient(connectionId);
  if (params.type === "set_profile_setting") {
    const column = params.targetKind === "profile" ? "profile_name" : params.targetKind === "user" ? "user_name" : "role_name";
    const rows = await queryRows(client, `SELECT * FROM system.settings_profile_elements WHERE ${column} = ${quoteString(params.targetName)}`);
    return { settingsList: renderSettingsElements(rows) };
  }
  if (params.type === "modify_ttl") {
    const rows = await queryRows(client, `SELECT create_table_query FROM system.tables WHERE database = ${quoteString(params.database)} AND name = ${quoteString(params.table)}`);
    if (rows.length === 0) throw new RemediationError(`Table ${params.database}.${params.table} not found`, "precondition");
    return { ttl: extractTtl(String(rows[0].create_table_query ?? "")) };
  }
  const rows = await queryRows(client, `SELECT compression_codec FROM system.columns WHERE database = ${quoteString(params.database)} AND table = ${quoteString(params.table)} AND name = ${quoteString(params.column)}`);
  if (rows.length === 0) throw new RemediationError(`Column ${params.database}.${params.table}.${params.column} not found`, "precondition");
  return { codec: String(rows[0].compression_codec ?? "") };
}

// --- propose / approve / reject ----------------------------------------------

export interface ProposeInput {
  connectionId: string;
  params: unknown;
  title?: string;
  rationale?: string | null;
  proposedBy: string | null;
  proposedSource: store.ProposedSource;
  incidentSource?: string | null;
  incidentId?: string | null;
  notebookId?: string | null;
}

export async function proposeAction(input: ProposeInput): Promise<store.RemediationAction> {
  const parsed = actionParamsSchema.safeParse(input.params);
  if (!parsed.success) throw new RemediationError(parsed.error.issues.map((i) => i.message).join("; "), "invalid");
  const params = parsed.data;
  if ((params.type === "pause_scheduled_job" || params.type === "resume_scheduled_job" || params.type === "delay_scheduled_job") && !(await getJob(params.jobId))) {
    throw new RemediationError(`Scheduled job ${params.jobId} not found`, "not_found");
  }
  const prior = await readPriorState(input.connectionId, params);
  const built = buildAction(params, prior);
  const id = await store.createAction({
    connectionId: input.connectionId,
    params,
    prior,
    title: input.title?.trim() || built.preview,
    rationale: input.rationale ?? null,
    proposedBy: input.proposedBy,
    proposedSource: input.proposedSource,
    incidentSource: input.incidentSource ?? null,
    incidentId: input.incidentId ?? null,
    notebookId: input.notebookId ?? null,
    previewSql: built.statements.length > 0 ? built.statements.join(";\n") : built.preview,
    rollbackSql: built.rollback ? built.rollback.join(";\n") : null,
    verification: built.verification,
    approvalClass: built.approvalClass,
    windowOnly: built.windowOnly,
  });
  await createAuditLog(AUDIT_ACTIONS.REMEDIATION_PROPOSE, input.proposedBy ?? undefined, {
    resourceType: "remediation_action",
    resourceId: id,
    details: { type: params.type, connectionId: input.connectionId, source: input.proposedSource },
  });
  const action = await store.getAction(id);
  if (!action) throw new RemediationError("Action was not stored", "conflict");
  return action;
}

export interface ApprovalOutcome {
  action: store.RemediationAction;
  approvalsNeeded: number;
  approvalsGiven: number;
}

export async function approveAction(actionId: string, actor: Actor, channel: store.ApprovalChannel, comment: string | null): Promise<ApprovalOutcome> {
  const action = await store.getAction(actionId);
  if (!action) throw new RemediationError("Action not found", "not_found");
  if (action.status !== "proposed") throw new RemediationError(`Action is ${action.status}; only proposed actions can be approved`, "conflict");
  const permission = action.approvalClass === 2 ? PERMISSIONS.REMEDIATION_APPROVE_HIGH : PERMISSIONS.REMEDIATION_APPROVE;
  if (!can(actor, permission)) throw new RemediationError(`Approving this action requires ${permission}`, "forbidden");
  // Only a human proposing a class-1 action may approve it themselves. High-risk
  // actions, and anything proposed by AI or an agent, need someone else.
  const selfApprovalAllowed = action.approvalClass === 1 && action.proposedSource === "user";
  if (!selfApprovalAllowed && action.proposedBy === actor.id) {
    throw new RemediationError("The proposer cannot approve this action", "forbidden");
  }
  // Re-validate the stored parameters against the current catalog.
  if (!actionParamsSchema.safeParse(action.params).success) throw new RemediationError("Stored parameters are no longer valid", "invalid");

  await store.addApproval(actionId, actor.id, channel, "approve", comment);
  const counted = (await store.listApprovals(actionId)).filter(
    (a) => a.decision === "approve" && (selfApprovalAllowed || a.approverId !== action.proposedBy),
  );
  const needed = action.approvalClass === 2 ? 2 : 1;
  await createAuditLog(AUDIT_ACTIONS.REMEDIATION_APPROVE, actor.id, { resourceType: "remediation_action", resourceId: actionId, details: { channel, approvals: counted.length, needed } });
  if (counted.length >= needed) {
    await store.transitionStatus(actionId, ["proposed"], "approved");
  }
  const updated = await store.getAction(actionId);
  return { action: updated ?? action, approvalsNeeded: needed, approvalsGiven: counted.length };
}

export async function rejectAction(actionId: string, actor: Actor, channel: store.ApprovalChannel, comment: string | null): Promise<store.RemediationAction> {
  const action = await store.getAction(actionId);
  if (!action) throw new RemediationError("Action not found", "not_found");
  if (!can(actor, PERMISSIONS.REMEDIATION_APPROVE) && !can(actor, PERMISSIONS.REMEDIATION_APPROVE_HIGH) && action.proposedBy !== actor.id) {
    throw new RemediationError("Rejecting this action requires an approve permission", "forbidden");
  }
  const ok = await store.transitionStatus(actionId, ["proposed", "approved"], "rejected");
  if (!ok) throw new RemediationError(`Action is ${action.status}; it can no longer be rejected`, "conflict");
  await store.addApproval(actionId, actor.id, channel, "reject", comment);
  await createAuditLog(AUDIT_ACTIONS.REMEDIATION_REJECT, actor.id, { resourceType: "remediation_action", resourceId: actionId, details: { channel } });
  return (await store.getAction(actionId)) ?? action;
}

// --- execution ---------------------------------------------------------------

function samePrior(a: PriorState, b: PriorState): boolean {
  return (a.settingsList ?? "") === (b.settingsList ?? "") && (a.ttl ?? "") === (b.ttl ?? "") && (a.codec ?? "") === (b.codec ?? "");
}

async function runInternal(action: store.RemediationAction, internal: NonNullable<ReturnType<typeof buildAction>["internal"]>): Promise<void> {
  if (internal.kind === "job_resume") {
    await setJobEnabled(internal.jobId, true);
    return;
  }
  await setJobEnabled(internal.jobId, false);
  if (internal.kind === "job_delay" && internal.until) {
    await store.setStoredParams(action.id, { params: action.params, prior: action.prior, resumeAt: internal.until });
  }
}

export async function executeAction(actionId: string, nowMs = Date.now()): Promise<store.RemediationAction> {
  const action = await store.getAction(actionId);
  if (!action) throw new RemediationError("Action not found", "not_found");
  if (action.windowOnly && !inWindow(nowMs, WINDOW())) throw new RemediationError("Outside the maintenance window", "precondition");
  if (!(await store.transitionStatus(actionId, ["approved"], "executing"))) {
    throw new RemediationError(`Action is ${action.status}; only approved actions run`, "conflict");
  }
  const parsed = actionParamsSchema.safeParse(action.params);
  if (!parsed.success) {
    await store.transitionStatus(actionId, ["executing"], "failed");
    throw new RemediationError("Stored parameters are no longer valid", "invalid");
  }
  let executionId: string | null = null;
  try {
    // Precondition: the state the approvers saw is still the state we act on.
    const current = await readPriorState(action.connectionId, parsed.data);
    if (!samePrior(current, action.prior)) {
      throw new RemediationError("The target changed since this action was approved; propose it again", "precondition");
    }
    const built = buildAction(parsed.data, action.prior);
    executionId = await store.startExecution(actionId, built.statements.join(";\n") || built.preview);
    if (built.internal) {
      await runInternal(action, built.internal);
    } else {
      const client = await remediationClient(action.connectionId, actionId);
      for (const statement of built.statements) {
        await client.command({ query: statement, clickhouse_settings: { max_execution_time: 600 } });
      }
    }
    await store.finishExecution(executionId, "succeeded", null);
    await store.transitionStatus(actionId, ["executing"], "executed");
    await createAuditLog(AUDIT_ACTIONS.REMEDIATION_EXECUTE, action.proposedBy ?? undefined, { resourceType: "remediation_action", resourceId: actionId, details: { type: action.type }, status: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (executionId) await store.finishExecution(executionId, "failed", message.slice(0, 2000));
    else await store.finishExecution(await store.startExecution(actionId, ""), "failed", message.slice(0, 2000));
    await store.transitionStatus(actionId, ["executing"], "failed");
    await createAuditLog(AUDIT_ACTIONS.REMEDIATION_EXECUTE, action.proposedBy ?? undefined, { resourceType: "remediation_action", resourceId: actionId, status: "failed", errorMessage: message.slice(0, 500) });
    throw error instanceof RemediationError ? error : new RemediationError(message, "precondition");
  }
  return (await store.getAction(actionId)) ?? action;
}

/** One verification probe; returns true when the action reached a terminal verification state. */
export async function verifyAction(action: store.RemediationAction, nowMs = Date.now()): Promise<boolean> {
  const execution = await store.latestExecution(action.id);
  if (!execution || execution.status !== "succeeded" || execution.finishedAt === null) return false;
  const spec = action.verification;
  const deadline = execution.finishedAt + spec.withinSeconds * 1000;
  let value: number | null = null;
  let ok = false;
  if (spec.sql === null) {
    if (action.params.type === "pause_scheduled_job" || action.params.type === "delay_scheduled_job" || action.params.type === "resume_scheduled_job") {
      const job = await getJob(action.params.jobId);
      const wantEnabled = action.params.type === "resume_scheduled_job";
      ok = job !== null && job.enabled === wantEnabled;
      value = ok ? 1 : 0;
    }
  } else {
    try {
      const rows = await queryRows(await readClient(action.connectionId), spec.sql);
      value = rows.length === 0 ? 0 : Number(rows[0].value ?? 0);
      ok = compare(value, spec.comparator, spec.threshold);
    } catch (error) {
      logger.warn({ module: "Remediation", actionId: action.id, err: error instanceof Error ? error.message : String(error) }, "Verification probe failed");
    }
  }
  if (ok) {
    await store.recordVerification(execution.id, { ok: true, value, checkedAt: nowMs, message: spec.description });
    await store.transitionStatus(action.id, ["executed"], "verified");
    return true;
  }
  if (nowMs >= deadline) {
    await store.recordVerification(execution.id, { ok: false, value, checkedAt: nowMs, message: `Not met within ${spec.withinSeconds}s: ${spec.description}` });
    await store.transitionStatus(action.id, ["executed"], "failed_verification");
    return true;
  }
  return false;
}

export async function rollbackAction(actionId: string, actor: Actor): Promise<store.RemediationAction> {
  const action = await store.getAction(actionId);
  if (!action) throw new RemediationError("Action not found", "not_found");
  const permission = action.approvalClass === 2 ? PERMISSIONS.REMEDIATION_APPROVE_HIGH : PERMISSIONS.REMEDIATION_APPROVE;
  if (!can(actor, permission)) throw new RemediationError(`Rolling back requires ${permission}`, "forbidden");
  if (!["executed", "verified", "failed_verification"].includes(action.status)) throw new RemediationError(`Action is ${action.status}; nothing to roll back`, "conflict");
  const built = buildAction(action.params, action.prior);
  if (!built.rollback && !built.internal) throw new RemediationError("This action type has no rollback", "invalid");
  if (built.internal) {
    // Scheduled-job pause/delay roll back by resuming; resume rolls back by pausing.
    await setJobEnabled(built.internal.jobId, built.internal.kind !== "job_resume");
  } else if (built.rollback) {
    const client = await remediationClient(action.connectionId, actionId);
    for (const statement of built.rollback) await client.command({ query: statement, clickhouse_settings: { max_execution_time: 600 } });
  }
  const execution = await store.latestExecution(actionId);
  if (execution) await store.markRolledBack(execution.id);
  await store.transitionStatus(actionId, ["executed", "verified", "failed_verification"], "rolled_back");
  await createAuditLog(AUDIT_ACTIONS.REMEDIATION_ROLLBACK, actor.id, { resourceType: "remediation_action", resourceId: actionId });
  return (await store.getAction(actionId)) ?? action;
}

// --- worker ------------------------------------------------------------------

const TICK_MS = 10_000;

/**
 * Single-holder worker (lease `remediation:worker`): runs approved actions
 * (respecting the window), polls verifications and resumes delayed jobs.
 */
export class RemediationWorker {
  private static instance: RemediationWorker | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly holder = randomUUID();

  static getInstance(): RemediationWorker {
    if (!RemediationWorker.instance) RemediationWorker.instance = new RemediationWorker();
    return RemediationWorker.instance;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!(await acquireLease("remediation:worker", this.holder, 60))) return;
      for (const action of await store.listActions({ status: ["approved"], limit: 50 })) {
        if (action.windowOnly && !inWindow(nowMs, WINDOW())) continue;
        try {
          await executeAction(action.id, nowMs);
        } catch (error) {
          logger.warn({ module: "Remediation", actionId: action.id, err: error instanceof Error ? error.message : String(error) }, "Remediation execution failed");
        }
      }
      for (const action of await store.listActions({ status: ["executed"], limit: 100 })) {
        await verifyAction(action, nowMs);
      }
      for (const action of await store.listActions({ status: ["verified", "executed"], limit: 100 })) {
        if (action.params.type === "delay_scheduled_job" && action.resumeAt !== null && action.resumeAt <= nowMs) {
          const job = await getJob(action.params.jobId);
          if (job && !job.enabled) {
            await setJobEnabled(action.params.jobId, true);
            await store.setStoredParams(action.id, { params: action.params, prior: action.prior });
          }
        }
      }
    } catch (error) {
      logger.error({ module: "Remediation", err: error instanceof Error ? error.message : String(error) }, "Remediation worker tick failed");
    } finally {
      this.busy = false;
    }
  }
}
